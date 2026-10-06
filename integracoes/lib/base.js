'use strict';
// ---------------------------------------------------------------------------
// Tabelas e definições das integrações.
//
// Usa a mesma base de dados do site (um só ficheiro, um só disco), mas as
// tabelas são todas suas e começam por int_, para se ver logo o que é de quem.
// A única coisa que as integrações escrevem fora delas é o "Já pago" das
// marcações, quando entra um pagamento.
// ---------------------------------------------------------------------------
const path = require('path');
const fs = require('fs');
const { db } = require('../../backend/lib/db');

db.exec(`
CREATE TABLE IF NOT EXISTS int_definicoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Cada evento recebido por webhook fica aqui uma vez. Os fornecedores voltam a
-- mandar o mesmo evento quando não têm resposta a tempo; sem isto, um
-- pagamento repetido somava-se duas vezes ao "Já pago".
CREATE TABLE IF NOT EXISTS int_eventos (
  fornecedor  TEXT NOT NULL,
  evento_id   TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT '',
  recebido_em TEXT NOT NULL,
  PRIMARY KEY (fornecedor, evento_id)
);

CREATE TABLE IF NOT EXISTS int_pagamentos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  booking_code  TEXT NOT NULL,
  fornecedor    TEXT NOT NULL,
  externo_id    TEXT NOT NULL UNIQUE,
  -- Na unidade da moeda do site, como bookings.price (escudos, não centavos).
  valor         INTEGER NOT NULL,
  moeda         TEXT NOT NULL,
  estado        TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','pago','expirado')),
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_int_pagamentos_booking ON int_pagamentos(booking_id);

CREATE TABLE IF NOT EXISTS int_lancamentos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte         TEXT NOT NULL,
  externo_id    TEXT NOT NULL,
  titulo        TEXT NOT NULL,
  artista       TEXT NOT NULL DEFAULT '',
  texto         TEXT NOT NULL DEFAULT '',
  -- capa: o caminho da cópia local, servida pelo site; capa_origem: de onde veio.
  capa          TEXT NOT NULL DEFAULT '',
  capa_origem   TEXT NOT NULL DEFAULT '',
  link          TEXT NOT NULL DEFAULT '',
  data          TEXT NOT NULL DEFAULT '',
  formato       TEXT NOT NULL DEFAULT '',
  plays         INTEGER,
  plays_em      TEXT,
  -- visivel: o estúdio pode esconder um lançamento do site sem o apagar.
  -- removido: a plataforma deixou de o ter; fica no histórico.
  visivel       INTEGER NOT NULL DEFAULT 1,
  removido      INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (fonte, externo_id)
);

-- Projetos colaborativos e convocatórias: uma campanha para novos talentos,
-- um álbum coletivo, ou qualquer outra divulgação. Aparecem no site (visivel=1)
-- e, enquanto "aberto", o público pode manifestar interesse (int_inscricoes).
CREATE TABLE IF NOT EXISTS int_projetos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT NOT NULL DEFAULT 'outro' CHECK (tipo IN ('talentos','album','outro')),
  titulo        TEXT NOT NULL,
  resumo        TEXT NOT NULL DEFAULT '',
  descricao     TEXT NOT NULL DEFAULT '',
  -- capa: cópia local servida pelo site; capa_origem: de onde veio.
  capa          TEXT NOT NULL DEFAULT '',
  capa_origem   TEXT NOT NULL DEFAULT '',
  prazo         TEXT NOT NULL DEFAULT '',
  aberto        INTEGER NOT NULL DEFAULT 1,
  visivel       INTEGER NOT NULL DEFAULT 1,
  ordem         INTEGER NOT NULL DEFAULT 0,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

-- Quem, a partir do site, manifestou interesse num projeto.
CREATE TABLE IF NOT EXISTS int_inscricoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  projeto_id  INTEGER NOT NULL REFERENCES int_projetos(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  contacto    TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  mensagem    TEXT NOT NULL DEFAULT '',
  estado      TEXT NOT NULL DEFAULT 'novo' CHECK (estado IN ('novo','contactado','aceite','arquivado')),
  criado_em   TEXT NOT NULL,
  ip          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_int_inscricoes_projeto ON int_inscricoes(projeto_id);
`);

