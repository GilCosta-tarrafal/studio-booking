'use strict';
// O que o painel pede às integrações (em /api/admin/integracoes, com sessão).
const express = require('express');
const { db, lerDefinicoes, gravarDefinicoes } = require('../lib/base');
const auth = require('../../backend/lib/auth');
const U = require('../../backend/lib/util');
const musica = require('./musica');
const capas = require('../lib/capas');
const projetos = require('./projetos');

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
    if (invalida === 'max_novidades') throw new U.HttpError(400, 'O número de slides de novidades tem de ser entre 1 e 5.');
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

  // ------------------------------------------------------------ Música à mão
  // Lançamentos escritos no painel. Gerir é coisa de gestor (não de um agente
  // preso a um estúdio); ver a lista basta ter sessão.
  router.get('/musica', (_req, res) => {
    res.json({ lancamentos: musica.listar() });
  });
  // Colar o link de uma música: devolve o título, o artista, a data e a capa
  // (já copiada para o site), para o formulário se preencher sozinho.
  router.post('/musica/ler-link', auth.requireManager, async (req, res) => {
    res.json(await musica.lerDoLink((req.body || {}).link));
  });
  router.post('/musica', auth.requireManager, async (req, res) => {
    const r = await musica.criar(req.body);
    res.json({ lancamento: r.lancamento, aviso: r.avisoCapa });
  });
  router.put('/musica/:id', auth.requireManager, async (req, res) => {
    const r = await musica.editar(U.toInt(req.params.id), req.body);
    res.json({ lancamento: r.lancamento, aviso: r.avisoCapa });
  });
  router.delete('/musica/:id', auth.requireManager, (req, res) => {
    if (!musica.apagar(U.toInt(req.params.id))) throw new U.HttpError(404, 'Música não encontrada.');
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ Projetos
  router.get('/projetos', (_req, res) => {
    res.json({ projetos: projetos.listarAdmin(), tipos: projetos.TIPOS, estados: projetos.ESTADOS });
  });
  router.post('/projetos', auth.requireManager, async (req, res) => {
    const r = await projetos.criar(req.body);
    res.json({ projeto: r.projeto, aviso: r.avisoCapa });
  });
  router.put('/projetos/:id', auth.requireManager, async (req, res) => {
    const r = await projetos.editar(U.toInt(req.params.id), req.body);
    res.json({ projeto: r.projeto, aviso: r.avisoCapa });
  });
  router.delete('/projetos/:id', auth.requireManager, (req, res) => {
    if (!projetos.apagar(U.toInt(req.params.id))) throw new U.HttpError(404, 'Projeto não encontrado.');
    res.json({ ok: true });
  });
  // Encomendas de um artigo à venda (rotas/loja.js), para combinar a entrega.
  router.get('/projetos/:id/encomendas', (req, res) => {
    res.json({ encomendas: require('./loja').listar(U.toInt(req.params.id)) });
  });
  router.get('/projetos/:id/inscricoes', (req, res) => {
    res.json({ inscricoes: projetos.listarInscricoes(U.toInt(req.params.id)) });
  });
  router.patch('/inscricoes/:id', auth.requireManager, (req, res) => {
    res.json({ inscricao: projetos.mudarEstadoInscricao(U.toInt(req.params.id), (req.body || {}).estado) });
  });
  router.delete('/inscricoes/:id', auth.requireManager, (req, res) => {
    if (!projetos.apagarInscricao(U.toInt(req.params.id))) throw new U.HttpError(404, 'Inscrição não encontrada.');
    res.json({ ok: true });
  });

  // Imagem escolhida no computador para a capa de uma música ou de um projeto.
  // Vem em bruto (o próprio ficheiro, até 5 MB); devolve o caminho que se põe
  // no campo da imagem, em vez de um link.
  router.post('/imagens', auth.requireManager,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: capas.MAX }),
    (req, res) => {
      try {
        res.status(201).json({ caminho: capas.guardarEnviada(req.body) });
      } catch (e) { throw new U.HttpError(400, e.message); }
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
