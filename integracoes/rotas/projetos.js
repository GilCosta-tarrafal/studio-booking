'use strict';
// ---------------------------------------------------------------------------
// Projetos colaborativos e convocatórias.
//
// O estúdio cria um projeto no painel (uma campanha para novos talentos sem
// condições para gravar num estúdio profissional, um álbum coletivo com vários
// artistas, ou outra divulgação qualquer). Enquanto "aberto", o projeto aparece
// no site e quem quiser participar deixa o seu contacto (int_inscricoes), que
// volta ao painel para o produtor ver e dar seguimento.
//
// A "gravação prolongada" é diferente: um artista fica com uma sala durante um
// período (ex.: três semanas, das 10:00 às 18:00). Não aparece no site; em vez
// disso, o projeto cria um bloqueio por dia nessa sala e horário, e o estúdio
// deixa de aceitar marcações aí. Se já houver uma marcação ativa que coincida,
// o projeto não se guarda e o erro diz quais são, para as resolver primeiro.
// ---------------------------------------------------------------------------
const { db } = require('../lib/base');
const { baixarCapa, eOrigemCapa } = require('../lib/capas');
const U = require('../../backend/lib/util');
const { HttpError } = U;

const TIPOS = ['talentos', 'album', 'gravacao', 'outro'];
const MAX_DIAS_GRAVACAO = 366;
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
  const tipo = TIPOS.includes(d.tipo) ? d.tipo : 'outro';
  const ordem = Number.isFinite(Number(d.ordem)) ? Math.round(Number(d.ordem)) : 0;
  if (tipo === 'gravacao') return { ...normalizarGravacao(d), titulo, ordem };
  return {
    tipo,
    artista: '', room_id: null, data_inicio: '', data_fim: '', hora_inicio: null, hora_fim: null,
    titulo,
    resumo: texto(d.resumo, 200),
    descricao: texto(d.descricao, 2000),
    prazo,
    capa_origem: eOrigemCapa(d.capa_origem) ? d.capa_origem : '',
    aberto: d.aberto === undefined ? 1 : (d.aberto ? 1 : 0),
    visivel: d.visivel === undefined ? 1 : (d.visivel ? 1 : 0),
    ordem: Number.isFinite(Number(d.ordem)) ? Math.round(Number(d.ordem)) : 0,
  };
}

// Gravação prolongada: artista, sala, período e horário de cada dia.
function normalizarGravacao(d) {
  const artista = texto(d.artista, 120);
  if (!artista) throw erro('Indique o artista da gravação.');
  const room = db.prepare('SELECT id FROM rooms WHERE id=?').get(U.toInt(d.room_id));
  if (!room) throw erro('Escolha a sala da gravação.');
  const ini = texto(d.data_inicio, 10);
  const fim = texto(d.data_fim, 10);
  if (!U.isValidDate(ini) || !U.isValidDate(fim)) throw erro('Indique o primeiro e o último dia da gravação.');
  if (fim < ini) throw erro('O último dia não pode ser antes do primeiro.');
  if (U.daysBetween(ini, fim) + 1 > MAX_DIAS_GRAVACAO) throw erro(`Uma gravação prolongada pode durar no máximo ${MAX_DIAS_GRAVACAO} dias.`);
  let hIni = 0;
  let hFim = 1440;
  if (!d.dia_inteiro) {
    hIni = U.parseHM(String(d.hora_inicio || ''));
    hFim = U.parseHM(String(d.hora_fim || ''));
    if (hIni == null || hFim == null || hFim <= hIni) throw erro('Indique o horário da gravação (a hora de fim tem de ser depois da de início).');
  }
  return {
    tipo: 'gravacao', artista, room_id: room.id, data_inicio: ini, data_fim: fim, hora_inicio: hIni, hora_fim: hFim,
    resumo: texto(d.resumo, 200), descricao: texto(d.descricao, 2000), prazo: '',
    capa_origem: eOrigemCapa(d.capa_origem) ? d.capa_origem : '',
    aberto: 0, visivel: 0, // é um compromisso interno: não vai para o site
  };
}

