'use strict';
// ---------------------------------------------------------------------------
// Pagamento no site (/pagar), para o cliente com sessão iniciada.
//
// Depois de o estúdio aceitar o pedido, a marcação fica "aguarda pagamento".
// O cliente abre /pagar?code=…, escolhe (ou acrescenta) um cartão, vê o
// resumo com os serviços, o IVA e o total, e paga. Pago o valor em falta, a
// marcação fica confirmada e sai um recibo (talão) que se pode descarregar.
//
// Cartões: com o Stripe ligado (STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY)
// as caixas do cartão são do Stripe e o número nunca chega aqui; guarda-se só
// a marca, os 4 últimos dígitos e a validade. Para ver o fluxo sem Stripe há
// o modo de demonstração — só em desenvolvimento (ver util.pagamentosDemo),
// nunca por falta de chaves: aceita apenas cartões de teste e não cobra nada.
// ---------------------------------------------------------------------------
const express = require('express');
const crypto = require('crypto');
const { db, getSettings, BOOKING_SELECT } = require('../../backend/lib/db');
const U = require('../../backend/lib/util');
const { requireClient } = require('../../backend/lib/conta-auth');
const { rateLimit } = require('../../backend/lib/ratelimit');
const stripe = require('../fornecedores/stripe');

const router = express.Router();
const limitador = rateLimit({ windowMs: 10 * 60 * 1000, max: 30 });
const erro = (m, s = 400) => new U.HttpError(s, m);

const demo = () => !stripe.noSite() && U.pagamentosDemo();
const modo = () => (stripe.noSite() ? 'stripe' : demo() ? 'demo' : 'off');
// Cartões de teste aceites na demonstração (os mesmos do Stripe em teste).
const CARTOES_DEMO = { '4242424242424242': 'visa', '5555555555554444': 'mastercard', '4000056655665556': 'visa' };
const PAGAVEIS = ['aguarda_pagamento', 'confirmado', 'em_curso'];

const r2 = (n) => Math.round(n * 100) / 100;
const emFalta = (b) => Math.max(0, (b.price || 0) - (b.paid || 0));

// A marcação tem de ser da conta com sessão iniciada.
function marcacao(req, code) {
  const c = U.clean(String(code || ''), 12).toUpperCase();
  const b = c ? db.prepare(BOOKING_SELECT + ' WHERE b.code=?').get(c) : null;
  if (!b || b.client_id !== req.client.id) throw erro(req.t('api.marcacaoNaoEncontrada'), 404);
  return b;
}
const cliente = (req) => db.prepare('SELECT * FROM clients WHERE id=?').get(req.client.id);
const cartoes = (clientId) => db.prepare('SELECT id, marca, ultimos, mes, ano, titular, demo FROM pag_cartoes WHERE client_id=? ORDER BY id DESC').all(clientId)
  .map((c) => ({ ...c, demo: !!c.demo }));

// Resumo para o ecrã de pagamento: a linha do serviço, o que já foi pago, e o
// valor em falta repartido em base + IVA (o preço já inclui o IVA do estúdio).
function resumo(b) {
  const st = db.prepare('SELECT vat_rate, tax_name FROM studios WHERE id=?').get(b.studio_id) || {};
  const taxa = st.vat_rate == null ? null : Number(st.vat_rate);
  const total = emFalta(b);
  const base = taxa == null ? total : r2(total / (1 + taxa / 100));
  const min = b.end_min - b.start_min;
  return {
    code: b.code, status: b.status, studio: b.studio_name, room: b.room_name, date: b.date,
    start: U.fmtHM(b.start_min), end: U.fmtHM(b.end_min), minutos: min,
    itens: [{ descricao: b.service_name || 'Sessão em estúdio', detalhe: `${b.room_name} · ${min / 60} h${b.style ? ' · ' + b.style : ''}`, valor: b.price }],
    ja_pago: b.paid || 0, base, imposto: r2(total - base), taxa, imposto_nome: st.tax_name || 'IVA', total,
    moeda: getSettings().currency || '', pode_pagar: PAGAVEIS.includes(b.status) && total > 0,
  };
}

