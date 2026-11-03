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

module.exports = { avisar, siteUrl };
