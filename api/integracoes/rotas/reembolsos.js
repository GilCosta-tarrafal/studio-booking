'use strict';
// ---------------------------------------------------------------------------
// Reembolsos de pagamentos online (marcações e compras da loja), feitos no
// painel em Integrações › Pagamentos online.
//
//   Stripe        → o dinheiro volta ao cartão do cliente (reembolso total).
//   Demonstração  → só se marca como reembolsado (não houve dinheiro).
//
// Depois: o pagamento fica "reembolsado" (com data, motivo e quem o fez).
// Numa marcação, o valor sai do "Já pago" e, se pedido, a marcação é
// cancelada (o horário fica livre). Numa compra, a encomenda fica
// reembolsada e, se pedido, as unidades voltam ao stock. O cliente recebe
// um email a avisar.
// ---------------------------------------------------------------------------
const { db, getSettings, BOOKING_SELECT } = require('../../lib/db');
const U = require('../../lib/util');
const stripe = require('../fornecedores/stripe');
const loja = require('./loja');
const notify = require('../../lib/notify');

const erro = (m, s = 400) => new U.HttpError(s, m);
// Estados em que cancelar uma marcação ainda faz sentido (antes de acontecer).
const CANCELAVEIS = ['pedido', 'aguarda_pagamento', 'confirmado', 'em_curso'];

async function reembolsar(pagId, opcoes, user) {
  const o = opcoes || {};
  const p = db.prepare('SELECT * FROM int_pagamentos WHERE id=?').get(U.toInt(pagId));
  if (!p) throw erro('Pagamento não encontrado.', 404);
  if (p.estado === 'reembolsado') throw erro('Este pagamento já foi reembolsado.', 409);
  if (p.estado !== 'pago') throw erro('Só um pagamento pago se pode reembolsar.', 409);
  const motivo = U.clean(o.motivo, 300);

  let externo = '';
  if (p.fornecedor === 'stripe') {
    if (!stripe.ativo()) throw erro('O Stripe não está ligado neste servidor: faça o reembolso no painel do Stripe.', 503);
    try { externo = await stripe.reembolsar(p); } catch (e) { throw erro('O Stripe recusou o reembolso: ' + e.message, 502); }
  } else if (p.fornecedor !== 'demo') {
    throw erro('Este pagamento não se reembolsa daqui.');
  }

  const agora = new Date().toISOString();
  const booking = p.booking_id ? db.prepare(BOOKING_SELECT + ' WHERE b.id=?').get(p.booking_id) : null;
  let cancelada = false;
  let encomenda = null;
  db.transaction(() => {
    db.prepare(`UPDATE int_pagamentos SET estado='reembolsado', reembolsado_em=?, reembolso_motivo=?, reembolso_externo=?,
                reembolsado_por=?, atualizado_em=? WHERE id=?`).run(agora, motivo, externo, user ? user.id : null, agora, p.id);
    if (booking) {
      db.prepare('UPDATE bookings SET paid=MAX(0, paid-?), updated_at=? WHERE id=?').run(p.valor, agora, booking.id);
      if (o.cancelar && CANCELAVEIS.includes(booking.status)) {
        db.prepare("UPDATE bookings SET status='cancelado', updated_at=? WHERE id=?").run(agora, booking.id);
        cancelada = true;
      }
    } else {
      encomenda = loja.reembolsar(p.booking_code, !!o.devolverStock);
    }
  })();

  avisar(p, booking, encomenda, motivo, cancelada).catch((e) => console.error('aviso de reembolso:', e.message));
  return {
    pagamento: db.prepare('SELECT * FROM int_pagamentos WHERE id=?').get(p.id),
    cancelada, stock_devolvido: !!(encomenda && o.devolverStock), stripe: !!externo,
  };
}

async function avisar(p, booking, encomenda, motivo, cancelada) {
  const para = booking ? booking.client_email : encomenda && encomenda.cliente_email;
  if (!para) return;
  const s = getSettings();
  const nome = booking ? booking.client_name : encomenda.cliente_nome;
  const oque = booking ? `da marcação ${booking.code}` : `da compra ${encomenda.code} (${encomenda.quantidade} × ${encomenda.titulo})`;
  await notify.sendEmail({
    to: para,
    subject: `Reembolso ${booking ? 'da marcação ' + booking.code : 'da compra ' + encomenda.code}`,
    text: [
      `Olá ${nome},`,
      '',
      `O ${s.business_name || 'estúdio'} reembolsou o pagamento ${oque}: ${Number(p.valor).toLocaleString('pt-PT')} ${String(p.moeda || s.currency || '').toUpperCase()}.`,
      p.fornecedor === 'stripe' ? 'O valor volta ao cartão com que pagou; pode demorar alguns dias a aparecer, conforme o banco.' : null,
      cancelada ? 'A marcação foi cancelada.' : null,
      motivo ? `Motivo: ${motivo}` : null,
      '',
      'Para qualquer dúvida, responda a este email ou fale com o estúdio.',
    ].filter((l) => l !== null).join('\n'),
  });
}

module.exports = { reembolsar };
