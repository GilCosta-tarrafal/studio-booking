'use strict';
// ---------------------------------------------------------------------------
// Assinatura dos webhooks.
//
// Um webhook é um pedido que chega de fora, sem sessão nenhuma: a única prova
// de que vem mesmo de quem diz vir é a assinatura. O esquema é o do Stripe, e
// a plataforma da gravadora usa o mesmo, para haver só uma maneira de conferir:
//
//   cabeçalho:  t=<segundos unix>,v1=<hex>
//   v1 = HMAC-SHA256(segredo, "<t>.<corpo tal e qual chegou>")
//
// O t entra na conta para um pedido gravado não poder ser repetido mais tarde:
// fora da tolerância (5 minutos) é recusado, mesmo com a assinatura certa.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const TOLERANCIA_S = 300;

function assinar(segredo, t, corpo) {
  return crypto.createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex');
}

// Para quem manda (os testes, ou um script da gravadora em Node).
function cabecalho(segredo, corpo, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${assinar(segredo, t, corpo)}`;
}

function verificar(cabecalhoRecebido, corpo, segredo, agora = Date.now()) {
  if (!segredo || typeof cabecalhoRecebido !== 'string') return false;
  let t = null;
  const assinaturas = [];
  for (const parte of cabecalhoRecebido.split(',')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim(), v = parte.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') assinaturas.push(v);
  }
  if (!/^\d+$/.test(t || '') || !assinaturas.length) return false;
  if (Math.abs(agora / 1000 - Number(t)) > TOLERANCIA_S) return false;
  const esperada = Buffer.from(assinar(segredo, t, Buffer.isBuffer(corpo) ? corpo.toString('utf8') : String(corpo)), 'hex');
  // Comparação em tempo constante: uma comparação normal pára no primeiro
  // carácter diferente, e o tempo de resposta ia denunciando a assinatura.
  return assinaturas.some((a) => {
    const b = Buffer.from(a, 'hex');
    return b.length === esperada.length && crypto.timingSafeEqual(b, esperada);
  });
}

module.exports = { assinar, cabecalho, verificar, TOLERANCIA_S };
