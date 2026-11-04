'use strict';

// Chat da equipa do painel, em tempo real: o administrador e os agentes de
// todos os estúdios falam numa conversa geral ou a dois. As mensagens chegam
// por Server-Sent Events (GET /stream) — uma ligação aberta por separador, sem
// bibliotecas extra; o envio é um POST normal.
//
// Conversas: 'geral' (toda a equipa ativa) e 'dm:<a>-<b>' (os dois ids, o
// menor primeiro). Só quem lá está lê ou escreve.

const express = require('express');
const { db } = require('../lib/db');
const U = require('../lib/util');
const { HttpError } = U;

const router = express.Router();
const MAX_CORPO = 2000;

// ------------------------------------------------------------ Ligações abertas
// userId -> Set de respostas SSE (a mesma pessoa pode ter vários separadores).
const ligacoes = new Map();

function enviar(res, evento, dados) {
  res.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
}
function enviarA(userIds, evento, dados) {
  for (const id of userIds) for (const res of ligacoes.get(id) || []) enviar(res, evento, dados);
}
const online = () => [...ligacoes.keys()];
function avisarPresenca() {
  const ids = online();
  enviarA(ids, 'presenca', { online: ids });
}

// Fecha todas as ligações (ao desligar o servidor, para o server.close acabar).
function fechar() {
  for (const set of ligacoes.values()) for (const res of set) res.end();
  ligacoes.clear();
}

// ------------------------------------------------------------ Conversas
const dm = (a, b) => `dm:${Math.min(a, b)}-${Math.max(a, b)}`;

// Quem pertence à conversa (ids) — ou erro se quem pede não pertence.
function membros(req, channel) {
  if (channel === 'geral') return db.prepare('SELECT id FROM users WHERE active=1').all().map((u) => u.id);
  const m = /^dm:(\d+)-(\d+)$/.exec(channel);
  if (m) {
    const a = U.toInt(m[1]), b = U.toInt(m[2]);
    if (a < b && (req.user.id === a || req.user.id === b)) {
      const outro = req.user.id === a ? b : a;
      if (db.prepare('SELECT 1 FROM users WHERE id=?').get(outro)) return [a, b];
    }
  }
  throw new HttpError(404, 'Conversa não encontrada.');
}

const MSG_SELECT = `SELECT m.id, m.channel, m.user_id, m.body, m.created_at, COALESCE(u.name, 'Utilizador removido') AS user_name
  FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;

function lido(userId, channel) {
  const r = db.prepare('SELECT last_id FROM chat_reads WHERE user_id=? AND channel=?').get(userId, channel);
  return r ? r.last_id : 0;
}
function resumo(userId, channel) {
  const ultima = db.prepare(`${MSG_SELECT} WHERE m.channel=? ORDER BY m.id DESC LIMIT 1`).get(channel) || null;
  const porLer = db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE channel=? AND id>? AND COALESCE(user_id,0)<>?')
    .get(channel, lido(userId, channel), userId).n;
  return { last: ultima, unread: porLer };
}

// ------------------------------------------------------------ Rotas

// Lista para o painel do chat: a conversa geral e uma por colega, com quem está
// ligado agora e quantas mensagens estão por ler.
router.get('/', (req, res) => {
  const me = req.user.id;
  const ids = new Set(online());
  const colegas = db.prepare(
    `SELECT u.id, u.name, u.role, u.studio_id, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON s.id = u.studio_id
      WHERE u.active=1 AND u.id<>? ORDER BY u.role='owner' DESC, u.name`
  ).all(me).map((u) => ({
    id: u.id, name: u.name, studio_name: u.studio_name || '',
    role: u.role === 'owner' ? 'owner' : u.studio_id ? 'agent' : 'staff',
    online: ids.has(u.id), channel: dm(me, u.id), ...resumo(me, dm(me, u.id)),
  }));
  res.json({ me, geral: { channel: 'geral', ...resumo(me, 'geral') }, contacts: colegas });
});

// Ligação em tempo real. Fica aberta; um comentário de 25 em 25 s impede que
// proxies a fechem por inatividade.
router.get('/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const id = req.user.id;
  if (!ligacoes.has(id)) ligacoes.set(id, new Set());
  ligacoes.get(id).add(res);
  avisarPresenca();
  const batida = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(batida);
    const set = ligacoes.get(id);
    if (set) { set.delete(res); if (!set.size) ligacoes.delete(id); }
    avisarPresenca();
  });
});

// As últimas 50 mensagens (ou as 50 antes de ?before=id, para ver mais antigas).
router.get('/:channel/messages', (req, res) => {
  const channel = req.params.channel;
  membros(req, channel);
  const before = U.toInt(req.query.before);
  const rows = db.prepare(`${MSG_SELECT} WHERE m.channel=?${before ? ' AND m.id<?' : ''} ORDER BY m.id DESC LIMIT 50`)
    .all(...(before ? [channel, before] : [channel]));
  res.json({ messages: rows.reverse() });
});

router.post('/:channel/messages', (req, res) => {
  const channel = req.params.channel;
  const quem = membros(req, channel);
  const body = String((req.body || {}).body || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_CORPO);
  if (!body) throw new HttpError(400, 'Escreva uma mensagem.');
  const id = db.prepare('INSERT INTO chat_messages(channel,user_id,body,created_at) VALUES(?,?,?,?)')
    .run(channel, req.user.id, body, new Date().toISOString()).lastInsertRowid;
  // Quem escreve já leu o que escreveu.
  db.prepare(`INSERT INTO chat_reads(user_id,channel,last_id) VALUES(?,?,?)
    ON CONFLICT(user_id,channel) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)`).run(req.user.id, channel, id);
  const msg = db.prepare(`${MSG_SELECT} WHERE m.id=?`).get(id);
  enviarA(quem, 'mensagem', msg);
  res.status(201).json({ message: msg });
});

router.post('/:channel/read', (req, res) => {
  const channel = req.params.channel;
  membros(req, channel);
  const ultimo = db.prepare('SELECT COALESCE(MAX(id),0) m FROM chat_messages WHERE channel=?').get(channel).m;
  db.prepare(`INSERT INTO chat_reads(user_id,channel,last_id) VALUES(?,?,?)
    ON CONFLICT(user_id,channel) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)`).run(req.user.id, channel, ultimo);
  res.json({ ok: true });
});

module.exports = { router, fechar };
