'use strict';

// Registo da atividade da equipa no painel: entradas, saídas, alterações e
// erros. Cada pessoa vê o seu na secção "Atividade" do perfil.

const { db } = require('./db');

const GUARDAR_DIAS = 180;

function registar(userId, kind, action, { detail = '', status = null, ip = '' } = {}) {
  db.prepare('INSERT INTO user_activity(user_id,kind,action,detail,status,ip,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(userId, kind, String(action).slice(0, 200), String(detail).slice(0, 300), status, String(ip || '').slice(0, 64), new Date().toISOString());
}

// O que cada pedaço do endereço quer dizer, para a lista ler-se em português
// ("Alterou uma marcação") em vez de "PUT /api/admin/bookings/12".
const RECURSOS = {
  bookings: 'uma marcação', blocks: 'um bloqueio de horário', studios: 'um estúdio', rooms: 'uma sala',
  services: 'um serviço', settings: 'as definições', users: 'um utilizador', geocode: 'a localização de um estúdio',
  permissions: 'uma permissão', roles: 'um papel', assignments: 'uma atribuição de papel',
  musica: 'uma música', projetos: 'um projeto', lancamentos: 'um lançamento', inscricoes: 'uma inscrição',
  definicoes: 'as definições das integrações',
};
// [feito, falhado]: "Criou um estúdio" / "Falhou ao criar um estúdio".
const VERBOS = {
  POST: ['Criou', 'criar'], PUT: ['Alterou', 'alterar'], PATCH: ['Alterou', 'alterar'], DELETE: ['Eliminou', 'eliminar'],
  sincronizar: ['Sincronizou', 'sincronizar'], status: ['Mudou', 'mudar'], geocode: ['Procurou', 'procurar'],
};

function descrever(method, path, falhou = false) {
  const partes = path.split('?')[0].split('/').filter(Boolean).filter((p) => !/^\d+$/.test(p));
  const ultima = partes[partes.length - 1];
  let verbo = VERBOS[method] || [method, method];
  let alvo;
  if (partes.includes('sincronizar')) { verbo = VERBOS.sincronizar; alvo = 'uma integração'; }
  else if (ultima === 'status') { verbo = VERBOS.status; alvo = 'o estado de uma marcação'; }
  else if (ultima === 'geocode') { verbo = VERBOS.geocode; alvo = 'a localização de um estúdio'; }
  else {
    const recurso = [...partes].reverse().find((p) => RECURSOS[p]);
    alvo = recurso ? RECURSOS[recurso] : 'dados do painel';
  }
  return falhou ? `Falhou ao ${verbo[1]} ${alvo}` : `${verbo[0]} ${alvo}`;
}

// Middleware para /api/admin: regista cada pedido que altera dados, com o
// resultado (código HTTP) e quanto tempo demorou. As leituras não entram.
function middleware(req, res, next) {
  if (!req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Abrir o sininho não é uma alteração.
  if (req.path === '/notificacoes/vistas') return next();
  const t0 = Date.now();
  const caminho = req.originalUrl.split('?')[0];
  res.on('finish', () => {
    try {
      const status = res.statusCode;
      registar(req.user.id, status >= 400 ? 'error' : 'change', descrever(req.method, caminho, status >= 400), {
        detail: `${req.method} ${caminho} · ${Date.now() - t0} ms`, status, ip: req.ip,
      });
    } catch (e) { console.error('atividade:', e.message); }
  });
  next();
}

function limpar() {
  const limite = new Date(Date.now() - GUARDAR_DIAS * 86400000).toISOString();
  db.prepare('DELETE FROM user_activity WHERE created_at < ?').run(limite);
}

module.exports = { registar, middleware, limpar, descrever };
