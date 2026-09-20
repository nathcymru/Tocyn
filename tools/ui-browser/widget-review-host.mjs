import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.TOCYN_WIDGET_REVIEW_PORT ?? 5175);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local widget review port');
const widgetKey = 'fixture-widget-key-a';
const previewToken = 'widget-visual-only';
const bundle = readFileSync(resolve('apps/widget/dist/lumina-widget.js'));

function html(previewSession) { return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tocyn local widget review</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #f8fafc; color: #1e293b; font: 16px/1.5 sans-serif; }
    main { max-width: 42rem; padding: 2rem; }
    h1 { margin-top: 0; }
  </style>
</head>
<body>
  <main>
    <h1>Widget review host</h1>
    <p>This disposable page loads the built Tocyn widget with tenant A's synthetic public key.</p>
    <p>Configuration and ${previewSession ? 'customer session' : 'signed-out session'} are simulated for visual review. Submissions are disabled.</p>
    <p><a href="${previewSession ? '/' : '/?session=synthetic'}">Switch to ${previewSession ? 'signed-out' : 'synthetic signed-in'} preview</a></p>
  </main>
  <script src="/lumina-widget.js" data-widget-key="${widgetKey}"${previewSession ? ` data-widget-token="${previewToken}"` : ''} defer></script>
</body>
</html>`; }

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  const path = url.pathname;
  if (path === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html(url.searchParams.get('session') === 'synthetic'));
    return;
  }
  if (path === '/lumina-widget.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(bundle);
    return;
  }
  if (path === '/api/v1/widget/config' || path === '/api/v1/widget/session') {
    response.setHeader('Content-Type', 'application/json');
    if (request.headers['x-widget-key'] !== widgetKey) {
      response.writeHead(404).end('{"error":"Unknown synthetic widget key"}');
      return;
    }
    if (path.endsWith('/config')) {
      response.writeHead(200).end(JSON.stringify({
        title: 'Synthetic support', primaryColor: '#334155',
        features: { aiChat: true, ticketForm: true },
        portalUrl: `http://127.0.0.1:5174/login?key=${widgetKey}`,
      }));
      return;
    }
    if (request.headers.authorization === `Bearer ${previewToken}`) {
      response.writeHead(200).end('{"user":{"email":"widget-preview@example.invalid"}}');
    } else {
      response.writeHead(401).end('{"error":"No synthetic preview session"}');
    }
    return;
  }
  response.writeHead(404).end();
});

server.listen(port, host, () => {
  process.stdout.write(`\n========================================\nWIDGET REVIEW READY\n========================================\n\n`);
  process.stdout.write(`Open: http://${host}:${port}/\n`);
  process.stdout.write(`Preview form: http://${host}:${port}/?session=synthetic\n`);
  process.stdout.write(`Synthetic config/session only; submissions are disabled.\n\n`);
  process.stdout.write(`Press Ctrl+C to stop this host.\n\n`);
});
