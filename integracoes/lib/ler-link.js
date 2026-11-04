'use strict';
// ---------------------------------------------------------------------------
// Ler um link de música (Spotify, YouTube, Apple Music, SoundCloud, Deezer…)
// e tirar de lá o título, o artista, a data de lançamento e a capa, para o
// painel criar a novidade só com o link (ver rotas/musica.js).
//
//   Spotify  → oEmbed (título) + etiquetas da página (capa 640 px, artista,
//              data de lançamento).
//   YouTube  → oEmbed (título, canal, imagem) + a data de publicação da página.
//   Outros   → as etiquetas Open Graph da página (og:title, og:image...).
//
// Só se segue http(s) para fora: nunca para a própria máquina ou a rede local.
// ---------------------------------------------------------------------------
const { pedir, pedirJson } = require('./http');

// Curto de propósito: com a identificação completa de um browser, o Spotify
// manda a página da aplicação, sem as etiquetas de pré-visualização.
const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const MAX_HTML = 2 * 1024 * 1024;

const { HttpError } = require('../../backend/lib/util');

// 400 com a mensagem à vista no painel.
class ErroLink extends HttpError {
  constructor(m) { super(400, m); }
}

function validar(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (_) { throw new ErroLink('O link não é válido.'); }
  if (!/^https?:$/.test(u.protocol)) throw new ErroLink('O link tem de começar por http:// ou https://.');
  const host = u.hostname.toLowerCase();
  // Nos testes, as páginas "de fora" são um servidor falso nesta máquina.
  if (process.env.NODE_ENV === 'test') return u;
  if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host.includes(':')) {
    throw new ErroLink('Esse link não aponta para uma página pública.');
  }
  return u;
}

const des = (s) => String(s || '')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ').trim();

// <meta property|name="chave" content="..."> (a ordem dos atributos varia).
function metas(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const k = (/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const v = (/content\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1];
    if (k && v !== undefined && !(k.toLowerCase() in out)) out[k.toLowerCase()] = des(v);
  }
  return out;
}

async function pagina(url) {
  const res = await pedir(url, { headers: { 'User-Agent': AGENTE, 'Accept-Language': 'pt,en;q=0.8', Accept: 'text/html' }, prazoMs: 12000 });
  if (!res.ok) throw new ErroLink(`A página respondeu com erro ${res.status}.`);
  const texto = await res.text();
  return texto.slice(0, MAX_HTML);
}

const soData = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };

// "Rick Astley - Never Gonna Give You Up (Official Video)" → "Never Gonna Give You Up"
function limparTituloVideo(titulo, canal) {
  let t = titulo;
  if (canal) {
    const re = new RegExp('^' + canal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—:|]\\s*', 'i');
    t = t.replace(re, '');
  }
  return t.replace(/\s*[([]\s*(official|oficial|videoclipe|clipe|lyric|lyrics|letra|audio|áudio|visualizer|music video|video|vídeo|4k|hd)[^)\]]*[)\]]\s*/gi, ' ')
    .replace(/\s+/g, ' ').trim() || titulo;
}

async function spotify(u) {
  const [oe, html] = await Promise.all([
    pedirJson('https://open.spotify.com/oembed?url=' + encodeURIComponent(u.href), { prazoMs: 10000 }).catch(() => null),
    pagina(u.href).catch(() => ''),
  ]);
  const m = metas(html);
  // og:description: "Brou As · single · 2023 · 1 songs" ou "Artista · Álbum · Song · 2023".
  const artista = (m['og:description'] || '').split(' · ')[0] || '';
  const titulo = (oe && oe.title) || (m['og:title'] || '').replace(/^Listen to\s+/i, '').replace(/\s*\|\s*Spotify$/i, '').replace(/\s+-\s+(single|album|ep|song).*$/i, '');
  return {
    plataforma: 'Spotify', titulo, artista,
    data: soData(m['music:release_date']),
    capa: m['og:image'] || (oe && oe.thumbnail_url) || '',
    formato: '',
  };
}

async function youtube(u) {
  const oe = await pedirJson('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u.href), { prazoMs: 10000 });
  const id = (/[?&]v=([\w-]{11})/.exec(u.href) || /youtu\.be\/([\w-]{11})/.exec(u.href) || /\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.href) || [])[1];
  let data = '';
  try { const m = metas(await pagina(u.href)); data = soData(m.datepublished || m.uploaddate); } catch (_) { /* fica sem data */ }
  // A imagem grande (1280×720) nem sempre existe; quem guarda tenta-a primeiro.
  const capas = id ? [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, oe.thumbnail_url] : [oe.thumbnail_url];
  return {
    plataforma: 'YouTube', titulo: limparTituloVideo(des(oe.title), des(oe.author_name)),
    artista: des(oe.author_name).replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim(),
    data, capa: capas[0], capas, formato: 'video',
  };
}

async function generico(u) {
  const m = metas(await pagina(u.href));
  const titulo = m['og:title'] || m['twitter:title'] || '';
  if (!titulo && !m['og:image']) throw new ErroLink('Não foi possível ler essa página. Escreva os dados à mão.');
  return {
    plataforma: m['og:site_name'] || u.hostname.replace(/^www\./, ''),
    titulo: titulo.replace(/\s*[|–-]\s*(Apple Music|SoundCloud|Deezer|Boomplay|Audiomack|TIDAL).*$/i, ''),
    artista: m['music:musician_description'] || m['twitter:audio:artist_name'] || '',
    data: soData(m['music:release_date'] || m['og:release_date'] || m.datepublished),
    capa: m['og:image'] || m['twitter:image'] || '',
    formato: /video/i.test(m['og:type'] || '') ? 'video' : '',
  };
}

async function lerLink(url) {
  const u = validar(url);
  const host = u.hostname.toLowerCase();
  let r;
  try {
    if (host.endsWith('spotify.com')) r = await spotify(u);
    else if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host)) r = await youtube(u);
    else r = await generico(u);
  } catch (e) {
    if (e instanceof ErroLink) throw e;
    throw new ErroLink('Não foi possível ler esse link (' + e.message + '). Confirme o endereço, ou escreva os dados à mão.');
  }
  return { ...r, link: u.href, titulo: (r.titulo || '').slice(0, 160), artista: (r.artista || '').slice(0, 200) };
}

module.exports = { lerLink, metas, limparTituloVideo };
