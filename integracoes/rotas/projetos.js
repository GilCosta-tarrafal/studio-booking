'use strict';
// ---------------------------------------------------------------------------
// Projetos colaborativos e convocatórias.
//
// O estúdio cria um projeto no painel (uma campanha para novos talentos sem
// condições para gravar num estúdio profissional, um álbum coletivo com vários
// artistas, ou outra divulgação qualquer). Enquanto "aberto", o projeto aparece
// no site e quem quiser participar deixa o seu contacto (int_inscricoes), que
// volta ao painel para o produtor ver e dar seguimento.
// ---------------------------------------------------------------------------
const { db } = require('../lib/base');
const { baixarCapa } = require('../lib/capas');
const { HttpError } = require('../../backend/lib/util');

const TIPOS = ['talentos', 'album', 'outro'];
const ESTADOS = ['novo', 'contactado', 'aceite', 'arquivado'];

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : '');
const eUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 1000;
const erro = (m, s = 400) => new HttpError(s, m);

// ---------------------------------------------------------------- Projetos
function normalizar(d) {
  d = d || {};
  const titulo = texto(d.titulo, 140);
  if (!titulo) throw erro('Indique o título do projeto.');
  const prazo = texto(d.prazo, 10);
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) throw erro('O prazo tem de ser no formato AAAA-MM-DD.');
  return {
    tipo: TIPOS.includes(d.tipo) ? d.tipo : 'outro',
    titulo,
    resumo: texto(d.resumo, 200),
    descricao: texto(d.descricao, 2000),
    prazo,
    capa_origem: eUrl(d.capa_origem) ? d.capa_origem : '',
    aberto: d.aberto === undefined ? 1 : (d.aberto ? 1 : 0),
    visivel: d.visivel === undefined ? 1 : (d.visivel ? 1 : 0),
    ordem: Number.isFinite(Number(d.ordem)) ? Math.round(Number(d.ordem)) : 0,
  };
}

function obter(id) {
  return db.prepare('SELECT * FROM int_projetos WHERE id=?').get(id);
}

// Lista para o painel, com a contagem de inscrições (e quantas por ver).
function listarAdmin() {
  const projetos = db.prepare('SELECT * FROM int_projetos ORDER BY ordem ASC, id DESC').all();
  const contagens = db.prepare(
    "SELECT projeto_id, COUNT(*) total, SUM(CASE WHEN estado='novo' THEN 1 ELSE 0 END) novos FROM int_inscricoes GROUP BY projeto_id"
  ).all();
  const mapa = Object.fromEntries(contagens.map((c) => [c.projeto_id, c]));
  return projetos.map((p) => ({
    ...p,
    inscricoes: mapa[p.id] ? mapa[p.id].total : 0,
    inscricoes_novas: mapa[p.id] ? mapa[p.id].novos : 0,
  }));
}

// Lista para o site: só os visíveis, com o essencial para o cartão.
function listarPublico() {
  return db.prepare('SELECT * FROM int_projetos WHERE visivel=1 ORDER BY ordem ASC, id DESC').all().map((p) => ({
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    resumo: p.resumo || undefined,
    descricao: p.descricao || undefined,
    capa: p.capa || undefined,
    prazo: p.prazo || undefined,
    aberto: !!p.aberto,
  }));
}

async function aplicarCapa(id, url) {
  if (!url) { db.prepare('UPDATE int_projetos SET capa=? WHERE id=?').run('', id); return null; }
  try {
    const caminho = await baixarCapa(url, 'projeto-' + id);
    db.prepare('UPDATE int_projetos SET capa=? WHERE id=?').run(caminho, id);
    return null;
  } catch (e) {
    db.prepare('UPDATE int_projetos SET capa=? WHERE id=?').run('', id);
    return e.message;
  }
}

async function criar(dados) {
  const p = normalizar(dados);
  const agora = new Date().toISOString();
  const r = db.prepare(
    `INSERT INTO int_projetos(tipo,titulo,resumo,descricao,capa_origem,prazo,aberto,visivel,ordem,criado_em,atualizado_em)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`
  ).run(p.tipo, p.titulo, p.resumo, p.descricao, p.capa_origem, p.prazo, p.aberto, p.visivel, p.ordem, agora, agora);
  const avisoCapa = await aplicarCapa(r.lastInsertRowid, p.capa_origem);
  return { projeto: obter(r.lastInsertRowid), avisoCapa };
}

async function editar(id, dados) {
  const atual = obter(id);
  if (!atual) throw erro('Projeto não encontrado.', 404);
  const p = normalizar(dados);
  const agora = new Date().toISOString();
  db.prepare(
    `UPDATE int_projetos SET tipo=?, titulo=?, resumo=?, descricao=?, capa_origem=?, prazo=?, aberto=?, visivel=?, ordem=?, atualizado_em=? WHERE id=?`
  ).run(p.tipo, p.titulo, p.resumo, p.descricao, p.capa_origem, p.prazo, p.aberto, p.visivel, p.ordem, agora, id);
  const avisoCapa = p.capa_origem !== atual.capa_origem ? await aplicarCapa(id, p.capa_origem) : null;
  return { projeto: obter(id), avisoCapa };
}

function apagar(id) {
  // As inscrições vão atrás, pela chave estrangeira (ON DELETE CASCADE).
  return db.prepare('DELETE FROM int_projetos WHERE id=?').run(id).changes;
}

// ---------------------------------------------------------------- Inscrições
function listarInscricoes(projetoId) {
  return db.prepare('SELECT * FROM int_inscricoes WHERE projeto_id=? ORDER BY id DESC').all(projetoId);
}

// Guarda o interesse vindo do site. Pede-se o nome e pelo menos uma forma de
// contacto, para o estúdio poder responder.
function registarInteresse(projetoId, d, ip) {
  const projeto = obter(projetoId);
  if (!projeto || !projeto.visivel) throw erro('Projeto não encontrado.', 404);
  if (!projeto.aberto) throw erro('Este projeto já não aceita inscrições.', 409);
  d = d || {};
  const nome = texto(d.nome, 80);
  if (!nome) throw erro('Indique o seu nome.');
  const contacto = texto(d.contacto, 40);
  const email = texto(d.email, 120);
  if (!contacto && !email) throw erro('Deixe um contacto: telefone/WhatsApp ou email.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro('O email não parece válido.');
  const agora = new Date().toISOString();
  const r = db.prepare(
    `INSERT INTO int_inscricoes(projeto_id,nome,contacto,email,link,mensagem,estado,criado_em,ip)
     VALUES(?,?,?,?,?,?, 'novo', ?, ?)`
  ).run(projetoId, nome, contacto, email, eUrl(d.link) ? d.link : '', texto(d.mensagem, 1000), agora, String(ip || '').slice(0, 45));
  return db.prepare('SELECT * FROM int_inscricoes WHERE id=?').get(r.lastInsertRowid);
}

function mudarEstadoInscricao(id, estado) {
  if (!ESTADOS.includes(estado)) throw erro('Estado inválido.');
  const r = db.prepare('UPDATE int_inscricoes SET estado=? WHERE id=?').run(estado, id);
  if (!r.changes) throw erro('Inscrição não encontrada.', 404);
  return db.prepare('SELECT * FROM int_inscricoes WHERE id=?').get(id);
}

function apagarInscricao(id) {
  return db.prepare('DELETE FROM int_inscricoes WHERE id=?').run(id).changes;
}

module.exports = {
  TIPOS, ESTADOS,
  obter, listarAdmin, listarPublico, criar, editar, apagar,
  listarInscricoes, registarInteresse, mudarEstadoInscricao, apagarInscricao,
};
