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
const ESTADOS_PAGAVEIS = ['confirmado', 'em_curso'];

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
    payment_intent_data: { metadata: { booking_code: booking.code } },
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
  if (booking) {
    db.prepare('UPDATE bookings SET paid = paid + ?, updated_at=? WHERE id=?').run(valor, agora, booking.id);
  }
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

module.exports = { id: ID, ativo, estado, webhook, criarCheckout, podePagar, emFalta, moeda };
