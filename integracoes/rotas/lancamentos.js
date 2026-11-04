'use strict';
// Lançamentos das plataformas, já no formato do site: novidades para o
// carrossel do topo e sucessos para "Saíram deste estúdio".
const { db, lerDefinicoes } = require('../lib/base');

const CAPA_SEM_IMAGEM = '/img/logo.png';

function paraSite() {
  const def = lerDefinicoes();
  const visiveis = "visivel=1 AND removido=0";

  // Novidades: os max_novidades (até 5) lançamentos mais recentes pela data de
  // lançamento, a começar pelos que ainda vão sair. Entra um novo, sai o mais
  // antigo; nenhum sai sem outro entrar no lugar.
  const novidades = db.prepare(
    `SELECT * FROM int_lancamentos WHERE ${visiveis} AND data != ''
      ORDER BY data DESC, id DESC LIMIT ?`
  ).all(def.max_novidades).map((l) => ({
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

  // max_novidades: o site corta a lista junta (esta + novidades.js) no mesmo número.
  return { novidades, sucessos, max_novidades: def.max_novidades };
}

module.exports = { paraSite };
