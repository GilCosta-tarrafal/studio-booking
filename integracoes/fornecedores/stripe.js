'use strict';
// ---------------------------------------------------------------------------
// Stripe: pagamento online das marcações.
//
// O cliente nunca escreve o cartão no nosso site. Pedimos ao Stripe uma
// página de pagamento (Checkout) com o valor em falta e mandamos o cliente
// para lá; quando o pagamento entra, o Stripe avisa-nos por webhook e só
// então se soma ao "Já pago" da marcação. O regresso do cliente ao site
// (success_url) não prova nada — qualquer pessoa pode abrir esse endereço —
// por isso não mexe em valores.
//
// Sem biblioteca do Stripe: são dois pedidos HTTP e uma assinatura, e assim
// o projeto fica com as duas dependências que já tinha.
//
// Variáveis de ambiente:
//   STRIPE_SECRET_KEY       sk_test_... ou sk_live_...   (sem ela, desligado)
//   STRIPE_WEBHOOK_SECRET   whsec_...  (do endpoint criado no painel do Stripe)
//   STRIPE_CURRENCY         código ISO da moeda a cobrar, se a moeda das
//                           Definições não for um (ex.: "€" -> eur)
//   SITE_URL                endereço público do site, para o regresso do Stripe
// ---------------------------------------------------------------------------
const { db, eventoNovo, gravarEstado, lerEstado } = require('../lib/base');
const { verificar } = require('../lib/assinatura');
const { pedirJson } = require('../lib/http');
const { BOOKING_SELECT } = require('../../backend/lib/db');

const ID = 'stripe';
const API = () => (process.env.STRIPE_API_URL || 'https://api.stripe.com').replace(/\/$/, '');

// Moedas que o Stripe conta sem casas decimais: 500 é 500, não 5,00.
const ZERO_DECIMAIS = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const SIMBOLOS = { '€': 'eur', '$': 'usd', 'us$': 'usd', '£': 'gbp', 'r$': 'brl', 'esc': 'cve', 'kz': 'aoa', 'mt': 'mzn' };

// Só se aceita pagar o que o estúdio já aceitou: um pedido por confirmar
// ainda pode ser recusado, e aí era preciso devolver o dinheiro.
const ESTADOS_PAGAVEIS = ['aguarda_pagamento', 'confirmado', 'em_curso'];

function ativo() { return !!process.env.STRIPE_SECRET_KEY; }

function moeda(textoMoeda) {
  const env = (process.env.STRIPE_CURRENCY || '').trim().toLowerCase();
  if (/^[a-z]{3}$/.test(env)) return env;
  const t = String(textoMoeda || '').trim().toLowerCase();
  if (SIMBOLOS[t]) return SIMBOLOS[t];
  return /^[a-z]{3}$/.test(t) ? t : null;
}

// Valor do site (unidades) <-> valor do Stripe (a menor unidade da moeda).
const paraStripe = (valor, m) => (ZERO_DECIMAIS.has(m) ? valor : valor * 100);
const doStripe = (valor, m) => (ZERO_DECIMAIS.has(m) ? valor : Math.round(valor / 100));

function emFalta(booking) { return Math.max(0, (booking.price || 0) - (booking.paid || 0)); }

function podePagar(booking) {
  return ativo() && ESTADOS_PAGAVEIS.includes(booking.status) && emFalta(booking) > 0;
}

// O Stripe quer os campos como formulário, com os objetos achatados:
// { line_items: [{ quantity: 1 }] } -> line_items[0][quantity]=1
function achatar(obj, prefixo = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    const chave = prefixo ? `${prefixo}[${k}]` : k;
    if (typeof v === 'object') achatar(v, chave, out);
    else out.append(chave, String(v));
  }
  return out;
}

async function stripe(caminho, corpo) {
  return pedirJson(API() + caminho, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: achatar(corpo).toString(),
  });
}

