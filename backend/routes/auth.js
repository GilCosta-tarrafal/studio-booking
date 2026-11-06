'use strict';

const express = require('express');
const { db, getSettings } = require('../lib/db');
const auth = require('../lib/auth');
const atividade = require('../lib/atividade');
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
  if (!user || !ok || !user.active) {
    // Tentativa falhada numa conta que existe: fica na atividade dessa conta,
    // para o dono perceber se alguém anda a tentar entrar.
    if (user) atividade.registar(user.id, 'error', 'Tentativa de login falhada', { status: 401, ip: req.ip });
    throw new HttpError(401, 'Email ou palavra-passe incorretos.');
  }
  auth.createSession(res, user.id);
  db.prepare('UPDATE users SET last_login_at=?, last_login_ip=?, last_seen_at=? WHERE id=?')
    .run(new Date().toISOString(), String(req.ip || '').slice(0, 64), new Date().toISOString(), user.id);
  atividade.registar(user.id, 'login', 'Login efetuado no painel', { status: 200, ip: req.ip });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, studio_id: user.studio_id || null } });
});

router.post('/logout', (req, res) => {
  if (req.user) atividade.registar(req.user.id, 'logout', 'Sessão terminada no painel', { status: 200, ip: req.ip });
  auth.destroySession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) throw new HttpError(401, 'Sem sessão.');
  // site_url: para onde apontam os links "Ver o site" do painel (outra porta,
  // se o painel tiver a sua; ver lib/portas.js).
  const portas = require('../lib/portas');
  // bloqueio_ms: ao fim de quanto tempo parado o painel se bloqueia; user.locked
  // diz se já está bloqueado (ver lib/auth.js).
  // A função (perfil de "Gestão de acesso") com maior prioridade, para o chip
  // da barra de topo.
  const funcao = db.prepare(
    `SELECT r.name, r.code FROM rbac_assignments a JOIN rbac_roles r ON r.id = a.role_id
      WHERE a.user_id=? AND (a.expires_at IS NULL OR a.expires_at >= date('now')) ORDER BY r.priority DESC LIMIT 1`
  ).get(req.user.id) || null;
  res.json({
    user: { ...req.user, funcao }, today: U.nowLocal().date, settings: getSettings(), bloqueio_ms: auth.BLOQUEIO_MS,
    site_url: portas.separado() ? portas.url('site', req) + '/' : '/',
  });
});

// ---- Bloqueio por inatividade ----
// O painel avisa quando há atividade real (no máximo uma vez por minuto) e
// bloqueia a sessão quando passa o tempo sem mexer. Para desbloquear, a
// palavra-passe da própria conta; 5 erros seguidos terminam a sessão.
const SEM_SESSAO = 'Sessão expirada. Inicie sessão novamente.';
const errosDesbloqueio = new Map();   // sessionHash -> erros seguidos

router.post('/ativo', (req, res) => {
  if (!req.user) throw new HttpError(401, SEM_SESSAO);
  if (req.user.locked) throw new HttpError(423, 'O painel está bloqueado por inatividade.');
  auth.marcarAtividade(req);
  res.json({ ok: true });
});

router.post('/bloquear', (req, res) => {
  if (!req.user) throw new HttpError(401, SEM_SESSAO);
  auth.bloquear(req);
  res.json({ ok: true });
});

router.post('/desbloquear', (req, res) => {
  if (!req.user) throw new HttpError(401, SEM_SESSAO);
  const password = String((req.body || {}).password || '');
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!auth.verifyPassword(password, row.password_hash)) {
    const erros = (errosDesbloqueio.get(req.sessionHash) || 0) + 1;
    atividade.registar(req.user.id, 'error', 'Palavra-passe errada ao desbloquear o painel', { status: 400, ip: req.ip });
    if (erros >= 5) {
      errosDesbloqueio.delete(req.sessionHash);
      auth.destroySession(req, res);
      throw new HttpError(401, 'Demasiadas tentativas erradas. A sessão foi terminada; entre de novo.');
    }
    errosDesbloqueio.set(req.sessionHash, erros);
    throw new HttpError(400, `Palavra-passe incorreta. Restam ${5 - erros} ${5 - erros === 1 ? 'tentativa' : 'tentativas'}.`);
  }
  errosDesbloqueio.delete(req.sessionHash);
  auth.desbloquear(req);
  res.json({ ok: true });
});