// Depois de um pagamento confirmado: soma ao "Já pago" e, pago tudo, a
// marcação que aguardava pagamento fica confirmada.
function aposPagamento(bookingId, valor) {
  const agora = new Date().toISOString();
  db.prepare('UPDATE bookings SET paid = paid + ?, updated_at=? WHERE id=?').run(valor, agora, bookingId);
  db.prepare("UPDATE bookings SET status='confirmado', updated_at=? WHERE id=? AND status='aguarda_pagamento' AND paid >= price").run(agora, bookingId);
  // O cliente fica a saber que o pagamento entrou (o painel vê-o no sininho).
  const b = db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(bookingId);
  if (b) {
    require('../../backend/lib/aviso-pagamento').confirmado({ ...b, start: U.fmtHM(b.start_min), end: U.fmtHM(b.end_min) }, valor)
      .catch((e) => console.error('aviso de pagamento recebido:', e.message));
  }
}

// O que o recibo (talão) mostra, a partir de um pagamento.
function recibo(pagId, clientId) {
  const p = db.prepare('SELECT * FROM int_pagamentos WHERE id=?').get(pagId);
  const b = p && p.booking_id ? db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(p.booking_id) : null;
  if (!p || !b || p.estado !== 'pago' || (clientId && b.client_id !== clientId)) return null;
  const s = getSettings();
  const st = db.prepare('SELECT * FROM studios WHERE id=?').get(b.studio_id) || {};
  const taxa = st.vat_rate == null ? null : Number(st.vat_rate);
  const base = taxa == null ? p.valor : r2(p.valor / (1 + taxa / 100));
  return {
    id: p.id, numero: `${b.code}-${String(p.id).padStart(4, '0')}`, pago_em: p.atualizado_em,
    empresa: {
      nome: s.business_name || '', frase: s.tagline || '', legal: st.legal_name || st.name || '', nif: st.nif || '',
      telefone: st.phone || s.phone || '', email: st.email || s.email || '', morada: [st.address, st.city].filter(Boolean).join(', '),
    },
    marcacao: { code: b.code, studio: b.studio_name, room: b.room_name, date: b.date, start: U.fmtHM(b.start_min), end: U.fmtHM(b.end_min), cliente: b.client_name, servico: b.service_name || 'Sessão em estúdio', minutos: b.end_min - b.start_min },
    valor: p.valor, base, imposto: r2(p.valor - base), taxa, imposto_nome: st.tax_name || 'IVA', moeda: s.currency || '',
    cartao: { marca: p.cartao_marca, ultimos: p.cartao_ultimos }, estado: 'APROVADO', demo: p.fornecedor === 'demo',
    status_marcacao: b.status,
  };
}

router.use(requireClient);

router.get('/config', (_req, res) => {
  res.json({ modo: modo(), publicavel: modo() === 'stripe' ? stripe.publicavel() : '', moeda: getSettings().currency || '' });
});

router.post('/marcacao', (req, res) => {
  const b = marcacao(req, (req.body || {}).code);
  res.json({ resumo: resumo(b), cartoes: cartoes(req.client.id), modo: modo() });
});

router.post('/cartoes/setup', limitador, async (req, res) => {
  if (modo() !== 'stripe') throw erro('Os pagamentos online não estão ligados.', 503);
  const customer = await stripe.clienteStripe(cliente(req));
  res.json({ client_secret: await stripe.criarSetup(customer) });
});

