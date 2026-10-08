'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { parseHM, weekday } = require('./util');
const TR = require('./traducoes');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(DATA_DIR, 'estudio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Contas de cliente: quem marca no site. Ficam à parte da equipa (users): um
-- cliente nunca toca no painel e a equipa não se mistura na lista de clientes.
-- O login pode ser pelo email ou pelo telefone, por isso ambos são únicos. O
-- telefone guarda-se só com dígitos (phone), para a procura e a unicidade não
-- dependerem de espaços nem do indicativo escrito de formas diferentes.
CREATE TABLE IF NOT EXISTS clients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_sessions (
  token_hash TEXT PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Códigos de verificação e de recuperação de palavra-passe. Guarda-se o resumo
-- (hash), nunca o código à vista. Validade curta e tentativas limitadas: um
-- código de 6 dígitos só é seguro se não se puder adivinhar à vontade.
CREATE TABLE IF NOT EXISTS client_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('reset','verify')),
  channel    TEXT NOT NULL CHECK (channel IN ('email','sms')),
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_codes_client ON client_codes(client_id, purpose);

-- Controlo de acesso (RBAC) do painel: perfis (roles), permissões e a atribuição
-- de perfis a utilizadores da equipa. É gerível na secção "Gestão de acesso".
CREATE TABLE IF NOT EXISTS rbac_permissions (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  label    TEXT NOT NULL,
  resource TEXT NOT NULL,
  action   TEXT NOT NULL,
  UNIQUE(resource, action)
);
CREATE TABLE IF NOT EXISTS rbac_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  priority    INTEGER NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rbac_role_permissions (
  role_id       INTEGER NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES rbac_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS rbac_assignments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS studios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  city        TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  hours       TEXT NOT NULL,
  -- Coordenadas do estúdio, para o globo do formulário de marcação.
  lat         REAL,
  lon         REAL,
  -- Nome, cidade e descrição noutras línguas (ver lib/traducoes.js).
  traducoes   TEXT NOT NULL DEFAULT '{}',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  studio_id   INTEGER NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  traducoes   TEXT NOT NULL DEFAULT '{}',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- 1 = o trabalho pode ser feito sem o cliente vir ao estúdio (mistura, masterização)
  remote_ok   INTEGER NOT NULL DEFAULT 0,
  traducoes   TEXT NOT NULL DEFAULT '{}',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  room_id        INTEGER NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
  service_id     INTEGER REFERENCES services(id) ON DELETE SET NULL,
  title          TEXT NOT NULL DEFAULT '',
  date           TEXT NOT NULL,
  start_min      INTEGER NOT NULL,
  end_min        INTEGER NOT NULL,
  client_name    TEXT NOT NULL,
  client_phone   TEXT NOT NULL DEFAULT '',
  client_email   TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pedido'
                 CHECK (status IN ('pedido','confirmado','em_curso','concluido','cancelado')),
  -- 1 = o cliente não vai ao estúdio; manda os ficheiros
  remote         INTEGER NOT NULL DEFAULT 0,
  price          INTEGER NOT NULL DEFAULT 0,
  paid           INTEGER NOT NULL DEFAULT 0,
  source         TEXT NOT NULL DEFAULT 'site',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS idx_bookings_room_date ON bookings(room_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS blocks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id   INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  date      TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min   INTEGER NOT NULL,
  reason    TEXT NOT NULL DEFAULT '',
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS idx_blocks_room_date ON blocks(room_id, date);
`);

// Colunas acrescentadas depois da primeira versão. CREATE TABLE IF NOT EXISTS não
// toca numa tabela que já exista, por isso as bases antigas precisam deste passo.
function acrescentaColuna(tabela, coluna, ddl) {
  const tem = db.prepare(`PRAGMA table_info(${tabela})`).all().some((c) => c.name === coluna);
  if (!tem) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${ddl}`);
}
acrescentaColuna('services', 'remote_ok', 'INTEGER NOT NULL DEFAULT 0');
acrescentaColuna('bookings', 'remote', 'INTEGER NOT NULL DEFAULT 0');
acrescentaColuna('bookings', 'style', "TEXT NOT NULL DEFAULT ''");
// Onde fica cada estúdio, para o globo do formulário saber para onde voar.
// Vazio (null) quando não se sabe: aí o globo fica parado, sem marcador.
acrescentaColuna('studios', 'lat', 'REAL');
acrescentaColuna('studios', 'lon', 'REAL');
// O que o dono escreve noutras línguas (nome, descrição...). Ver lib/traducoes.js.
for (const tabela of ['studios', 'rooms', 'services']) acrescentaColuna(tabela, 'traducoes', "TEXT NOT NULL DEFAULT '{}'");
// Agentes de estúdio: um utilizador da equipa pode ficar preso a um estúdio
// (o seu). Nesse caso só vê e gere as marcações, o calendário, os bloqueios e
// os clientes desse estúdio. Vazio (null) = vê tudo (proprietário ou equipa
// sem estúdio atribuído). ON DELETE SET NULL: se o estúdio for eliminado, o
// agente deixa de estar preso — não se perde a conta.
acrescentaColuna('users', 'studio_id', 'INTEGER REFERENCES studios(id) ON DELETE SET NULL');
// Conta de cliente que fez a marcação. Vazio (null) nas marcações antigas,
// feitas antes de haver contas, e nas criadas pela equipa no painel. ON DELETE
// SET NULL: apagar a conta não apaga o histórico de marcações do estúdio.
acrescentaColuna('bookings', 'client_id', 'INTEGER REFERENCES clients(id) ON DELETE SET NULL');

// As bases criadas antes de haver coordenadas ficaram com os estúdios de
// exemplo por preencher. Dá-se-lhes a cidade e o ponto no mapa — mas só
// quando ainda estão tal e qual como saíram do molde ("Cidade A", sem
// coordenadas): num estúdio a sério, o que o dono escreveu nunca se toca.
for (const [cidadeDemo, cidade, lat, lon] of [
  ['Cidade A', 'Paris, França', 48.8566, 2.3522],
  ['Cidade B', 'Assomada, Cabo Verde', 15.1, -23.6833],
]) {
  db.prepare(
    `UPDATE studios SET city=?, lat=?, lon=?, address=''
      WHERE city=? AND lat IS NULL AND lon IS NULL AND address IN ('', 'Morada a definir')`
  ).run(cidade, lat, lon, cidadeDemo);
}

// Os textos dos estúdios, salas e serviços de exemplo, já em inglês e francês,
// para o site de exemplo não aparecer meio em português noutra língua. Só se
// aplicam a um campo que ainda esteja tal e qual saiu do molde e a uma linha
// sem traduções nenhumas: o que o dono escreveu nunca se toca.
const TEXTOS_EXEMPLO = {
  'Estúdio Central': { en: 'Central Studio', fr: 'Studio Central' },
  'Estúdio Norte': { en: 'North Studio', fr: 'Studio Nord' },
  'Paris, França': { en: 'Paris, France', fr: 'Paris, France' },
  'Assomada, Cabo Verde': { en: 'Assomada, Cape Verde', fr: 'Assomada, Cap-Vert' },
  'Estúdio principal, com sala de gravação e cabine de voz.': {
    en: 'Main studio, with a recording room and a vocal booth.',
    fr: 'Studio principal, avec une salle d’enregistrement et une cabine voix.',
  },
  'Segundo estúdio, para produção e mistura.': {
    en: 'Second studio, for production and mixing.', fr: 'Deuxième studio, pour la production et le mixage.',
  },
  'Sala de gravação': { en: 'Recording room', fr: 'Salle d’enregistrement' },
  'Sala grande para bandas e gravação de instrumentos.': {
    en: 'Large room for bands and recording instruments.', fr: 'Grande salle pour les groupes et l’enregistrement d’instruments.',
  },
  'Cabine de voz': { en: 'Vocal booth', fr: 'Cabine voix' },
  'Cabine tratada para voz e locução.': {
    en: 'Acoustically treated booth for vocals and voice-over.', fr: 'Cabine traitée pour la voix et la voix off.',
  },
  'Sala de produção': { en: 'Production room', fr: 'Salle de production' },
  'Produção, mistura e masterização.': { en: 'Production, mixing and mastering.', fr: 'Production, mixage et mastering.' },
  'Gravação': { en: 'Recording', fr: 'Enregistrement' },
  'Sessão de gravação de voz ou instrumentos, com técnico.': {
    en: 'Vocal or instrument recording session, with an engineer.', fr: 'Séance d’enregistrement voix ou instruments, avec un ingénieur du son.',
  },
  'Mistura': { en: 'Mixing', fr: 'Mixage' },
  'Mistura das faixas gravadas.': { en: 'Mixing of the recorded tracks.', fr: 'Mixage des pistes enregistrées.' },
  'Masterização': { en: 'Mastering', fr: 'Mastering' },
  'Acabamento final para edição e streaming.': {
    en: 'Final polish for release and streaming.', fr: 'Finition pour la sortie et le streaming.',
  },
  'Produção': { en: 'Production', fr: 'Production' },
  'Criação e arranjo de instrumentais.': { en: 'Creating and arranging instrumentals.', fr: 'Création et arrangement d’instrumentales.' },
  'Ensaio': { en: 'Rehearsal', fr: 'Répétition' },
  'Aluguer da sala para ensaio, sem técnico.': {
    en: 'Room hire for rehearsals, without an engineer.', fr: 'Location de salle pour répéter, sans ingénieur du son.',
  },
  'Gravação, mistura e produção musical': {
    en: 'Music recording, mixing and production', fr: 'Enregistrement, mixage et production musicale',
  },
  'O pedido fica pendente até ser confirmado pelo estúdio. Receberá a confirmação por telefone ou WhatsApp.': {
    en: 'Your request stays pending until the studio confirms it. You will get the confirmation by phone or WhatsApp.',
    fr: 'Votre demande reste en attente jusqu’à sa confirmation par le studio. Vous recevrez la confirmation par téléphone ou WhatsApp.',
  },
};

// As traduções de exemplo para os campos de uma linha, ou {} se nenhum campo
// for texto de exemplo.
function traducoesExemplo(linha, campos) {
  const out = {};
  for (const campo of Object.keys(campos)) {
    const t = TEXTOS_EXEMPLO[linha[campo]];
    if (!t) continue;
    for (const lingua of TR.OUTRAS) if (t[lingua]) (out[lingua] = out[lingua] || {})[campo] = t[lingua];
  }
  return out;
}

function traduzExemplos() {
  for (const tabela of ['studios', 'rooms', 'services']) {
    const campos = TR.CAMPOS[tabela];
    const up = db.prepare(`UPDATE ${tabela} SET traducoes=? WHERE id=?`);
    for (const linha of db.prepare(`SELECT * FROM ${tabela} WHERE traducoes='{}'`).all()) {
      const tr = traducoesExemplo(linha, campos);
      if (Object.keys(tr).length) up.run(JSON.stringify(tr), linha.id);
    }
  }
}
traduzExemplos();

// ---------------------------------------------------------------- Definições

const DEFAULT_SETTINGS = {
  business_name: 'Suavita Records',
  tagline: 'Gravação, mistura e produção musical',
  phone: '',
  whatsapp: '',
  email: '',
  instagram: '',
  spotify: '',
  youtube: '',
  currency: 'CVE',
  country_code: '238',
  slot_minutes: '60',
  min_minutes: '60',
  max_minutes: '480',
  lead_hours: '12',
  max_advance_days: '90',
  auto_confirm: '0',
  terms: 'O pedido fica pendente até ser confirmado pelo estúdio. Receberá a confirmação por telefone ou WhatsApp.',
  // A frase de apresentação e o texto antes de enviar, noutras línguas (JSON).
  traducoes: '',
};

const INT_SETTINGS = ['slot_minutes', 'min_minutes', 'max_minutes', 'lead_hours', 'max_advance_days'];

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) {
    if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  }
  for (const k of INT_SETTINGS) out[k] = parseInt(out[k], 10) || parseInt(DEFAULT_SETTINGS[k], 10);
  out.auto_confirm = out.auto_confirm === '1' || out.auto_confirm === 1;
  // Enquanto o dono não guardar traduções, a frase e o texto que ainda forem
  // os de origem levam as suas traduções de exemplo.
  out.traducoes = out.traducoes ? TR.ler(out.traducoes) : traducoesExemplo(out, TR.CAMPOS.settings);
  return out;
}

