'use strict';
// ---------------------------------------------------------------------------
// YouTube: views dos vídeos, para manter os números dos cartões atualizados.
//
// De tantos em tantos minutos vamos à YouTube Data API buscar o viewCount de
// cada vídeo da lista em youtube-musicas.js e guardamo-lo como "plays" de um
// lançamento (fonte 'youtube'). No site, esse número junta-se ao cartão com o
// mesmo link e o cartão mostra o MAIOR entre o escrito à mão e as views do
// YouTube (ver publico/assets/js/home.js).
//
// Ao contrário do Spotify, as views do YouTube são públicas: basta uma chave
// da API (YOUTUBE_API_KEY). Sem ela, a integração fica desligada e o site
// mostra os números escritos à mão, como antes.
//
//   YOUTUBE_API_KEY        Liga a integração. Chave da YouTube Data API v3.
//   YOUTUBE_INTERVALO_MIN  De quantos em quantos minutos (60 por omissão, mín. 15).
//   YOUTUBE_NOME           Nome mostrado no painel.
//   YOUTUBE_API_URL        Só para testes (por omissão a API oficial do Google).
// ---------------------------------------------------------------------------
const { db, gravarEstado, lerEstado } = require('../lib/base');
const { pedirJson } = require('../lib/http');

// A lista vem de youtube-musicas.js. YOUTUBE_MUSICAS_FILE serve para os testes
// apontarem a uma lista própria (como DB_FILE ou STRIPE_API_URL); em produção
// fica por definir e usa-se a lista ao lado.
let MUSICAS = [];
try { MUSICAS = require(process.env.YOUTUBE_MUSICAS_FILE || './youtube-musicas'); } catch (_) { MUSICAS = []; }

const ID = 'youtube';
const nome = () => process.env.YOUTUBE_NOME || 'YouTube (views)';
const apiUrl = () => (process.env.YOUTUBE_API_URL || 'https://www.googleapis.com/youtube/v3').replace(/\/$/, '');
const ativo = () => !!process.env.YOUTUBE_API_KEY;
const intervalo = () => Math.max(15, Number(process.env.YOUTUBE_INTERVALO_MIN) || 60);

class ErroDados extends Error {
  constructor(m) { super(m); this.status = 400; }
}

// O código de 11 letras de um vídeo, a partir de um link em qualquer das
// formas usuais, ou de um texto que já seja só o código.
function videoId(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/|v\/))([\w-]{11})/);
  return m ? m[1] : '';
}

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : '');
const eUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 1000;

// A lista de youtube-musicas.js arrumada: só as que já têm um vídeo válido.
function faixas() {
  const out = [];
  for (const m of Array.isArray(MUSICAS) ? MUSICAS : []) {
    const vid = videoId(m && m.youtube);
    if (!vid) continue;   // ainda sem link do YouTube: fica à espera
    out.push({
      videoId: vid,
      externo_id: texto(String((m && m.id) || vid), 200),
      titulo: texto(m && m.titulo, 160) || vid,
      artista: texto(m && m.artista, 200),
      link: eUrl(m && m.link) ? m.link : 'https://youtu.be/' + vid,
      data: texto(m && m.data, 16),
    });
  }
  return out;
}

// Pede as views à YouTube Data API, em lotes de 50 (o máximo por pedido).
// Devolve { <videoId>: views }. Um vídeo privado ou apagado não vem na lista.
async function verViews(ids) {
  const views = {};
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const url = `${apiUrl()}/videos?part=statistics&id=${lote.join(',')}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`;
    const dados = await pedirJson(url, { headers: { Accept: 'application/json' } });
    for (const it of (dados && dados.items) || []) {
      const n = Number(it && it.statistics && it.statistics.viewCount);
      if (Number.isFinite(n) && n >= 0) views[it.id] = Math.round(n);
    }
  }
  return views;
}

