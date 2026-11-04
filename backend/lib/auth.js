'use strict';

const crypto = require('crypto');
const { db } = require('./db');
const { HttpError } = require('./util');

const COOKIE = 'sid';
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
// Bloqueio por inatividade: sem mexer no painel durante este tempo, a sessão
// fica bloqueada até a pessoa voltar a escrever a palavra-passe. Conta só a
// atividade real (rato, teclado), que o painel avisa em POST /api/auth/ativo;
// os pedidos automáticos (sininho, chat) não contam. BLOQUEIO_MIN muda o tempo.
const BLOQUEIO_MS = Math.max(1, Number(process.env.BLOQUEIO_MIN) || 15) * 60 * 1000;
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
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,active_at,locked) VALUES(?,?,?,?,0)')
    .run(sha(token), userId, Date.now() + SESSION_MS, Date.now());
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
      `SELECT u.id, u.name, u.email, u.role, u.active, u.studio_id, u.last_seen_at, s.expires_at, s.active_at, s.locked
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    ).get(sha(token));
    if (row && row.expires_at > Date.now() && row.active) {
      req.sessionHash = sha(token);
      // Parada há mais do que o tempo de bloqueio: fica bloqueada (e assim
      // continua, mesmo que o browser não o diga).
      let locked = !!row.locked;
      // (+1 min de margem: o painel só avisa a atividade de minuto a minuto.)
      if (!locked && row.active_at && Date.now() - row.active_at > BLOQUEIO_MS + 60000) {
        db.prepare('UPDATE sessions SET locked=1 WHERE token_hash=?').run(req.sessionHash);
        locked = true;
      }
      req.user = { id: row.id, name: row.name, email: row.email, role: row.role, studio_id: row.studio_id || null, locked };
      // "Último acesso" do perfil. Grava-se no máximo uma vez por minuto, para
      // não escrever na base a cada pedido.
      if (!row.last_seen_at || Date.now() - Date.parse(row.last_seen_at) > 60000) {
        db.prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(new Date().toISOString(), row.id);
      }
    }
  }
  next();
}

// Sessão bloqueada por inatividade: responde 423 até ser desbloqueada.
const BLOQUEADA = 'O painel está bloqueado por inatividade. Escreva a palavra-passe para continuar.';

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Inicie sessão novamente.'));
  if (req.user.locked) return next(new HttpError(423, BLOQUEADA));
  next();
}

// Marcar atividade real, bloquear e desbloquear a sessão atual.
function marcarAtividade(req) {
  db.prepare('UPDATE sessions SET active_at=? WHERE token_hash=? AND locked=0').run(Date.now(), req.sessionHash);
}
function bloquear(req) {
  db.prepare('UPDATE sessions SET locked=1 WHERE token_hash=?').run(req.sessionHash);
}
function desbloquear(req) {
  db.prepare('UPDATE sessions SET locked=0, active_at=? WHERE token_hash=?').run(Date.now(), req.sessionHash);
}

function requireOwner(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Inicie sessão novamente.'));
  if (req.user.locked) return next(new HttpError(423, BLOQUEADA));
  if (req.user.role !== 'owner') return next(new HttpError(403, 'Só o proprietário pode fazer isto.'));
  next();
}

// Gestor = proprietário ou equipa sem estúdio atribuído. Um agente (equipa
// presa a um estúdio) não mexe na configuração global — criar/eliminar
// estúdios, serviços, catálogos. (O seu estúdio e as suas salas configura-os:
// ver assertStudioInScope em routes/admin.js.)
function requireManager(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Sessão expirada. Inicie sessão novamente.'));
  if (req.user.locked) return next(new HttpError(423, BLOQUEADA));
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
  hashPassword, verifyPassword, DUMMY_HASH, parseCookies, createSession, destroySession,
  loadUser, requireAuth, requireOwner, requireManager, purgeSessions, ensureFirstUser,
  BLOQUEIO_MS, marcarAtividade, bloquear, desbloquear,
};
