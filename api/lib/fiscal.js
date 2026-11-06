'use strict';
// ---------------------------------------------------------------------------
// País e taxa de IVA de um estúdio, a partir do sítio onde fica (as
// coordenadas que se põem em Estúdios: link do Google Maps, morada ou "Estou
// aqui"). Pergunta-se ao serviço de mapas (OpenStreetMap) de que país é o
// ponto; sem resposta, usa-se uma tabela aproximada das zonas mais prováveis.
// A taxa encontrada é só uma proposta: fica num campo do estúdio, editável.
//
// Taxas normais em vigor (2026). Regiões com taxa própria: Açores (16%),
// Madeira (22%) e Canárias (IGIC 7%, em vez de IVA).
// ---------------------------------------------------------------------------

const PAISES = {
  cv: ['Cabo Verde', 15], pt: ['Portugal', 23], fr: ['França', 20], es: ['Espanha', 21], it: ['Itália', 22],
  de: ['Alemanha', 19], be: ['Bélgica', 21], nl: ['Países Baixos', 21], lu: ['Luxemburgo', 17], ie: ['Irlanda', 23],
  gb: ['Reino Unido', 20], ch: ['Suíça', 8.1], at: ['Áustria', 20], ao: ['Angola', 14], mz: ['Moçambique', 16],
  sn: ['Senegal', 18],
};

// Caixas aproximadas [latMin, latMax, lonMin, lonMax]. As regiões vêm antes
// dos países, para ganharem a quem as contém.
const ZONAS = [
  { codigo: 'pt', regiao: 'Açores', taxa: 16, caixa: [36.8, 40.0, -31.6, -24.7] },
  { codigo: 'pt', regiao: 'Madeira', taxa: 22, caixa: [32.3, 33.2, -17.4, -16.2] },
  { codigo: 'es', regiao: 'Canárias', taxa: 7, imposto: 'IGIC', caixa: [27.5, 29.5, -18.3, -13.3] },
  { codigo: 'cv', caixa: [14.7, 17.3, -25.5, -22.6] },
  { codigo: 'pt', caixa: [36.95, 42.16, -9.55, -6.19] },
];
const dentro = ([a, b, c, d], lat, lon) => lat >= a && lat <= b && lon >= c && lon <= d;

function montar(codigo, zona) {
  const p = PAISES[codigo];
  if (!p) return { codigo, pais: codigo.toUpperCase(), regiao: '', taxa: null, imposto: 'IVA' };
  return {
    codigo, pais: p[0], regiao: (zona && zona.regiao) || '',
    taxa: zona && zona.taxa != null ? zona.taxa : p[1], imposto: (zona && zona.imposto) || 'IVA',
  };
}

// Só com as coordenadas, sem rede.
function aproximar(lat, lon) {
  const z = ZONAS.find((x) => dentro(x.caixa, lat, lon));
  return z ? { ...montar(z.codigo, z), fonte: 'aproximado' } : null;
}

// Com o serviço de mapas (reverse). `url` é o endereço de procura configurado
// (…/search); o de coordenadas é o irmão …/reverse.
async function detetar(lat, lon, { url, agente } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (url && process.env.GEOCODER !== 'off') {
    try {
      const rev = url.replace(/\/search\/?$/, '/reverse');
      const r = await fetch(`${rev}?format=jsonv2&zoom=5&lat=${lat}&lon=${lon}`, {
        signal: AbortSignal.timeout(6000), headers: { 'User-Agent': agente || 'studio-booking', 'Accept-Language': 'pt,en' },
      });
      const j = r.ok ? await r.json() : null;
      const codigo = j && j.address && String(j.address.country_code || '').toLowerCase();
      if (codigo) {
        // As regiões com taxa própria reconhecem-se pelas coordenadas.
        const z = ZONAS.find((x) => x.regiao && x.codigo === codigo && dentro(x.caixa, lat, lon));
        return { ...montar(codigo, z), fonte: 'mapa' };
      }
    } catch (_) { /* sem resposta: vai pela tabela */ }
  }
  return aproximar(lat, lon);
}

module.exports = { PAISES, detetar, aproximar, montar };
