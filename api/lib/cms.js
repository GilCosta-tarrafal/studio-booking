'use strict';
// ---------------------------------------------------------------------------
// CMS do site: o que o painel deixa mudar no site sem mexer no código.
//
//   textos   os textos fixos das páginas (título do topo, "Como funciona",
//            rodapé...). São chaves do dicionário (comum/assets/js/dicionario.js)
//            com outro valor por língua. Um valor em falta deixa ficar o do
//            dicionário — o texto de origem do site.
//   imagens  as três fotografias do topo e a da faixa a meio da página.
//   secoes   que secções da página inicial aparecem.
//   extras   secções novas, criadas no painel: título, texto, imagem e botão
//            (nas três línguas), e o sítio da página onde entram.
//
// Fica tudo numa linha da tabela settings (chave "cms"), em JSON. O site lê-o
// em três sítios: /api/public/pagina (o servidor escreve a página já com os
// textos certos), /api/public/cms.js (o navegador, para trocar de língua sem
// recarregar) e /api/public/cms.css (as fotografias do topo).
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const { db } = require('./db');
const D = require('../comum/assets/js/dicionario.js');
const { HttpError } = require('./util');

// As chaves que o painel mostra, por grupo e pela ordem da página. `longo`
// pede uma caixa de várias linhas.
const GRUPOS = [
  { key: 'topo', titulo: 'Topo da página inicial', desc: 'O título grande, a frase por baixo e o convite para marcar.', campos: [
    { chave: 'inicio.h1', rotulo: 'Título principal' },
    { chave: 'inicio.lead', rotulo: 'Texto por baixo do título', longo: true, dica: 'Aparece logo a seguir à frase de apresentação (essa muda-se em Definições do negócio).' },
    { chave: 'inicio.marcarInfo', rotulo: 'Convite ao lado do botão', longo: true },
    { chave: 'nav.marcar', rotulo: 'Botão "Marcar sessão"', dica: 'O mesmo texto aparece no rodapé.' },
  ] },
  { key: 'secoes-txt', titulo: 'Títulos das secções', desc: 'Os títulos e subtítulos das secções da página inicial.', campos: [
    { chave: 'singles.titulo', rotulo: 'Músicas: título' },
    { chave: 'singles.sub', rotulo: 'Músicas: subtítulo', longo: true },
    { chave: 'projetos.titulo', rotulo: 'Projetos: título' },
    { chave: 'projetos.sub', rotulo: 'Projetos: subtítulo', longo: true },
    { chave: 'servicos.titulo', rotulo: 'Serviços: título' },
  ] },
  { key: 'como', titulo: 'Como funciona', desc: 'Os três passos no fim da página inicial.', campos: [
    { chave: 'como.titulo', rotulo: 'Título' },
    { chave: 'como.1.t', rotulo: 'Passo 1: título' },
    { chave: 'como.1.d', rotulo: 'Passo 1: texto', longo: true },
    { chave: 'como.2.t', rotulo: 'Passo 2: título' },
    { chave: 'como.2.d', rotulo: 'Passo 2: texto', longo: true },
    { chave: 'como.3.t', rotulo: 'Passo 3: título' },
    { chave: 'como.3.d', rotulo: 'Passo 3: texto', longo: true },
  ] },
  { key: 'menu', titulo: 'Menu do topo', desc: 'Os links do cabeçalho do site.', campos: [
    { chave: 'nav.servicos', rotulo: 'Serviços' },
    { chave: 'nav.musicas', rotulo: 'Músicas' },
    { chave: 'nav.contactos', rotulo: 'Contactos' },
    { chave: 'nav.consultar', rotulo: 'Consultar marcação' },
  ] },
  { key: 'paginas', titulo: 'Marcar e consultar', desc: 'O título e a introdução das páginas de marcação e de consulta.', campos: [
    { chave: 'marcar.titulo', rotulo: 'Marcar: título' },
    { chave: 'marcar.lead', rotulo: 'Marcar: introdução', longo: true },
    { chave: 'consultar.titulo', rotulo: 'Consultar: título' },
    { chave: 'consultar.lead', rotulo: 'Consultar: introdução', longo: true },
  ] },
  { key: 'rodape', titulo: 'Rodapé', desc: 'Os títulos das colunas e as frases do fundo da página.', campos: [
    { chave: 'rodape.links', rotulo: 'Coluna dos links' },
    { chave: 'rodape.contactos', rotulo: 'Coluna dos contactos' },
    { chave: 'rodape.horario', rotulo: 'Coluna do horário' },
    { chave: 'rodape.semContactos', rotulo: 'Sem contactos definidos', longo: true },
    { chave: 'rodape.direitos', rotulo: 'Direitos reservados' },
  ] },
  { key: 'seo', titulo: 'Motores de busca', desc: 'O que o Google e as redes sociais mostram ao partilhar o site.', campos: [
    { chave: 'inicio.titulo', rotulo: 'Título do separador', dica: 'Vem logo a seguir ao nome do negócio. Comece por ": " ou " | ".' },
    { chave: 'inicio.descricao', rotulo: 'Descrição', longo: true, dica: 'Vem a seguir à frase de apresentação.' },
  ] },
];
const CHAVES = new Set(GRUPOS.flatMap((g) => g.campos.map((c) => c.chave)));
const MAX_TEXTO = 400;

