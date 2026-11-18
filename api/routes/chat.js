'use strict';

// Chat da equipa do painel, em tempo real: conversas a dois entre o
// administrador e os agentes de todos os estúdios. Cada mensagem é de uma
// pessoa para outra (não há conversa de grupo). As mensagens chegam por
// Server-Sent Events (GET /stream) — uma ligação aberta por separador, sem
// bibliotecas extra; o envio é um POST normal.
//
// Conversas: 'dm:<a>-<b>' (os dois ids, o menor primeiro). Só essas duas
// pessoas lêem ou escrevem.
//
// Além de texto: fotografias, mensagens de voz, documentos (PDF, Word, Excel,
// PowerPoint, OpenDocument, RTF, TXT, CSV, ZIP) e ficheiros de áudio. O
// ficheiro vai em bruto (POST /:channel/anexo?nome=…), confere-se pelos
// primeiros bytes e guarda-se numa pasta privada ao lado da base de dados;
// serve-se só a quem está na conversa (GET /anexos/:id), nunca pela pasta
// pública do site.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db } = require('../lib/db');
const U = require('../lib/util');
const { HttpError } = U;

const router = express.Router();
const MAX_CORPO = 2000;
const MAX_ANEXO = 20 * 1024 * 1024;  // 20 MB
const MAX_VOZ_S = 5 * 60;            // 5 minutos

// Pasta privada dos anexos: junto à base de dados (no disco persistente).
const PASTA = path.join(process.env.DATA_DIR || (process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.join(__dirname, '..', 'data')), 'chat');
fs.mkdirSync(PASTA, { recursive: true });

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

// Quem pertence à conversa (os dois ids) — ou erro se quem pede não pertence.
function membros(req, channel) {
  const m = /^dm:(\d+)-(\d+)$/.exec(String(channel || ''));
  if (m) {
    const a = U.toInt(m[1]), b = U.toInt(m[2]);
    if (a < b && (req.user.id === a || req.user.id === b)) {
      const outro = req.user.id === a ? b : a;
      if (db.prepare('SELECT 1 FROM users WHERE id=?').get(outro)) return [a, b];
    }
  }
  throw new HttpError(404, 'Conversa não encontrada.');
}

const MSG_SELECT = `SELECT m.id, m.channel, m.user_id, m.body, m.tipo, m.anexo_mime, m.duracao, m.created_at,
  m.anexo_nome AS nome, m.anexo_tamanho AS tamanho,
  COALESCE(u.name, 'Utilizador removido') AS user_name
  FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id`;
// Para o browser: o endereço do anexo, em vez do nome do ficheiro.
const publica = (m) => {
  if (!m) return m;
  const { anexo_mime: mime, ...r } = m;
  return m.tipo === 'texto' ? r : { ...r, mime, url: `/api/admin/chat/anexos/${m.id}` };
};

function lido(userId, channel) {
  const r = db.prepare('SELECT last_id FROM chat_reads WHERE user_id=? AND channel=?').get(userId, channel);
  return r ? r.last_id : 0;
}
function resumo(userId, channel) {
  const ultima = db.prepare(`${MSG_SELECT} WHERE m.channel=? ORDER BY m.id DESC LIMIT 1`).get(channel) || null;
  const porLer = db.prepare('SELECT COUNT(*) n FROM chat_messages WHERE channel=? AND id>? AND COALESCE(user_id,0)<>?')
    .get(channel, lido(userId, channel), userId).n;
  return { last: publica(ultima), unread: porLer };
}

function marcarLido(userId, channel, id) {
  db.prepare(`INSERT INTO chat_reads(user_id,channel,last_id) VALUES(?,?,?)
    ON CONFLICT(user_id,channel) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)`).run(userId, channel, id);
}

