'use strict';
// ---------------------------------------------------------------------------
// Os estilos de música que aparecem no formulário de marcação, por esta ordem.
//
// É uma escolha só, e é opcional: serve para o estúdio saber ao que vem a
// sessão antes de responder. Quem não se revir em nenhum escolhe "Outro" e
// escreve o que quiser — por isso esta lista não tem de ser exaustiva, só tem
// de cobrir o que aparece mais vezes.
//
// Para mexer: acrescente, tire ou troque a ordem das linhas. Os nomes são os
// mesmos nas três línguas do site (são nomes próprios de géneros), por isso
// não passam pelo dicionário. A lista pode ficar vazia: o campo desaparece.
// ---------------------------------------------------------------------------
window.ESTILOS = [
  'Drill',
  'Trap',
  'Boom Bap',
  'Rap / Hip-Hop',
  'Afrobeats',
  'R&B',
];

// Estilos que o formulário já sabe tocar, prontos a entrar na lista acima se
// um dia fizerem falta — a batida de cada um continua guardada em /js/som.js:
//   Kizomba · Zouk · Funaná · Coladeira · Morna · Batuque
//   Reggae / Dancehall · Gospel · Pop
