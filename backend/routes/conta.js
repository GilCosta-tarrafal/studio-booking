'use strict';

// Contas de cliente: criar conta, entrar (por email ou telefone), sair, e
// recuperar a palavra-passe com um código enviado por email ou SMS. A equipa
// usa /api/auth; isto é só para quem marca no site.

const express = require('express');
const { db, getSettings } = require('../lib/db');
const conta = require('../lib/conta-auth');
const auth = require('../lib/auth');
const notify = require('../lib/notify');
const U = require('../lib/util');
const { HttpError } = U;
const { rateLimit } = require('../lib/ratelimit');

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
// A recuperação envia email/SMS (que custa): mão travada e por dispositivo.
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });

function publicClient(c) {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone };
}

// Telefone em formato internacional (+238...) para o SMS. Se o número já trouxer
// o indicativo do país, não se repete.
function toE164(phoneDigits, countryCode) {
  let d = U.digits(phoneDigits);
  if (countryCode && !d.startsWith(countryCode)) d = countryCode + d;
  return '+' + d;
}

// Valida e normaliza os campos de uma conta. Lança HttpError com mensagem clara.
function lerCampos(req, { exigirNome }) {
  const b = req.body || {};
  const name = U.clean(b.name, 80);
  const email = U.clean(b.email, 120).toLowerCase();
  const phone = U.digits(b.phone);
  const password = String(b.password || '');
  if (exigirNome && name.length < 2) throw new HttpError(400, req.t('api.nome'));
  if (!U.isEmail(email)) throw new HttpError(400, req.t('api.email'));
  if (phone.length < 7 || phone.length > 15) throw new HttpError(400, req.t('api.telefone'));
  if (password.length < 8) throw new HttpError(400, req.t('conta.passwordCurta'));
  return { name, email, phone, password };
}

router.post('/signup', signupLimiter, (req, res) => {
  const { name, email, phone, password } = lerCampos(req, { exigirNome: true });
  if (db.prepare('SELECT 1 FROM clients WHERE email=?').get(email)) throw new HttpError(409, req.t('conta.emailEmUso'));
  if (db.prepare('SELECT 1 FROM clients WHERE phone=?').get(phone)) throw new HttpError(409, req.t('conta.telefoneEmUso'));
  const info = db.prepare(
    'INSERT INTO clients(name,email,phone,password_hash,created_at) VALUES(?,?,?,?,?)'
  ).run(name, email, phone, conta.hashPassword(password), new Date().toISOString());
  conta.createSession(res, info.lastInsertRowid);
  res.status(201).json({ client: publicClient({ id: info.lastInsertRowid, name, email, phone }) });
});

// Login único do site: serve clientes e a equipa. Primeiro tenta-se uma conta
// da equipa (que se identifica por email); se bater certo, abre-se sessão de
// painel e devolve-se o destino /admin, para o mesmo botão de entrar levar o
// administrador direto à sua área. Senão, tenta-se a conta de cliente (email ou
// telefone). A ordem é decidida pela palavra-passe que bate certo: um email que
// exista nas duas tabelas entra onde a senha corresponder.
router.post('/login', loginLimiter, (req, res) => {
  const b = req.body || {};
  const id = U.clean(b.identifier, 120).trim();
  const password = String(b.password || '');

  if (id.includes('@')) {
    const staff = db.prepare('SELECT * FROM users WHERE email=?').get(id.toLowerCase());
    if (staff && staff.active && auth.verifyPassword(password, staff.password_hash)) {
      auth.createSession(res, staff.id);
      return res.json({ redirect: '/admin' });
    }
  }

  const row = id.includes('@')
    ? db.prepare('SELECT * FROM clients WHERE email=?').get(id.toLowerCase())
    : db.prepare('SELECT * FROM clients WHERE phone=?').get(U.digits(id));
  const ok = conta.verifyPassword(password, row ? row.password_hash : auth.DUMMY_HASH);
  if (!row || !ok || !row.active) throw new HttpError(401, req.t('conta.credenciaisErradas'));
  conta.createSession(res, row.id);
  res.json({ client: publicClient(row) });
});

router.post('/logout', (req, res) => {
  conta.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.client) throw new HttpError(401, req.t('conta.precisaEntrar'));
  res.json({ client: req.client });
});

// Pede um código de recuperação. Responde sempre ok, mesmo que a conta não
// exista, para não revelar quem está registado — o atacante não fica a saber se
// um email ou número tem conta.
router.post('/forgot', codeLimiter, async (req, res) => {
  const b = req.body || {};
  const canal = b.channel === 'sms' ? 'sms' : b.channel === 'email' ? 'email' : null;
  if (!canal) throw new HttpError(400, req.t('conta.canalInvalido'));
  const id = U.clean(b.identifier, 120).trim();
  const row = id.includes('@')
    ? db.prepare('SELECT * FROM clients WHERE email=?').get(id.toLowerCase())
    : db.prepare('SELECT * FROM clients WHERE phone=?').get(U.digits(id));

  if (row && row.active) {
    const s = getSettings();
    const code = conta.issueCode(row.id, 'reset', canal);
    if (canal === 'email') {
      await notify.sendEmail({
        to: row.email,
        subject: `${req.t('conta.msgAssunto')} — ${s.business_name}`,
        text: req.t('conta.msgCorpo', { codigo: code }),
      });
    } else {
      await notify.sendSms({ to: toE164(row.phone, s.country_code), text: req.t('conta.smsCorpo', { codigo: code }) });
    }
  }
  res.json({ ok: true });
});

// Confirma o código e define a nova palavra-passe. Fecha todas as sessões
// antigas: se alguém tinha entrado, deixa de ter acesso.
router.post('/reset', codeLimiter, (req, res) => {
  const b = req.body || {};
  const id = U.clean(b.identifier, 120).trim();
  const code = U.digits(b.code).slice(0, 6);
  const password = String(b.password || '');
  if (password.length < 8) throw new HttpError(400, req.t('conta.passwordCurta'));
  const row = id.includes('@')
    ? db.prepare('SELECT * FROM clients WHERE email=?').get(id.toLowerCase())
    : db.prepare('SELECT * FROM clients WHERE phone=?').get(U.digits(id));
  if (!row || !conta.checkCode(row.id, 'reset', code)) throw new HttpError(400, req.t('conta.codigoInvalido'));
  db.prepare('UPDATE clients SET password_hash=? WHERE id=?').run(conta.hashPassword(password), row.id);
  conta.destroyAllSessions(row.id);
  conta.createSession(res, row.id);
  res.json({ client: publicClient(row) });
});

// Alterar a palavra-passe com sessão iniciada: exige a atual, para ninguém
// mudar a senha de uma conta deixada aberta sem a saber.
router.post('/password', conta.requireClient, (req, res) => {
  const current = String((req.body || {}).current || '');
  const next = String((req.body || {}).next || '');
  const row = db.prepare('SELECT password_hash FROM clients WHERE id=?').get(req.client.id);
  if (!conta.verifyPassword(current, row.password_hash)) throw new HttpError(400, req.t('conta.senhaAtualErrada'));
  if (next.length < 8) throw new HttpError(400, req.t('conta.passwordCurta'));
  db.prepare('UPDATE clients SET password_hash=? WHERE id=?').run(conta.hashPassword(next), req.client.id);
  res.json({ ok: true });
});

module.exports = router;
