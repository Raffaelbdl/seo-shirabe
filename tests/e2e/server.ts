// Local fixture server for the e2e test. Records the User-Agent of every
// request so "fetch as bot" can be verified.
import { createServer, type Server } from 'node:http';
import { deflateSync } from 'node:zlib';
import { fixture } from '../helpers/fixtures';

function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0xc2)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export interface FixtureServer {
  origin: string;
  userAgents: { path: string; ua: string }[];
  close(): Promise<void>;
}

export async function startServer(): Promise<FixtureServer> {
  const userAgents: { path: string; ua: string }[] = [];
  const og = png(1200, 630);
  let origin = '';
  const ANIME = '/fr/map/16bit%20Sensation:%20Another%20Layer';
  const server: Server = createServer((req, res) => {
    const path = req.url ?? '/';
    userAgents.push({ path, ua: req.headers['user-agent'] ?? '' });
    const html = (body: string, status = 200) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    const local = (s: string) => s.replaceAll('https://myanimetrip.com', origin);
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(`User-agent: *\nDisallow: /private\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
    }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/fr/blog/kamiina-botan-pelerinage-utsunomiya</loc></url></urlset>`);
    }
    if (path === '/og.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(og);
    }
    if (path === '/old') {
      res.writeHead(301, { location: '/older' });
      return res.end();
    }
    if (path === '/older') {
      res.writeHead(302, { location: ANIME });
      return res.end();
    }
    if (path === '/' || path === '/fr') return html(local(fixture('myanimetrip-home.html')));
    if (path === ANIME || path === '/fr/map/16bit%20Sensation%3A%20Another%20Layer') return html(local(fixture('myanimetrip-anime.html')));
    if (path === '/fr/map') return html(local(fixture('myanimetrip-map.html')));
    if (path === '/fr/blog/kamiina-botan-pelerinage-utsunomiya') {
      let body = local(fixture('myanimetrip-blog.html')).replace(`${origin}/assets/blog/kamiina-botan/og.jpg"`, `${origin}/og.png"`);
      // A prerender-style difference for bots, to exercise the bot diff.
      if (/Twitterbot/.test(req.headers['user-agent'] ?? '')) body = body.replace('<title>Kamiina Botan', '<title>[BOT] Kamiina Botan');
      return html(body);
    }
    return html('<!doctype html><title>Not found</title><h1>404</h1>', 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return { origin, userAgents, close: () => new Promise((r) => server.close(() => r())) };
}
