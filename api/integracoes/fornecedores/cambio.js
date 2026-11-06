'use strict';
// ---------------------------------------------------------------------------
// Taxas de câmbio, atualizadas todos os dias, para o sistema converter
// valores entre moedas quando for preciso (ver converter(), em baixo, e
// GET /api/integracoes/cambio).
//
// Fonte: ExchangeRate-API, acesso aberto (https://open.er-api.com). Gratuito,
// sem chave, 160+ moedas (inclui CVE, EUR, USD, AOA, BRL, XOF...), atualizado
// uma vez por dia. Os termos pedem que, onde as taxas aparecem, se indique a
// fonte: "Rates By Exchange Rate API" (o painel mostra-o).
//
// As taxas guardam-se em relação à moeda das Definições (a "base"): 1 base =
// taxa × moeda. Se a moeda das Definições mudar, a próxima verificação vai
// buscar tudo de novo nessa base.
//
//   CAMBIO=off          Desliga a integração (servidores sem saída para a internet).
//   CAMBIO_API_URL      Outro servidor compatível, ou um falso nos testes.
// ---------------------------------------------------------------------------
const { db, gravarEstado, lerEstado } = require('../lib/base');
const { pedirJson } = require('../lib/http');
const { getSettings } = require('../../lib/db');

db.exec(`
CREATE TABLE IF NOT EXISTS int_cambio (
  moeda         TEXT PRIMARY KEY,
  taxa          REAL NOT NULL,
  base          TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
`);

const ID = 'cambio';
const DIA_MS = 24 * 60 * 60 * 1000;
const apiUrl = () => (process.env.CAMBIO_API_URL || 'https://open.er-api.com/v6').replace(/\/$/, '');
const ativo = () => process.env.CAMBIO !== 'off';
// A moeda das Definições é texto livre ("CVE", "ECV"...): só serve de base um
// código ISO de 3 letras.
const codigo = (m) => String(m || '').trim().toUpperCase();
const base = () => { const c = codigo(getSettings().currency); return /^[A-Z]{3}$/.test(c) ? c : 'EUR'; };

class ErroDados extends Error {
  constructor(m) { super(m); this.status = 400; }
}

// ---------------------------------------------------------------- Sincronizar
let aSincronizar = null;
async function sincronizar() {
  if (!ativo()) throw new ErroDados('A integração do câmbio está desligada (CAMBIO=off).');
  if (aSincronizar) return aSincronizar;
  aSincronizar = (async () => {
    const b = base();
    try {
      const dados = await pedirJson(`${apiUrl()}/latest/${b}`, { headers: { Accept: 'application/json' } });
      if (!dados || dados.result !== 'success' || !dados.rates || typeof dados.rates !== 'object') {
        throw new Error((dados && (dados['error-type'] || dados.result)) || 'resposta inesperada');
      }
      const agora = new Date().toISOString();
      const ins = db.prepare('INSERT INTO int_cambio(moeda,taxa,base,atualizado_em) VALUES(?,?,?,?)');
      let guardados = 0;
      db.transaction(() => {
        db.prepare('DELETE FROM int_cambio').run();
        for (const [moeda, taxa] of Object.entries(dados.rates)) {
          const n = Number(taxa);
          if (!/^[A-Z]{3}$/.test(moeda) || !Number.isFinite(n) || n <= 0) continue;
          ins.run(moeda, n, b, agora);
          guardados++;
        }
      })();
      const fonteEm = dados.time_last_update_unix ? new Date(dados.time_last_update_unix * 1000).toISOString() : agora;
      gravarEstado(ID, { ultima_sync: agora, ultima_sync_n: guardados, base: b, fonte_em: fonteEm, ultimo_erro: '', ultimo_erro_em: '' });
      return { guardados, erros: [], mensagem: `Taxas de câmbio atualizadas: ${guardados} moedas, em relação a ${b}.` };
    } catch (e) {
      gravarEstado(ID, { ultimo_erro: e.message, ultimo_erro_em: new Date().toISOString() });
      throw e;
    } finally {
      aSincronizar = null;
    }
  })();
  return aSincronizar;
}

