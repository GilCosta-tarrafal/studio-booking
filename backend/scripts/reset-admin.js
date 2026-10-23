// Repõe a palavra-passe do administrador (owner) do painel.
// Uso: node backend/scripts/reset-admin.js [nova-palavra-passe]
// Sem argumento, gera uma palavra-passe aleatória e mostra-a no ecrã.
const crypto = require('crypto');
const { db } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const pw = process.argv[2] || crypto.randomBytes(9).toString('base64url');
if (pw.length < 8) {
  console.error('A palavra-passe deve ter pelo menos 8 caracteres.');
  process.exit(1);
}

const owner = db.prepare("SELECT id, email FROM users WHERE role='owner' ORDER BY id LIMIT 1").get();
if (!owner) {
  console.error('Nenhum administrador (owner) encontrado.');
  process.exit(1);
}

db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(pw), owner.id);
console.log('Email:         ', owner.email);
console.log('Palavra-passe: ', pw);