function saveSettings(obj) {
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      up.run(k, typeof v === 'boolean' ? (v ? '1' : '0') : v && typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
  })();
}

// ---------------------------------------------------------------- Horários

// 7 posições (0 = domingo). null = fechado.
const DEFAULT_HOURS = [
  null,
  { open: '09:00', close: '21:00' },
  { open: '09:00', close: '21:00' },
  { open: '09:00', close: '21:00' },
  { open: '09:00', close: '21:00' },
  { open: '09:00', close: '21:00' },
  { open: '10:00', close: '20:00' },
];

function parseHours(json) {
  try {
    const a = JSON.parse(json);
    if (Array.isArray(a) && a.length === 7) return a;
  } catch (_) { /* usa o padrão */ }
  return DEFAULT_HOURS;
}

// {open, close} em minutos para uma data, ou null se fechado.
function hoursFor(studio, date) {
  const h = parseHours(studio.hours)[weekday(date)];
  if (!h) return null;
  const open = parseHM(h.open), close = parseHM(h.close);
  if (open == null || close == null || close <= open) return null;
  return { open, close };
}

// ---------------------------------------------------------------- Marcações

// Verifica se já existe marcação ativa ou bloqueio sobreposto nessa sala.
function findConflict(roomId, date, start, end, excludeBookingId = 0) {
  const b = db.prepare(
    `SELECT id, code FROM bookings
      WHERE room_id=? AND date=? AND status!='cancelado'
        AND start_min<? AND end_min>? AND id!=? LIMIT 1`
  ).get(roomId, date, end, start, excludeBookingId);
  if (b) return { type: 'booking', ...b };
  const k = db.prepare(
    `SELECT id, reason FROM blocks
      WHERE room_id=? AND date=? AND start_min<? AND end_min>? LIMIT 1`
  ).get(roomId, date, end, start);
  if (k) return { type: 'block', ...k };
  return null;
}

