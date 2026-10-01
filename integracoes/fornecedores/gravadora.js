'use strict';
// ---------------------------------------------------------------------------
// Plataforma da gravadora: lançamentos e reproduções.
//
// Tudo o que a gravadora lança entra no site sozinho, como novidade; e o que
// passar do limite de reproduções (definido no painel) passa a "sucesso" e
// aparece em "Saíram deste estúdio".
//
// Dois caminhos, que podem estar os dois ligados:
//
//   1. A plataforma avisa-nos (webhook). POST /integracoes/webhooks/gravadora,
//      assinado com GRAVADORA_WEBHOOK_SECRET (ver lib/assinatura.js).
//   2. Nós vamos buscar (feed). GET GRAVADORA_FEED_URL de tantos em tantos
//      minutos (GRAVADORA_INTERVALO_MIN, 60 por omissão), com
//      "Authorization: Bearer GRAVADORA_TOKEN" se houver token.
//
// O formato de cada lançamento, nos dois caminhos, está no README desta pasta.
// Não depende de nenhuma plataforma em particular: é o contrato que a
// plataforma da gravadora (ou um pequeno script do lado dela) tem de cumprir.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, eventoNovo, gravarEstado, lerEstado, PASTA_CAPAS } = require('../lib/base');
const { verificar } = require('../lib/assinatura');
const { pedir, pedirJson } = require('../lib/http');

const ID = 'gravadora';
const nome = () => process.env.GRAVADORA_NOME || 'Plataforma da gravadora';

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max) : '');
const eUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s]+$/i.test(v) && v.length <= 1000;

class ErroDados extends Error {
  constructor(m) { super(m); this.status = 400; }
}

// Valida e arruma um lançamento vindo de fora. Só id e titulo são obrigatórios.
function normalizar(l) {
  if (!l || typeof l !== 'object') throw new ErroDados('Lançamento vazio.');
  const id = texto(String(l.id ?? ''), 200);
  const titulo = texto(l.titulo, 160);
  if (!id) throw new ErroDados('Lançamento sem id.');
  if (!titulo) throw new ErroDados(`Lançamento ${id} sem titulo.`);
  const artista = Array.isArray(l.artistas) ? l.artistas.map((a) => texto(a, 80)).filter(Boolean).join(', ') : texto(l.artista, 200);
  const data = texto(l.data, 16);
  if (data && !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(data)) throw new ErroDados(`Lançamento ${id}: data "${data}" não é AAAA-MM-DD.`);
  let plays = null;
  if (l.plays !== undefined && l.plays !== null) {
    plays = Math.round(Number(l.plays));
    if (!Number.isFinite(plays) || plays < 0) throw new ErroDados(`Lançamento ${id}: plays inválido.`);
  }
  return {
    externo_id: id, titulo, artista, data, plays,
    texto: texto(l.texto, 400),
    link: eUrl(l.link) ? l.link : '',
    capa_origem: eUrl(l.capa) ? l.capa : '',
    formato: l.formato === 'video' ? 'video' : '',
  };
}