// Guarda o cartão que o browser acabou de confirmar no Stripe (ou, na
// demonstração, um cartão de teste — só marca, 4 dígitos e validade).
router.post('/cartoes', limitador, async (req, res) => {
  const body = req.body || {};
  let c;
  if (modo() === 'stripe') {
    const customer = await stripe.clienteStripe(cliente(req));
    try { c = await stripe.lerCartao(String(body.payment_method || ''), customer); } catch (_) { throw erro('Não foi possível guardar o cartão.'); }
    c.demo = 0;
  } else if (modo() === 'demo') {
    const marca = String(body.marca || '');
    const ultimos = String(body.ultimos || '');
    if (!Object.entries(CARTOES_DEMO).some(([n, m]) => m === marca && n.endsWith(ultimos)) || !/^\d{4}$/.test(ultimos)) {
      throw erro('Na demonstração só se aceitam cartões de teste (ex.: 4242 4242 4242 4242).');
    }
    c = { externo_id: 'demo_' + crypto.randomBytes(6).toString('hex'), marca, ultimos, mes: U.toInt(body.mes), ano: U.toInt(body.ano), titular: U.clean(body.titular, 80), demo: 1 };
  } else throw erro('Os pagamentos online não estão ligados.', 503);
  db.prepare(`INSERT OR IGNORE INTO pag_cartoes(client_id,externo_id,marca,ultimos,mes,ano,titular,demo,criado_em) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(req.client.id, c.externo_id, c.marca, c.ultimos, c.mes, c.ano, c.titular || req.client.name, c.demo, new Date().toISOString());
  res.status(201).json({ cartoes: cartoes(req.client.id) });
});

router.delete('/cartoes/:id', (req, res) => {
  db.prepare('DELETE FROM pag_cartoes WHERE id=? AND client_id=?').run(U.toInt(req.params.id), req.client.id);
  res.json({ cartoes: cartoes(req.client.id) });
});

router.post('/pagar', limitador, async (req, res) => {
  const body = req.body || {};
  const b = marcacao(req, body.code);
  if (!PAGAVEIS.includes(b.status) || emFalta(b) <= 0) throw erro(req.t(emFalta(b) > 0 ? 'pagar.aindaNao' : 'pagar.nadaEmFalta'));
  const cartao = db.prepare('SELECT * FROM pag_cartoes WHERE id=? AND client_id=?').get(U.toInt(body.cartao_id), req.client.id);
  if (!cartao) throw erro('Escolha um cartão.');
  const agora = new Date().toISOString();

  if (modo() === 'demo' && cartao.demo) {
    const valor = emFalta(b);
    const pagId = db.transaction(() => {
      const id = db.prepare(`INSERT INTO int_pagamentos(booking_id,booking_code,fornecedor,externo_id,valor,moeda,estado,criado_em,atualizado_em,cartao_marca,cartao_ultimos)
                             VALUES(?,?,'demo',?,?,?,'pago',?,?,?,?)`)
        .run(b.id, b.code, 'demo_pi_' + crypto.randomBytes(6).toString('hex'), valor, getSettings().currency || '', agora, agora, cartao.marca, cartao.ultimos).lastInsertRowid;
      aposPagamento(b.id, valor);
      return id;
    })();
    return res.json({ estado: 'pago', recibo: recibo(pagId, req.client.id) });
  }
  if (modo() !== 'stripe' || cartao.demo) throw erro('Os pagamentos online não estão ligados.', 503);

  const customer = await stripe.clienteStripe(cliente(req));
  let pi;
  try { pi = await stripe.pagarComCartao({ booking: b, customer, pmId: cartao.externo_id, textoMoeda: getSettings().currency }); } catch (e) {
    throw erro(e.message && /card|cartão|declin/i.test(e.message) ? 'O pagamento foi recusado: ' + e.message : req.t('pagar.falhou'), 402);
  }
  db.prepare('UPDATE int_pagamentos SET cartao_marca=?, cartao_ultimos=? WHERE externo_id=?').run(cartao.marca, cartao.ultimos, pi.id);
  if (pi.status === 'succeeded') {
    const pag = stripe.marcarIntentPago(pi);
    return res.json({ estado: 'pago', recibo: recibo(pag.id, req.client.id) });
  }
  if (pi.status === 'requires_action') return res.json({ estado: 'acao', client_secret: pi.client_secret, intent: pi.id });
  throw erro('O pagamento não foi aceite. Experimente outro cartão.', 402);
});

// Depois da confirmação extra do banco: lê o resultado no Stripe (o browser
// só diz qual pagamento verificar, não o que aconteceu).
router.post('/confirmar', limitador, async (req, res) => {
  const body = req.body || {};
  const b = marcacao(req, body.code);
  if (modo() !== 'stripe') throw erro('Os pagamentos online não estão ligados.', 503);
  const pi = await stripe.lerIntent(String(body.intent || ''));
  if (!pi || !pi.metadata || pi.metadata.booking_code !== b.code) throw erro('Pagamento desconhecido.', 404);
  if (pi.status !== 'succeeded') throw erro('O pagamento não foi concluído.', 402);
  const pag = stripe.marcarIntentPago(pi);
  res.json({ estado: 'pago', recibo: recibo(pag.id, req.client.id) });
});

router.get('/recibo/:id', (req, res) => {
  const r = recibo(U.toInt(req.params.id), req.client.id);
  if (!r) throw erro('Recibo não encontrado.', 404);
  res.json({ recibo: r });
});

router.get('/recibo/:id/pdf', (req, res) => {
  const r = recibo(U.toInt(req.params.id), req.client.id);
  if (!r) throw erro('Recibo não encontrado.', 404);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="recibo-pagamento-${r.numero}.pdf"` });
  require('../../backend/lib/pdf-talao').gerar(res, r);
});

module.exports = { router, aposPagamento, recibo, modo };
