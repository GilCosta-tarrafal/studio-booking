'use strict';
// Abre a API, o site e o painel, cada um na sua janela de terminal, com o
// nome da parte no título (npm run terminais). A API arranca primeiro: o
// site e o painel precisam dela.

const { spawn } = require('child_process');
const path = require('path');

const raiz = path.join(__dirname, '..');
const PARTES = [['API', 'api'], ['Site', 'site'], ['Painel', 'painel']];

function abrir(titulo, script) {
  if (process.platform === 'win32') {
    // "start" abre uma janela nova; o primeiro argumento entre aspas é o título.
    spawn('cmd.exe', ['/c', 'start', `"${titulo}"`, 'cmd.exe', '/k', `chcp 65001 >nul && title ${titulo} && npm run ${script}`],
      { cwd: raiz, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell application "Terminal" to do script "cd '${raiz}' && npm run ${script}"`],
      { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('x-terminal-emulator', ['-T', titulo, '-e', `bash -c "cd '${raiz}' && npm run ${script}; exec bash"`],
      { detached: true, stdio: 'ignore' }).on('error', () => console.log(`  Abra um terminal e corra: npm run ${script}`)).unref();
  }
}

PARTES.forEach(([titulo, script], i) => setTimeout(() => {
  abrir(titulo, script);
  console.log(`  ${titulo}: aberto numa janela nova (npm run ${script})`);
}, i * 1500));
