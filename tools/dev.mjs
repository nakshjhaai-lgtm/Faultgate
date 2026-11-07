#!/usr/bin/env node
/**
 * Local preview server for dist/. Static files only, plus a build-on-change
 * watcher when --watch is passed. Deliberately tiny: if this server can serve
 * the site, so can any static host.
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const portArg = process.argv.indexOf('--port');
const port = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 4173);
const host = '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let file = path.join(dist, pathname);

    // Never serve outside dist.
    if (!file.startsWith(dist)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info) {
      const notFound = await readFile(path.join(dist, '404.html')).catch(() => Buffer.from('Not found'));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end(notFound);
      return;
    }

    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Server error');
    console.error(err);
  }
});

server.listen(port, host, () => {
  console.log(`serving dist/ on http://${host}:${port}`);
});
