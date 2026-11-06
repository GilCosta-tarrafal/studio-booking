'use strict';
// ---------------------------------------------------------------------------
// Peças comuns aos servidores do site e do painel. Nenhum dos dois tem base de
// dados: montam as páginas com o que a API lhes diz (nome do negócio, frase,
// taxas do dia) e reencaminham /api para ela. Assim, para o navegador, a API
// está no mesmo endereço da página — os cookies de sessão, a proteção CSRF e a
// política de segurança continuam a funcionar sem CORS.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const D = require('../assets/js/dicionario.js');
const prefs = require('./prefs');

const esc = prefs.esc;

// Onde está a API. No computador, a 3007 desta máquina.
const apiUrl = () => (process.env.API_URL || 'http://127.0.0.1:3007').replace(/\/$/, '');

function seguranca(_req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      // Stripe: as caixas do cartão da página /pagar vêm de js.stripe.com.
      "script-src 'self' https://js.stripe.com",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      // Mensagens de voz do chat: tocam a partir de uma cópia local (blob:).
      "media-src 'self' blob:",
      "connect-src 'self' https://api.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
}

// ---------------------------------------------------------------- Reencaminhar
// Passa o pedido tal como veio (corpo em bruto, cookies, cabeçalhos) e devolve
// a resposta tal como vem — também as que ficam abertas, como o chat (SSE).
// O Host passa a ser o da API (os alojamentos encaminham por ele); o original
// segue em X-Forwarded-Host, e o IP de quem visita em X-Forwarded-For, para os
// limites de pedidos da API contarem cada pessoa e não este servidor.
function reencaminhar(destino = apiUrl()) {
  const alvo = new URL(destino);
  const mod = alvo.protocol === 'https:' ? https : http;
  const prefixo = alvo.pathname.replace(/\/$/, '');
  return (req, res) => {
    const headers = { ...req.headers };
    delete headers.connection;
    const ip = req.socket.remoteAddress || '';
    headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${ip}` : ip;
    headers['x-forwarded-proto'] = headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
    headers['x-forwarded-host'] = headers['x-forwarded-host'] || headers.host;
    headers.host = alvo.host;
    const pedido = mod.request({
      protocol: alvo.protocol, hostname: alvo.hostname, port: alvo.port,
      method: req.method, path: prefixo + req.originalUrl, headers,
    }, (resposta) => {
      const h = { ...resposta.headers };
      delete h.connection;
      delete h['keep-alive'];
      res.writeHead(resposta.statusCode, h);
      resposta.pipe(res);
    });
    pedido.on('error', (err) => {
      if (res.headersSent) return res.destroy();
      console.error(`[api] ${req.method} ${req.originalUrl}: ${err.message}`);
      res.status(502).json({ error: 'O serviço não está a responder. Tente daqui a pouco.' });
    });
    // Quem fechou a página já não precisa da resposta (importante no chat).
    res.on('close', () => { if (!res.writableFinished) pedido.destroy(); });
    req.pipe(pedido);
  };
}

// ---------------------------------------------------------------- Páginas
// Traduz a página antes de a enviar, para o texto já chegar certo ao navegador
// (sem trocar à frente dos olhos) e para os motores de busca verem cada língua.
// Três marcas, todas opcionais:
//   data-i18n="chave"                 -> troca o texto do elemento
//   data-i18n-attr="attr:chave ..."   -> troca atributos (placeholder, aria-label)
//   {{t:chave}}                       -> troca o texto onde estiver
// O texto português fica escrito no ficheiro: serve de original e deixa o
// modelo legível a quem lhe mexer.
const TEXTO_SIMPLES = 'a|b|button|div|h1|h2|h3|h4|label|legend|li|option|output|p|small|span|strong|title';
const RE_TEXTO = new RegExp(String.raw`<(${TEXTO_SIMPLES})\b([^>]*\bdata-i18n="([^"]+)"[^>]*)>([^<]*)</\1>`, 'gi');
const RE_ATTR = /<[a-z][a-z0-9]*\b[^>]*\bdata-i18n-attr="([^"]+)"[^>]*>/gi;
const RE_INLINE = /\{\{t:([\w.-]+)\}\}/g;

