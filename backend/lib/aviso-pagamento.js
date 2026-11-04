'use strict';
// Aviso ao cliente quando o estúdio aceita o pedido: a marcação fica à espera
// do pagamento e só depois fica confirmada. Vai por email e por SMS (ver
// lib/notify.js: sem fornecedor configurado, fica escrito no registo).
const { getSettings } = require('./db');
const notify = require('./notify');

function siteUrl(req) {
  return (process.env.SITE_URL || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3005')).replace(/\/$/, '');
}

async function avisar(b, req) {
  const s = getSettings();
  const link = `${siteUrl(req)}/pagar?code=${encodeURIComponent(b.code)}`;
  const dia = b.date.split('-').reverse().join('/');
  const emFalta = Math.max(0, b.price - b.paid);
  const texto = [
    `Olá ${b.client_name},`,
    '',
    `O ${s.business_name || 'estúdio'} aceitou o seu pedido de marcação ${b.code}`,
    `(${b.studio_name}, ${b.room_name} · ${dia}, ${b.start}-${b.end}).`,
    '',
    `A sua marcação precisa somente do pagamento para ficar confirmada: ${emFalta} ${s.currency || ''}.`,
    `Pague aqui: ${link}`,
    '',
    'Se não for paga até à hora da sessão, a marcação expira e o horário fica livre.',
  ].join('\n');
  const envios = [];
  if (b.client_email) envios.push(notify.sendEmail({ to: b.client_email, subject: `Marcação ${b.code}: falta só o pagamento`, text: texto }));
  if (b.client_phone) {
    envios.push(notify.sendSms({ to: b.client_phone, text: `${s.business_name || 'Estúdio'}: o seu pedido ${b.code} foi aceite. Falta só pagar para confirmar: ${link}` }));
  }
  return Promise.all(envios);
}

// Logo que o cliente marca no site e a marcação não fica à espera de pagamento
// (pedido por confirmar, ou sessão sem custo já confirmada): envia para o email
// da conta a referência, para a guardar e consultar a marcação. Quando fica à
// espera de pagamento, o aviso de cima já leva a referência.
async function referencia(b, req) {
  if (!b.client_email) return [];
  const s = getSettings();
  const dia = b.date.split('-').reverse().join('/');
  const link = `${siteUrl(req)}/consultar?code=${encodeURIComponent(b.code)}`;
  const pedido = b.status === 'pedido';
  const texto = [
    `Olá ${b.client_name},`,
    '',
    pedido
      ? `Recebemos o seu pedido de marcação no ${s.business_name || 'estúdio'}.`
      : `A sua marcação no ${s.business_name || 'estúdio'} está confirmada.`,
    '',
    `Referência da marcação: ${b.code}`,
    `${b.studio_name}, ${b.room_name} · ${dia}, ${b.start}-${b.end}`,
    '',
    pedido ? 'O estúdio vai confirmar o pedido e avisá-lo por email.' : null,
    `Guarde esta referência. Consulte a marcação aqui: ${link}`,
  ].filter((l) => l !== null).join('\n');
  return [await notify.sendEmail({
    to: b.client_email,
    subject: pedido ? `Pedido de marcação recebido — referência ${b.code}` : `Marcação confirmada — referência ${b.code}`,
    text: texto,
  })];
}

// Depois de o pagamento entrar: confirma ao cliente que a marcação ficou
// confirmada (e quanto pagou), com o link para consultar a marcação.
async function confirmado(b, valor, req) {
  const s = getSettings();
  const dia = b.date.split('-').reverse().join('/');
  const link = `${siteUrl(req)}/consultar?code=${encodeURIComponent(b.code)}`;
  const texto = [
    `Olá ${b.client_name},`,
    '',
    `Recebemos o seu pagamento de ${valor} ${s.currency || ''} da marcação ${b.code}.`,
    `A marcação está confirmada: ${b.studio_name}, ${b.room_name} · ${dia}, ${b.start}-${b.end}.`,
    '',
    `Consulte a marcação e o recibo aqui: ${link}`,
  ].join('\n');
  const envios = [];
  if (b.client_email) envios.push(notify.sendEmail({ to: b.client_email, subject: `Pagamento recebido — marcação ${b.code} confirmada`, text: texto }));
  if (b.client_phone) envios.push(notify.sendSms({ to: b.client_phone, text: `${s.business_name || 'Estúdio'}: pagamento recebido. A marcação ${b.code} (${dia}, ${b.start}) está confirmada.` }));
  return Promise.all(envios);
}

module.exports = { avisar, referencia, confirmado, siteUrl };
