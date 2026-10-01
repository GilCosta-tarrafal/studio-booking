'use strict';
// O que o site público pede às integrações (em /api/integracoes).
const express = require('express');
const { db, getSettings, BOOKING_SELECT } = require('../../backend/lib/db');
const U = require('../../backend/lib/util');
const { rateLimit } = require('../../backend/lib/ratelimit');
const stripe = require('../fornecedores/stripe');
const { paraSite } = require('./lancamentos');

const router = express.Router();
const pagarLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });

// O que está ligado, para o site saber que botões mostrar.
router.get('/estado', (_req, res) => {
  res.json({ pagamentos: stripe.ativo() && !!stripe.moeda(getSettings().currency) });
});

router.get('/lancamentos', (_req, res) => {
  // Muda poucas vezes por dia: um minuto de cache poupa o servidor sem que
  // um lançamento novo demore a aparecer.
  res.set('Cache-Control', 'public, max-age=60');
  res.json(paraSite());
});

// A mesma prova que a consulta de marcações pede: código e telefone.
function marcacaoDoCliente(req) {
  const body = req.body || {};
  const code = U.clean(body.code, 12).toUpperCase();
  const phone = U.digits(body.phone).slice(-7);
  const row = code ? db.prepare(BOOKING_SELECT + ' WHERE b.code=?').get(code) : null;
  if (!row || phone.length < 6 || U.digits(row.client_phone).slice(-7) !== phone) {
    throw new U.HttpError(404, req.t('api.marcacaoNaoEncontrada'));
  }
  return row;
}

// Endereço público do site, para o Stripe saber para onde devolver o cliente.
// Em produção defina SITE_URL: atrás de um proxy, o Host do pedido pode não
// ser o domínio que o cliente vê.
function siteUrl(req) {
  return (process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

router.post('/pagamentos/checkout', pagarLimiter, async (req, res) => {
  const booking = marcacaoDoCliente(req);
  if (!stripe.ativo()) throw new U.HttpError(503, req.t('pagar.indisponivel'));
  if (!stripe.podePagar(booking)) {
    throw new U.HttpError(400, req.t(stripe.emFalta(booking) > 0 ? 'pagar.aindaNao' : 'pagar.nadaEmFalta'));
  }
  try {
    const r = await stripe.criarCheckout({
      booking, textoMoeda: getSettings().currency, siteUrl: siteUrl(req), lingua: req.lingua,
    });
    res.json({ url: r.url, valor: r.valor });
  } catch (e) {
    console.error('[stripe] não foi possível criar o pagamento:', e.message);
    throw new U.HttpError(502, req.t('pagar.falhou'));
  }
});

module.exports = router;
