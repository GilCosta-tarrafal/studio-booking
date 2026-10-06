'use strict';
// ---------------------------------------------------------------------------
// Música à mão: lançamentos que o estúdio escreve no painel, sem depender de
// nenhuma plataforma. Ficam na mesma tabela dos lançamentos sincronizados
// (int_lancamentos), com fonte='manual', por isso entram no site pela mesma
// porta (ver rotas/lancamentos.js → paraSite): aparecem nas novidades enquanto
// recentes e em "Saíram deste estúdio" quando passam o limite de reproduções.
// ---------------------------------------------------------------------------
const { db } = require('../lib/base');
const { baixarCapa } = require('../lib/capas');
const { HttpError } = require('../../backend/lib/util');

const FONTE = 'manual';

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : '');
const eUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 1000;
const erro = (m, s = 400) => new HttpError(s, m);

// Lê e valida o que vem do formulário. Só o título é obrigatório.
function normalizar(d) {
  d = d || {};
  const titulo = texto(d.titulo, 160);
  if (!titulo) throw erro('Indique o título da música.');
  const data = texto(d.data, 16);
  if (data && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(data)) throw erro('A data tem de ser no formato AAAA-MM-DD.');
  let plays = null;
  if (d.plays !== undefined && d.plays !== null && String(d.plays).trim() !== '') {
    plays = Math.round(Number(d.plays));
    if (!Number.isFinite(plays) || plays < 0) throw erro('As reproduções têm de ser um número igual ou maior que zero.');
  }
  return {
    titulo,
    artista: texto(d.artista, 200),
    texto: texto(d.texto, 400),
    data,
    plays,
    link: eUrl(d.link) ? d.link : '',
    capa_origem: eUrl(d.capa_origem) ? d.capa_origem : '',
    formato: d.formato === 'video' ? 'video' : '',
    visivel: d.visivel === undefined ? 1 : (d.visivel ? 1 : 0),
  };
}

function listar() {
  return db.prepare(
    "SELECT * FROM int_lancamentos WHERE fonte=? ORDER BY CASE WHEN data='' THEN 1 ELSE 0 END, data DESC, id DESC"
  ).all(FONTE);
}

function obter(id) {
  return db.prepare('SELECT * FROM int_lancamentos WHERE id=? AND fonte=?').get(id, FONTE);
}

// Copia a capa indicada por link para o disco do site. Nunca faz falhar a
// gravação: se a imagem não servir, fica sem capa (o site usa o logo) e
// devolve-se o aviso para o painel o mostrar.
async function aplicarCapa(id, url) {
  if (!url) { db.prepare('UPDATE int_lancamentos SET capa=? WHERE id=?').run('', id); return null; }
  try {
    const caminho = await baixarCapa(url, 'manual-' + id);
    db.prepare('UPDATE int_lancamentos SET capa=? WHERE id=?').run(caminho, id);
    return null;
  } catch (e) {
    db.prepare('UPDATE int_lancamentos SET capa=? WHERE id=?').run('', id);
    return e.message;
  }
}

async function criar(dados) {
  const l = normalizar(dados);
  const agora = new Date().toISOString();
  const externo = 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const r = db.prepare(
    `INSERT INTO int_lancamentos(fonte,externo_id,titulo,artista,texto,capa_origem,link,data,formato,plays,plays_em,visivel,criado_em,atualizado_em)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(FONTE, externo, l.titulo, l.artista, l.texto, l.capa_origem, l.link, l.data, l.formato,
    l.plays, l.plays === null ? null : agora, l.visivel, agora, agora);
  const avisoCapa = await aplicarCapa(r.lastInsertRowid, l.capa_origem);
  return { lancamento: obter(r.lastInsertRowid), avisoCapa };
}

async function editar(id, dados) {
  const atual = obter(id);
  if (!atual) throw erro('Música não encontrada.', 404);
  const l = normalizar(dados);
  const agora = new Date().toISOString();
  db.prepare(
    `UPDATE int_lancamentos SET titulo=?, artista=?, texto=?, capa_origem=?, link=?, data=?, formato=?,
       plays=?, plays_em=?, visivel=?, atualizado_em=? WHERE id=?`
  ).run(l.titulo, l.artista, l.texto, l.capa_origem, l.link, l.data, l.formato,
    l.plays, l.plays === null ? null : agora, l.visivel, agora, id);
  // Só volta a buscar a imagem se o endereço mudou.
  const avisoCapa = l.capa_origem !== atual.capa_origem ? await aplicarCapa(id, l.capa_origem) : null;
  return { lancamento: obter(id), avisoCapa };
}

function apagar(id) {
  return db.prepare('DELETE FROM int_lancamentos WHERE id=? AND fonte=?').run(id, FONTE).changes;
}

module.exports = { FONTE, listar, obter, criar, editar, apagar };
