// Minimal Agrisetu sensor API + static website server.
// Run with: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const latestReadings = new Map();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // ESP32 sends readings here.
  if (req.method === 'POST' && url.pathname === '/api/telemetry') {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 16_384) req.destroy();
    });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const facilityId = String(body.facility_id || '').trim();
        const temperature = Number(body.temperature);
        const humidity = Number(body.humidity);
        const methane = Number(body.methane_ppm);
        if (!facilityId || ![temperature, humidity, methane].every(Number.isFinite)) {
          return sendJson(res, 400, { success: false, error: 'facility_id, temperature, humidity and methane_ppm are required numeric values' });
        }
        const data = {
          facility_id: facilityId,
          temperature,
          humidity,
          methane_ppm: methane,
          raw_adc: Number.isFinite(Number(body.raw_adc)) ? Number(body.raw_adc) : null,
          sensor_voltage: Number.isFinite(Number(body.sensor_voltage)) ? Number(body.sensor_voltage) : null,
          device_timestamp: body.timestamp ?? null,
          receivedAt: new Date().toISOString()
        };
        latestReadings.set(facilityId, data);
        return sendJson(res, 200, { success: true, message: 'Sensor reading received', data });
      } catch (error) {
        return sendJson(res, 400, { success: false, error: 'Invalid JSON payload' });
      }
    });
    return;
  }

  // Website fetches the latest reading for a cold-storage facility.
  if (req.method === 'GET' && url.pathname.startsWith('/api/telemetry/')) {
    const facilityId = decodeURIComponent(url.pathname.slice('/api/telemetry/'.length));
    const data = latestReadings.get(facilityId);
    if (!data) return sendJson(res, 404, { success: false, error: 'No sensor reading received for this facility yet' });
    return sendJson(res, 200, { success: true, data });
  }

  // Serve the website from this same origin (avoids browser CORS issues).
  let requestedPath = decodeURIComponent(url.pathname);
  if (requestedPath === '/') requestedPath = '/index.html';
  const filePath = path.resolve(ROOT, '.' + requestedPath);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agrisetu website + sensor API running at http://localhost:${PORT}`);
  console.log(`ESP32 POST endpoint: http://<YOUR-PC-IP>:${PORT}/api/telemetry`);
});
