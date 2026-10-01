'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const TZ = process.env.TIMEZONE || 'Atlantic/Cape_Verde';

// Data e hora atuais no fuso horário do estúdio (não do servidor).
function nowLocal() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: parseInt(g('hour'), 10) * 60 + parseInt(g('minute'), 10),
  };
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(s) {
  return new Date(s + 'T00:00:00Z').getUTCDay(); // 0 = domingo
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// "09:30" -> 570. Aceita "24:00" (fim do dia). Devolve null se inválido.
function parseHM(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return null;
  return h * 60 + mi;
}

function fmtHM(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function digits(s) {
  return String(s || '').replace(/\D/g, '');
}

// Texto limpo com tamanho máximo. Devolve '' se não for string.
function clean(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function toInt(v, def = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : def;
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

module.exports = {
  HttpError, TZ, nowLocal, isValidDate, addDays, weekday, daysBetween,
  parseHM, fmtHM, digits, clean, toInt, isEmail,
};
