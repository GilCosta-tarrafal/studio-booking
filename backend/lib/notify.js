'use strict';

// Envio de email e SMS. Os fornecedores ligam-se por variáveis de ambiente; sem
// elas, o envio não falha — escreve a mensagem no registo (log) do servidor,
// para se poder desenvolver e testar sem contratar nada. Em produção, basta pôr
// as chaves no painel do serviço de alojamento e o mesmo código passa a enviar
// a sério.
//
// Email: Resend (RESEND_API_KEY) ou Brevo (BREVO_API_KEY), por HTTPS — sem
//        dependências novas, usa o fetch que o Node 22 já traz.
// SMS:   Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_SMS_FROM).
//
// Cada envio devolve { sent, channel, provider } e nunca deita o servidor
// abaixo: uma falha de envio regista-se e segue, para um erro do fornecedor não
// deixar o utilizador preso.

const MAIL_FROM = process.env.MAIL_FROM || 'Estúdio <nao-responder@localhost>';

function log(linhas) {
  console.log('\n────────────────────────────────────────────────────');
  for (const l of linhas) console.log(l);
  console.log('────────────────────────────────────────────────────\n');
}

async function enviarResend({ to, subject, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function enviarBrevo({ to, subject, text }) {
  const m = /<([^>]+)>/.exec(MAIL_FROM);
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { email: m ? m[1] : MAIL_FROM, name: MAIL_FROM.replace(/\s*<[^>]+>/, '').trim() || undefined },
      to: [{ email: to }], subject, textContent: text,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

async function enviarTwilio({ to, text }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const body = new URLSearchParams({ To: to, From: process.env.TWILIO_SMS_FROM, Body: text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${await r.text()}`);
}

const emailConfigurado = () => !!(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
const smsConfigurado = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);

async function sendEmail({ to, subject, text }) {
  if (!emailConfigurado()) {
    log([' Email por enviar (nenhum fornecedor configurado)', `   Para:     ${to}`, `   Assunto:  ${subject}`, '', text]);
    return { sent: false, channel: 'email', provider: 'log' };
  }
  const provider = process.env.RESEND_API_KEY ? 'resend' : 'brevo';
  try {
    await (provider === 'resend' ? enviarResend : enviarBrevo)({ to, subject, text });
    return { sent: true, channel: 'email', provider };
  } catch (err) {
    console.error('Falha ao enviar email:', err.message);
    return { sent: false, channel: 'email', provider, error: err.message };
  }
}

async function sendSms({ to, text }) {
  if (!smsConfigurado()) {
    log([' SMS por enviar (nenhum fornecedor configurado)', `   Para:  ${to}`, '', text]);
    return { sent: false, channel: 'sms', provider: 'log' };
  }
  try {
    await enviarTwilio({ to, text });
    return { sent: true, channel: 'sms', provider: 'twilio' };
  } catch (err) {
    console.error('Falha ao enviar SMS:', err.message);
    return { sent: false, channel: 'sms', provider: 'twilio', error: err.message };
  }
}

module.exports = { sendEmail, sendSms, emailConfigurado, smsConfigurado };
