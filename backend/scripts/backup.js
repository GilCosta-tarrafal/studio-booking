'use strict';
// Cópia de segurança segura da base de dados (funciona com o servidor ligado).
// Uso: npm run backup      (cria data/backups/estudio-AAAA-MM-DD-HHMM.db)
const path = require('path');
const fs = require('fs');
const { db } = require('../lib/db');

const dir = path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const file = path.join(dir, `estudio-${stamp}.db`);

db.backup(file)
  .then(() => {
    console.log('Cópia criada: ' + file);
    // Mantém apenas as 30 mais recentes.
    const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().slice(30);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
    db.close();
  })
  .catch((e) => { console.error('Falhou:', e.message); process.exit(1); });