// Grava (ou atualiza) o lançamento desta faixa. Sem views (plays null) a linha
// fica à mesma, para guardar o título e o link, mas não conta como sucesso.
function guardar(f, plays) {
  const agora = new Date().toISOString();
  const atual = db.prepare('SELECT * FROM int_lancamentos WHERE fonte=? AND externo_id=?').get(ID, f.externo_id);
  if (!atual) {
    db.prepare(`INSERT INTO int_lancamentos(fonte,externo_id,titulo,artista,texto,capa,capa_origem,link,data,formato,plays,plays_em,criado_em,atualizado_em)
                VALUES(?,?,?,?,'','','',?,?,'',?,?,?,?)`)
      .run(ID, f.externo_id, f.titulo, f.artista, f.link, f.data,
        plays === null ? null : plays, plays === null ? null : agora, agora, agora);
  } else {
    db.prepare(`UPDATE int_lancamentos SET titulo=?, artista=?, link=?, data=?, plays=?, plays_em=?, removido=0, atualizado_em=? WHERE id=?`)
      .run(f.titulo, f.artista, f.link, f.data,
        plays === null ? atual.plays : plays, plays === null ? atual.plays_em : agora, agora, atual.id);
  }
}

// Uma música tirada da lista deixa de aparecer no site (fica no histórico).
function reconciliar(externos) {
  const atuais = new Set(externos);
  const agora = new Date().toISOString();
  for (const r of db.prepare('SELECT id, externo_id FROM int_lancamentos WHERE fonte=? AND removido=0').all(ID)) {
    if (!atuais.has(r.externo_id)) db.prepare('UPDATE int_lancamentos SET removido=1, atualizado_em=? WHERE id=?').run(agora, r.id);
  }
}

let aSincronizar = null;
async function sincronizar() {
  if (!ativo()) throw new ErroDados('YOUTUBE_API_KEY não está definido.');
  if (aSincronizar) return aSincronizar;   // dois cliques seguidos, um só pedido
  aSincronizar = (async () => {
    try {
      const lista = faixas();
      const views = lista.length ? await verViews(lista.map((f) => f.videoId)) : {};
      const erros = [];
      let guardados = 0;
      db.transaction(() => {
        for (const f of lista) {
          const v = views[f.videoId];
          if (v === undefined) { erros.push(`${f.titulo}: o YouTube não devolveu views (vídeo privado, apagado ou link errado?)`); guardar(f, null); }
          else { guardar(f, v); guardados++; }
        }
        reconciliar(lista.map((f) => f.externo_id));
      })();
      gravarEstado(ID, {
        ultima_sync: new Date().toISOString(), ultima_sync_n: guardados,
        ...(erros.length ? { ultimo_erro: erros.slice(0, 3).join(' · '), ultimo_erro_em: new Date().toISOString() }
          : { ultimo_erro: '', ultimo_erro_em: '' }),
      });
      return { recebidos: lista.length, guardados, erros };
    } catch (e) {
      gravarEstado(ID, { ultimo_erro: e.message, ultimo_erro_em: new Date().toISOString() });
      throw e;
    } finally {
      aSincronizar = null;
    }
  })();
  return aSincronizar;
}

let relogio = null;
function iniciar() {
  if (!ativo() || relogio) return;
  const correr = () => sincronizar().catch((e) => console.error('[youtube] sincronização falhou:', e.message));
  setTimeout(correr, 5000).unref();   // logo a seguir ao arranque, sem o atrasar
  relogio = setInterval(correr, intervalo() * 60 * 1000);
  relogio.unref();
}
function parar() { clearInterval(relogio); relogio = null; }

function estado() {
  const e = lerEstado(ID);
  const comVideo = faixas().length;
  const naLista = Array.isArray(MUSICAS) ? MUSICAS.length : 0;
  return {
    id: ID,
    nome: nome(),
    ativo: ativo(),
    sincronizavel: ativo(),
    detalhes: [
      ['Chave da API', ativo() ? 'definida' : 'em falta (YOUTUBE_API_KEY)'],
      ['Músicas com vídeo', `${comVideo} de ${naLista} na lista`],
      ['Ir buscar as views', ativo() ? `de ${intervalo()} em ${intervalo()} minutos` : 'desligado'],
      ['Última sincronização', e.ultima_sync ? `${e.ultima_sync} (${e.ultima_sync_n} músicas)` : '—'],
      ['Último erro', e.ultimo_erro ? `${e.ultimo_erro_em}: ${e.ultimo_erro}` : '—'],
    ],
  };
}

module.exports = { id: ID, estado, sincronizar, iniciar, parar, ativo, videoId };