// As secções da página inicial que se podem esconder (o id no HTML).
const SECOES = [
  { key: 'novidades', rotulo: 'Novidades', desc: 'O slide de lançamentos logo a seguir ao topo.' },
  { key: 'destaques', rotulo: 'Saíram deste estúdio', desc: 'Os singles em destaque.' },
  { key: 'projetos', rotulo: 'Participa', desc: 'Os projetos abertos.' },
  { key: 'faixa', rotulo: 'Fotografia a meio', desc: 'A faixa com a fotografia entre as secções.' },
  { key: 'servicos', rotulo: 'Serviços', desc: 'A lista de serviços.' },
  { key: 'como', rotulo: 'Como funciona', desc: 'Os três passos no fim da página.' },
];
const N_SLIDES = 3;

// Secções novas: no máximo MAX_EXTRAS, cada uma depois de uma das secções da
// página ('topo' = logo a seguir ao topo, antes de todas).
const MAX_EXTRAS = 20;
const POSICOES = [{ key: 'topo', rotulo: 'Logo a seguir ao topo' }, ...SECOES.map((s) => ({ key: s.key, rotulo: 'Depois de "' + s.rotulo + '"' }))];
const CAMPOS_EXTRA = { titulo: 120, texto: 1200, botao: 40 };

// Uma imagem do próprio site (enviada pelo painel ou já na pasta img/).
// Sem aspas, parênteses nem "..": vai parar a um url("...") de CSS.
const IMG_LOCAL = /^\/(capas-integracao|img)\/[\w-]+(\/[\w-]+)*\.(jpe?g|png|webp)(\?v=\w+)?$/i;

function vazio() {
  return { textos: {}, imagens: { slides: Array(N_SLIDES).fill(''), faixa: '' }, secoes: {}, extras: [] };
}

function ler() {
  const r = db.prepare("SELECT value FROM settings WHERE key='cms'").get();
  const out = vazio();
  if (!r) return out;
  let j;
  try { j = JSON.parse(r.value); } catch (_) { return out; }
  if (j && typeof j === 'object') {
    if (j.textos && typeof j.textos === 'object') out.textos = j.textos;
    if (j.imagens && typeof j.imagens === 'object') {
      if (Array.isArray(j.imagens.slides)) out.imagens.slides = Array.from({ length: N_SLIDES }, (_, i) => String(j.imagens.slides[i] || ''));
      out.imagens.faixa = String(j.imagens.faixa || '');
    }
    if (j.secoes && typeof j.secoes === 'object') out.secoes = j.secoes;
    if (Array.isArray(j.extras)) out.extras = j.extras;
  }
  return out;
}

