'use strict';
// ---------------------------------------------------------------------------
// O painel de gestão (/admin). Como o site, não tem base de dados: pede à API
// o nome do negócio e reencaminha-lhe /api (ver comum/servidor/paginas.js).
// Vai para o ar sozinho: precisa só desta pasta, de API_URL a apontar para a
// API e de SITE_URL para levar ao site quem abrir aqui uma página dele.
// ---------------------------------------------------------------------------

const express = require('express');
const path = require('path');
const prefs = require('./comum/servidor/prefs');
const P = require('./comum/servidor/paginas');

// Sem SITE_URL (no computador), o site está na 3005 da mesma máquina.
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.hostname}:${process.env.SITE_PORT || 3005}`;
}

function criar() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);
  app.use(P.seguranca);

  app.use(['/api', '/capas-integracao'], P.reencaminhar());

  app.use(prefs.middleware);
  app.get('/', (_req, res) => res.redirect(302, '/admin'));
  app.get('/admin', P.pagina(__dirname, 'admin.html', { traduzida: false }));
  // Páginas do site abertas aqui: leva-as para o site.
  app.get(['/marcar', '/consultar', '/pagar', '/conta'], (req, res) => res.redirect(302, siteUrl(req) + req.originalUrl));

  app.use(express.static(path.join(__dirname, 'comum', 'assets'), P.estaticos));
  app.use(express.static(path.join(__dirname, 'assets'), P.estaticos));
  app.use(P.naoEncontrado);
  app.use(P.erro);
  return app;
}

function start(porta = process.env.PORT || 3006) {
  return P.ouvir(criar(), porta, { nome: 'Painel', caminho: '/admin' });
}

if (require.main === module) start();
module.exports = { criar, start };
