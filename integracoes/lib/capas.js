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
  // Imagem enviada do computador (guardarEnviada): já está na pasta das capas.
  if (eEnviada(url)) {
    if (!fs.existsSync(path.join(PASTA_CAPAS, url.slice(PREFIXO.length)))) throw new Error('A imagem enviada já não existe. Volte a escolhê-la.');
    return url;
  }
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

// ---------------------------------------------------------------------------
// Imagem escolhida no computador (painel → POST /api/admin/integracoes/imagens).
// Chega em bruto; confere-se pelos primeiros bytes que é mesmo JPEG, PNG ou
// WebP (não basta o que o browser diz) e guarda-se com o nome tirado do
// conteúdo: a mesma imagem duas vezes fica um ficheiro só.
// ---------------------------------------------------------------------------
const PREFIXO = '/capas-integracao/';
const eEnviada = (v) => typeof v === 'string' && /^\/capas-integracao\/env-[a-f0-9]{20}\.(jpg|png|webp)$/.test(v);

function tipoPelosBytes(b) {
  if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function guardarEnviada(dados) {
  if (!Buffer.isBuffer(dados) || !dados.length) throw new Error('Escolha uma imagem.');
  if (dados.length > MAX) throw new Error('A imagem tem mais de 5 MB.');
  const ext = tipoPelosBytes(dados);
  if (!ext) throw new Error('O ficheiro não é uma imagem JPG, PNG ou WebP.');
  const nome = `env-${crypto.createHash('sha1').update(dados).digest('hex').slice(0, 20)}.${ext}`;
  fs.writeFileSync(path.join(PASTA_CAPAS, nome), dados);
  return PREFIXO + nome;
}

// Descarrega uma imagem de fora (a capa lida de um link de música) e guarda-a
// como uma imagem enviada: o painel pode mostrá-la logo, antes de guardar.
// Aceita vários endereços e fica com o primeiro que servir (no YouTube, a
// imagem grande nem sempre existe).
async function guardarDeFora(urls) {
  let ultimo = 'sem imagem';
  for (const url of [].concat(urls).filter(Boolean)) {
    try {
      const res = await pedir(url, { prazoMs: 15000 });
      if (!res.ok) { ultimo = 'resposta ' + res.status; continue; }
      if (Number(res.headers.get('content-length')) > MAX) { ultimo = 'mais de 5 MB'; continue; }
      return guardarEnviada(Buffer.from(await res.arrayBuffer()));
    } catch (e) { ultimo = e.message; }
  }
  throw new Error('Não foi possível trazer a capa (' + ultimo + ').');
}

// Origem de capa aceite num formulário: um link, ou uma imagem já enviada.
const eOrigemCapa = (v) => eEnviada(v) || (typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 1000);

module.exports = { baixarCapa, guardarEnviada, guardarDeFora, eOrigemCapa, MAX };