// Precisa de ir buscar? Nunca foi, passou um dia, ou a moeda base mudou.
function desatualizado() {
  const e = lerEstado(ID);
  return !e.ultima_sync || Date.now() - Date.parse(e.ultima_sync) > DIA_MS || e.base !== base();
}

let relogio = null;
function iniciar() {
  if (!ativo() || relogio) return;
  // Nos testes, só com um servidor falso (CAMBIO_API_URL): nunca vai à internet.
  if (process.env.NODE_ENV === 'test' && !process.env.CAMBIO_API_URL) return;
  const verificar = () => {
    if (!desatualizado()) return;
    sincronizar().catch((e) => console.error('[cambio] atualização falhou:', e.message));
  };
  setTimeout(verificar, 5000).unref();               // logo a seguir ao arranque
  relogio = setInterval(verificar, 60 * 60 * 1000);   // vê de hora a hora; vai buscar 1×/dia
  relogio.unref();
}
function parar() { clearInterval(relogio); relogio = null; }

// ---------------------------------------------------------------- Converter
// Taxa de "de" para "para" (1 de = taxa para), ou null se não houver uma das duas.
function taxa(de, para) {
  de = codigo(de); para = codigo(para);
  if (de === para) return 1;
  const linha = db.prepare('SELECT moeda, taxa FROM int_cambio WHERE moeda IN (?, ?)').all(de, para);
  const t = Object.fromEntries(linha.map((r) => [r.moeda, r.taxa]));
  if (!t[de] || !t[para]) return null;
  return t[para] / t[de];
}

// Converte um valor; devolve null se não houver taxas para essas moedas.
function converter(valor, de, para) {
  const t = taxa(de, para);
  const v = Number(valor);
  if (t === null || !Number.isFinite(v)) return null;
  return v * t;
}

function info() {
  const e = lerEstado(ID);
  return { base: e.base || base(), atualizado_em: e.ultima_sync || null, fonte_em: e.fonte_em || null };
}

function listar() {
  return db.prepare('SELECT moeda, taxa FROM int_cambio ORDER BY moeda').all();
}

// ---------------------------------------------------------------- Painel
const MOSTRAR = ['EUR', 'USD', 'GBP', 'BRL', 'AOA', 'XOF', 'CHF'];
const fmt = (n) => Number(n).toLocaleString('pt-PT', { maximumSignificantDigits: 6 });

function estado() {
  const e = lerEstado(ID);
  const b = e.base || base();
  const exemplos = MOSTRAR.filter((m) => m !== b)
    .map((m) => { const t = taxa(m, b); return t === null ? null : `1 ${m} = ${fmt(t)} ${b}`; })
    .filter(Boolean);
  return {
    id: ID,
    nome: 'Taxas de câmbio',
    ativo: ativo(),
    sincronizavel: ativo(),
    conversor: ativo() && !!e.ultima_sync,
    detalhes: [
      ['Fonte', 'ExchangeRate-API (open.er-api.com), gratuita e sem chave'],
      ['Atualização', ativo() ? 'automática, uma vez por dia' : 'desligada (CAMBIO=off)'],
      ['Moeda base', `${b} (a moeda das Definições)`],
      ['Última atualização', e.ultima_sync ? `${e.ultima_sync} (${e.ultima_sync_n} moedas)` : '—'],
      ['Taxas atuais', exemplos.length ? exemplos.join(' · ') : '—'],
      ['Último erro', e.ultimo_erro ? `${e.ultimo_erro_em}: ${e.ultimo_erro}` : '—'],
    ],
  };
}

module.exports = { id: ID, estado, sincronizar, iniciar, parar, ativo, taxa, converter, info, listar };
