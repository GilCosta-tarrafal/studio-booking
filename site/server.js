'use strict';
// ---------------------------------------------------------------------------
// O site público: página inicial, marcar, consultar, pagar e a conta do
// cliente. Não tem base de dados — pede à API o que precisa e reencaminha-lhe
// /api (ver comum/servidor/paginas.js). Vai para o ar sozinho: precisa só desta
// pasta e de API_URL a apontar para a API.
// ---------------------------------------------------------------------------

const express = require('express');
const path = require('path');
const prefs = require('./comum/servidor/prefs');
const P = require('./comum/servidor/paginas');

function criar() {
  const app = express();
  app.disable('x-powered-by');
  // Atrás de um proxy (Render, Railway, Nginx...), para ler o protocolo certo.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);
  app.use(P.seguranca);

  // O painel não existe neste endereço: nem a página nem a sua API.
  const DO_PAINEL = /^\/(admin|api\/admin|api\/auth)(\/|$)/;
  app.use((req, res, next) => {
    if (!DO_PAINEL.test(req.path)) return next();
    return req.path.startsWith('/api/')
      ? res.status(404).json({ error: 'Não encontrado.' })
      : res.status(404).type('text').send('Não encontrado.');
  });

  // Para a API: os pedidos do site, os avisos do Stripe e da gravadora (que
  // podem estar configurados com o endereço do site) e as capas.
  const api = P.reencaminhar();
  app.use(['/api', '/integracoes/webhooks', '/capas-integracao'], api);
  // Os estilos do formulário de marcação vêm do catálogo "Géneros musicais"
  // de Configurações; o estilos.js da pasta fica como reserva.
  app.get('/js/estilos.js', (req, res, next) => { req.url = req.originalUrl = '/api/public/estilos.js'; api(req, res, next); });

  app.use(prefs.middleware);
  const aqui = (f, o) => P.pagina(__dirname, f, o);
  app.get('/', aqui('index.html'));
  app.get('/marcar', aqui('marcar.html'));
  app.get('/consultar', aqui('consultar.html'));
  app.get('/pagar', aqui('pagar.html'));
  app.get('/conta', aqui('conta.html'));

  app.use(express.static(path.join(__dirname, 'comum', 'assets'), P.estaticos));
  app.use(express.static(path.join(__dirname, 'assets'), P.estaticos));
  app.use(P.naoEncontrado);
  app.use(P.erro);
  return app;
}

function start(porta = process.env.PORT || 3005) {
  return P.ouvir(criar(), porta, { nome: 'Site' });
}

if (require.main === module) start();
module.exports = { criar, start };
