'use strict';

// Assistente IA do painel (botão de auriculares → "Assistente IA"). Responde a
// perguntas da equipa sobre o painel e sobre o dia a dia do estúdio, com base
// num resumo dos dados que a pessoa já pode ver: um agente só leva o seu
// estúdio, o proprietário leva todos. O assistente não altera nada.
//
// Usa a API da Claude (Anthropic). Precisa de ANTHROPIC_API_KEY no ambiente
// (ou no .env, com `npm run start:env`); sem ela responde 503 com um aviso.
// A conversa vive no browser: cada pedido traz o histórico (até 20 mensagens).

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db, getSettings, BOOKING_SELECT } = require('../lib/db');
const U = require('../lib/util');
const { HttpError } = U;

const router = express.Router();
const MODELO = process.env.ASSISTENTE_MODELO || 'claude-opus-5-5';
const MAX_MENSAGENS = 20;
const MAX_TEXTO = 4000;

let cliente = null;
const obterCliente = () => (cliente = cliente || new Anthropic());

// Limite por pessoa (cada pergunta custa dinheiro): 30 em cada 10 minutos.
const pedidos = new Map();
function limitar(userId) {
  const agora = Date.now();
  let p = pedidos.get(userId);
  if (!p || p.reset < agora) { p = { n: 0, reset: agora + 10 * 60 * 1000 }; pedidos.set(userId, p); }
  if (++p.n > 30) throw new HttpError(429, 'Fez muitas perguntas seguidas. Espere uns minutos e tente outra vez.');
}

// Resumo dos dados que a pessoa pode ver, para o assistente responder com
// factos: estúdios e salas, serviços, pedidos por confirmar e a agenda das
// próximas duas semanas.
function contexto(user) {
  const s = getSettings();
  const hoje = U.nowLocal();
  const scope = user.studio_id || null;
  const sf = scope ? ' AND r.studio_id=' + scope : '';
  const estudios = db.prepare('SELECT * FROM studios' + (scope ? ' WHERE id=' + scope : '') + ' ORDER BY sort, id').all();
  const salas = db.prepare('SELECT * FROM rooms ORDER BY sort, id').all();
  const servicos = db.prepare('SELECT name, remote_ok FROM services WHERE active=1 ORDER BY sort, id').all();
  const ate = U.addDays(hoje.date, 14);
  const agenda = db.prepare(`${BOOKING_SELECT} WHERE b.date>=? AND b.date<=? AND b.status NOT IN ('cancelado','expirado')${sf}
    ORDER BY b.date, b.start_min LIMIT 80`).all(hoje.date, ate);
  const porPagar = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(${require('../lib/db').paraBase('b.price-b.paid')}),0) v FROM bookings b JOIN rooms r ON r.id=b.room_id
    WHERE b.status='concluido' AND b.price>b.paid${sf}`).get();

  const linhas = [];
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  linhas.push(`Negócio: ${s.business_name}. Moeda: ${s.currency}. Hoje: ${DIAS[U.weekday(hoje.date)]}, ${hoje.date}, ${U.fmtHM(hoje.minutes)}.`);
  const papel = user.role === 'owner' ? 'proprietário (administrador, vê todos os estúdios)'
    : scope ? `agente do estúdio "${(estudios[0] || {}).name || ''}" (só vê e gere esse estúdio)` : 'equipa (vê todos os estúdios)';
  linhas.push(`Quem pergunta: ${user.name}, ${papel}.`);
  linhas.push('', 'Estúdios e salas:');
  for (const e of estudios) {
    linhas.push(`- ${e.name}${e.city ? ' (' + e.city + ')' : ''} · moeda ${e.currency || s.currency}${e.active ? '' : ' [oculto no site]'}`);
    for (const r of salas.filter((x) => x.studio_id === e.id)) {
      linhas.push(`  · ${r.name}: ${r.hourly_rate} ${e.currency || s.currency}/hora${r.active ? '' : ' [inativa]'}`);
    }
  }
  linhas.push('', 'Serviços: ' + (servicos.map((x) => x.name + (x.remote_ok ? ' (pode ser à distância)' : '')).join(', ') || 'nenhum'));
  linhas.push('', `Marcações de ${hoje.date} a ${ate} (estado entre parênteses):`);
  if (!agenda.length) linhas.push('- nenhuma');
  for (const b of agenda) {
    linhas.push(`- ${b.date} ${U.fmtHM(b.start_min)}–${U.fmtHM(b.end_min)} · ${b.studio_name} / ${b.room_name} · ${b.client_name}`
      + `${b.service_name ? ' · ' + b.service_name : ''} · ${b.price} ${b.currency || s.currency}, pago ${b.paid} (${b.status}) · código ${b.code}`);
  }
  linhas.push('', `Sessões concluídas por pagar: ${porPagar.n} (falta receber ${porPagar.v} ${s.currency}).`);
  return linhas.join('\n');
}

const INSTRUCOES = `És o assistente do painel de gestão de um negócio com estúdios de gravação.
Ajudas a equipa (proprietário e agentes de estúdio) a usar o painel e a responder a perguntas sobre a agenda, marcações, salas, preços e pagamentos.
Responde em português de Portugal, de forma curta e prática. Usa só os dados do contexto abaixo para factos sobre o negócio; se a resposta não estiver lá, diz isso e indica onde no painel a pessoa pode ver.
Não podes alterar nada: para criar, mudar ou cancelar algo, explica os passos no painel.
Secções do painel: Dashboard (gráficos e totais), Painel (o dia de hoje e pedidos por confirmar), Calendário (salas por dia, bloqueios de horário), Marcações (lista, filtros, estados, recibos e faturas), Clientes, Relatórios (receita e PDF), Estúdios (dados do estúdio, horário, salas e preços).
Estados de uma marcação: pedido, aguarda_pagamento, confirmado, em_curso, concluido, cancelado, expirado.
Um agente de estúdio só vê o seu estúdio: nunca fales de dados de outros estúdios a um agente.
Para falar com o administrador ou com agentes de outros estúdios, existe o "Chat — Agentes" no mesmo botão de auriculares.`;

function validarMensagens(lista) {
  if (!Array.isArray(lista) || !lista.length) throw new HttpError(400, 'Escreva uma pergunta.');
  const msgs = lista.slice(-MAX_MENSAGENS).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').trim().slice(0, MAX_TEXTO),
  })).filter((m) => m.content);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new HttpError(400, 'Escreva uma pergunta.');
  return msgs;
}

router.post('/', async (req, res) => {
  const messages = validarMensagens((req.body || {}).messages);
  limitar(req.user.id);
  let resposta;
  try {
    resposta = await obterCliente().beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      output_config: { effort: 'low' },
      // Se o modelo recusar por política, a API tenta outro modelo no mesmo pedido.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: INSTRUCOES }, { type: 'text', text: 'Contexto atual:\n' + contexto(req.user) }],
      messages,
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || !(e instanceof Anthropic.APIError)) {
      console.error('assistente:', e.message);
      throw new HttpError(503, 'O Assistente IA ainda não está configurado. O administrador tem de definir a chave ANTHROPIC_API_KEY no servidor.');
    }
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'O assistente está ocupado. Tente daqui a pouco.');
    console.error('assistente:', e.status, e.message);
    throw new HttpError(502, 'O assistente não respondeu. Tente outra vez.');
  }
  if (resposta.stop_reason === 'refusal') {
    return res.json({ reply: 'Não posso ajudar com esse pedido. Experimente perguntar de outra forma.' });
  }
  const texto = resposta.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  res.json({ reply: texto || 'Não consegui responder. Tente outra vez.' });
});

module.exports = router;
