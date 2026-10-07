// Loads a fixture and expands its filler placeholders.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const THIRD_PARTY_HOSTS = ['pbs.twimg.com', 'cdn.myanimelist.net', 'i.imgur.com', 'prtimes.jp', 'animeanime.jp', 'natalie.mu'];

const GENERATORS: Record<string, (n: number) => string> = {
  // Angular TransferState blob of ~n bytes
  NG_STATE: (n) => {
    const item = '{"id":123456,"name":"Akihabara Electric Town","lat":35.6984,"lng":139.7731,"images":["https://cdn.myanimelist.net/images/x.jpg"],"desc":"Lorem ipsum dolor sit amet"},';
    return '{"spots":[' + item.repeat(Math.ceil(n / item.length)).slice(0, -1) + ']}';
  },
  FONT_FACES: (n) =>
    Array.from(
      { length: n },
      (_, i) =>
        `@font-face{font-family:'Noto Sans JP';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/notosansjp/v52/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEi75vY0rw-oME.${i}.woff2) format('woff2');unicode-range:U+25ee8,U+25f23,U+25f5c,U+25fd4,U+25fe0,U+25ffb,U+2600c,U+26017,U+26060,U+260ed,U+26222,U+2626a,U+26270,U+26286,U+2634c,U+26402,U+2667e,U+266b0,U+2671d,U+268dd,U+268ea,U+26951,U+2696f,U+26999,U+269dd,U+26a1e,U+26a58,U+26a8c,U+26ab7,U+26aff,U+26c29,U+26c34,U+26c9f,U+26e40,U+26e65,U+26ec2,U+26f9b,U+2706f,U+270b1,U+27181,U+27185,U+2721e,U+27245,U+2733b,U+27380,U+273a4,U+273e3,U+274ff,U+2753d,U+27610,U+276a2,U+2778e,U+277c9,U+27806,U+2784a,U+27a0d,U+27aae,U+27b4c,U+27bcf,U+27bd0,U+27be6,U+27c32,U+27c3b,U+27c44,U+27d2a,U+27d48,U+27db0,U+27e47,U+27e94;}`,
    ).join('\n'),
  ANIME_CARDS: (n) =>
    Array.from(
      { length: n },
      (_, i) =>
        `<div class="anime-card" data-title="Anime ${i}"><img src="https://cdn.myanimelist.net/images/anime/${1000 + i}.jpg" alt="Anime ${i}"><div class="anime-title">Anime ${i}</div><div class="anime-count">${i + 3} lieux</div></div>`,
    ).join('\n'),
  EVENT_CARDS: (n) =>
    Array.from(
      { length: n },
      (_, i) =>
        `<div class="event-card" onclick="openEvent(${i})"><img src="https://${THIRD_PARTY_HOSTS[i % THIRD_PARTY_HOSTS.length]}/events/${i}.jpg" alt="Événement ${i}"><p>Collaboration café anime n°${i} à Tokyo</p></div>`,
    ).join('\n'),
};

export function expand(html: string): string {
  return html.replace(/\{\{([A-Z_]+):(\d+)\}\}/g, (_, name: string, n: string) => {
    const gen = GENERATORS[name];
    if (!gen) throw new Error(`Unknown fixture placeholder ${name}`);
    return gen(Number(n));
  });
}

export function fixture(name: string): string {
  return expand(readFileSync(join(DIR, name), 'utf8'));
}

export function realFixture(name: string): string | null {
  const p = join(DIR, 'real', name);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
