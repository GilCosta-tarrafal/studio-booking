'use strict';
// Lançamentos das plataformas, já no formato do site: novidades para o
// carrossel do topo e sucessos para "Saíram deste estúdio".
const { db, lerDefinicoes } = require('../lib/base');
const U = require('../../backend/lib/util');

const CAPA_SEM_IMAGEM = '/img/logo.png';

function paraSite() {
  const def = lerDefinicoes();
  const desde = U.addDays(U.nowLocal().date, -def.novidade_dias);
  const visiveis = "visivel=1 AND removido=0";

  // Novidades: o que sai em breve e o que saiu há menos de novidade_dias dias.
  const novidades = db.prepare(
    `SELECT * FROM int_lancamentos WHERE ${visiveis} AND data != '' AND substr(data,1,10) >= ?
      ORDER BY data DESC, id DESC LIMIT ?`
  ).all(desde, def.max_novidades).map((l) => ({
    titulo: l.titulo,
    artista: l.artista,
    texto: l.texto || undefined,
    capa: l.capa || CAPA_SEM_IMAGEM,
    data: l.data,
    link: l.link || undefined,
    formato: l.formato || undefined,
  }));

  const sucessos = db.prepare(
    `SELECT * FROM int_lancamentos WHERE ${visiveis} AND plays >= ? ORDER BY plays DESC, id DESC LIMIT 24`
  ).all(def.sucesso_plays).map((l) => ({
    titulo: l.titulo,
    descricao: [l.artista, l.data.slice(0, 4)].filter(Boolean).join(' · '),
    capa: l.capa || CAPA_SEM_IMAGEM,
    link: l.link || undefined,
    streams: l.plays,
  }));

  return { novidades, sucessos };
}

module.exports = { paraSite };
