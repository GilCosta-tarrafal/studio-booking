'use strict';
// Arranca a API, o site e o painel em portas livres, como no `npm run dev`, e
// devolve o endereço de cada um. Chame-o depois de definir DB_FILE e afins.

const ouvido = (server) => new Promise((r) => server.once('listening', r));
const endereco = (server) => 'http://127.0.0.1:' + server.address().port;

async function arrancar() {
  const servidores = { api: require('../api/server').start(0) };
  await ouvido(servidores.api);
  process.env.API_URL = endereco(servidores.api);
  servidores.site = require('../site/server').start(0);
  servidores.admin = require('../admin/server').start(0);
  await Promise.all([ouvido(servidores.site), ouvido(servidores.admin)]);
  const site = endereco(servidores.site), admin = endereco(servidores.admin);
  // A API e o painel montam links para o site e para o painel com isto (um
  // teste pode ter fixado o seu, como o endereço público do Stripe).
  process.env.SITE_URL = process.env.SITE_URL || site;
  process.env.PAINEL_URL = process.env.PAINEL_URL || admin;
  return { servidores, api: process.env.API_URL, site, admin };
}

module.exports = { arrancar };
