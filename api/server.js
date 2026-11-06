'use strict';
// ---------------------------------------------------------------------------
// A API: a base de dados, as regras de negócio e as integrações. Não serve
// páginas — o site (pasta site/) e o painel (pasta admin/) são servidores à
// parte que reencaminham para aqui /api, os avisos das integrações e as capas.
// Vai para o ar sozinha: precisa só desta pasta e de um disco persistente.
// ---------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const { db, ensureRbacOwners, expirarPedidos } = require('./lib/db');
const auth = require('./lib/auth');
const contaAuth = require('./lib/conta-auth');
const atividade = require('./lib/atividade');
const { HttpError } = require('./lib/util');
const prefs = require('./comum/servidor/prefs');
const D = require('./comum/assets/js/dicionario.js');
const integracoes = require('./integracoes');
const chat = require('./routes/chat');

const app = express();
app.disable('x-powered-by');
// Os pedidos chegam reencaminhados pelo site e pelo painel, que dizem o IP de
// quem visita em X-Forwarded-For: confia-se nele quando vem de uma rede
// interna (o caso do computador e das redes privadas dos alojamentos), para os
// limites de pedidos contarem cada pessoa. TRUST_PROXY substitui esta regra.
app.set('trust proxy', process.env.TRUST_PROXY
  ? (process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY)
  : 'loopback, linklocal, uniquelocal');

// A política de segurança (CSP) é posta pelo site e pelo painel, por onde
// passam todas as respostas a caminho do navegador (PDFs incluídos).
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
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
app.use('/api/pagamento', require('./integracoes/rotas/pagamento').router);
// Cada alteração feita no painel fica na atividade de quem a fez (ver o perfil).
app.use('/api/admin', atividade.middleware);
app.use('/api/admin/integracoes', auth.requireAuth, integracoes.admin);
app.use('/api/admin/rbac', auth.requireAuth, auth.requireOwner, require('./routes/rbac'));
app.use('/api/admin/catalogos', auth.requireAuth, require('./routes/catalogos'));
// Botão de auriculares do painel: chat da equipa em tempo real e Assistente IA.
app.use('/api/admin/chat', auth.requireAuth, chat.router);
app.use('/api/admin/assistente', auth.requireAuth, require('./routes/assistente'));
app.use('/api/admin', auth.requireAuth, require('./routes/admin'));

// Capas trazidas pelas integrações, guardadas junto à base de dados.
app.use('/capas-integracao', express.static(integracoes.PASTA_CAPAS, { index: false, maxAge: '7d' }));

app.use((req, res) => res.status(404).json({ error: req.t('api.naoEncontrado') }));

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

// 3007: o site fica na 3005 e o painel na 3006. Em produção, o alojamento
// costuma dar a porta em PORT. Uma porta ocupada é um erro às claras: o site e
// o painel contam com esta.
function start(port = process.env.PORT || 3007) {
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
  atividade.limpar();
  setInterval(() => { auth.purgeSessions(); contaAuth.purgeSessions(); atividade.limpar(); }, 60 * 60 * 1000).unref();
  // Pedidos não confirmados até à hora da sessão passam a "expirado".
  expirarPedidos();
  setInterval(expirarPedidos, 5 * 60 * 1000).unref();
  integracoes.iniciar();

  const server = http.createServer(app);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  API: a porta ${port} está ocupada por outro programa. Feche-o ou escolha outra no .env.\n`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(Number(port), process.env.HOST || '0.0.0.0', () => {
    if (process.env.NODE_ENV !== 'test') console.log(`  API:     http://localhost:${server.address().port}`);
  });
  const shutdown = () => {
    integracoes.parar();
    chat.fechar();
    server.close(() => { db.close(); process.exit(0); });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

if (require.main === module) start();
module.exports = { app, start };
