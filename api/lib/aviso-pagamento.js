'use strict';
// Aviso ao cliente quando o estúdio aceita o pedido: a marcação fica à espera
// do pagamento e só depois fica confirmada. Vai por email e por SMS (ver
// lib/notify.js: sem fornecedor configurado, fica escrito no registo).
//
// Os textos estão no dicionario.js (chaves "email.*") e saem na língua em que
// o cliente marcou no site (bookings.lingua; vazia = português), tal como os
// nomes do estúdio e da sala, se o estúdio os traduziu no painel.
const { getSettings } = require('./db');
const notify = require('./notify');
const D = require('../comum/assets/js/dicionario.js');
const TR = require('./traducoes');

// O aviso pode partir do painel: o link é sempre o do site (ver lib/enderecos.js).
const siteUrl = (req) => require('./enderecos').site(req);

// O que os três avisos têm em comum: a língua, o t() preso a ela e os nomes.
function contexto(b) {
  const s = getSettings();
  const lingua = D.codigos.includes(b.lingua) ? b.lingua : 'pt';
  const t = (chave, valores) => D.t(lingua, chave, valores);
  const estudio = TR.local(b.studio_name, b.studio_tr, lingua, 'name');
  const sala = TR.local(b.room_name, b.room_tr, lingua, 'name');
  const dia = b.date.split('-').reverse().join('/');
  return { s, t, negocio: s.business_name || t('email.estudio'), dia, onde: `${estudio}, ${sala} · ${dia}, ${b.start}-${b.end}` };
}

async function avisar(b, req) {
  const { s, t, negocio, onde } = contexto(b);
  const link = `${siteUrl(req)}/pagar?code=${encodeURIComponent(b.code)}`;
  const emFalta = Math.max(0, b.price - b.paid);
  const texto = [
    t('email.ola', { nome: b.client_name }),
    '',
    t('email.aceite.l1', { negocio, code: b.code }),
    `(${onde}).`,
    '',
    t('email.aceite.l3', { valor: `${emFalta} ${b.currency || s.currency || ''}`.trim() }),
    t('email.aceite.pague', { link }),
    '',
    t('email.aceite.expira'),
  ].join('\n');
  const envios = [];
  if (b.client_email) envios.push(notify.sendEmail({ to: b.client_email, subject: t('email.aceite.assunto', { code: b.code }), text: texto }));
  if (b.client_phone) envios.push(notify.sendSms({ to: b.client_phone, text: t('email.aceite.sms', { negocio, code: b.code, link }) }));
  return Promise.all(envios);
}

// Logo que o cliente marca no site e a marcação não fica à espera de pagamento
// (pedido por confirmar, ou sessão sem custo já confirmada): envia para o email
// da conta a referência, para a guardar e consultar a marcação. Quando fica à
// espera de pagamento, o aviso de cima já leva a referência.
async function referencia(b, req) {
  if (!b.client_email) return [];
  const { t, negocio, onde } = contexto(b);
  const link = `${siteUrl(req)}/consultar?code=${encodeURIComponent(b.code)}`;
  const pedido = b.status === 'pedido';
  const texto = [
    t('email.ola', { nome: b.client_name }),
    '',
    t(pedido ? 'email.ref.recebido' : 'email.ref.confirmada', { negocio }),
    '',
    t('email.ref.codigo', { code: b.code }),
    onde,
    '',
    pedido ? t('email.ref.vaiConfirmar') : null,
    t('email.ref.guarde', { link }),
  ].filter((l) => l !== null).join('\n');
  return [await notify.sendEmail({
    to: b.client_email,
    subject: t(pedido ? 'email.ref.assuntoPedido' : 'email.ref.assuntoConfirmada', { code: b.code }),
    text: texto,
  })];
}

// Depois de o pagamento entrar: confirma ao cliente que a marcação ficou
// confirmada (e quanto pagou), com o link para consultar a marcação.
async function confirmado(b, valor, req) {
  const { s, t, negocio, dia, onde } = contexto(b);
  const link = `${siteUrl(req)}/consultar?code=${encodeURIComponent(b.code)}`;
  const texto = [
    t('email.ola', { nome: b.client_name }),
    '',
    t('email.pago.l1', { valor: `${valor} ${b.currency || s.currency || ''}`.trim(), code: b.code }),
    t('email.pago.l2', { onde }),
    '',
    t('email.pago.consulte', { link }),
  ].join('\n');
  const envios = [];
  if (b.client_email) envios.push(notify.sendEmail({ to: b.client_email, subject: t('email.pago.assunto', { code: b.code }), text: texto }));
  if (b.client_phone) envios.push(notify.sendSms({ to: b.client_phone, text: t('email.pago.sms', { negocio, code: b.code, dia, hora: b.start }) }));
  return Promise.all(envios);
}

module.exports = { avisar, referencia, confirmado, siteUrl };
