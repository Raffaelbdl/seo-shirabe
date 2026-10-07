// Fetches the real pages of the myanimetrip audit into tests/fixtures/real/
// (git-ignored) so tests/unit/real.test.ts can run against them.
// Run from a machine that can reach the sites: pnpm fixtures:fetch
import { mkdirSync, writeFileSync } from 'node:fs';

const PAGES = {
  'myanimetrip-anime.html': 'https://myanimetrip.com/fr/map/16bit%20Sensation:%20Another%20Layer',
  'myanimetrip-home.html': 'https://myanimetrip.com/fr',
  'myanimetrip-map.html': 'https://myanimetrip.com/fr/map',
  'myanimetrip-events.html': 'https://myanimetrip.com/fr/events',
  'seichigo-map.html': 'https://www.seichigo.com/en/map',
  'animepilgrimage-anime.html': 'https://animepilgrimage.com/maps/anime/0AvGlAgPpCxpeHIuaJPN/tonikawa',
};

mkdirSync('tests/fixtures/real', { recursive: true });
const urls = {};
for (const [file, url] of Object.entries(PAGES)) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Shirabe fixture fetch)' } });
    const html = await res.text();
    writeFileSync(`tests/fixtures/real/${file}`, html);
    urls[file] = { url, finalUrl: res.url, status: res.status };
    console.log(`${res.status} ${file} ${(html.length / 1024).toFixed(0)} KB`);
  } catch (e) {
    console.error(`failed ${file}: ${e.message}`);
  }
}
writeFileSync('tests/fixtures/real/urls.json', JSON.stringify(urls, null, 2));