function traduzir(html, lingua) {
  const t = (chave) => esc(D.t(lingua, chave));
  // Em português não há nada a trocar: o texto escrito no ficheiro já é o
  // original. Além de poupar o trabalho, torna a página portuguesa imune a um
  // dicionário desencontrado — que o Node guarda em memória desde o arranque.
  if (lingua === 'pt') return html.replace(RE_INLINE, (_m, chave) => t(chave));

  return html
    .replace(RE_ATTR, (tag, spec) => {
      let saida = tag;
      for (const par of spec.trim().split(/\s+/)) {
        const i = par.indexOf(':');
        if (i <= 0) continue;
        const attr = par.slice(0, i);
        // Sem tradução, fica o que o ficheiro já trazia: mais vale o original
        // do que o nome da chave à vista de quem visita.
        const valor = D.talvez(lingua, par.slice(i + 1));
        if (valor === null) continue;
        const re = new RegExp(String.raw`\s${attr}="[^"]*"`);
        saida = re.test(saida)
          ? saida.replace(re, ' ' + attr + '="' + esc(valor) + '"')
          : saida.replace(/^(<[a-z0-9]+)/i, '$1 ' + attr + '="' + esc(valor) + '"');
      }
      return saida;
    })
    .replace(RE_TEXTO, (m, tag, attrs, chave) => {
      const valor = D.talvez(lingua, chave);
      return valor === null ? m : `<${tag}${attrs}>${esc(valor)}</${tag}>`;
    })
    .replace(RE_INLINE, (_m, chave) => t(chave));
}

// O que a página precisa de saber do estúdio (ver /api/public/pagina). Leva o
// cookie de quem visita, para a frase vir já na língua escolhida.
async function dadosDaPagina(req) {
  const res = await fetch(apiUrl() + '/api/public/pagina', { headers: { Cookie: req.headers.cookie || '' } });
  if (!res.ok) throw new Error(`a API respondeu ${res.status} a /api/public/pagina`);
  return res.json();
}

function pagina(pasta, file, { traduzida = true } = {}) {
  return async (req, res, next) => {
    try {
      const s = await dadosDaPagina(req);
      // O painel é interno e fica sempre em português e em escuro.
      const lingua = traduzida ? req.lingua : 'pt';
      const tema = traduzida ? prefs.lerTema(req) : 'escuro';
      let html = fs.readFileSync(path.join(pasta, 'views', file), 'utf8')
        .replaceAll('{{NAME}}', esc(s.nome))
        .replaceAll('{{TAGLINE}}', esc(s.tagline))
        .replaceAll('{{YEAR}}', String(new Date().getFullYear()))
        .replaceAll('{{LANG}}', lingua)
        .replaceAll('{{TEMA}}', tema)
        .replaceAll('{{PREFS}}', traduzida ? prefs.html(lingua, tema, { escolhida: prefs.lerMoeda(req), base: s.moeda, taxas: s.taxas }) : '');
      html = traduzir(html, lingua);
      // A resposta muda com o cookie: sem isto, uma cache pública podia servir a
      // página portuguesa a quem escolheu francês.
      res.set('Vary', 'Cookie').set('Cache-Control', 'no-cache').type('html').send(html);
    } catch (err) { next(err); }
  };
}

// Os ficheiros servem-se todos na raiz (/css/site.css, /js/common.js), venham
// da pasta da parte ou da sua cópia de comum. Os nomes não se repetem.
const estaticos = { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') };

function naoEncontrado(req, res) {
  const titulo = esc(req.t('404.titulo'));
  res.status(404).type('html').send(
    `<!doctype html><html lang="${req.lingua}"><meta charset="utf-8"><title>${titulo}</title>`
    + `<p style="font:16px system-ui;padding:2rem">${titulo}. <a href="/">${esc(req.t('404.voltar'))}</a></p>`);
}

// eslint-disable-next-line no-unused-vars
function erro(err, req, res, next) {
  console.error(err);
  if (res.headersSent) return res.destroy();
  res.status(502).type('html').send(
    '<!doctype html><meta charset="utf-8"><title>Indisponível</title>'
    + '<p style="font:16px system-ui;padding:2rem">O serviço não está a responder. Tente daqui a pouco.</p>');
}

// ---------------------------------------------------------------- Arranque
function enderecosDaRede() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// Abre a porta e diz onde abrir. Uma porta ocupada é um erro às claras: as
// três partes contam umas com as portas das outras, não podem saltar sozinhas.
function ouvir(app, porta, { nome, caminho = '' } = {}) {
  const server = http.createServer(app);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  ${nome}: a porta ${porta} está ocupada por outro programa. Feche-o ou escolha outra no .env.\n`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(Number(porta), process.env.HOST || '0.0.0.0', () => {
    if (process.env.NODE_ENV === 'test') return;
    const p = server.address().port;
    console.log(`  ${(nome + ':').padEnd(8)} http://localhost:${p}${caminho}`);
    for (const ip of enderecosDaRede()) console.log(`  ${'Rede:'.padEnd(8)} http://${ip}:${p}${caminho}`);
  });
  return server;
}

module.exports = { apiUrl, seguranca, reencaminhar, traduzir, pagina, estaticos, naoEncontrado, erro, ouvir };
