'use strict';
// Pedidos para fora, com prazo. Um serviço externo lento não pode deixar um
// pedido do site pendurado para sempre.

class ErroExterno extends Error {
  constructor(message, status = 0, corpo = null) {
    super(message);
    this.status = status;
    this.corpo = corpo;
  }
}

async function pedir(url, { method = 'GET', headers = {}, body, prazoMs = 15000 } = {}) {
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(prazoMs) });
  } catch (e) {
    throw new ErroExterno(e.name === 'TimeoutError' ? 'O serviço não respondeu a tempo.' : 'Não foi possível contactar o serviço.');
  }
  return res;
}

async function pedirJson(url, opcoes) {
  const res = await pedir(url, opcoes);
  let dados = null;
  try { dados = await res.json(); } catch (_) { /* sem corpo JSON */ }
  if (!res.ok) {
    const msg = (dados && dados.error && (dados.error.message || dados.error)) || `O serviço respondeu com erro ${res.status}.`;
    throw new ErroExterno(typeof msg === 'string' ? msg : `O serviço respondeu com erro ${res.status}.`, res.status, dados);
  }
  return dados;
}

module.exports = { pedir, pedirJson, ErroExterno };