// Os textos que valem numa língua: { chave: valor }, só os mudados.
function textosDe(cms, lingua) {
  const out = {};
  for (const [chave, porLingua] of Object.entries(cms.textos)) {
    const v = porLingua && porLingua[lingua];
    if (CHAVES.has(chave) && typeof v === 'string' && v) out[chave] = v;
  }
  return out;
}

// As secções escondidas, para o servidor do site marcar no <body>.
const ocultas = (cms) => SECOES.filter((s) => cms.secoes[s.key] === false).map((s) => s.key);

function limparTextos(entrada) {
  const out = {};
  if (!entrada || typeof entrada !== 'object') return out;
  for (const [chave, porLingua] of Object.entries(entrada)) {
    if (!CHAVES.has(chave) || !porLingua || typeof porLingua !== 'object') continue;
    const l = {};
    for (const cod of D.codigos) {
      const v = typeof porLingua[cod] === 'string' ? porLingua[cod].replace(/\s+/g, ' ').trim() : '';
      if (!v) continue;
      if (v.length > MAX_TEXTO) throw new HttpError(400, `O texto "${chave}" tem mais de ${MAX_TEXTO} caracteres.`);
      l[cod] = v;
    }
    if (Object.keys(l).length) out[chave] = l;
  }
  return out;
}

// Uma imagem por link é copiada para o site (a política de segurança das
// páginas só deixa mostrar imagens do próprio endereço).
async function limparImagem(v, nome) {
  v = typeof v === 'string' ? v.trim() : '';
  if (!v || IMG_LOCAL.test(v)) return v;
  if (/^https?:\/\//i.test(v)) {
    const { baixarCapa } = require('../integracoes/lib/capas');
    try { return await baixarCapa(v, 'cms-' + nome); } catch (e) { throw new HttpError(400, `Imagem "${nome}": ${e.message}`); }
  }
  throw new HttpError(400, `Imagem "${nome}": use uma imagem enviada do computador ou um link http(s).`);
}