// Intervalos ocupados (marcações ativas + bloqueios) de uma sala num dia.
function busyIntervals(roomId, date) {
  const a = db.prepare(
    `SELECT start_min AS s, end_min AS e FROM bookings
      WHERE room_id=? AND date=? AND status!='cancelado'`
  ).all(roomId, date);
  const b = db.prepare('SELECT start_min AS s, end_min AS e FROM blocks WHERE room_id=? AND date=?').all(roomId, date);
  return [...a, ...b].sort((x, y) => x.s - y.s);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let tries = 0; tries < 20; tries++) {
    let c = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if (!db.prepare('SELECT 1 FROM bookings WHERE code=?').get(c)) return c;
  }
  throw new Error('Não foi possível gerar um código único');
}

const BOOKING_SELECT = `
  SELECT b.*, r.name AS room_name, r.studio_id, s.name AS studio_name, sv.name AS service_name,
         r.traducoes AS room_tr, s.traducoes AS studio_tr, sv.traducoes AS service_tr
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    JOIN studios s ON s.id = r.studio_id
    LEFT JOIN services sv ON sv.id = b.service_id`;

function priceFor(room, start, end) {
  return Math.round((room.hourly_rate * (end - start)) / 60);
}

// ---------------------------------------------------------------- Dados iniciais

