'use strict';

// Sessões e códigos das contas de cliente. Vive à parte de lib/auth.js (que
// trata da equipa): o cookie é outro (csid), a tabela é outra (client_sessions)
// e assim uma sessão de cliente nunca abre o painel nem o contrário. O que é
// igual — cifrar a palavra-passe, ler cookies — reaproveita-se do auth.js.

const crypto = require('crypto');
const { db } = require('./db');
const { HttpError } = require('./util');
const { hashPassword, verifyPassword, parseCookies } = require('./auth');

const COOKIE = 'csid';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const CODE_MS = 10 * 60 * 1000;              // o código vale 10 minutos
const CODE_MAX_ATTEMPTS = 5;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_MS,
  };
}

function createSession(res, clientId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO client_sessions(token_hash,client_id,expires_at) VALUES(?,?,?)')
    .run(sha(token), clientId, Date.now() + SESSION_MS);
  res.cookie(COOKIE, token, cookieOptions());
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM client_sessions WHERE token_hash=?').run(sha(token));
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE, opts);
}

// Fecha todas as sessões de um cliente (ao redefinir a palavra-passe).
function destroyAllSessions(clientId) {
  db.prepare('DELETE FROM client_sessions WHERE client_id=?').run(clientId);
}

// Preenche req.client se houver sessão de cliente válida.
function loadClient(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.client = null;
  if (token) {
    const row = db.prepare(
      `SELECT c.id, c.name, c.email, c.phone, c.active, s.expires_at
         FROM client_sessions s JOIN clients c ON c.id = s.client_id
        WHERE s.token_hash = ?`
    ).get(sha(token));
    if (row && row.expires_at > Date.now() && row.active) {
      req.client = { id: row.id, name: row.name, email: row.email, phone: row.phone };
    }
  }
  next();
}

function requireClient(req, _res, next) {
  if (!req.client) return next(new HttpError(401, req.t('conta.precisaEntrar')));
  next();
}

function purgeSessions() {
  db.prepare('DELETE FROM client_sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM client_codes WHERE expires_at < ?').run(Date.now());
}

// Gera um código novo de 6 dígitos para um cliente, guarda o resumo e devolve o
// código em claro (só agora, para o enviar). Apaga os códigos anteriores do
// mesmo fim: só o último vale, e não se acumulam tentativas em paralelo.
function issueCode(clientId, purpose, channel) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  db.prepare('DELETE FROM client_codes WHERE client_id=? AND purpose=?').run(clientId, purpose);
  db.prepare(
    'INSERT INTO client_codes(client_id,purpose,channel,code_hash,expires_at,created_at) VALUES(?,?,?,?,?,?)'
  ).run(clientId, purpose, channel, sha(code), Date.now() + CODE_MS, Date.now());
  return code;
}

// Confere um código. Gasta uma tentativa a cada falha e apaga o código quando
// acerta ou quando esgota as tentativas, para não dar para adivinhar à vontade.
function checkCode(clientId, purpose, code) {
  const row = db.prepare(
    'SELECT id, code_hash, expires_at, attempts FROM client_codes WHERE client_id=? AND purpose=?'
  ).get(clientId, purpose);
  if (!row) return false;
  if (row.expires_at < Date.now() || row.attempts >= CODE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM client_codes WHERE id=?').run(row.id);
    return false;
  }
  const ok = crypto.timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(sha(String(code)), 'hex'));
  if (ok) {
    db.prepare('DELETE FROM client_codes WHERE id=?').run(row.id);
    return true;
  }
  db.prepare('UPDATE client_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
  return false;
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession, destroyAllSessions,
  loadClient, requireClient, purgeSessions, issueCode, checkCode,
};
