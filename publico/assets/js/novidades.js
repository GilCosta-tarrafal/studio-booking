'use strict';
// ---------------------------------------------------------------------------
// Novidades e lançamentos, no slide logo a seguir ao topo da página inicial,
// da mais recente para a mais antiga.
//
// data: dia do lançamento, AAAA-MM-DD (ou AAAA-MM-DDTHH:MM para uma hora certa).
//   - Se a data ainda não chegou, o slide mostra "Brevemente" e uma contagem
//     decrescente, e passa sozinho a "disponível" quando o dia chega.
//   - Se já passou, mostra a data e o botão para ouvir.
// texto e botao são opcionais. Sem link, o slide não tem botão. Sem botao,
// o rótulo segue o link (Spotify, Instagram ou YouTube).
// formato: 'video' para imagens de vídeo (miniatura de um clipe ou reel), que
// aparecem na proporção original; sem ele, a imagem é uma capa quadrada.
// Com mais de um slide, passam sozinhos; a secção desaparece se a lista ficar
// vazia. As imagens ficam em publico/assets/img/capas/.
// ---------------------------------------------------------------------------
window.NOVIDADES = [
  {
    titulo: 'Fidju Di Téra',
    artista: 'Daski FNG',
    texto: 'Primeiro single do EP FDT. Produção: Many Make.',
    capa: '/img/capas/fidju-di-tera.jpg',
    data: '2026-09-18',
    link: 'https://open.spotify.com/intl-pt/track/44tQnYrjd7ubuLEaUJEist',
  },
  {
    titulo: 'Berdiana',
    artista: 'Alex Aks, Marcia Cruz',
    capa: '/img/capas/berdiana.jpg',
    data: '2026-07-18',
    link: 'https://open.spotify.com/intl-pt/track/3VP13toJkdl4BesVltNGm1',
  },
  {
    // Videoclipe publicado no canal de YouTube da Suavita Records.
    titulo: 'Sem bo',
    artista: 'Djelox',
    texto: 'Videoclipe no canal da Suavita Records.',
    capa: '/img/capas/sem-bo.jpg',
    formato: 'video',
    data: '2026-02-06',
    link: 'https://youtu.be/BgJGvyt4D84',
  },
  {
    titulo: 'Ex',
    artista: 'Djelox',
    capa: '/img/capas/ex.jpg',
    data: '2026-01-16',
    link: 'https://open.spotify.com/intl-pt/track/2E8RplvSm7WRjGMxLezSDP',
    botao: 'Ouvir no Spotify',
  },
];