function seedIfEmpty() {
  const seeded = db.prepare("SELECT value FROM settings WHERE key='seeded'").get();
  if (seeded) return;
  const anyStudio = db.prepare('SELECT 1 FROM studios LIMIT 1').get();
  if (!anyStudio && process.env.SEED_DEMO !== '0') {
    const hours = JSON.stringify(DEFAULT_HOURS);
    const st = db.prepare('INSERT INTO studios(name,city,address,phone,description,hours,lat,lon,sort) VALUES(?,?,?,?,?,?,?,?,?)');
    const rm = db.prepare('INSERT INTO rooms(studio_id,name,description,hourly_rate,sort) VALUES(?,?,?,?,?)');
    const a = st.run('Estúdio Central', 'Paris, França', '', '', 'Estúdio principal, com sala de gravação e cabine de voz.', hours, 48.8566, 2.3522, 1).lastInsertRowid;
    rm.run(a, 'Sala de gravação', 'Sala grande para bandas e gravação de instrumentos.', 2500, 1);
    rm.run(a, 'Cabine de voz', 'Cabine tratada para voz e locução.', 1500, 2);
    const b = st.run('Estúdio Norte', 'Assomada, Cabo Verde', '', '', 'Segundo estúdio, para produção e mistura.', hours, 15.1000, -23.6833, 2).lastInsertRowid;
    rm.run(b, 'Sala de produção', 'Produção, mistura e masterização.', 2000, 1);
    const sv = db.prepare('INSERT INTO services(name,description,remote_ok,sort) VALUES(?,?,?,?)');
    sv.run('Gravação', 'Sessão de gravação de voz ou instrumentos, com técnico.', 0, 1);
    sv.run('Mistura', 'Mistura das faixas gravadas.', 1, 2);
    sv.run('Masterização', 'Acabamento final para edição e streaming.', 1, 3);
    sv.run('Produção', 'Criação e arranjo de instrumentais.', 1, 4);
    sv.run('Ensaio', 'Aluguer da sala para ensaio, sem técnico.', 0, 5);
    traduzExemplos();
  }
  saveSettings({});
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('seeded','1')").run();
}
seedIfEmpty();