// ---------------------------------------------------------------- Definições
// O que o estúdio pode mudar no painel, em Integrações.
const DEFINICOES = {
  // A partir de quantas reproduções um lançamento passa a "sucesso" e entra
  // em "Saíram deste estúdio".
  sucesso_plays: 100000,
  // Durante quantos dias depois de sair um lançamento continua nas novidades.
  novidade_dias: 60,
  // Quantos lançamentos, no máximo, entram no carrossel de novidades.
  max_novidades: 8,
};
const LIMITES = {
  sucesso_plays: [1, 1e12],
  novidade_dias: [1, 3650],
  max_novidades: [1, 30],
};

function lerDefinicoes() {
  const out = { ...DEFINICOES };
  for (const r of db.prepare("SELECT chave, valor FROM int_definicoes WHERE chave NOT LIKE 'estado:%'").all()) {
    if (r.chave in DEFINICOES) out[r.chave] = Number(r.valor);
  }
  return out;
}

// Devolve o nome da primeira definição inválida, ou null se estiver tudo certo.
function gravarDefinicoes(obj) {
  const novas = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!(k in DEFINICOES)) continue;
    const n = Math.round(Number(v));
    const [min, max] = LIMITES[k];
    if (!Number.isFinite(n) || n < min || n > max) return k;
    novas[k] = n;
  }
  const up = db.prepare('INSERT INTO int_definicoes(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor');
  db.transaction(() => { for (const [k, v] of Object.entries(novas)) up.run(k, String(v)); })();
  return null;
}

// Estado de cada fornecedor (última sincronização, último erro), para o painel.
// Mesma tabela, com a chave a começar por "estado:".
function lerEstado(fornecedor) {
  const r = db.prepare('SELECT valor FROM int_definicoes WHERE chave=?').get('estado:' + fornecedor);
  try { return r ? JSON.parse(r.valor) : {}; } catch (_) { return {}; }
}
function gravarEstado(fornecedor, mudancas) {
  const novo = { ...lerEstado(fornecedor), ...mudancas };
  db.prepare('INSERT INTO int_definicoes(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor')
    .run('estado:' + fornecedor, JSON.stringify(novo));
  return novo;
}

// ---------------------------------------------------------------- Eventos
// true se o evento é novo (e fica registado); false se já tinha chegado antes.
// Chame-se dentro da mesma transação que trata o evento: se o tratamento
// falhar, o registo desfaz-se com ele e o fornecedor pode voltar a mandá-lo.
function eventoNovo(fornecedor, id, tipo) {
  if (!id) return true;   // sem identificador não há como reconhecer repetições
  return db.prepare('INSERT OR IGNORE INTO int_eventos(fornecedor,evento_id,tipo,recebido_em) VALUES(?,?,?,?)')
    .run(fornecedor, String(id).slice(0, 200), String(tipo || '').slice(0, 80), new Date().toISOString()).changes === 1;
}

// ---------------------------------------------------------------- Ficheiros
// Onde ficam as capas trazidas das plataformas: ao lado da base de dados,
// no disco persistente, e não dentro do código.
const PASTA_DADOS = process.env.DATA_DIR
  || (process.env.DB_FILE ? path.dirname(process.env.DB_FILE) : path.join(__dirname, '..', '..', 'backend', 'data'));
const PASTA_CAPAS = path.join(PASTA_DADOS, 'capas');
fs.mkdirSync(PASTA_CAPAS, { recursive: true });

module.exports = {
  db, DEFINICOES, lerDefinicoes, gravarDefinicoes, lerEstado, gravarEstado, eventoNovo, PASTA_CAPAS,
};
