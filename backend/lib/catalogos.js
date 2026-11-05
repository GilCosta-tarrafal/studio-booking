'use strict';

// Catálogos de Configurações: as listas que o dono pode mudar sem mexer no
// código (géneros musicais, tipos de projeto, tipos de cliente, métodos de
// pagamento e os estados das marcações). Cada item tem um código fixo (o que
// fica guardado nas marcações) e um nome (o que se vê).

const { db } = require('./db');

// Ordem = ordem no menu de Configurações. "sistema" = os itens vêm do código e
// estão protegidos (cadeado): só a descrição se edita.
const CATALOGOS = [
  {
    key: 'generos', titulo: 'Géneros musicais', desc: 'Os estilos que o estúdio produz. Aparecem ao criar uma marcação.',
    // Os ativos são os do formulário do site (/js/estilos.js é gerado daqui),
    // por esta ordem. Os inativos já têm batida em /js/som.js: é só ativá-los.
    campo: 'style', itens: [
      ['DRILL', 'Drill', ''], ['TRAP', 'Trap', ''], ['BOOM_BAP', 'Boom Bap', ''], ['RAP_HIP_HOP', 'Rap / Hip-Hop', ''],
      ['AFROBEATS', 'Afrobeats', ''], ['RNB', 'R&B', ''],
      ['KIZOMBA', 'Kizomba', '', 0], ['ZOUK', 'Zouk', '', 0], ['FUNANA', 'Funaná', '', 0], ['COLADEIRA', 'Coladeira', '', 0],
      ['MORNA', 'Morna', '', 0], ['BATUQUE', 'Batuque', '', 0], ['REGGAE_DANCEHALL', 'Reggae / Dancehall', '', 0],
      ['GOSPEL', 'Gospel', '', 0], ['POP', 'Pop', '', 0],
    ],
  },
  {
    key: 'tipos_projeto', titulo: 'Tipos de projeto', desc: 'O que se está a gravar: um single, um álbum, um jingle…',
    campo: 'project_type', itens: [
      ['SINGLE', 'Single', 'Uma só música.'], ['EP', 'EP', 'Até seis músicas.'], ['ALBUM', 'Álbum', 'Trabalho completo.'],
      ['MIXTAPE', 'Mixtape', ''], ['JINGLE', 'Jingle / publicidade', 'Spots de rádio, televisão ou redes sociais.'],
      ['PODCAST', 'Podcast', ''], ['BANDA_SONORA', 'Banda sonora', 'Música para filme, série ou jogo.'],
    ],
  },
  {
    key: 'tipos_cliente', titulo: 'Tipos de cliente', desc: 'Quem marca: clientes normais, artistas com acordo com a gravadora…',
    campo: 'client_type', itens: [
      ['NORMAL', 'Normal', 'Cliente avulso, paga o preço de tabela.'],
      ['ARTISTA_ACORDO', 'Artista com acordo', 'Artista com contrato ou acordo com a gravadora.'],
      ['EMPRESA', 'Empresa / marca', 'Gravações para empresas, marcas ou agências.'],
      ['PARCEIRO', 'Parceiro', 'Produtores e estúdios parceiros.'],
    ],
  },
  {
    key: 'metodos_pagamento', titulo: 'Métodos de pagamento', desc: 'Como os clientes pagam. Escolhe-se na marcação, junto ao valor recebido.',
    campo: 'payment_method', itens: [
      ['NUMERARIO', 'Numerário', 'Pagamento em dinheiro no estúdio.'], ['CARTAO_DEBITO', 'Cartão de débito', ''],
      ['CARTAO_CREDITO', 'Cartão de crédito', ''], ['TRANSFERENCIA', 'Transferência bancária', ''],
      ['VINTI4', 'Vinti4', 'Rede de pagamentos de Cabo Verde.'], ['ONLINE', 'Pagamento online', 'Pago no site, ao marcar.'],
    ],
  },
  {
    key: 'estados_marcacao', titulo: 'Estados de marcação', desc: 'Os passos de uma marcação. São do sistema: muda-se só a descrição.',
    sistema: true, itens: [
      ['pedido', 'Pedido', 'Pendente: à espera de confirmação do estúdio.'],
      ['aguarda_pagamento', 'Aguarda pagamento', 'O estúdio aceitou o pedido; falta o cliente pagar para ficar confirmada.'],
      ['confirmado', 'Confirmado', 'Pago (ou aceite sem pagamento): o horário está reservado.'],
      ['em_curso', 'Em curso', 'A sessão está a decorrer.'],
      ['concluido', 'Concluído', 'A sessão terminou.'],
      ['cancelado', 'Cancelado', 'Recusado pelo estúdio ou cancelado pelo cliente. O horário fica livre.'],
      ['expirado', 'Expirado', 'Ninguém confirmou o pedido até à hora da sessão. O horário fica livre.'],
    ],
  },
  {
    // Os códigos são os de int_pagamentos.estado (pagamentos online de
    // marcações e da loja). Reembolsa-se em Integrações › Pagamentos online.
    key: 'estados_pagamento', titulo: 'Estados de pagamento', desc: 'Os estados de um pagamento online. São do sistema: muda-se só a descrição. Para reembolsar, vá a Integrações › Pagamentos online.',
    sistema: true, itens: [
      ['pago', 'Pago', 'Pagamento confirmado e processado. Já conta no "Já pago" da marcação ou na compra.'],
      ['aberto', 'Pendente', 'À espera da confirmação do pagamento.'],
      ['reembolsado', 'Reembolsado', 'Valor devolvido ao cliente.'],
      ['expirado', 'Falhou', 'Pagamento rejeitado, cancelado ou não concluído.'],
    ],
  },
];
const PORCHAVE = new Map(CATALOGOS.map((c) => [c.key, c]));

// Primeiro arranque de cada catálogo: põe os itens de origem. Os do sistema
// voltam sempre (se faltar algum, é reposto); os outros só entram quando o
// catálogo ainda está vazio, para não ressuscitar o que o dono apagou.
function semear() {
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT OR IGNORE INTO catalogo_itens(catalogo,codigo,nome,descricao,ativo,sistema,ordem,created_at)
                          VALUES(?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const c of CATALOGOS) {
      const vazio = !db.prepare('SELECT 1 FROM catalogo_itens WHERE catalogo=? LIMIT 1').get(c.key);
      if (!vazio && !c.sistema) continue;
      c.itens.forEach(([codigo, nome, descricao, ativo = 1], i) => ins.run(c.key, codigo, nome, descricao, ativo, c.sistema ? 1 : 0, i, now));
    }
  })();
}
semear();

const itens = (key) => db.prepare('SELECT * FROM catalogo_itens WHERE catalogo=? ORDER BY ordem, id').all(key)
  .map((r) => ({ ...r, ativo: !!r.ativo, sistema: !!r.sistema }));

// Um código só é aceite numa marcação se existir no catálogo (vazio = nada).
function codigoValido(key, codigo) {
  if (!codigo) return '';
  const c = String(codigo).slice(0, 40);
  return db.prepare('SELECT 1 FROM catalogo_itens WHERE catalogo=? AND codigo=?').get(key, c) ? c : null;
}

module.exports = { CATALOGOS, PORCHAVE, itens, codigoValido };
