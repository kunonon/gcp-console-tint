import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect as connectNet } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ALLOWED_HOSTS = new Set(['console.cloud.google.com', 'outside.example.test']);
const fixturePath = fileURLToPath(new URL('./gcp.html', import.meta.url));

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

export async function startGcpMock() {
  const certDir = await mkdtemp(join(tmpdir(), 'gcp-tint-cert-'));
  const configPath = join(certDir, 'openssl.cnf');
  const certPath = join(certDir, 'cert.pem');
  const keyPath = join(certDir, 'key.pem');
  await writeFile(
    configPath,
    [
      '[req]',
      'distinguished_name = distinguished_name',
      'x509_extensions = extensions',
      'prompt = no',
      '[distinguished_name]',
      'CN = console.cloud.google.com',
      '[extensions]',
      'subjectAltName = @hosts',
      '[hosts]',
      'DNS.1 = console.cloud.google.com',
      'DNS.2 = outside.example.test',
      '',
    ].join('\n'),
  );

  let httpsServer;
  let proxy;
  const sockets = new Set();
  const requests = [];
  const closeServer = (server) =>
    !server?.listening ? Promise.resolve() : new Promise((resolve) => server.close(resolve));

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-config',
        configPath,
      ],
      { stdio: 'ignore' },
    );
    const [key, cert, fixture] = await Promise.all([
      readFile(keyPath),
      readFile(certPath),
      readFile(fixturePath, 'utf8'),
    ]);
    httpsServer = createHttpsServer({ key, cert }, (req, res) => {
      const host = String(req.headers.host || '')
        .split(':')[0]
        .toLowerCase();
      if (!ALLOWED_HOSTS.has(host)) {
        res.writeHead(421).end('Unrecognized mock host');
        return;
      }
      res
        .writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
        })
        .end(fixture);
    });
    const httpsPort = await listen(httpsServer);
    proxy = createHttpServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, `http://${req.headers.host || ''}`);
      } catch {
        res.writeHead(400).end('Bad proxy request');
        return;
      }
      if (url.protocol !== 'http:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
        res.writeHead(502, { 'cache-control': 'no-store' }).end('External network is disabled in the E2E proxy');
        return;
      }
      requests.push({
        scheme: 'http',
        host: url.hostname.toLowerCase(),
        method: req.method,
        path: `${url.pathname}${url.search}`,
      });
      req.url = `${url.pathname}${url.search}`;
      httpsServer.emit('request', req, res);
    });
    proxy.on('connection', (socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
    });
    proxy.on('connect', (req, client, head) => {
      const [host, rawPort] = req.url.split(':');
      if (!ALLOWED_HOSTS.has(host.toLowerCase()) || rawPort !== '443') {
        client.end('HTTP/1.1 502 External network disabled\r\nConnection: close\r\n\r\n');
        return;
      }
      requests.push({ scheme: 'https', host: host.toLowerCase(), method: 'CONNECT', path: '' });
      const upstream = connectNet(httpsPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: gcp-console-tint-e2e\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      sockets.add(upstream);
      upstream.once('close', () => sockets.delete(upstream));
      upstream.once('error', () => client.destroy());
      client.once('error', () => upstream.destroy());
      client.once('close', () => upstream.destroy());
    });
    const proxyPort = await listen(proxy);

    let closed = false;
    return {
      proxyUrl: `127.0.0.1:${proxyPort}`,
      requests,
      async close() {
        if (closed) return;
        closed = true;
        for (const socket of sockets) socket.destroy();
        await Promise.all([httpsServer, proxy].map(closeServer));
        await rm(certDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await Promise.all([httpsServer, proxy].map(closeServer));
    await rm(certDir, { recursive: true, force: true });
    throw error;
  }
}
