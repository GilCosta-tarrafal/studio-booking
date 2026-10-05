'use strict';
// O que o painel pede às integrações (em /api/admin/integracoes, com sessão).
const express = require('express');
const { db, lerDefinicoes, gravarDefinicoes } = require('../lib/base');
const auth = require('../../backend/lib/auth');
const U = require('../../backend/lib/util');

const NOMES = {
  sucesso_plays: 'O limite de reproduções',
  novidade_dias: 'Os dias como novidade',
  max_novidades: 'O número de novidades',
};

module.exports = (fornecedores) => {
  const router = express.Router();
  const porId = Object.fromEntries(fornecedores.map((f) => [f.id, f]));

  router.get('/', (_req, res) => {
    res.json({
      fornecedores: fornecedores.map((f) => f.estado()),
      definicoes: lerDefinicoes(),
      lancamentos: db.prepare(
        "SELECT id, fonte, titulo, artista, capa, link, data, plays, plays_em, visivel, removido FROM int_lancamentos ORDER BY data DESC, id DESC LIMIT 300"
      ).all(),
      pagamentos: db.prepare(
        `SELECT p.id, p.booking_code, p.booking_id, p.valor, p.moeda, p.estado, p.criado_em, p.atualizado_em, b.client_name
           FROM int_pagamentos p LEFT JOIN bookings b ON b.id = p.booking_id
          ORDER BY p.id DESC LIMIT 50`
      ).all(),
    });
  });

  router.put('/definicoes', auth.requireOwner, (req, res) => {
    const invalida = gravarDefinicoes(req.body);
    if (invalida) throw new U.HttpError(400, `${NOMES[invalida]} tem de ser um número inteiro positivo.`);
    res.json({ definicoes: lerDefinicoes() });
  });

  // Esconder ou voltar a mostrar um lançamento no site.
  router.patch('/lancamentos/:id', (req, res) => {
    const id = U.toInt(req.params.id);
    const visivel = req.body && req.body.visivel ? 1 : 0;
    const r = db.prepare('UPDATE int_lancamentos SET visivel=? WHERE id=?').run(visivel, id);
    if (!r.changes) throw new U.HttpError(404, 'Lançamento não encontrado.');
    res.json({ ok: true, visivel: !!visivel });
  });

  // Ir buscar agora, à mão, a um fornecedor que o saiba fazer (gravadora, youtube).
  router.post('/:fornecedor/sincronizar', async (req, res) => {
    const f = porId[req.params.fornecedor];
    if (!f || !f.sincronizar) throw new U.HttpError(404, 'Esta integração não se sincroniza.');
    try {
      res.json(await f.sincronizar());
    } catch (e) {
      throw new U.HttpError(e.status === 400 ? 400 : 502, 'A sincronização falhou: ' + e.message);
    }
  });

  return router;
};
