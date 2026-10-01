'use strict';

const { HttpError } = require('./util');

// Limitador simples em memória (por IP). Suficiente para um único servidor.
// "chave" é uma chave do dicionário: a mensagem sai na língua de quem pediu.
// "message" escreve-a à letra, para o que não é traduzido (a entrada no painel).
function rateLimit({ windowMs, max, message, chave = 'api.demasiadosPedidos' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60 * 1000).unref();

  return (req, _res, next) => {
    if (process.env.NODE_ENV === 'test') return next();
    const key = req.ip;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    h.count++;
    if (h.count > max) {
      return next(new HttpError(429, message || req.t(chave)));
    }
    next();
  };
}

module.exports = { rateLimit };