// Cria a página de pagamento do valor em falta e devolve o endereço dela.
async function criarCheckout({ booking, textoMoeda, siteUrl, lingua }) {
  const m = moeda(textoMoeda);
  if (!m) throw new Error('A moeda das Definições não é um código que o Stripe conheça. Defina STRIPE_CURRENCY (por exemplo, eur ou cve).');
  const valor = emFalta(booking);
  const volta = `${siteUrl}/consultar?code=${encodeURIComponent(booking.code)}`;
  const sessao = await stripe('/v1/checkout/sessions', {
    mode: 'payment',
    client_reference_id: booking.code,
    customer_email: booking.client_email || undefined,
    locale: ['pt', 'en', 'fr'].includes(lingua) ? lingua : 'auto',
    success_url: volta + '&pago=1',
    cancel_url: volta + '&pago=0',
    metadata: { booking_code: booking.code },
    // checkout=1: este pagamento já é tratado por checkout.session.completed;
    // o aviso payment_intent.succeeded dele não pode voltar a somar.
    payment_intent_data: { metadata: { booking_code: booking.code, checkout: '1' } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: m,
        unit_amount: paraStripe(valor, m),
        product_data: {
          name: `${booking.service_name || 'Sessão'} · ${booking.studio_name}, ${booking.room_name}`,
          description: `${booking.code} · ${booking.date}`,
        },
      },
    }],
  });
  const agora = new Date().toISOString();
  db.prepare(`INSERT INTO int_pagamentos(booking_id,booking_code,fornecedor,externo_id,valor,moeda,criado_em,atualizado_em)
              VALUES(?,?,?,?,?,?,?,?)`).run(booking.id, booking.code, ID, sessao.id, valor, m, agora, agora);
  return { url: sessao.url, valor };
}

// ---------------------------------------------------------------- Pagamento no site
// A página /pagar mostra as caixas do cartão do próprio Stripe (Stripe
// Elements, chave publicável): o número do cartão vai do browser direto para
// o Stripe. O servidor só cria os pedidos (guardar cartão / pagar) e lê o
// resultado no Stripe — nunca aceita do browser que "está pago".
const publicavel = () => process.env.STRIPE_PUBLISHABLE_KEY || '';
const noSite = () => ativo() && !!publicavel();

async function stripeGet(caminho) {
  return pedirJson(API() + caminho, { headers: { Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY } });
}

// O "customer" do Stripe da conta de cliente (cria-se à primeira vez).
async function clienteStripe(cliente) {
  if (cliente.stripe_customer_id) return cliente.stripe_customer_id;
  const c = await stripe('/v1/customers', { name: cliente.name, email: cliente.email, phone: cliente.phone, metadata: { client_id: cliente.id } });
  db.prepare('UPDATE clients SET stripe_customer_id=? WHERE id=?').run(c.id, cliente.id);
  return c.id;
}

// Para guardar um cartão: o browser confirma este SetupIntent com as caixas do Stripe.
async function criarSetup(customer) {
  const s = await stripe('/v1/setup_intents', { customer, 'payment_method_types[0]': 'card', usage: 'on_session' });
  return s.client_secret;
}

// O cartão guardado, tal como o Stripe o conhece (marca, 4 dígitos, validade).
async function lerCartao(pmId, customer) {
  const pm = await stripeGet('/v1/payment_methods/' + encodeURIComponent(pmId));
  if (!pm || pm.customer !== customer || !pm.card) throw new Error('Cartão desconhecido.');
  return { externo_id: pm.id, marca: pm.card.brand, ultimos: pm.card.last4, mes: pm.card.exp_month, ano: pm.card.exp_year, titular: (pm.billing_details && pm.billing_details.name) || '' };
}

