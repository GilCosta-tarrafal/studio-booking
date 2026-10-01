'use strict';
// ---------------------------------------------------------------------------
// Os singles em destaque na página inicial, do mais ouvido para o menos.
//
// Nome, capa e ano vieram do próprio Spotify, para baterem certo com o que as
// pessoas encontram lá. As capas estão em publico/assets/img/capas/.
//
// streams: número de reproduções, indicado pelo estúdio em setembro de 2026.
// São valores arredondados, não leituras exatas do Spotify — que só as mostra
// a quem tem sessão iniciada. Daí o "+" à frente no cartão. Com um número, o
// cartão mostra-o a subir de zero quando entra no ecrã; a null, a linha não
// aparece. Vale a pena rever de vez em quando: um número parado acaba por
// dizer menos do que a verdade.
//
// Para acrescentar: copie um bloco, guarde a capa naquela pasta e cole o link.
// A secção desaparece sozinha se esta lista ficar vazia.
// ---------------------------------------------------------------------------
window.SINGLES = [
  {
    titulo: 'Boca Mundo',
    descricao: 'Brou As, khalashy · 2023',
    capa: '/img/capas/boca-mundo.jpg',
    link: 'https://open.spotify.com/intl-pt/track/7GeswDlpsTublOFpE5W8o4',
    streams: 3700000,
  },
  {
    titulo: 'Mundo Ta Roda',
    descricao: 'Brou As · Single, 2023',
    capa: '/img/capas/mundo-ta-roda.jpg',
    link: 'https://open.spotify.com/album/1HwqLXfZ93ter1KUhP9X3m',
    streams: 1500000,
  },
  {
    titulo: 'Berdiana',
    descricao: 'Alex Aks, Marcia Cruz · 2026',
    capa: '/img/capas/berdiana.jpg',
    link: 'https://open.spotify.com/intl-pt/track/3VP13toJkdl4BesVltNGm1',
    streams: 967000,
  },
  {
    titulo: 'Na Strada',
    descricao: 'Brou As · Single, 2023',
    capa: '/img/capas/na-strada.jpg',
    link: 'https://open.spotify.com/album/06BUmYsrHAzKNVuRwuFHRn',
    streams: 715000,
  },
  {
    titulo: 'Karma',
    descricao: 'Montero xix, Brou As · 2024',
    capa: '/img/capas/karma.jpg',
    link: 'https://open.spotify.com/intl-pt/track/1Vn4kimB5d1Wql3BkYZpoP',
    streams: 514000,
  },
  {
    titulo: 'Ex',
    descricao: 'Djelox · 2026',
    capa: '/img/capas/ex.jpg',
    link: 'https://open.spotify.com/intl-pt/track/2E8RplvSm7WRjGMxLezSDP',
    streams: 109000,
  },
  {
    titulo: 'Oru',
    descricao: 'Djelox · 2023',
    capa: '/img/capas/oru.jpg',
    link: 'https://open.spotify.com/intl-pt/track/1NtDBFfNNpdoOn7Ao0LxdR',
    streams: 100000,
  },
];