// Uma secção nova vinda do painel, já limpa. Os textos levam as três línguas;
// sem título nem texto em português não há secção.
async function limparExtra(e, i) {
  if (!e || typeof e !== 'object') throw new HttpError(400, `Secção ${i + 1}: dados inválidos.`);
  const out = {
    id: typeof e.id === 'string' && /^[a-z0-9]{6,16}$/.test(e.id) ? e.id : crypto.randomBytes(6).toString('hex'),
    depois: POSICOES.some((p) => p.key === e.depois) ? e.depois : 'como',
    visivel: e.visivel !== false,
  };
  for (const [campo, max] of Object.entries(CAMPOS_EXTRA)) {
    out[campo] = {};
    for (const cod of D.codigos) {
      const bruto = e[campo] && typeof e[campo][cod] === 'string' ? e[campo][cod] : '';
      // O texto guarda as mudanças de linha (parágrafos); o resto fica numa linha.
      const v = (campo === 'texto'
        ? bruto.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n')
        : bruto.replace(/\s+/g, ' ')).trim();
      if (v.length > max) throw new HttpError(400, `Secção ${i + 1}: o campo "${campo}" tem mais de ${max} caracteres.`);
      if (v) out[campo][cod] = v;
    }
  }
  if (!out.titulo.pt && !out.texto.pt) throw new HttpError(400, `Secção ${i + 1}: escreva pelo menos o título ou o texto em português.`);
  const link = typeof e.link === 'string' ? e.link.trim() : '';
  // Um link de fora, uma página do site (/marcar, sem // que levaria para fora) ou uma secção (#servicos).
  if (link && (!(/^https?:\/\/\S+$/i.test(link) || /^\/(?!\/)\S*$/.test(link) || /^#[\w-]+$/.test(link)) || link.length > 500)) {
    throw new HttpError(400, `Secção ${i + 1}: o link do botão tem de começar por http://, https://, / ou #.`);
  }
  out.link = link;
  out.imagem = await limparImagem(e.imagem, `secao-${out.id}`);
  return out;
}

async function guardar(b) {
  b = b || {};
  const atual = ler();
  const novo = {
    textos: b.textos === undefined ? atual.textos : limparTextos(b.textos),
    imagens: atual.imagens,
    secoes: atual.secoes,
    extras: atual.extras,
  };
  if (Array.isArray(b.extras)) {
    if (b.extras.length > MAX_EXTRAS) throw new HttpError(400, `No máximo ${MAX_EXTRAS} secções novas.`);
    novo.extras = await Promise.all(b.extras.map(limparExtra));
  }
  if (b.imagens && typeof b.imagens === 'object') {
    const slides = Array.isArray(b.imagens.slides) ? b.imagens.slides : atual.imagens.slides;
    novo.imagens = {
      slides: await Promise.all(Array.from({ length: N_SLIDES }, (_, i) => limparImagem(slides[i], `slide-${i + 1}`))),
      faixa: await limparImagem(b.imagens.faixa === undefined ? atual.imagens.faixa : b.imagens.faixa, 'faixa'),
    };
  }
  if (b.secoes && typeof b.secoes === 'object') {
    novo.secoes = Object.fromEntries(SECOES.map((s) => [s.key, b.secoes[s.key] !== false]));
  }
  db.prepare("INSERT INTO settings(key,value) VALUES('cms',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(novo));
  return novo;
}

// Para o painel: os grupos com o texto de origem de cada campo em cada língua.
function catalogo() {
  return {
    linguas: D.LINGUAS.map((l) => ({ cod: l.cod, nome: l.nome })),
    grupos: GRUPOS.map((g) => ({
      ...g,
      campos: g.campos.map((c) => ({ ...c, origem: Object.fromEntries(D.codigos.map((cod) => [cod, D.t(cod, c.chave)])) })),
    })),
    secoes: SECOES,
    posicoes: POSICOES,
    max_extras: MAX_EXTRAS,
    campos_extra: CAMPOS_EXTRA,
    n_slides: N_SLIDES,
    // As fotografias que o site mostra quando o CMS não tem nenhuma (site.css
    // e site/views/index.html), para o painel as pré-visualizar.
    imagens_origem: { slides: Array.from({ length: N_SLIDES }, (_, i) => `/img/slides/slide-${i + 1}.jpg`), faixa: '/img/many.jpg' },
    max_texto: MAX_TEXTO,
  };
}

// O script que o site carrega logo a seguir ao dicionário: põe lá os textos
// mudados, para o que é desenhado em JavaScript (e a troca de língua) os usar.
function script(cms) {
  const porLingua = Object.fromEntries(D.codigos.map((cod) => [cod, textosDe(cms, cod)]));
  // E as secções novas que estão ligadas, para site/assets/js/secoes-cms.js as desenhar.
  const extras = cms.extras.filter((e) => e.visivel).map(({ visivel: _v, ...e }) => e);
  return `'use strict';\n// Gerado a partir do painel (CMS do site).\n(function (T) {\n  if (!window.DICIONARIO) return;\n  for (const cod in T) Object.assign(window.DICIONARIO.TEXTOS[cod], T[cod]);\n})(${JSON.stringify(porLingua)});\n`
    + `window.CMS_SECOES = ${JSON.stringify(extras).replace(/</g, '\\u003c')};\n`;
}

// As fotografias do topo, por cima das que vêm em site.css.
function css(cms) {
  return cms.imagens.slides
    .map((src, i) => (src && IMG_LOCAL.test(src) ? `.hero-slide:nth-child(${i + 1}) { background-image: url("${src}"); }` : ''))
    .filter(Boolean).join('\n') + '\n';
}

module.exports = { ler, guardar, catalogo, textosDe, ocultas, script, css, IMG_LOCAL };