// Cobra o valor em falta da marcação com um cartão guardado. Pode pedir uma
// confirmação extra ao banco (3D Secure): aí devolve o client_secret, o
// browser trata disso e depois chama confirmarIntent.
async function pagarComCartao({ booking, customer, pmId, textoMoeda }) {
  const m = moeda(textoMoeda);
  if (!m) throw new Error('A moeda das Definições não é um código que o Stripe conheça. Defina STRIPE_CURRENCY.');
  const valor = emFalta(booking);
  const pi = await stripe('/v1/payment_intents', {
    amount: paraStripe(valor, m), currency: m, customer, payment_method: pmId, confirm: 'true',
    'payment_method_types[0]': 'card', description: `${booking.code} · ${booking.studio_name}, ${booking.room_name}`,
    metadata: { booking_code: booking.code },
  });
  const agora = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO int_pagamentos(booking_id,booking_code,fornecedor,externo_id,valor,moeda,criado_em,atualizado_em)
              VALUES(?,?,?,?,?,?,?,?)`).run(booking.id, booking.code, ID, pi.id, valor, m, agora, agora);
  return pi;
}

async function lerIntent(id) { return stripeGet('/v1/payment_intents/' + encodeURIComponent(id)); }

// Um PaymentIntent pago (lido no Stripe): soma ao "Já pago" uma vez só.
function marcarIntentPago(pi) {
  const pag = db.prepare('SELECT * FROM int_pagamentos WHERE externo_id=?').get(pi.id);
  if (pag && pag.estado === 'pago') return pag;
  const m = String(pi.currency || (pag && pag.moeda) || '').toLowerCase();
  const valor = doStripe(Number(pi.amount_received || pi.amount) || 0, m);
  const code = (pi.metadata && pi.metadata.booking_code) || (pag && pag.booking_code);
  const booking = code ? db.prepare(BOOKING_SELECT + ' WHERE b.code=?').get(code) : null;
  const agora = new Date().toISOString();
  if (!pag) {
    db.prepare(`INSERT INTO int_pagamentos(booking_id,booking_code,fornecedor,externo_id,valor,moeda,estado,criado_em,atualizado_em)
                VALUES(?,?,?,?,?,?,'pago',?,?)`).run(booking ? booking.id : null, code || '', ID, pi.id, valor, m, agora, agora);
  } else db.prepare("UPDATE int_pagamentos SET estado='pago', valor=?, atualizado_em=? WHERE id=?").run(valor, agora, pag.id);
  if (booking) require('../rotas/pagamento').aposPagamento(booking.id, valor);
  // Sem marcação com este código: pode ser uma compra da loja (rotas/loja.js).
  else if (code) require('../rotas/loja').aposPagamento(code);
  return db.prepare('SELECT * FROM int_pagamentos WHERE externo_id=?').get(pi.id);
}

// Devolve ao cartão o valor de um pagamento (todo). Os pagamentos do site são
// PaymentIntents (pi_…); os de Checkout (cs_…) têm o PaymentIntent na sessão.
// Devolve o id do reembolso no Stripe.
async function reembolsar(pag) {
  let pi = pag.externo_id;
  if (pi.startsWith('cs_')) {
    const sessao = await stripeGet('/v1/checkout/sessions/' + encodeURIComponent(pi));
    pi = sessao && sessao.payment_intent;
  }
  if (!pi) throw new Error('Não foi possível encontrar este pagamento no Stripe.');
  const r = await stripe('/v1/refunds', { payment_intent: pi, metadata: { booking_code: pag.booking_code } });
  return r.id;
}

// ---------------------------------------------------------------- Webhook

function marcarPago(sessao) {
  let pag = db.prepare('SELECT * FROM int_pagamentos WHERE externo_id=?').get(sessao.id);
  if (pag && pag.estado === 'pago') return 'já registado';
  const m = String(sessao.currency || (pag && pag.moeda) || '').toLowerCase();
  const valor = doStripe(Number(sessao.amount_total) || 0, m);
  const code = (sessao.metadata && sessao.metadata.booking_code) || sessao.client_reference_id || (pag && pag.booking_code);
  const booking = code ? db.prepare(BOOKING_SELECT + ' WHERE b.code=?').get(code) : null;
  const agora = new Date().toISOString();
  if (!pag) {
    // Sessão criada fora do site (por exemplo, um link de pagamento feito à
    // mão no Stripe com o código da marcação): regista-se na mesma.
    db.prepare(`INSERT INTO int_pagamentos(booking_id,booking_code,fornecedor,externo_id,valor,moeda,estado,criado_em,atualizado_em)
                VALUES(?,?,?,?,?,?,'pago',?,?)`).run(booking ? booking.id : null, code || '', ID, sessao.id, valor, m, agora, agora);
  } else {
    db.prepare("UPDATE int_pagamentos SET estado='pago', valor=?, atualizado_em=? WHERE id=?").run(valor, agora, pag.id);
  }
  // Soma ao "Já pago" e, pago tudo, confirma a marcação que aguardava pagamento.
  if (booking) require('../rotas/pagamento').aposPagamento(booking.id, valor);
  return booking ? `pago ${valor} ${m} (${booking.code})` : 'pago, sem marcação correspondente';
}

function tratar(evento) {
  const obj = evento.data && evento.data.object;
  switch (evento.type) {
    case 'checkout.session.completed':
      // Com transferência ou multibanco o pagamento fica pendente e só chega
      // depois, em async_payment_succeeded.
      return obj.payment_status === 'paid' ? marcarPago(obj) : 'à espera do pagamento';
    case 'checkout.session.async_payment_succeeded':
      return marcarPago(obj);
    // Pagamento feito na página /pagar (com cartão guardado).
    case 'payment_intent.succeeded':
      return obj.metadata && obj.metadata.booking_code && !obj.metadata.checkout ? (marcarIntentPago(obj), 'pago (site)') : 'ignorado';
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      db.prepare("UPDATE int_pagamentos SET estado='expirado', atualizado_em=? WHERE externo_id=? AND estado='aberto'")
        .run(new Date().toISOString(), obj.id);
      return 'expirado';
    default:
      return 'ignorado';
  }
}

// Recebe o corpo tal e qual chegou (Buffer): a assinatura é sobre esses bytes.
function webhook(corpo, cabecalhos) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    const e = new Error('Webhook do Stripe sem segredo configurado.'); e.status = 503; throw e;
  }
  if (!verificar(cabecalhos['stripe-signature'], corpo, process.env.STRIPE_WEBHOOK_SECRET)) {
    const e = new Error('Assinatura inválida.'); e.status = 400; throw e;
  }
  let evento;
  try { evento = JSON.parse(corpo.toString('utf8')); } catch (_) { const e = new Error('JSON inválido.'); e.status = 400; throw e; }
  const resultado = db.transaction(() => (eventoNovo(ID, evento.id, evento.type) ? tratar(evento) : 'repetido'))();
  gravarEstado(ID, { ultimo_evento: new Date().toISOString(), ultimo_tipo: evento.type });
  return resultado;
}

function estado() {
  const chave = process.env.STRIPE_SECRET_KEY || '';
  const e = lerEstado(ID);
  return {
    id: ID,
    nome: 'Stripe (pagamentos online)',
    ativo: ativo(),
    detalhes: [
      ['Chave', chave ? (chave.startsWith('sk_live') ? 'real (cobra a sério)' : 'de teste') : 'não definida (STRIPE_SECRET_KEY)'],
      ['Webhook', process.env.STRIPE_WEBHOOK_SECRET ? 'segredo definido' : 'sem segredo (STRIPE_WEBHOOK_SECRET) — os pagamentos não chegam ao painel'],
      ['Último aviso do Stripe', e.ultimo_evento ? `${e.ultimo_evento} (${e.ultimo_tipo})` : '—'],
    ],
  };
}

module.exports = {
  id: ID, ativo, estado, webhook, criarCheckout, podePagar, emFalta, moeda,
  publicavel, noSite, clienteStripe, criarSetup, lerCartao, pagarComCartao, lerIntent, marcarIntentPago, reembolsar,
};
