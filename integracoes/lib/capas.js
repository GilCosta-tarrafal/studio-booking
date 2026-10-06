'use strict';
// ---------------------------------------------------------------------------
// Trazer uma imagem de fora para o disco do site.
//
// O site só mostra imagens servidas por ele próprio (a política de segurança
// não deixa carregar de outros sítios) e uma capa não deve desaparecer se a
// origem mudar de endereço. Por isso, uma capa indicada por link é copiada
// para a pasta das capas e passa a ser servida em /capas-integracao/...
//
// É o mesmo princípio que a plataforma da gravadora já usa; aqui fica num sítio
// só, para os lançamentos à mão e os projetos reaproveitarem.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PASTA_CAPAS } = require('./base');
const { pedir } = require('./http');

const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 5 * 1024 * 1024;

// Descarrega a imagem e devolve o caminho servido (/capas-integracao/ficheiro?v=…).
// Lança um erro claro se o endereço não servir — quem chama decide o que fazer.
async function baixarCapa(url, chave) {
  if (typeof url !== 'string' || !/^https?:\/\/[^\s]+$/i.test(url) || url.length > 1000) {
    throw new Error('Endereço de imagem inválido.');
  }
  const nomeBase = crypto.createHash('sha1').update(String(chave)).digest('hex').slice(0, 16);
  // ?v= muda com a origem: o navegador não fica preso à capa antiga da cache.
  const v = crypto.createHash('sha1').update(url).digest('hex').slice(0, 8);
  const res = await pedir(url, { prazoMs: 20000 });
  const tipo = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || !TIPOS[tipo]) throw new Error(`A imagem não pôde ser carregada (resposta ${res.status}${tipo ? ', ' + tipo : ''}).`);
  if (Number(res.headers.get('content-length')) > MAX) throw new Error('A imagem tem mais de 5 MB.');
  const dados = Buffer.from(await res.arrayBuffer());
  if (dados.length > MAX) throw new Error('A imagem tem mais de 5 MB.');
  const ficheiro = `${nomeBase}.${TIPOS[tipo]}`;
  fs.writeFileSync(path.join(PASTA_CAPAS, ficheiro), dados);
  return `/capas-integracao/${ficheiro}?v=${v}`;
}

module.exports = { baixarCapa };
