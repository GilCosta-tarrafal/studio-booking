'use strict';

const crypto = require('crypto');
const { db } = require('./db');
const { HttpError } = require('./util');

const COOKIE = 'sid';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 's1') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(String(pw), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Palavra-passe falsa para gastar o mesmo tempo quando o email não existe.
const DUMMY_HASH = hashPassword('nao-existe');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_MS,
  };
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run(sha(token), userId, Date.now() + SESSION_MS);
  res.cookie(COOKIE, token, cookieOptions());
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(token));
  const { maxAge, ...opts } = cookieOptions();
  res.clearCookie(COOKIE, opts);
}

// Preenche req.user se houver sessão válida.
function loadUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  req.user = null;
  if (token) {
    const row = db.prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.studio_id, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    ).get(sha(token));
    if (row && row.expires_at > Date.now() && row.active) {
      req.user = { id: row.id, name: row.name, email: row.email, role: row.role, studio_id: row.studio_id || null };
    }
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Inicie sessão novamente.'));
  next();
}

function requireOwner(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Inicie sessão novamente.'));
  if (req.user.role !== 'owner') return next(new HttpError(403, 'Só o proprietário pode fazer isto.'));
  next();
}

// Gestor = proprietário ou equipa sem estúdio atribuído. Um agente (equipa
// presa a um estúdio) não mexe na configuração global — estúdios, salas,
// serviços nem na procura de coordenadas.
function requireManager(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Inicie sessão novamente.'));
  if (req.user.studio_id) return next(new HttpError(403, 'Um agente de estúdio não pode alterar a configuração geral.'));
  next();
}

function purgeSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

// Cria o primeiro utilizador se ainda não existir nenhum.
function ensureFirstUser() {
  const any = db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (any) return null;
  const email = (process.env.ADMIN_EMAIL || 'admin@estudio.local').toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }
  db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)')
    .run('Administrador', email, hashPassword(password), 'owner', new Date().toISOString());
  return { email, password, generated };
}

module.exports = {
  hashPassword, verifyPassword, DUMMY_HASH, createSession, destroySession,
  loadUser, requireAuth, requireOwner, requireManager, purgeSessions, ensureFirstUser,
};
