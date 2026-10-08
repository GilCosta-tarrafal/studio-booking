'use strict';

// Gestão do controlo de acesso (RBAC) do painel: perfis (roles), permissões e a
// atribuição de perfis a utilizadores. Só o proprietário lá chega (o guarda
// requireOwner é posto na montagem, em server.js). É um módulo de gestão: aqui
// cria-se e organiza-se o catálogo; a aplicação dos acessos continua a usar o
// modelo proprietário/gestor/agente.

const express = require('express');
const { db } = require('../lib/db');
const U = require('../lib/util');
const { HttpError } = U;

const router = express.Router();

// Códigos (code, resource, action) só com letras minúsculas, números e . _ -
const slug = (v, max) => U.clean(v, max).toLowerCase().replace(/[^a-z0-9._-]/g, '');

function permissions() {
  return db.prepare('SELECT id, label, resource, action FROM rbac_permissions ORDER BY resource, action')
    .all().map((p) => ({ ...p, code: p.resource + '.' + p.action }));
}

function roles() {
  const rs = db.prepare('SELECT * FROM rbac_roles ORDER BY priority DESC, id').all();
  const porRole = {};
  for (const rp of db.prepare('SELECT role_id, permission_id FROM rbac_role_permissions').all()) {
    (porRole[rp.role_id] = porRole[rp.role_id] || []).push(rp.permission_id);
  }
  return rs.map((r) => ({
    ...r, is_system: !!r.is_system,
    permissions: porRole[r.id] || [], permCount: (porRole[r.id] || []).length,
  }));
}

function assignments() {
  return db.prepare(
    `SELECT a.id, a.user_id, a.role_id, a.expires_at, a.created_at,
            u.name AS user_name, u.email AS user_email, r.name AS role_name
       FROM rbac_assignments a
       JOIN users u ON u.id = a.user_id
       JOIN rbac_roles r ON r.id = a.role_id
      ORDER BY u.name, r.priority DESC`
  ).all();
}

router.get('/', (_req, res) => {
  res.json({ permissions: permissions(), roles: roles(), assignments: assignments() });
});

// ---- Permissões ----
router.post('/permissions', (req, res) => {
  const b = req.body || {};
  const label = U.clean(b.label, 80);
  const resource = slug(b.resource, 40);
  const action = slug(b.action, 40);
  if (label.length < 2) throw new HttpError(400, 'Indique um rótulo para a permissão.');
  if (!resource || !action) throw new HttpError(400, 'Indique o recurso e a ação (letras minúsculas).');
  if (db.prepare('SELECT 1 FROM rbac_permissions WHERE resource=? AND action=?').get(resource, action)) {
    throw new HttpError(409, 'Já existe uma permissão para esse recurso e ação.');
  }
  const info = db.prepare('INSERT INTO rbac_permissions(label,resource,action) VALUES(?,?,?)').run(label, resource, action);
  res.status(201).json({ id: info.lastInsertRowid, label, resource, action, code: resource + '.' + action });
});

router.delete('/permissions/:id', (req, res) => {
  const info = db.prepare('DELETE FROM rbac_permissions WHERE id=?').run(U.toInt(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Permissão não encontrada.');
  res.json({ ok: true });
});

// ---- Perfis (roles) ----
router.post('/roles', (req, res) => {
  const b = req.body || {};
  const name = U.clean(b.name, 60);
  const code = slug(b.code || name, 40);
  const description = U.clean(b.description, 300);
  const priority = U.toInt(b.priority, 0);
  const category = slug(b.category, 40);
  const isSystem = b.is_system ? 1 : 0;
  const permIds = Array.isArray(b.permissions) ? [...new Set(b.permissions.map((x) => U.toInt(x)).filter(Boolean))] : [];
  if (name.length < 2) throw new HttpError(400, 'Indique um nome para o perfil.');
  if (!code) throw new HttpError(400, 'Indique um código válido para o perfil.');
  if (db.prepare('SELECT 1 FROM rbac_roles WHERE code=?').get(code)) throw new HttpError(409, 'Já existe um perfil com esse código.');

  const create = db.transaction(() => {
    const id = db.prepare('INSERT INTO rbac_roles(name,code,description,priority,category,is_system) VALUES(?,?,?,?,?,?)')
      .run(name, code, description, priority, category, isSystem).lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO rbac_role_permissions(role_id,permission_id) VALUES(?,?)');
    for (const pid of permIds) {
      if (db.prepare('SELECT 1 FROM rbac_permissions WHERE id=?').get(pid)) ins.run(id, pid);
    }
    return id;
  });
  res.status(201).json({ id: create() });
});

router.delete('/roles/:id', (req, res) => {
  const row = db.prepare('SELECT is_system FROM rbac_roles WHERE id=?').get(U.toInt(req.params.id));
  if (!row) throw new HttpError(404, 'Perfil não encontrado.');
  if (row.is_system) throw new HttpError(400, 'Um perfil de sistema não pode ser eliminado.');
  db.prepare('DELETE FROM rbac_roles WHERE id=?').run(U.toInt(req.params.id));
  res.json({ ok: true });
});

// ---- Atribuições ----
router.post('/assignments', (req, res) => {
  const b = req.body || {};
  const userId = U.toInt(b.user_id);
  const roleIds = Array.isArray(b.role_ids) ? [...new Set(b.role_ids.map((x) => U.toInt(x)).filter(Boolean))]
    : b.role_id ? [U.toInt(b.role_id)] : [];
  const expires = b.expires_at ? U.clean(b.expires_at, 32) : null;
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(userId)) throw new HttpError(400, 'Escolha um utilizador válido.');
  if (!roleIds.length) throw new HttpError(400, 'Escolha pelo menos um perfil para atribuir.');
  if (expires && !U.isValidDate(expires)) throw new HttpError(400, 'A data de expiração não é válida.');

  const assign = db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO rbac_assignments(user_id,role_id,expires_at,created_at) VALUES(?,?,?,?)
       ON CONFLICT(user_id,role_id) DO UPDATE SET expires_at=excluded.expires_at`
    );
    const now = new Date().toISOString();
    let n = 0;
    for (const rid of roleIds) {
      if (db.prepare('SELECT 1 FROM rbac_roles WHERE id=?').get(rid)) { ins.run(userId, rid, expires, now); n += 1; }
    }
    return n;
  });
  const n = assign();
  if (!n) throw new HttpError(400, 'Nenhum dos perfis indicados existe.');
  res.status(201).json({ ok: true, atribuidos: n });
});

router.delete('/assignments/:id', (req, res) => {
  const info = db.prepare('DELETE FROM rbac_assignments WHERE id=?').run(U.toInt(req.params.id));
  if (!info.changes) throw new HttpError(404, 'Atribuição não encontrada.');
  res.json({ ok: true });
});

module.exports = router;
