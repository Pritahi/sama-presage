'use strict';
// Sama server: serves the PWA and bridges browser webcam frames to the real
// Presage SmartSpectra Node SDK. The SDK computes metrics on-device (in this
// Node process); it contacts Presage only to authenticate the API key.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch (e) { /* no .env */ }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.SMARTSPECTRA_API_KEY || '';
const TELEMETRY = process.env.SMARTSPECTRA_TELEMETRY === 'true';
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ liveAvailable: Boolean(API_KEY), telemetry: TELEMETRY }));
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function last(arr) { return arr && arr.length ? arr[arr.length - 1] : null; }
// The SDK reports confidence on a 0-100 scale for pulse; breathing rate samples carry none. Normalise to 0-1 (null = not reported).
function toSample(m) {
  if (!m) return null;
  const c = m.confidence == null ? null : (Number(m.confidence) > 1 ? Number(m.confidence) / 100 : Number(m.confidence));
  return { value: Number(m.value || 0), confidence: c, stable: Boolean(m.stable) };
}

/** Reduce a decoded Metrics message to what the UI needs. */
function summarize(m) {
  const pulse = toSample(last(m && m.cardio && m.cardio.pulseRate));
  const breath = toSample(last(m && m.breathing && m.breathing.rate));
  const trace = (m && m.breathing && m.breathing.upperTrace || []).slice(-30).map((x) => Number(x.value || 0));
  const hrvArr = m && m.cardio && m.cardio.hrv;
  const h = last(hrvArr);
  const hrv = h ? { rmssd: Number(h.rmssd || 0), sdnn: Number(h.sdnn || 0) } : null;
  return { pulse, breath, trace, hrv };
}

const TOKEN = process.env.SAMA_ACCESS_TOKEN || '';
const wss = new WebSocketServer({
  server, path: '/stream',
  // Optional shared token so a public tunnel cannot spend your Presage credits.
  verifyClient: (info) => !TOKEN || new URL(info.req.url, 'http://x').searchParams.get('k') === TOKEN,
});
wss.on('connection', (ws) => {
  let sdk = null;
  let started = false;
  const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

  async function startSdk() {
    if (!API_KEY) return send({ type: 'error', message: 'No SMARTSPECTRA_API_KEY set on the server. Use mock mode or add a key to .env.' });
    const S = require('@smartspectra/node-sdk');
    const { decodeMetrics } = require('@smartspectra/node-sdk/messages');
    sdk = new S.SmartSpectraSDK({
      apiKey: API_KEY,
      requestedMetrics: [...S.cardioMetrics, ...S.breathingMetrics],
      enableTelemetry: TELEMETRY,
    });
    sdk.on('metrics', (buf) => { try { send(Object.assign({ type: 'metrics' }, summarize(decodeMetrics(buf)))); } catch (e) { send({ type: 'error', message: 'decode: ' + e.message }); } });
    sdk.on('validationStatus', (code, ts, hint) => send({ type: 'validation', code, hint }));
    sdk.on('error', (code, message, retryable) => send({ type: 'error', code, message, retryable }));
    sdk.useCustomInput();
    sdk.start();
    started = true;
    send({ type: 'started' });
  }

  ws.on('message', async (data, isBinary) => {
    try {
      if (!isBinary) {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'start' && !started) await startSdk();
        if (msg.type === 'stop') await cleanup();
        return;
      }
      if (!sdk || !started) return;
      // Frame packet: u16 width, u16 height, u32 timestamp (ms), then RGBA bytes.
      const w = data.readUInt16LE(0), h = data.readUInt16LE(2), tsMs = data.readUInt32LE(4);
      const rgba = data.subarray(8);
      if (rgba.length !== w * h * 4) return;
      const rgb = Buffer.allocUnsafe(w * h * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
      const { PixelFormat } = require('@smartspectra/node-sdk');
      sdk.sendFrame(rgb, w, h, w * 3, PixelFormat.kRGB, tsMs * 1000);
    } catch (e) { send({ type: 'error', message: e.message }); }
  });

  async function cleanup() {
    if (sdk) { const s = sdk; sdk = null; started = false; try { await s.destroy(); } catch (e) { /* ignore */ } }
  }
  ws.on('close', cleanup);
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Sama running at http://localhost:${PORT} (live SDK ${API_KEY ? 'enabled' : 'disabled: no key'})`));
}
module.exports = { server, summarize };
