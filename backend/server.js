'use strict';

const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { db, getSettings, ensureRbacOwners } = require('./lib/db');
const auth = require('./lib/auth');
const contaAuth = require('./lib/conta-auth');
const { HttpError } = require('./lib/util');
const prefs = require('./lib/prefs');
const TR = require('./lib/traducoes');
const D = require('../comum/assets/js/dicionario.js');
const integracoes = require('../integracoes');

const app = express();
// Cinco pastas: o backend (aqui), o site público, o fluxo de marcação (marcar
// e consultar), a área de gestão/painel e o que é comum a todos (dicionário,
// common.js e base.css) — assim nenhuma destas três áreas vai buscar ficheiros
// à pasta de outra.
const RAIZ = path.join(__dirname, '..');
const PUBLICO = path.join(RAIZ, 'publico');
const MARCACOES = path.join(RAIZ, 'marcacoes');
const BOOKING = path.join(RAIZ, 'booking');
const CONTA = path.join(RAIZ, 'conta');
const COMUM = path.join(RAIZ, 'comum');

app.disable('x-powered-by');
// Atrás de um proxy (Render, Railway, Nginx...), defina TRUST_PROXY=1 para o limitador ver o IP real.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// Avisos que chegam de fora (Stripe, plataforma da gravadora). Vêm antes do
// express.json porque a assinatura é conferida sobre o corpo em bruto, e
// fora de /api porque não trazem o cabeçalho anti-CSRF — a prova é a assinatura.
app.use('/integracoes/webhooks', integracoes.webhooks);

app.use(express.json({ limit: '100kb' }));
app.use(prefs.middleware);
app.use(auth.loadUser);
app.use(contaAuth.loadClient);

// ---------------------------------------------------------------- API
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // Proteção CSRF: pedidos que alteram dados têm de trazer este cabeçalho,
  // que outros sites não conseguem enviar.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'studio') {
    return next(new HttpError(403, req.t('api.naoAutorizado')));
  }
  next();
});
app.use('/api/public', require('./routes/public'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/conta', require('./routes/conta'));
app.use('/api/integracoes', integracoes.publico);
app.use('/api/admin/integracoes', auth.requireAuth, integracoes.admin);
app.use('/api/admin/rbac', auth.requireAuth, auth.requireOwner, require('./routes/rbac'));
app.use('/api/admin', auth.requireAuth, require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ error: req.t('api.naoEncontrado') }));

// ---------------------------------------------------------------- Páginas
const esc = prefs.esc;

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

function page(pasta, file, { traduzida = true } = {}) {
  return (req, res) => {
    const s = getSettings();
    // O painel é interno e fica sempre em português e em escuro.
    const lingua = traduzida ? req.lingua : 'pt';
    const tema = traduzida ? prefs.lerTema(req) : 'escuro';
    let html = fs.readFileSync(path.join(pasta, 'views', file), 'utf8')
      .replaceAll('{{NAME}}', esc(s.business_name))
      .replaceAll('{{TAGLINE}}', esc(TR.local(s.tagline, s.traducoes, lingua, 'tagline')))
      .replaceAll('{{YEAR}}', String(new Date().getFullYear()))
      .replaceAll('{{LANG}}', lingua)
      .replaceAll('{{TEMA}}', tema)
      .replaceAll('{{PREFS}}', traduzida ? prefs.html(lingua, tema) : '');
    html = traduzir(html, lingua);
    // A resposta muda com o cookie: sem isto, uma cache pública podia servir a
    // página portuguesa a quem escolheu francês.
    res.set('Vary', 'Cookie').set('Cache-Control', 'no-cache').type('html').send(html);
  };
}
app.get('/', page(PUBLICO, 'index.html'));
app.get('/marcar', page(MARCACOES, 'marcar.html'));
app.get('/consultar', page(MARCACOES, 'consultar.html'));
app.get('/conta', page(CONTA, 'conta.html'));
app.get('/admin', page(BOOKING, 'admin.html', { traduzida: false }));

