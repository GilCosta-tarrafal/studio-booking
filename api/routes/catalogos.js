'use strict';

// Catálogos de Configurações. Ler: toda a equipa (o formulário da marcação
// precisa das listas). Mudar: só quem gere a configuração geral.

const express = require('express');
const { db } = require('../lib/db');
const auth = require('../lib/auth');
const U = require('../lib/util');
const { HttpError } = U;
const C = require('../lib/catalogos');

const router = express.Router();

function catalogo(req) {
  const c = C.PORCHAVE.get(req.params.cat);
  if (!c) throw new HttpError(404, 'Catálogo não encontrado.');
  return c;
}
function item(c, req) {
  const it = db.prepare('SELECT * FROM catalogo_itens WHERE id=? AND catalogo=?').get(U.toInt(req.params.id), c.key);
  if (!it) throw new HttpError(404, 'Item não encontrado.');
  return it;
}

// "Cartão de débito" -> "CARTAO_DE_DEBITO".
const paraCodigo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// Quantas marcações usam o item (o género fica guardado pelo nome).
function emUso(c, it) {
  // Tipos de projeto da secção "Participa": contam os projetos com esse tipo.
  if (c.key === 'tipos_participa') {
    return db.prepare('SELECT COUNT(*) n FROM int_projetos WHERE categoria=?').get(it.codigo).n;
  }
  if (!c.campo) return 0;
  const valor = c.campo === 'style' ? it.nome : it.codigo;
  return db.prepare(`SELECT COUNT(*) n FROM bookings WHERE ${c.campo}=?`).get(valor).n;
}

router.get('/', (_req, res) => {
  res.json({
    catalogos: C.CATALOGOS.map((c) => ({ key: c.key, titulo: c.titulo, desc: c.desc, sistema: !!c.sistema, itens: C.itens(c.key) })),
  });
});

router.post('/:cat', auth.requireManager, (req, res) => {
  const c = catalogo(req);
  if (c.sistema) throw new HttpError(400, 'Esta lista é do sistema: não se lhe acrescentam itens.');
  const b = req.body || {};
  const nome = U.clean(b.nome, 80);
  if (!nome) throw new HttpError(400, 'Indique o nome.');
  const codigo = paraCodigo(b.codigo || nome);
  if (!codigo) throw new HttpError(400, 'Indique um código com letras ou números.');
  if (db.prepare('SELECT 1 FROM catalogo_itens WHERE catalogo=? AND codigo=?').get(c.key, codigo)) {
    throw new HttpError(409, `Já existe um item com o código ${codigo}.`);
  }
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),-1)+1 o FROM catalogo_itens WHERE catalogo=?').get(c.key).o;
  const id = db.prepare(`INSERT INTO catalogo_itens(catalogo,codigo,nome,descricao,ativo,sistema,ordem,created_at)
                         VALUES(?,?,?,?,?,0,?,?)`)
    .run(c.key, codigo, nome, U.clean(b.descricao, 300), b.ativo === false ? 0 : 1, ordem, new Date().toISOString()).lastInsertRowid;
  res.status(201).json({ id });
});

router.put('/:cat/:id', auth.requireManager, (req, res) => {
  const c = catalogo(req);
  const it = item(c, req);
  const b = req.body || {};
  const descricao = U.clean(b.descricao, 300);
  if (it.sistema) {
    // Do sistema: o nome e o estado vêm do código; só a descrição é do dono.
    db.prepare('UPDATE catalogo_itens SET descricao=? WHERE id=?').run(descricao, it.id);
    return res.json({ ok: true });
  }
  const nome = U.clean(b.nome, 80);
  if (!nome) throw new HttpError(400, 'Indique o nome.');
  db.prepare('UPDATE catalogo_itens SET nome=?, descricao=?, ativo=? WHERE id=?').run(nome, descricao, b.ativo === false ? 0 : 1, it.id);
  res.json({ ok: true });
});

router.delete('/:cat/:id', auth.requireManager, (req, res) => {
  const c = catalogo(req);
  const it = item(c, req);
  if (it.sistema) throw new HttpError(400, 'Este item é do sistema e não pode ser apagado.');
  const n = emUso(c, it);
  const onde = c.key === 'tipos_participa' ? (n === 1 ? 'projeto' : 'projetos') : (n === 1 ? 'marcação' : 'marcações');
  if (n) throw new HttpError(409, `Está a ser usado em ${n} ${onde}. Desative-o em vez de o apagar.`);
  db.prepare('DELETE FROM catalogo_itens WHERE id=?').run(it.id);
  res.json({ ok: true });
});

module.exports = router;
