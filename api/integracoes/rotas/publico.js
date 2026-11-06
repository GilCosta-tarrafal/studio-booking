'use strict';
// O que o site público pede às integrações (em /api/integracoes).
const express = require('express');
const { db, getSettings, BOOKING_SELECT } = require('../../lib/db');
const U = require('../../lib/util');
const { rateLimit } = require('../../lib/ratelimit');
const stripe = require('../fornecedores/stripe');
const cambio = require('../fornecedores/cambio');
const loja = require('./loja');
const { requireClient } = require('../../lib/conta-auth');
const { paraSite } = require('./lancamentos');
const projetos = require('./projetos');

const router = express.Router();
const pagarLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 10 });
const interesseLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8 });
const compraLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20 });

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

// Taxas de câmbio (atualizadas 1×/dia, ver fornecedores/cambio.js).
//   /cambio                         -> todas as taxas, em relação à moeda base
//   /cambio?valor=10&de=EUR&para=CVE -> o valor convertido
router.get('/cambio', (req, res) => {
  const info = cambio.info();
  res.set('Cache-Control', 'public, max-age=600');
  if (req.query.de || req.query.para || req.query.valor) {
    const de = String(req.query.de || info.base).toUpperCase().slice(0, 3);
    const para = String(req.query.para || info.base).toUpperCase().slice(0, 3);
    const valor = req.query.valor === undefined ? 1 : Number(req.query.valor);
    if (!Number.isFinite(valor)) throw new U.HttpError(400, 'Valor inválido.');
    const t = cambio.taxa(de, para);
    if (t === null) throw new U.HttpError(404, `Sem taxa de câmbio para ${de} → ${para}.`);
    return res.json({ valor, de, para, taxa: t, convertido: valor * t, atualizado_em: info.atualizado_em });
  }
  res.json({ ...info, taxas: Object.fromEntries(cambio.listar().map((r) => [r.moeda, r.taxa])) });
});

// Comprar um artigo à venda (projeto "vendas"): cria a encomenda, que reserva
// as unidades, e devolve o código para a página de pagamento (/pagar?code=…).
router.post('/encomendas', requireClient, compraLimiter, (req, res) => {
  const b = req.body || {};
  const e = loja.criar(req.client, b.projeto_id, b.quantidade);
  res.status(201).json({ code: e.code, total: e.total, pagar: '/pagar?code=' + encodeURIComponent(e.code) });
});

// Projetos colaborativos visíveis, para a secção "Participa" do site.
router.get('/projetos', (_req, res) => {
  // Sem cache: com artigos à venda, o stock tem de estar sempre certo.
  res.set('Cache-Control', 'no-cache');
  // A moeda, para o site mostrar o preço dos artigos à venda.
  res.json({ projetos: projetos.listarPublico(), moeda: getSettings().currency || '' });
});

// Alguém, a partir do site, manifesta interesse num projeto.
router.post('/projetos/:id/interesse', interesseLimiter, (req, res) => {
  const id = U.toInt(req.params.id);
  projetos.registarInteresse(id, req.body, req.ip);
  res.json({ ok: true });
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
// Em produção defina SITE_URL (ver lib/enderecos.js).
const siteUrl = (req) => require('../../lib/enderecos').site(req);

router.post('/pagamentos/checkout', pagarLimiter, async (req, res) => {
  const booking = marcacaoDoCliente(req);
  if (!stripe.ativo()) throw new U.HttpError(503, req.t('pagar.indisponivel'));
  if (!stripe.podePagar(booking)) {
    throw new U.HttpError(400, req.t(stripe.emFalta(booking) > 0 ? 'pagar.aindaNao' : 'pagar.nadaEmFalta'));
  }
  try {
    const r = await stripe.criarCheckout({
      booking, valor: require('./pagamento').aPagarAgora(booking, (req.body || {}).opcao), textoMoeda: booking.currency || getSettings().currency, siteUrl: siteUrl(req), lingua: req.lingua,
    });
    res.json({ url: r.url, valor: r.valor });
  } catch (e) {
    console.error('[stripe] não foi possível criar o pagamento:', e.message);
    throw new U.HttpError(502, req.t('pagar.falhou'));
  }
});

module.exports = router;
