'use strict';
// ---------------------------------------------------------------------------
// Traduções do conteúdo escrito no painel: nomes e descrições dos estúdios,
// das salas e dos serviços, a frase de apresentação e o texto antes de enviar.
//
// O português fica nas colunas de sempre (name, description...). As outras
// línguas ficam numa coluna "traducoes", em JSON:
//   { "en": { "name": "...", "description": "..." }, "fr": { ... } }
// Uma tradução em falta fica de fora, e quem a lê cai no português — mais vale
// o original do que um buraco na página.
//
// O site recebe estas traduções num campo "i18n" de cada objeto e escolhe a da
// língua ativa (ver tr() em common.js). Assim, trocar de língua no cabeçalho
// não precisa de voltar a pedir nada ao servidor.
// ---------------------------------------------------------------------------

const D = require('../../comum/assets/js/dicionario.js');

// As línguas que levam tradução: todas menos o português, que é o original.
const OUTRAS = D.codigos.filter((c) => c !== 'pt');

// Que campos de cada coisa se traduzem, e com que tamanho máximo (o mesmo do
// campo em português).
const CAMPOS = {
  studios: { name: 80, city: 60, description: 400 },
  rooms: { name: 80, description: 300 },
  services: { name: 80, description: 300 },
  settings: { tagline: 160, terms: 500 },
};

function ler(json) {
  if (json && typeof json === 'object') return json;
  try {
    const o = JSON.parse(json || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_) { return {}; }
}

// O que chega do painel, limpo: só as línguas e os campos conhecidos, texto
// aparado e cortado ao tamanho do campo, sem entradas vazias.
function limpar(bruto, campos) {
  const entrada = ler(bruto);
  const out = {};
  for (const lingua of OUTRAS) {
    const l = entrada[lingua];
    if (!l || typeof l !== 'object') continue;
    const campo = {};
    for (const [k, max] of Object.entries(campos)) {
      const v = typeof l[k] === 'string' ? l[k].replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '';
      if (v) campo[k] = v;
    }
    if (Object.keys(campo).length) out[lingua] = campo;
  }
  return out;
}

// O texto de um campo na língua pedida, ou o português.
function local(original, traducoes, lingua, campo) {
  const t = ler(traducoes)[lingua];
  return (t && t[campo]) || original;
}

// Junta as traduções de vários objetos num só "i18n", trocando o nome dos
// campos: { room: [traducoesDaSala, {name: 'room_name'}], ... }.
function juntar(partes) {
  const out = {};
  for (const [traducoes, nomes] of partes) {
    const tr = ler(traducoes);
    for (const lingua of OUTRAS) {
      for (const [campo, novo] of Object.entries(nomes)) {
        const v = tr[lingua] && tr[lingua][campo];
        if (v) (out[lingua] = out[lingua] || {})[novo] = v;
      }
    }
  }
  return out;
}

module.exports = { OUTRAS, CAMPOS, ler, limpar, local, juntar };
