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
const U = require('../../lib/util');
const CAT = require('../../lib/catalogos');
const { HttpError } = U;

const TIPOS = ['talentos', 'album', 'gravacao', 'publicidade', 'vendas', 'outro'];
const MAX_DIAS_GRAVACAO = 366;
const ESTADOS = ['novo', 'contactado', 'aceite', 'arquivado'];

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : '');
const eUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 1000;
const erro = (m, s = 400) => new HttpError(s, m);
const MAX_IMAGENS = 10;
// A loja (encomendas e stock) carrega-se à primeira vez, para a tabela das
// encomendas existir já com a dos projetos criada.
const loja = () => require('./loja');
const lerLista = (json) => { try { const v = JSON.parse(json || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };

// As imagens do projeto (links ou imagens enviadas do computador), pela ordem
// em que aparecem no slide do site. Aceita a lista nova (capas_origem) ou, de
// quem ainda mande só uma, capa_origem. Sem repetidas, no máximo MAX_IMAGENS.
function origens(d) {
  const lista = Array.isArray(d.capas_origem) ? d.capas_origem : (d.capa_origem ? [d.capa_origem] : []);
  return [...new Set(lista.filter(eOrigemCapa))].slice(0, MAX_IMAGENS);
}

// ---------------------------------------------------------------- Projetos
function normalizar(d) {
  d = d || {};
  const titulo = texto(d.titulo, 140);
  if (!titulo) throw erro('Indique o título do projeto.');
  const prazo = texto(d.prazo, 10);
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) throw erro('O prazo tem de ser no formato AAAA-MM-DD.');
  // Um tipo do sistema (talentos, vendas…) ou um criado em Configurações ›
  // Tipos de projeto (Participa): esse funciona como "outro" e guarda-se o
  // código em categoria.
  let tipo = 'outro';
  let categoria = '';
  if (TIPOS.includes(d.tipo)) tipo = d.tipo;
  else if (d.tipo && CAT.codigoValido('tipos_participa', d.tipo)) categoria = String(d.tipo).slice(0, 40);
  const ordem = Number.isFinite(Number(d.ordem)) ? Math.round(Number(d.ordem)) : 0;
  if (tipo === 'gravacao') return { ...normalizarGravacao(d), titulo, ordem, preco: null, stock: null, categoria: '' };
  // Vendas: o preço de cada unidade e a quantidade à venda são obrigatórios.
  let preco = null;
  let stock = null;
  if (tipo === 'vendas') {
    preco = Number(d.preco);
    stock = Number(d.stock);
    if (d.preco === '' || d.preco == null || !Number.isInteger(preco) || preco <= 0) throw erro('Indique o preço do artigo (um número inteiro maior que zero).');
    if (d.stock === '' || d.stock == null || !Number.isInteger(stock) || stock < 0 || stock > 1e6) throw erro('Indique a quantidade à venda (um número inteiro, 0 ou mais).');
  }
  return {
    preco, stock, categoria,
    tipo,
    artista: '', room_id: null, data_inicio: '', data_fim: '', hora_inicio: null, hora_fim: null,
    titulo,
    resumo: texto(d.resumo, 200),
    descricao: texto(d.descricao, 2000),
    prazo,
    ...comImagens(d),
    // Uma publicidade é só um anúncio, e um artigo compra-se: sem inscrições.
    aberto: tipo === 'publicidade' || tipo === 'vendas' ? 0 : d.aberto === undefined ? 1 : (d.aberto ? 1 : 0),
    visivel: d.visivel === undefined ? 1 : (d.visivel ? 1 : 0),
    ordem: Number.isFinite(Number(d.ordem)) ? Math.round(Number(d.ordem)) : 0,
  };
}

// capa_origem fica com a primeira imagem (é a "capa" de sempre); capas_origem
// guarda a lista toda, em JSON.
function comImagens(d) {
  const lista = origens(d);
  return { capa_origem: lista[0] || '', capas_origem: JSON.stringify(lista) };
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
    ...comImagens(d),
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
    ...(p.tipo === 'vendas' ? { vendidas: loja().vendidas(p.id), disponivel: loja().disponivel(p) } : {}),
  }));
}