// ---------------------------------------------------------------- RBAC
// Perfis e permissões iniciais, que retratam o modelo do painel. Depois são
// geríveis em "Gestão de acesso" (criar/editar/atribuir).
function seedRbac() {
  if (db.prepare('SELECT 1 FROM rbac_roles LIMIT 1').get()) return;
  const PERMS = [
    ['Marcações – Ver', 'marcacoes', 'ver'],
    ['Marcações – Gerir', 'marcacoes', 'gerir'],
    ['Marcações – Cancelar', 'marcacoes', 'cancelar'],
    ['Calendário – Gerir', 'calendario', 'gerir'],
    ['Clientes – Ver', 'clientes', 'ver'],
    ['Painel – Ver', 'painel', 'ver'],
    ['Relatórios – Ver', 'relatorios', 'ver'],
    ['Estúdios – Gerir', 'estudios', 'gerir'],
    ['Serviços – Gerir', 'servicos', 'gerir'],
    ['Definições – Gerir', 'definicoes', 'gerir'],
    ['Música – Gerir', 'musica', 'gerir'],
    ['Projetos – Gerir', 'projetos', 'gerir'],
    ['Integrações – Gerir', 'integracoes', 'gerir'],
    ['Utilizadores – Gerir', 'utilizadores', 'gerir'],
    ['Acesso – Gerir', 'acesso', 'gerir'],
  ];
  db.transaction(() => {
    const insP = db.prepare('INSERT INTO rbac_permissions(label,resource,action) VALUES(?,?,?)');
    const pid = {};
    for (const [l, r, a] of PERMS) pid[r + '.' + a] = insP.run(l, r, a).lastInsertRowid;
    const insR = db.prepare('INSERT INTO rbac_roles(name,code,description,priority,category,is_system) VALUES(?,?,?,?,?,?)');
    const insRP = db.prepare('INSERT OR IGNORE INTO rbac_role_permissions(role_id,permission_id) VALUES(?,?)');
    const todas = Object.keys(pid);
    const criar = (name, code, desc, prio, cat, sys, perms) => {
      const id = insR.run(name, code, desc, prio, cat, sys).lastInsertRowid;
      for (const k of perms) if (pid[k]) insRP.run(id, pid[k]);
    };
    criar('Proprietário', 'proprietario', 'Acesso total ao sistema.', 100, 'system', 1, todas);
    criar('Gestor', 'gestor', 'Gere marcações, clientes, estúdios, serviços, conteúdo e definições.', 60, 'gestao', 0,
      todas.filter((k) => k !== 'utilizadores.gerir' && k !== 'acesso.gerir'));
    criar('Agente de estúdio', 'agente', 'Vê e gere apenas o seu estúdio.', 40, 'operacao', 0,
      ['marcacoes.ver', 'marcacoes.gerir', 'marcacoes.cancelar', 'calendario.gerir', 'clientes.ver', 'painel.ver', 'relatorios.ver']);
  })();
}
seedRbac();

// Garante que cada proprietário tem o perfil "Proprietário". Corre no arranque,
// já com o primeiro utilizador criado.
function ensureRbacOwners() {
  const role = db.prepare("SELECT id FROM rbac_roles WHERE code='proprietario'").get();
  if (!role) return;
  const ins = db.prepare('INSERT OR IGNORE INTO rbac_assignments(user_id,role_id,created_at) VALUES(?,?,?)');
  const now = new Date().toISOString();
  for (const o of db.prepare("SELECT id FROM users WHERE role='owner'").all()) ins.run(o.id, role.id, now);
}

module.exports = {
  db, getSettings, saveSettings, DEFAULT_HOURS, parseHours, hoursFor,
  findConflict, busyIntervals, newCode, BOOKING_SELECT, priceFor, ensureRbacOwners,
};
