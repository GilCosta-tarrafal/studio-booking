'use strict';
// ---------------------------------------------------------------------------
// Integrações com serviços de fora: pagamentos, plataforma da gravadora e os
// que vierem a seguir.
//
// Fica à parte do resto do backend: tabelas próprias, rotas próprias e
// nenhum serviço de fora é chamado pelo código das marcações. O servidor só
// precisa de montar três coisas (ver backend/server.js):
//
//   integracoes.webhooks  em /integracoes/webhooks  (antes do express.json)
//   integracoes.publico   em /api/integracoes
//   integracoes.admin     em /api/admin/integracoes  (com sessão)
//
// Para acrescentar um fornecedor: um ficheiro em fornecedores/ que exporte
// { id, estado(), webhook?(corpo, cabecalhos), iniciar?(), parar?() } e uma
// linha em FORNECEDORES, aqui em baixo. O webhook passa a existir sozinho em
// /integracoes/webhooks/<id> e o estado aparece no painel.
// ---------------------------------------------------------------------------
const express = require('express');
const base = require('./lib/base');
const stripe = require('./fornecedores/stripe');
const gravadora = require('./fornecedores/gravadora');
const youtube = require('./fornecedores/youtube');

const FORNECEDORES = [stripe, gravadora, youtube];
const porId = Object.fromEntries(FORNECEDORES.map((f) => [f.id, f]));

// ---------------------------------------------------------------- Webhooks
// Corpo em bruto (Buffer): a assinatura é feita sobre os bytes exatos que
// chegaram, e um JSON lido e voltado a escrever já não bate certo.
const webhooks = express.Router();
webhooks.post('/:fornecedor', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const f = porId[req.params.fornecedor];
  if (!f || !f.webhook) return res.status(404).json({ error: 'Integração desconhecida.' });
  try {
    const corpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const resultado = await f.webhook(corpo, req.headers);
    res.json({ recebido: true, resultado });
  } catch (e) {
    const status = e.status && e.status < 600 ? e.status : 500;
    if (status >= 500) console.error(`[${f.id}] webhook falhou:`, e);
    // Com 5xx o fornecedor volta a tentar mais tarde; com 4xx desiste — que é
    // o certo para uma assinatura errada ou dados que nunca vão ser válidos.
    res.status(status).json({ error: status >= 500 && status !== 503 ? 'Erro interno.' : e.message });
  }
});

function iniciar() { for (const f of FORNECEDORES) if (f.iniciar) f.iniciar(); }
function parar() { for (const f of FORNECEDORES) if (f.parar) f.parar(); }

module.exports = {
  webhooks,
  publico: require('./rotas/publico'),
  admin: require('./rotas/admin')(FORNECEDORES),
  iniciar, parar,
  PASTA_CAPAS: base.PASTA_CAPAS,
  FORNECEDORES,
};
