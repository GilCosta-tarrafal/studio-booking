'use strict';

const express = require('express');
const { db, getSettings } = require('../lib/db');
const auth = require('../lib/auth');
const U = require('../lib/util');
const { HttpError } = U;
const { rateLimit } = require('../lib/ratelimit');

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: 'Demasiadas tentativas. Tente novamente dentro de 15 minutos.',
});

router.post('/login', loginLimiter, (req, res) => {
  const email = U.clean((req.body || {}).email, 120).toLowerCase();
  const password = String((req.body || {}).password || '');
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = auth.verifyPassword(password, user ? user.password_hash : auth.DUMMY_HASH);
  if (!user || !ok || !user.active) throw new HttpError(401, 'Email ou palavra-passe incorretos.');
  auth.createSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, studio_id: user.studio_id || null } });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sem sessão.');
  res.json({ user: req.user, today: U.nowLocal().date, settings: getSettings() });
});

router.post('/password', auth.requireAuth, (req, res) => {
  const current = String((req.body || {}).current || '');
  const next = String((req.body || {}).next || '');
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!auth.verifyPassword(current, row.password_hash)) throw new HttpError(400, 'A palavra-passe atual não está correta.');
  if (next.length < 8) throw new HttpError(400, 'A nova palavra-passe deve ter pelo menos 8 caracteres.');
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(auth.hashPassword(next), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