// Apaga os bloqueios do projeto e, se for uma gravação prolongada, volta a
// criá-los (um por dia). Corre dentro da transação de quem guarda o projeto:
// se houver conflito, nada fica guardado.
function refazerBloqueios(id, p) {
  db.prepare('DELETE FROM blocks WHERE projeto_id=?').run(id);
  if (p.tipo !== 'gravacao') return 0;
  const conflitos = db.prepare(
    `SELECT b.code, b.client_name, b.date, b.start_min, b.end_min FROM bookings b
      WHERE b.room_id=? AND b.date>=? AND b.date<=? AND b.status NOT IN ('cancelado','expirado')
        AND b.start_min<? AND b.end_min>? ORDER BY b.date, b.start_min`
  ).all(p.room_id, p.data_inicio, p.data_fim, p.hora_fim, p.hora_inicio);
  if (conflitos.length) {
    const dia = (iso) => iso.split('-').reverse().join('/');
    const n = conflitos.length;
    const lista = conflitos.slice(0, 5)
      .map((c) => `${c.code} (${c.client_name}, ${dia(c.date)} ${U.fmtHM(c.start_min)}–${U.fmtHM(c.end_min)})`).join('; ');
    const mais = n > 5 ? ` e mais ${n - 5}` : '';
    const quantas = n === 1 ? 'já existe 1 marcação' : `já existem ${n} marcações`;
    const essas = n === 1 ? 'essa marcação' : 'essas marcações';
    throw erro(`Conflito de horário: ${quantas} nessa sala durante a gravação — ${lista}${mais}. Mude ou cancele ${essas} primeiro.`, 409);
  }
  const ins = db.prepare('INSERT INTO blocks(room_id,date,start_min,end_min,reason,projeto_id) VALUES(?,?,?,?,?,?)');
  const motivo = ('Gravação prolongada: ' + p.artista).slice(0, 120);
  let n = 0;
  for (let d = p.data_inicio; d <= p.data_fim; d = U.addDays(d, 1)) { ins.run(p.room_id, d, p.hora_inicio, p.hora_fim, motivo, id); n++; }
  return n;
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
  return db.prepare("SELECT * FROM int_projetos WHERE visivel=1 AND tipo!='gravacao' ORDER BY ordem ASC, id DESC").all().map((p) => ({
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
  const id = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO int_projetos(tipo,titulo,resumo,descricao,capa_origem,prazo,aberto,visivel,ordem,
                                artista,room_id,data_inicio,data_fim,hora_inicio,hora_fim,criado_em,atualizado_em)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(p.tipo, p.titulo, p.resumo, p.descricao, p.capa_origem, p.prazo, p.aberto, p.visivel, p.ordem,
      p.artista, p.room_id, p.data_inicio, p.data_fim, p.hora_inicio, p.hora_fim, agora, agora);
    refazerBloqueios(r.lastInsertRowid, p);
    return r.lastInsertRowid;
  })();
  const avisoCapa = await aplicarCapa(id, p.capa_origem);
  return { projeto: obter(id), avisoCapa };
}

async function editar(id, dados) {
  const atual = obter(id);
  if (!atual) throw erro('Projeto não encontrado.', 404);
  const p = normalizar(dados);
  const agora = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE int_projetos SET tipo=?, titulo=?, resumo=?, descricao=?, capa_origem=?, prazo=?, aberto=?, visivel=?, ordem=?,
              artista=?, room_id=?, data_inicio=?, data_fim=?, hora_inicio=?, hora_fim=?, atualizado_em=? WHERE id=?`
    ).run(p.tipo, p.titulo, p.resumo, p.descricao, p.capa_origem, p.prazo, p.aberto, p.visivel, p.ordem,
      p.artista, p.room_id, p.data_inicio, p.data_fim, p.hora_inicio, p.hora_fim, agora, id);
    refazerBloqueios(id, p);
  })();
  const avisoCapa = p.capa_origem !== atual.capa_origem ? await aplicarCapa(id, p.capa_origem) : null;
  return { projeto: obter(id), avisoCapa };
}

function apagar(id) {
  // As inscrições vão atrás, pela chave estrangeira (ON DELETE CASCADE); os
  // bloqueios de uma gravação prolongada saem aqui, e a sala fica livre.
  return db.transaction(() => {
    db.prepare('DELETE FROM blocks WHERE projeto_id=?').run(id);
    return db.prepare('DELETE FROM int_projetos WHERE id=?').run(id).changes;
  })();
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
