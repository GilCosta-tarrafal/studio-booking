'use strict';
// Para trabalhar no computador: arranca as três partes de uma vez, cada uma na
// sua porta — o site na 3005, o painel na 3006 e a API na 3007 (mude-as no
// .env com SITE_PORT, ADMIN_PORT e API_PORT). Antes, põe as cópias de comum/
// em dia (ver scripts/copiar-comum.js).
//
// Com --vigiar (o `npm run dev`), reinicia sozinho quando muda um .js do
// código. Não se usa o --watch do Node: no Windows vigia a pasta inteira e
// reinicia a cada escrita na base de dados, sem parar.
//
// Em produção não se usa isto: cada pasta (api/, site/, admin/) vai para o ar
// sozinha, com o seu `npm start`.

const fs = require('fs');
const path = require('path');

if (process.argv.includes('--vigiar') && !process.env.DEV_FILHO) {
  const { spawn } = require('child_process');
  const args = process.argv.slice(1).filter((a) => a !== '--vigiar');
  let filho = null, espera = null;
  const arrancar = () => {
    filho = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, DEV_FILHO: '1' } });
  };
  const reiniciar = (ficheiro) => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      console.log(`\n  ${ficheiro} mudou: a reiniciar...`);
      if (filho.exitCode !== null) return arrancar();
      filho.once('exit', arrancar);
      filho.kill();
    }, 200);
  };
  // As cópias <parte>/comum são escritas pelo próprio arranque e a base de
  // dados vive em api/data: nenhuma conta como mudança de código.
  const ignorar = /^(data|node_modules|comum)([\\/]|$)/;
  for (const pasta of ['api', 'site', 'admin', 'comum']) {
    fs.watch(path.join(__dirname, pasta), { recursive: true }, (_evento, f) => {
      if (!f || !f.endsWith('.js') || (pasta !== 'comum' && ignorar.test(f))) return;
      reiniciar(path.join(pasta, f));
    });
  }
  arrancar();
  return;
}

require('./scripts/copiar-comum').sincronizar();

const portas = { api: process.env.API_PORT || 3007, site: process.env.SITE_PORT || 3005, painel: process.env.ADMIN_PORT || 3006 };
process.env.API_URL = process.env.API_URL || `http://127.0.0.1:${portas.api}`;

console.log('');
require('./api/server').start(portas.api);
require('./site/server').start(portas.site);
require('./admin/server').start(portas.painel);
