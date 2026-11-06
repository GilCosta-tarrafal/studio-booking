'use strict';
// A pasta comum/ (na raiz) é o original do que o site, o painel e a API
// partilham: o dicionário, common.js, base.css, as imagens da marca e as peças
// de servidor (preferências, montagem das páginas, reencaminhamento).
//
// Cada uma das três partes tem de poder ir para o ar sozinha, sem as outras ao
// lado, por isso leva a sua cópia em <parte>/comum. Mexa só no original e
// corra `npm run comum` (os `npm run dev...` e o `npm test` já o fazem); o teste
// avisa se alguma cópia ficar para trás.
//
//   node scripts/copiar-comum.js          copia o que mudou
//   node scripts/copiar-comum.js --ver    só confere; sai com erro se houver diferenças

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ORIGEM = path.join(RAIZ, 'comum');
const PARTES = ['api', 'site', 'admin'];

function ficheiros(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? ficheiros(p, base) : [path.relative(base, p)];
  });
}

// Devolve as diferenças encontradas; com corrigir, deixa as cópias iguais ao original.
function sincronizar({ corrigir = true } = {}) {
  const originais = ficheiros(ORIGEM);
  const diferencas = [];
  for (const parte of PARTES) {
    const destino = path.join(RAIZ, parte, 'comum');
    for (const rel of originais) {
      const de = path.join(ORIGEM, rel), para = path.join(destino, rel);
      if (fs.existsSync(para) && fs.readFileSync(de).equals(fs.readFileSync(para))) continue;
      diferencas.push(path.join(parte, 'comum', rel));
      if (corrigir) { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.copyFileSync(de, para); }
    }
    // O que já não existe no original sai também da cópia.
    if (!fs.existsSync(destino)) continue;
    for (const rel of ficheiros(destino)) {
      if (originais.includes(rel)) continue;
      diferencas.push(path.join(parte, 'comum', rel) + ' (a mais)');
      if (corrigir) fs.rmSync(path.join(destino, rel));
    }
  }
  return diferencas;
}

if (require.main === module) {
  const soVer = process.argv.includes('--ver');
  const dif = sincronizar({ corrigir: !soVer });
  if (soVer && dif.length) {
    console.error('Cópias de comum/ desatualizadas (corra `npm run comum`):\n  ' + dif.join('\n  '));
    process.exit(1);
  }
  if (!soVer && dif.length) console.log(`comum/: ${dif.length} ficheiro(s) atualizado(s) nas cópias.`);
}

module.exports = { sincronizar };