// Os conjuntos de ficheiros servem-se todos na mesma raiz, para os endereços
// (/css/site.css, /js/admin.js, /js/common.js) continuarem a ser os mesmos de
// sempre, venha o ficheiro da pasta que vier. Os nomes não se repetem entre
// pastas, por isso a ordem não importa.
const estaticos = { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') };
app.use(express.static(path.join(COMUM, 'assets'), estaticos));
app.use(express.static(path.join(PUBLICO, 'assets'), estaticos));
app.use(express.static(path.join(MARCACOES, 'assets'), estaticos));
app.use(express.static(path.join(CONTA, 'assets'), estaticos));
app.use(express.static(path.join(BOOKING, 'assets'), estaticos));
// Capas trazidas pelas integrações, guardadas junto à base de dados.
app.use('/capas-integracao', express.static(integracoes.PASTA_CAPAS, { index: false, maxAge: '7d' }));

app.use((req, res) => {
  const titulo = esc(req.t('404.titulo'));
  res.status(404).type('html').send(
    `<!doctype html><html lang="${req.lingua}"><meta charset="utf-8"><title>${titulo}</title>`
    + `<p style="font:16px system-ui;padding:2rem">${titulo}. <a href="/">${esc(req.t('404.voltar'))}</a></p>`);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const t = req.t || ((chave) => D.t('pt', chave));
  let status = err.status || err.statusCode || 500;
  let message;
  if (err instanceof HttpError) message = err.message;
  else if (status < 500) message = t('api.pedidoInvalido');
  else { console.error(err); status = 500; message = t('api.erroInterno'); }
  res.status(status).json({ error: message });
});

// Endereços desta máquina na rede local, para abrir o site noutro aparelho.
function enderecosDaRede() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

// 3005 e não 3000: a 3000 é a porta por omissão de quase todos os projetos
// Node/Next, e costuma estar ocupada por outro que esteja a correr.
function start(port = process.env.PORT || 3005) {
  const first = auth.ensureFirstUser();
  ensureRbacOwners();
  if (first) {
    console.log('\n────────────────────────────────────────────────────');
    console.log(' Conta de administrador criada');
    console.log('   Email:          ' + first.email);
    console.log('   Palavra-passe:  ' + first.password + (first.generated ? '   (gerada agora; guarde-a e mude-a em Definições)' : ''));
    console.log('────────────────────────────────────────────────────\n');
  }
  auth.purgeSessions();
  contaAuth.purgeSessions();
  setInterval(() => { auth.purgeSessions(); contaAuth.purgeSessions(); }, 60 * 60 * 1000).unref();
  integracoes.iniciar();
  const host = process.env.HOST || '0.0.0.0';
  // Sem PORT definido, se a porta estiver ocupada por outro programa tenta-se a
  // seguinte. Com PORT definido falha às claras: num servidor a sério, mudar de
  // porta em silêncio seria pior do que não arrancar.
  const inicial = Number(port);
  const procurarLivre = !process.env.PORT && inicial !== 0;
  let tentativa = inicial;
  const server = app.listen(tentativa, host);
  server.on('listening', () => {
    const p = server.address().port;
    console.log('');
    console.log(`  Site:    http://localhost:${p}`);
    for (const ip of enderecosDaRede()) console.log(`  Rede:    http://${ip}:${p}`);
    console.log(`  Painel:  http://localhost:${p}/admin`);
    console.log('');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && procurarLivre && tentativa < inicial + 20) {
      console.log(`  A porta ${tentativa} está ocupada por outro programa; a tentar a ${tentativa + 1}...`);
      tentativa += 1;
      server.close();
      setTimeout(() => server.listen(tentativa, host), 50);
      return;
    }
    throw err;
  });
  const shutdown = () => { integracoes.parar(); server.close(() => { db.close(); process.exit(0); }); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();
module.exports = { app, start };
