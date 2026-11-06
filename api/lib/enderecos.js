'use strict';

// Onde estão o site e o painel, para os links que a API manda (emails, "Ver o
// site" no painel, o regresso do Stripe, a conta de equipa que entra por /conta).
// SITE_URL e PAINEL_URL mandam — em produção defina-os sempre. Sem eles (no
// computador), monta-se com o nome por onde o pedido chegou e a porta de cada
// um (3005 e 3006), para funcionar também noutro aparelho da rede local.

const PORTAS = { site: () => process.env.SITE_PORT || 3005, painel: () => process.env.ADMIN_PORT || 3006 };

function url(zona, req) {
  const fixo = zona === 'site' ? process.env.SITE_URL : process.env.PAINEL_URL;
  if (fixo) return fixo.replace(/\/$/, '');
  const protocolo = req ? req.protocol : 'http';
  const nome = req ? req.hostname : 'localhost';
  return `${protocolo}://${nome}:${PORTAS[zona]()}`;
}

module.exports = { url, site: (req) => url('site', req), painel: (req) => url('painel', req) };
