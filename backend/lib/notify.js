'use strict';

// Envio de email e SMS. Os fornecedores ligam-se por variáveis de ambiente; sem
// elas, o envio não falha — escreve a mensagem no registo (log) do servidor,
// para se poder desenvolver e testar sem contratar nada. Em produção, basta pôr
// as chaves no painel do serviço de alojamento e o mesmo código passa a enviar
// a sério.
//
// Email: SMTP (SMTP_USER + SMTP_PASS; por omissão o servidor do Gmail), Resend
//        (RESEND_API_KEY) ou Brevo (BREVO_API_KEY). Resend e Brevo vão por
//        HTTPS com o fetch do Node; o SMTP usa o nodemailer.
// SMS:   Twilio (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_SMS_FROM).
//
// Cada envio devolve { sent, channel, provider } e nunca deita o servidor
// abaixo: uma falha de envio regista-se e segue, para um erro do fornecedor não
// deixar o utilizador preso.

// Lido na hora de enviar (não no arranque), para o .env e os testes contarem.
// Sem MAIL_FROM, sai do endereço SMTP com o nome do negócio das Definições.
function mailFrom() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  let nome = 'Estúdio';
  try { nome = require('./db').getSettings().business_name.replace(/[<>"]/g, '') || nome; } catch (_) { /* fica "Estúdio" */ }
  return `${nome} <${process.env.SMTP_USER || 'nao-responder@localhost'}>`;
}

function log(linhas) {
  console.log('\n────────────────────────────────────────────────────');
  for (const l of linhas) console.log(l);
  console.log('────────────────────────────────────────────────────\n');
}

async function enviarResend({ to, subject, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: mailFrom(), to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function enviarBrevo({ to, subject, text }) {
  const MAIL_FROM = mailFrom();
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

// SMTP — pensado para o Gmail: SMTP_USER é o endereço Gmail e SMTP_PASS uma
// "palavra-passe de aplicação" (Conta Google › Segurança › Verificação em dois
// passos › Palavras-passe de aplicações), não a palavra-passe normal.
// SMTP_HOST/SMTP_PORT servem para outro servidor (Outlook, o do alojamento...).
let transporte = null;
function smtp() {
  if (!transporte) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transporte = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465,
      // O Google mostra a palavra-passe de aplicação com espaços; tiram-se.
      auth: { user: process.env.SMTP_USER, pass: String(process.env.SMTP_PASS).replace(/s+/g, '') },
    });
  }
  return transporte;
}

async function enviarSmtp({ to, subject, text }) {
  await smtp().sendMail({ from: mailFrom(), to, subject, text });
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

const smtpConfigurado = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);
const emailConfigurado = () => !!(smtpConfigurado() || process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
const smsConfigurado = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);

async function sendEmail({ to, subject, text }) {
  if (!emailConfigurado()) {
    log([' Email por enviar (nenhum fornecedor configurado)', `   Para:     ${to}`, `   Assunto:  ${subject}`, '', text]);
    return { sent: false, channel: 'email', provider: 'log' };
  }
  const provider = smtpConfigurado() ? 'smtp' : process.env.RESEND_API_KEY ? 'resend' : 'brevo';
  try {
    await ({ smtp: enviarSmtp, resend: enviarResend, brevo: enviarBrevo })[provider]({ to, subject, text });
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
