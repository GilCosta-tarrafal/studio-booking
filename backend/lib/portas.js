'use strict';

// Site e painel em portas separadas (opcional). Com ADMIN_PORT definido, o
// servidor abre duas portas: a do site (PORT, por omissão 3005) só serve as
// páginas públicas, as marcações e a conta do cliente; a do painel só serve
// /admin e as suas rotas. Sem ADMIN_PORT fica tudo numa porta, como sempre
// (é o que precisam os serviços de alojamento que só dão uma porta).
//
// Aqui guardam-se as portas em que o servidor ficou a ouvir e montam-se os
// endereços de uma zona para a outra. SITE_URL e PAINEL_URL, se definidos,
// mandam (ex.: atrás de um túnel ou de um domínio, cada porta tem o seu nome).

const portas = { site: null, painel: null };

const separado = () => !!portas.painel;
const definir = (zona, porta) => { portas[zona] = porta; };

function url(zona, req) {
  const fixo = zona === 'site' ? process.env.SITE_URL : process.env.PAINEL_URL;
  if (fixo) return fixo.replace(/\/$/, '');
  return `${req.protocol}://${req.hostname}:${portas[zona]}`;
}

module.exports = { separado, definir, url };
