'use strict';
// ---------------------------------------------------------------------------
// Lê coordenadas de um texto colado — quase sempre um link do Google Maps.
//
// Não fala com ninguém: as coordenadas já vêm dentro do próprio link, basta
// encontrá-las. Assim não é preciso chave da Google nem pagar nada.
//
// Reconhece, por esta ordem:
//   !3d48.8583!4d2.2944     o alfinete exato de um lugar (o mais fiável)
//   ?q=48.8566,2.3522       links de partilha, também ?ll= e ?q=loc:
//   /@48.8566,2.3522,15z    o centro do ecrã (aproximado, mas serve)
//   48°51'23.8"N 2°21'7.9"E graus/minutos/segundos, como o Google os copia
//   48.8566, 2.3522         dois números à solta
//
// Os links curtos (maps.app.goo.gl, goo.gl/maps) não trazem as coordenadas
// dentro: são só um atalho. Quem colar um desses recebe o aviso para abrir o
// link e copiar o endereço completo da barra do browser.
// ---------------------------------------------------------------------------
(function () {
  const valido = (lat, lon) => (Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null);

  // 48°51'23.8"N 2°21'07.9"E — o "O" é de Oeste, para quem copia em português.
  function lerGraus(s) {
    const re = /(\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*["″”]?\s*)?([NSEWOnsewo])/g;
    const achados = [];
    let m;
    while ((m = re.exec(s))) {
      const graus = +m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600;
      const dir = m[4].toUpperCase();
      achados.push({ eixo: 'NS'.includes(dir) ? 'lat' : 'lon', valor: 'SWO'.includes(dir) ? -graus : graus });
    }
    if (achados.length !== 2) return null;
    const lat = achados.find((a) => a.eixo === 'lat');
    const lon = achados.find((a) => a.eixo === 'lon');
    return lat && lon ? valido(lat.valor, lon.valor) : null;
  }

  function ler(texto) {
    const s = String(texto || '').trim();
    if (!s) return null;

    let m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s);
    if (m) return valido(+m[1], +m[2]);

    m = /[?&](?:q|ll|sll|daddr|center)=(?:loc:)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(s);
    if (m) return valido(+m[1], +m[2]);

    // O delimitador no fim evita apanhar um @ que venha de outra coisa.
    m = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/?#]|$)/.exec(s);
    if (m) return valido(+m[1], +m[2]);

    const graus = lerGraus(s);
    if (graus) return graus;

    m = /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(s);
    if (m) return valido(+m[1], +m[2]);

    return null;
  }

  const eLinkCurto = (t) => /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(String(t || ''));

  window.Coords = { ler, eLinkCurto };
})();
