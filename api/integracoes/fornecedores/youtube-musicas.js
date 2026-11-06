'use strict';
// ---------------------------------------------------------------------------
// Músicas que têm vídeo no YouTube.
//
// De tantos em tantos minutos, o estúdio vai ao YouTube buscar as views de
// cada vídeo desta lista e atualiza o número do cartão em "Saíram deste
// estúdio". O cartão mostra sempre o MAIOR entre o número escrito à mão em
// singles.js e as views do YouTube — por isso o número nunca desce, e sobe
// sozinho à medida que o vídeo cresce.
//
// Para ligar, faltam duas coisas (ver integracoes/README.md):
//   1. uma chave da YouTube Data API, na variável YOUTUBE_API_KEY;
//   2. o link do YouTube de cada música, no campo "youtube" aqui em baixo.
//
// Cada música:
//   id       Identificador estável. Não o mude depois de ligado.
//   titulo   Nome da música.
//   artista  Quem canta (aparece no cartão quando a música não está em singles.js).
//   youtube  Link do vídeo no YouTube. Serve qualquer forma:
//              https://www.youtube.com/watch?v=XXXXXXXXXXX
//              https://youtu.be/XXXXXXXXXXX
//              https://www.youtube.com/shorts/XXXXXXXXXXX
//              ou só o código de 11 letras (XXXXXXXXXXX).
//            Sem link, a música é ignorada — fica à espera de o colar.
//   link     Link do Spotify (ou outro) IGUAL ao de singles.js: é por aqui que
//            as views do YouTube se juntam ao cartão certo, em vez de criarem
//            um cartão repetido. Numa música que não esteja em singles.js, pode
//            deixar vazio — aí o botão do cartão vai para o próprio YouTube.
//   data     Ano ou dia (AAAA ou AAAA-MM-DD), só para a legenda do cartão.
//
// Para acrescentar: copie um bloco, cole o link do YouTube e guarde.
// A integração desliga-se sozinha se não houver chave nem links.
// ---------------------------------------------------------------------------
module.exports = [
  {
    id: 'boca-mundo',
    titulo: 'Boca Mundo',
    artista: 'Brou As, khalashy',
    youtube: '',
    link: 'https://open.spotify.com/intl-pt/track/7GeswDlpsTublOFpE5W8o4',
    data: '2023',
  },
  {
    id: 'mundo-ta-roda',
    titulo: 'Mundo Ta Roda',
    artista: 'Brou As',
    youtube: '',
    link: 'https://open.spotify.com/album/1HwqLXfZ93ter1KUhP9X3m',
    data: '2023',
  },
  {
    id: 'berdiana',
    titulo: 'Berdiana',
    artista: 'Alex Aks, Marcia Cruz',
    youtube: '',
    link: 'https://open.spotify.com/intl-pt/track/3VP13toJkdl4BesVltNGm1',
    data: '2026',
  },
  {
    id: 'na-strada',
    titulo: 'Na Strada',
    artista: 'Brou As',
    youtube: '',
    link: 'https://open.spotify.com/album/06BUmYsrHAzKNVuRwuFHRn',
    data: '2023',
  },
  {
    id: 'karma',
    titulo: 'Karma',
    artista: 'Montero xix, Brou As',
    youtube: '',
    link: 'https://open.spotify.com/intl-pt/track/1Vn4kimB5d1Wql3BkYZpoP',
    data: '2024',
  },
  {
    id: 'ex',
    titulo: 'Ex',
    artista: 'Djelox',
    youtube: '',
    link: 'https://open.spotify.com/intl-pt/track/2E8RplvSm7WRjGMxLezSDP',
    data: '2026',
  },
  {
    id: 'oru',
    titulo: 'Oru',
    artista: 'Djelox',
    youtube: '',
    link: 'https://open.spotify.com/intl-pt/track/1NtDBFfNNpdoOn7Ao0LxdR',
    data: '2023',
  },
];