// Grava uma mensagem e entrega-a às duas pessoas da conversa.
function publicar(req, channel, quem, campos) {
  const id = db.prepare(`INSERT INTO chat_messages(channel,user_id,body,tipo,anexo,anexo_mime,duracao,anexo_nome,anexo_tamanho,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(channel, req.user.id, campos.body || '', campos.tipo || 'texto', campos.anexo || '', campos.mime || '', campos.duracao || null,
      campos.nome || '', campos.tamanho || null, new Date().toISOString()).lastInsertRowid;
  marcarLido(req.user.id, channel, id);   // quem escreve já leu o que escreveu
  const msg = publica(db.prepare(`${MSG_SELECT} WHERE m.id=?`).get(id));
  enviarA(quem, 'mensagem', msg);
  return msg;
}

// ------------------------------------------------------------ Anexos
// Tipo do ficheiro pelos primeiros bytes (não basta o que o browser diz).
function tipoAnexo(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { tipo: 'imagem', mime: 'image/jpeg', ext: 'jpg' };
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { tipo: 'imagem', mime: 'image/png', ext: 'png' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return { tipo: 'imagem', mime: 'image/webp', ext: 'webp' };
  if (b.toString('latin1', 0, 4) === 'GIF8') return { tipo: 'imagem', mime: 'image/gif', ext: 'gif' };
  // Voz: o que os browsers gravam (WebM/Opus no Chrome e Firefox, MP4/AAC no
  // Safari) e os formatos comuns de áudio.
  if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { tipo: 'voz', mime: 'audio/webm', ext: 'webm' };
  if (b.toString('latin1', 0, 4) === 'OggS') return { tipo: 'voz', mime: 'audio/ogg', ext: 'ogg' };
  if (b.toString('latin1', 4, 8) === 'ftyp') return { tipo: 'voz', mime: 'audio/mp4', ext: 'm4a' };
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') return { tipo: 'voz', mime: 'audio/wav', ext: 'wav' };
  if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return { tipo: 'voz', mime: 'audio/mpeg', ext: 'mp3' };
  if (b.toString('latin1', 0, 4) === 'fLaC') return { tipo: 'voz', mime: 'audio/flac', ext: 'flac' };
  return null;
}

// Documentos: o conteúdo diz a família (PDF, ZIP, Office antigo, RTF) e a
// extensão do nome diz qual é dentro dela (um .docx e um .xlsx são ambos ZIP).
// TXT e CSV não têm assinatura: aceitam-se se não tiverem bytes nulos.
const DOCS_ZIP = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip',
};
const DOCS_OLE = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
function tipoDocumento(b, nome) {
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(nome) || [])[1];
  const e = ext ? ext.toLowerCase() : '';
  if (b.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return { mime: DOCS_ZIP[e] || DOCS_ZIP.zip, ext: DOCS_ZIP[e] ? e : 'zip' };
  if (b.subarray(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) && DOCS_OLE[e]) return { mime: DOCS_OLE[e], ext: e };
  if (b.toString('latin1', 0, 5) === '{\\rtf') return { mime: 'application/rtf', ext: 'rtf' };
  if ((e === 'txt' || e === 'csv') && !b.subarray(0, 65536).includes(0)) return { mime: e === 'csv' ? 'text/csv' : 'text/plain', ext: e };
  return null;
}

// O nome original, sem pastas nem caracteres de controlo (vai num cabeçalho).
const limparNome = (s) => path.basename(String(s || '')).replace(/[\u0000-\u001f\u007f"\\/]/g, '').trim().slice(0, 120);

// ------------------------------------------------------------ Rotas

// Lista para o painel do chat: uma conversa por colega, com quem está ligado
// agora e quantas mensagens estão por ler.
router.get('/', (req, res) => {
  const me = req.user.id;
  const ids = new Set(online());
  const colegas = db.prepare(
    `SELECT u.id, u.name, u.role, u.studio_id, u.photo, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON s.id = u.studio_id
      WHERE u.active=1 AND u.id<>? ORDER BY u.role='owner' DESC, u.name`
  ).all(me).map((u) => ({
    id: u.id, name: u.name, photo: u.photo || '', studio_name: u.studio_name || '',
    role: u.role === 'owner' ? 'owner' : u.studio_id ? 'agent' : 'staff',
    online: ids.has(u.id), channel: dm(me, u.id), ...resumo(me, dm(me, u.id)),
  }));
  res.json({ me, contacts: colegas });
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

// O ficheiro de uma fotografia ou mensagem de voz — só para quem está na conversa.
router.get('/anexos/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM chat_messages WHERE id=?').get(U.toInt(req.params.id));
  if (!m || !m.anexo) throw new HttpError(404, 'Anexo não encontrado.');
  membros(req, m.channel);
  const ficheiro = path.join(PASTA, path.basename(m.anexo));
  if (!fs.existsSync(ficheiro)) throw new HttpError(404, 'Anexo não encontrado.');
  res.set({ 'Content-Type': m.anexo_mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  // Documentos: o PDF abre no browser; os outros descarregam-se com o nome original.
  if (m.tipo === 'documento') {
    const nome = encodeURIComponent(m.anexo_nome || path.basename(m.anexo));
    res.set('Content-Disposition', `${m.anexo_mime === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${nome}`);
  }
  res.sendFile(ficheiro);
});

// As últimas 50 mensagens (ou as 50 antes de ?before=id, para ver mais antigas).
router.get('/:channel/messages', (req, res) => {
  const channel = req.params.channel;
  membros(req, channel);
  const before = U.toInt(req.query.before);
  const rows = db.prepare(`${MSG_SELECT} WHERE m.channel=?${before ? ' AND m.id<?' : ''} ORDER BY m.id DESC LIMIT 50`)
    .all(...(before ? [channel, before] : [channel]));
  res.json({ messages: rows.reverse().map(publica) });
});

router.post('/:channel/messages', (req, res) => {
  const channel = req.params.channel;
  const quem = membros(req, channel);
  const body = String((req.body || {}).body || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_CORPO);
  if (!body) throw new HttpError(400, 'Escreva uma mensagem.');
  res.status(201).json({ message: publicar(req, channel, quem, { body }) });
});

// Anexo: o ficheiro em bruto (até 20 MB), seja qual for o Content-Type — o
// que conta são os primeiros bytes. ?duracao= (segundos) para o áudio; ?nome=
// o nome original de um ficheiro escolhido no computador. Áudio com nome é um
// ficheiro de áudio ('audio'); sem nome, uma gravação feita no chat ('voz').
router.post('/:channel/anexo',
  express.raw({ type: () => true, limit: MAX_ANEXO }),
  (req, res) => {
    const channel = req.params.channel;
    const quem = membros(req, channel);
    const dados = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!dados.length) throw new HttpError(400, 'Escolha um ficheiro ou grave uma mensagem de voz.');
    const original = limparNome(req.query.nome);
    let t = tipoAnexo(dados);
    if (t && t.tipo === 'voz' && original) t = { ...t, tipo: 'audio' };
    if (!t) { const d = tipoDocumento(dados, original); if (d) t = { ...d, tipo: 'documento' }; }
    if (!t) throw new HttpError(400, 'Esse ficheiro não é aceite. Envie uma fotografia, um áudio ou um documento (PDF, Word, Excel, PowerPoint, TXT, CSV ou ZIP).');
    const duracao = t.tipo === 'voz' || t.tipo === 'audio' ? Math.min(t.tipo === 'voz' ? MAX_VOZ_S : 24 * 3600, Math.max(0, Math.round(Number(req.query.duracao) || 0))) : null;
    const guardado = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}.${t.ext}`;
    fs.writeFileSync(path.join(PASTA, guardado), dados);
    res.status(201).json({ message: publicar(req, channel, quem, {
      tipo: t.tipo, anexo: guardado, mime: t.mime, duracao,
      nome: t.tipo === 'documento' || t.tipo === 'audio' ? original || `ficheiro.${t.ext}` : '', tamanho: dados.length,
    }) });
  });

router.post('/:channel/read', (req, res) => {
  const channel = req.params.channel;
  membros(req, channel);
  const ultimo = db.prepare('SELECT COALESCE(MAX(id),0) m FROM chat_messages WHERE channel=?').get(channel).m;
  marcarLido(req.user.id, channel, ultimo);
  res.json({ ok: true });
});

module.exports = { router, fechar };
