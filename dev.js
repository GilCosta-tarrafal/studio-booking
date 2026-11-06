'use strict';
// Para trabalhar no computador. Cada parte arranca no seu terminal, na sua
// porta (mude-as no .env com SITE_PORT, ADMIN_PORT e API_PORT):
//
//   npm run dev:start   a API      http://localhost:3007
//   npm run dev:site    o site     http://localhost:3005
//   npm run dev         o painel   http://localhost:3006/admin
//
// O site e o painel precisam da API ligada. `npm start` arranca as três de
// uma vez. Antes de arrancar, põe as cópias de comum/ em dia (ver
// scripts/copiar-comum.js).
//
// Com --vigiar, reinicia sozinho quando muda um .js da parte ou de comum/.
// Não se usa o --watch do Node: no Windows vigia a pasta inteira e reinicia a
// cada escrita na base de dados, sem parar.
//
// Em produção não se usa isto: cada pasta (api/, site/, admin/) vai para o ar
// sozinha, com o seu `npm start`.

const fs = require('fs');
const path = require('path');

const PARTES = {
  api: { pasta: 'api', porta: () => process.env.API_PORT || 3007 },
  site: { pasta: 'site', porta: () => process.env.SITE_PORT || 3005 },
  painel: { pasta: 'admin', porta: () => process.env.ADMIN_PORT || 3006 },
};
// --parte=site (ou api, painel); sem ela, as três.
const escolha = (process.argv.find((a) => a.startsWith('--parte=')) || '').slice('--parte='.length);
if (escolha && !PARTES[escolha]) {
  console.error(`Parte desconhecida: "${escolha}". Use api, site ou painel.`);
  process.exit(1);
}
const partes = escolha ? [escolha] : Object.keys(PARTES);

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
  for (const pasta of [...partes.map((p) => PARTES[p].pasta), 'comum']) {
    fs.watch(path.join(__dirname, pasta), { recursive: true }, (_evento, f) => {
      if (!f || !f.endsWith('.js') || (pasta !== 'comum' && ignorar.test(f))) return;
      reiniciar(path.join(pasta, f));
    });
  }
  arrancar();
  return;
}

require('./scripts/copiar-comum').sincronizar();

process.env.API_URL = process.env.API_URL || `http://127.0.0.1:${PARTES.api.porta()}`;

console.log('');
if (partes.includes('api')) require('./api/server').start(PARTES.api.porta());
if (partes.includes('site')) require('./site/server').start(PARTES.site.porta());
if (partes.includes('painel')) require('./admin/server').start(PARTES.painel.porta());
if (escolha && escolha !== 'api') console.log(`  (a API tem de estar ligada: npm run dev:start, em ${process.env.API_URL})`);