// Lista para o site: só os visíveis, com o essencial para o cartão.
// Um artigo esgotado (stock 0) sai do site.
function listarPublico() {
  loja().expirar();
  return db.prepare("SELECT * FROM int_projetos WHERE visivel=1 AND tipo!='gravacao' AND NOT (tipo='vendas' AND COALESCE(stock,0)<=0) ORDER BY ordem ASC, id DESC").all().map((p) => ({
    id: p.id,
    tipo: p.tipo,
    titulo: p.titulo,
    resumo: p.resumo || undefined,
    descricao: p.descricao || undefined,
    capa: p.capa || undefined,
    // Todas as imagens (com mais de uma, o cartão do site faz um slide).
    capas: imagensServidas(p),
    // Tipo criado em Configurações: o site mostra o nome dele.
    ...(p.categoria ? { categoria: p.categoria, tipo_nome: nomeCategoria(p.categoria) } : {}),
    // Vendas: o preço e quantas unidades se podem comprar agora.
    ...(p.tipo === 'vendas' ? { preco: p.preco, disponivel: loja().disponivel(p) } : {}),
    prazo: p.prazo || undefined,
    aberto: !!p.aberto,
  }));
}

const nomeCategoria = (codigo) => {
  const it = db.prepare("SELECT nome FROM catalogo_itens WHERE catalogo='tipos_participa' AND codigo=?").get(codigo);
  return it ? it.nome : '';
};

// As imagens já copiadas para o site. Projetos antigos (de antes de haver
// várias) só têm a capa.
function imagensServidas(p) {
  const lista = lerLista(p.capas);
  return lista.length ? lista : (p.capa ? [p.capa] : []);
}

// Copia cada imagem para o disco do site (as enviadas do computador já lá
// estão). Uma que falhe fica de fora e não impede as outras nem a gravação;
// devolve o aviso, ou null se correram todas bem.
async function aplicarCapas(id, lista) {
  const servidas = [];
  const falhas = [];
  for (let i = 0; i < lista.length; i++) {
    try {
      servidas.push(await baixarCapa(lista[i], i === 0 ? 'projeto-' + id : `projeto-${id}-${i}`));
    } catch (e) { falhas.push(`imagem ${i + 1}: ${e.message}`); }
  }
  db.prepare('UPDATE int_projetos SET capa=?, capas=? WHERE id=?').run(servidas[0] || '', JSON.stringify(servidas), id);
  return falhas.length ? falhas.join(' · ') : null;
}

async function criar(dados) {
  const p = normalizar(dados);
  const agora = new Date().toISOString();
  const id = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO int_projetos(tipo,titulo,resumo,descricao,capa_origem,capas_origem,prazo,aberto,visivel,ordem,
                                artista,room_id,data_inicio,data_fim,hora_inicio,hora_fim,preco,stock,categoria,criado_em,atualizado_em)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(p.tipo, p.titulo, p.resumo, p.descricao, p.capa_origem, p.capas_origem, p.prazo, p.aberto, p.visivel, p.ordem,
      p.artista, p.room_id, p.data_inicio, p.data_fim, p.hora_inicio, p.hora_fim, p.preco, p.stock, p.categoria, agora, agora);
    refazerBloqueios(r.lastInsertRowid, p);
    return r.lastInsertRowid;
  })();
  const avisoCapa = await aplicarCapas(id, lerLista(p.capas_origem));
  return { projeto: obter(id), avisoCapa };
}

async function editar(id, dados) {
  const atual = obter(id);
  if (!atual) throw erro('Projeto não encontrado.', 404);
  const p = normalizar(dados);
  const agora = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE int_projetos SET tipo=?, titulo=?, resumo=?, descricao=?, capa_origem=?, capas_origem=?, prazo=?, aberto=?, visivel=?, ordem=?,
              artista=?, room_id=?, data_inicio=?, data_fim=?, hora_inicio=?, hora_fim=?, preco=?, stock=?, categoria=?, atualizado_em=? WHERE id=?`
    ).run(p.tipo, p.titulo, p.resumo, p.descricao, p.capa_origem, p.capas_origem, p.prazo, p.aberto, p.visivel, p.ordem,
      p.artista, p.room_id, p.data_inicio, p.data_fim, p.hora_inicio, p.hora_fim, p.preco, p.stock, p.categoria, agora, id);
    refazerBloqueios(id, p);
  })();
  // Só se voltam a copiar as imagens se a lista mudou. (Um projeto antigo só
  // tem capa_origem: conta como uma lista dessa imagem.)
  const antes = lerLista(atual.capas_origem).length ? atual.capas_origem : JSON.stringify(atual.capa_origem ? [atual.capa_origem] : []);
  const avisoCapa = p.capas_origem !== antes ? await aplicarCapas(id, lerLista(p.capas_origem)) : null;
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
  if (projeto.tipo === 'publicidade') throw erro('Esta publicidade não recebe inscrições.', 409);
  if (projeto.tipo === 'vendas') throw erro('Este artigo compra-se; não recebe inscrições.', 409);
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