router.post('/password', auth.requireAuth, (req, res) => {
  const current = String((req.body || {}).current || '');
  const next = String((req.body || {}).next || '');
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!auth.verifyPassword(current, row.password_hash)) {
    atividade.registar(req.user.id, 'error', 'Tentativa de alterar a palavra-passe falhada', { status: 400, ip: req.ip });
    throw new HttpError(400, 'A palavra-passe atual não está correta.');
  }
  if (next.length < 8) throw new HttpError(400, 'A nova palavra-passe deve ter pelo menos 8 caracteres.');
  db.prepare('UPDATE users SET password_hash=?, password_changed_at=? WHERE id=?')
    .run(auth.hashPassword(next), new Date().toISOString(), req.user.id);
  atividade.registar(req.user.id, 'change', 'Alterou a palavra-passe', { status: 200, ip: req.ip });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- O meu perfil
// Cada pessoa da equipa vê e edita os seus próprios dados. Papel, estado e
// estúdio continuam a ser geridos pelo proprietário em Utilizadores.
function papel(u) {
  if (u.role === 'owner') return 'Administrador';
  if (u.studio_id) return 'Agente';
  return 'Responsável';
}

function perfil(userId) {
  const u = db.prepare(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.active, u.studio_id, u.created_at,
            u.last_login_at, u.last_login_ip, u.last_seen_at, u.password_changed_at, s.name AS studio_name
       FROM users u LEFT JOIN studios s ON s.id = u.studio_id WHERE u.id=?`
  ).get(userId);
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const conta = db.prepare(
    `SELECT SUM(kind='login') logins, SUM(kind='change') changes, SUM(kind='error') errors
       FROM user_activity WHERE user_id=? AND created_at >= ?`
  ).get(userId, desde);
  // Perfil completo: nome, email, telefone e uma palavra-passe escolhida pela
  // própria pessoa (não a que veio do arranque ou de quem criou a conta).
  const passos = [!!u.name, !!u.email, !!u.phone, !!u.password_changed_at];
  return {
    ...u,
    active: !!u.active,
    role_label: papel(u),
    full_access: u.role === 'owner',
    stats: { logins: conta.logins || 0, changes: conta.changes || 0, errors: conta.errors || 0 },
    completeness: Math.round((passos.filter(Boolean).length / passos.length) * 100),
  };
}

router.get('/profile', auth.requireAuth, (req, res) => {
  res.json({ profile: perfil(req.user.id) });
});

router.put('/profile', auth.requireAuth, (req, res) => {
  const b = req.body || {};
  const name = U.clean(b.name, 80);
  const email = U.clean(b.email, 120).toLowerCase();
  const phone = U.clean(b.phone, 30);
  if (!name) throw new HttpError(400, 'Indique o nome.');
  if (!U.isEmail(email)) throw new HttpError(400, 'Indique um email válido.');
  if (phone && U.digits(phone).length < 7) throw new HttpError(400, 'Indique um telefone válido.');
  const atual = db.prepare('SELECT email, password_hash FROM users WHERE id=?').get(req.user.id);
  if (email !== atual.email.toLowerCase()) {
    // O email é o login: para o trocar pede-se a palavra-passe, para uma sessão
    // esquecida aberta não bastar para tomar conta da conta.
    if (!auth.verifyPassword(String(b.password || ''), atual.password_hash)) {
      throw new HttpError(400, 'Para mudar o email, confirme com a sua palavra-passe atual.');
    }
    if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(email, req.user.id)) {
      throw new HttpError(409, 'Já existe um utilizador com esse email.');
    }
  }
  db.prepare('UPDATE users SET name=?, email=?, phone=? WHERE id=?').run(name, email, phone, req.user.id);
  atividade.registar(req.user.id, 'change', 'Atualizou os dados pessoais', { status: 200, ip: req.ip });
  res.json({ profile: perfil(req.user.id) });
});

const FILTROS = {
  sessoes: "kind IN ('login','logout')",
  alteracoes: "kind = 'change'",
  erros: "kind = 'error'",
};

router.get('/activity', auth.requireAuth, (req, res) => {
  const filtro = FILTROS[req.query.filtro] || '1=1';
  const limite = Math.min(Math.max(U.toInt(req.query.limite, 50), 1), 200);
  const items = db.prepare(
    `SELECT id, kind, action, detail, status, ip, created_at FROM user_activity
      WHERE user_id=? AND ${filtro} ORDER BY id DESC LIMIT ?`
  ).all(req.user.id, limite);
  res.json({ items });
});

module.exports = router;