// Grava (ou atualiza) um lançamento. Campos que não vieram ficam como estavam,
// para um aviso só de reproduções não apagar o resto.
function guardar(l) {
  const agora = new Date().toISOString();
  const atual = db.prepare('SELECT * FROM int_lancamentos WHERE fonte=? AND externo_id=?').get(ID, l.externo_id);
  if (!atual) {
    db.prepare(`INSERT INTO int_lancamentos(fonte,externo_id,titulo,artista,texto,capa_origem,link,data,formato,plays,plays_em,criado_em,atualizado_em)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ID, l.externo_id, l.titulo, l.artista, l.texto, l.capa_origem, l.link, l.data, l.formato,
        l.plays, l.plays === null ? null : agora, agora, agora);
  } else {
    const junto = (k) => (l[k] ? l[k] : atual[k]);
    db.prepare(`UPDATE int_lancamentos SET titulo=?, artista=?, texto=?, capa_origem=?, link=?, data=?, formato=?,
                plays=?, plays_em=?, removido=0, atualizado_em=? WHERE id=?`)
      .run(l.titulo, junto('artista'), junto('texto'), junto('capa_origem'), junto('link'), junto('data'), junto('formato'),
        l.plays === null ? atual.plays : l.plays, l.plays === null ? atual.plays_em : agora, agora, atual.id);
  }
  return db.prepare('SELECT * FROM int_lancamentos WHERE fonte=? AND externo_id=?').get(ID, l.externo_id);
}

function atualizarPlays(id, plays) {
  const n = Math.round(Number(plays));
  if (!Number.isFinite(n) || n < 0) throw new ErroDados(`Lançamento ${id}: plays inválido.`);
  const agora = new Date().toISOString();
  return db.prepare('UPDATE int_lancamentos SET plays=?, plays_em=?, atualizado_em=? WHERE fonte=? AND externo_id=?')
    .run(n, agora, agora, ID, String(id)).changes;
}

// ---------------------------------------------------------------- Capas
// A capa é copiada para o nosso disco: o site só mostra imagens servidas por
// ele próprio (a política de segurança não deixa carregar de outros sítios),
// e assim uma capa não desaparece se a plataforma mudar de endereço.
const TIPOS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_CAPA = 5 * 1024 * 1024;

async function trazerCapa(lanc) {
  if (!lanc.capa_origem) return;
  const nomeBase = ID + '-' + crypto.createHash('sha1').update(lanc.externo_id).digest('hex').slice(0, 16);
  // ?v= muda com a origem: serve para o browser não mostrar a capa antiga da
  // cache e para saber que esta já cá está e não é preciso descarregá-la.
  const v = crypto.createHash('sha1').update(lanc.capa_origem).digest('hex').slice(0, 8);
  const guardada = db.prepare('SELECT capa FROM int_lancamentos WHERE id=?').get(lanc.id);
  if (guardada && guardada.capa.endsWith('?v=' + v)
    && fs.existsSync(path.join(PASTA_CAPAS, path.basename(guardada.capa.split('?')[0])))) return;

  const res = await pedir(lanc.capa_origem, { prazoMs: 20000 });
  const tipo = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!res.ok || !TIPOS[tipo]) throw new Error(`capa de "${lanc.titulo}": resposta ${res.status} ${tipo}`);
  if (Number(res.headers.get('content-length')) > MAX_CAPA) throw new Error(`capa de "${lanc.titulo}" com mais de 5 MB`);
  const dados = Buffer.from(await res.arrayBuffer());
  if (dados.length > MAX_CAPA) throw new Error(`capa de "${lanc.titulo}" com mais de 5 MB`);
  const ficheiro = `${nomeBase}.${TIPOS[tipo]}`;
  fs.writeFileSync(path.join(PASTA_CAPAS, ficheiro), dados);
  db.prepare('UPDATE int_lancamentos SET capa=? WHERE id=?').run(`/capas-integracao/${ficheiro}?v=${v}`, lanc.id);
}

// As capas vêm depois de o pedido estar respondido: a plataforma não fica à
// espera de downloads, e uma capa que falhe não faz perder o lançamento.
function capasEmFundo(lancamentos) {
  (async () => {
    for (const l of lancamentos) {
      try { await trazerCapa(l); } catch (e) { gravarEstado(ID, { ultimo_erro: e.message, ultimo_erro_em: new Date().toISOString() }); }
    }
  })();
}

// ---------------------------------------------------------------- Webhook
// { id, tipo, dados }
//   lancamento.publicado / lancamento.atualizado   dados = um lançamento
//   lancamento.plays     dados = { id, plays } ou { plays: [{ id, plays }, ...] }
//   lancamento.removido  dados = { id }
function tratar(evento) {
  const d = evento.dados || {};
  switch (evento.tipo) {
    case 'lancamento.publicado':
    case 'lancamento.atualizado':
      return { lancamentos: [guardar(normalizar(d))] };
    case 'lancamento.plays': {
      const lista = Array.isArray(d.plays) ? d.plays : [d];
      let n = 0;
      for (const p of lista) n += atualizarPlays(texto(String(p.id ?? ''), 200), p.plays);
      return { atualizados: n };
    }
    case 'lancamento.removido':
      return { removidos: db.prepare('UPDATE int_lancamentos SET removido=1, atualizado_em=? WHERE fonte=? AND externo_id=?')
        .run(new Date().toISOString(), ID, texto(String(d.id ?? ''), 200)).changes };
    default:
      throw new ErroDados(`Tipo de evento desconhecido: ${evento.tipo}`);
  }
}

function webhook(corpo, cabecalhos) {
  const segredo = process.env.GRAVADORA_WEBHOOK_SECRET;
  if (!segredo) { const e = new Error('Webhook da gravadora sem segredo configurado.'); e.status = 503; throw e; }
  if (!verificar(cabecalhos['x-gravadora-assinatura'], corpo, segredo)) {
    const e = new Error('Assinatura inválida.'); e.status = 400; throw e;
  }
  let evento;
  try { evento = JSON.parse(corpo.toString('utf8')); } catch (_) { throw new ErroDados('JSON inválido.'); }
  const r = db.transaction(() => (eventoNovo(ID, evento.id, evento.tipo) ? tratar(evento) : { repetido: true }))();
  gravarEstado(ID, { ultimo_evento: new Date().toISOString(), ultimo_tipo: evento.tipo });
  if (r.lancamentos) capasEmFundo(r.lancamentos);
  return { lancamentos: r.lancamentos ? r.lancamentos.length : 0, atualizados: r.atualizados, removidos: r.removidos, repetido: r.repetido };
}

// ---------------------------------------------------------------- Feed
let aSincronizar = null;

// Vai buscar a lista inteira e atualiza o que mudou. O que não vier na lista
// não é apagado: um feed paginado ou a meio de uma falha não pode esvaziar o site.
async function sincronizar() {
  if (!process.env.GRAVADORA_FEED_URL) throw new ErroDados('GRAVADORA_FEED_URL não está definido.');
  if (aSincronizar) return aSincronizar;   // dois cliques seguidos, um só pedido
  aSincronizar = (async () => {
    const headers = { Accept: 'application/json' };
    if (process.env.GRAVADORA_TOKEN) headers.Authorization = 'Bearer ' + process.env.GRAVADORA_TOKEN;
    try {
      const dados = await pedirJson(process.env.GRAVADORA_FEED_URL, { headers });
      const lista = Array.isArray(dados) ? dados : (dados && dados.lancamentos);
      if (!Array.isArray(lista)) throw new ErroDados('O feed não devolveu uma lista de lançamentos.');
      const erros = [];
      const guardados = db.transaction(() => lista.flatMap((l) => {
        try { return [guardar(normalizar(l))]; } catch (e) { erros.push(e.message); return []; }
      }))();
      gravarEstado(ID, {
        ultima_sync: new Date().toISOString(), ultima_sync_n: guardados.length,
        ...(erros.length ? { ultimo_erro: erros.slice(0, 3).join(' · '), ultimo_erro_em: new Date().toISOString() } : {}),
      });
      capasEmFundo(guardados);
      return { recebidos: lista.length, guardados: guardados.length, erros };
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
  if (!process.env.GRAVADORA_FEED_URL || relogio) return;
  const min = Math.max(5, Number(process.env.GRAVADORA_INTERVALO_MIN) || 60);
  const correr = () => sincronizar().catch((e) => console.error('[gravadora] sincronização falhou:', e.message));
  setTimeout(correr, 5000).unref();   // logo a seguir ao arranque, sem o atrasar
  relogio = setInterval(correr, min * 60 * 1000);
  relogio.unref();
}
function parar() { clearInterval(relogio); relogio = null; }

function estado() {
  const e = lerEstado(ID);
  const feed = process.env.GRAVADORA_FEED_URL;
  return {
    id: ID,
    nome: nome(),
    ativo: !!(feed || process.env.GRAVADORA_WEBHOOK_SECRET),
    sincronizavel: !!feed,
    detalhes: [
      ['Avisos da plataforma (webhook)', process.env.GRAVADORA_WEBHOOK_SECRET ? 'ligado' : 'desligado (GRAVADORA_WEBHOOK_SECRET)'],
      ['Ir buscar (feed)', feed ? `de ${Math.max(5, Number(process.env.GRAVADORA_INTERVALO_MIN) || 60)} em ${Math.max(5, Number(process.env.GRAVADORA_INTERVALO_MIN) || 60)} minutos` : 'desligado (GRAVADORA_FEED_URL)'],
      ['Última sincronização', e.ultima_sync ? `${e.ultima_sync} (${e.ultima_sync_n} lançamentos)` : '—'],
      ['Último aviso', e.ultimo_evento ? `${e.ultimo_evento} (${e.ultimo_tipo})` : '—'],
      ['Último erro', e.ultimo_erro ? `${e.ultimo_erro_em}: ${e.ultimo_erro}` : '—'],
    ],
  };
}

module.exports = { id: ID, estado, webhook, sincronizar, iniciar, parar, normalizar };
