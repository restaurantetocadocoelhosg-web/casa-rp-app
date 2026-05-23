'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SENSOR_TOKEN = process.env.SENSOR_TOKEN || null;
const TELEMETRY_FRESH_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const ADMIN_USER = process.env.ADMIN_USER || 'casarp';
const ADMIN_PASS = process.env.ADMIN_PASS || 'casarp2025';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

const business = {
  name: 'Casa RP Resistências',
  appName: 'Casa RP Thermo',
  whatsapp: '5521965987979',
  phone: '(21) 2620-8167',
  instagram: '@rp_resistencias',
  address: 'R. Visc. do Uruguai, 264 - Centro, Niterói/RJ',
  maps: 'https://maps.google.com/?q=-22.887899,-43.122898'
};

const equipment = [
  { id: 'sauna-seca',       name: 'Sauna Seca',              sector: 'residencial/comercial',        resistance: 'Tubular blindada para sauna seca',         target: 80,  powerKw: 9,   phase: 'trifásico',             alertThreshold: 15 },
  { id: 'sauna-vapor',      name: 'Sauna a Vapor',           sector: 'residencial/comercial',        resistance: 'Imersão para gerador de vapor',            target: 48,  powerKw: 6,   phase: 'trifásico/monofásico',  alertThreshold: 8  },
  { id: 'piscina',          name: 'Aquecedor de Piscina',    sector: 'residencial/condomínio',       resistance: 'Flow-through / imersão de passagem',       target: 30,  powerKw: 8,   phase: 'trifásico',             alertThreshold: 5  },
  { id: 'boiler',           name: 'Boiler / Aquecedor',      sector: 'residencial/comercial',        resistance: 'Rosqueável ou flangeada de imersão',       target: 60,  powerKw: 5.5, phase: 'monofásico/trifásico',  alertThreshold: 10 },
  { id: 'buffet',           name: 'Buffet Self-Service',     sector: 'comercial',                    resistance: 'Banho-maria, pista aquecida e cuba quente',target: 65,  powerKw: 3.5, phase: 'monofásico',             alertThreshold: 10 },
  { id: 'banho-maria',      name: 'Banho-Maria',             sector: 'comercial/industrial',         resistance: 'Imersão tubular blindada',                 target: 60,  powerKw: 2.5, phase: 'monofásico/trifásico',  alertThreshold: 10 },
  { id: 'pista-quente',     name: 'Pista Quente',            sector: 'comercial',                    resistance: 'Tubular para superfície aquecida',         target: 70,  powerKw: 4,   phase: 'monofásico',             alertThreshold: 12 },
  { id: 'forno',            name: 'Forno Industrial',        sector: 'industrial/comercial',         resistance: 'Tubular ou aletada para forno',            target: 180, powerKw: 12,  phase: 'trifásico',             alertThreshold: 20 },
  { id: 'fritadeira',       name: 'Fritadeira Elétrica',     sector: 'comercial/industrial',         resistance: 'Imersão para óleo',                        target: 180, powerKw: 5,   phase: 'monofásico/trifásico',  alertThreshold: 20 },
  { id: 'lava-loucas',      name: 'Lava-Louças Industrial',  sector: 'comercial/hospitalar',         resistance: 'Tubular de passagem / boiler interno',     target: 65,  powerKw: 4.5, phase: 'monofásico/trifásico',  alertThreshold: 10 },
  { id: 'chuveiro',         name: 'Chuveiro Industrial',     sector: 'comercial/hospitalar',         resistance: 'Monobloco / tubular instantânea',          target: 42,  powerKw: 15,  phase: 'trifásico',             alertThreshold: 5  },
  { id: 'estufa',           name: 'Estufa de Secagem',       sector: 'industrial',                   resistance: 'Tubular aletada / fio resistivo',          target: 110, powerKw: 8,   phase: 'trifásico',             alertThreshold: 15 },
  { id: 'caldeira',         name: 'Caldeira a Vapor',        sector: 'industrial',                   resistance: 'Tubular de alta potência',                 target: 120, powerKw: 18,  phase: 'trifásico',             alertThreshold: 10 },
  { id: 'aquecedor-ar',     name: 'Aquecedor de Ar',         sector: 'residencial/comercial',        resistance: 'Fio resistivo / tubular para ar',          target: 28,  powerKw: 6,   phase: 'monofásico/trifásico',  alertThreshold: 5  },
  { id: 'pasteurizador',    name: 'Pasteurizador',           sector: 'industrial/comercial',         resistance: 'Imersão / flow-through inox',              target: 72,  powerKw: 10,  phase: 'trifásico',             alertThreshold: 3  },
  { id: 'passagem',         name: 'Aquecedor de Passagem',   sector: 'residencial/comercial',        resistance: 'Fio resistivo de alta densidade',          target: 42,  powerKw: 7.5, phase: 'monofásico',             alertThreshold: 5  },
  { id: 'forno-confeitaria',name: 'Forno de Confeitaria',    sector: 'comercial',                    resistance: 'Tubular para forno de lastro',             target: 170, powerKw: 9,   phase: 'monofásico/trifásico',  alertThreshold: 15 },
  { id: 'extrusora',        name: 'Resistência de Extrusora',sector: 'industrial',                   resistance: 'Banda / tubular de cilindro',              target: 200, powerKw: 14,  phase: 'trifásico',             alertThreshold: 20 }
];

const realTelemetry = new Map();
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseCookies(req) {
  const result = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    try { result[k] = decodeURIComponent(v); } catch { result[k] = v; }
  });
  return result;
}

function isAuthenticated(req) {
  const token = parseCookies(req).rpSession || req.headers['x-session'] || '';
  if (!token) return false;
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function sessionCookie(token, maxAge) {
  return `rpSession=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function safePath(pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = decodeURIComponent(filePath).replace(/\\/g, '/');
  const normalized = path.normalize(filePath).replace(/^\.+[\\/]+/, '');
  return path.join(PUBLIC_DIR, normalized);
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) { req.destroy(); reject(new Error('Payload muito grande')); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function simulateTelemetry(eq) {
  const wave = Math.sin(Date.now() / 8500);
  const current = Math.max(18, Math.round((eq.target - 8) + wave * 5));
  const heating = current < eq.target - 1;
  return {
    equipmentId: eq.id, name: eq.name, online: true, source: 'simulated',
    currentTemp: current, targetTemp: eq.target, powerKw: eq.powerKw,
    heating, mode: heating ? 'aquecendo' : 'mantendo',
    resistance: eq.resistance, alert: false, alertMessage: null,
    updatedAt: new Date().toISOString()
  };
}

function getTelemetry(eq) {
  const real = realTelemetry.get(eq.id);
  if (real && (Date.now() - real.receivedAt) < TELEMETRY_FRESH_MS) {
    const heating = real.temp < eq.target - 1;
    const deviation = Math.abs(real.temp - eq.target);
    const alert = deviation > eq.alertThreshold;
    return {
      equipmentId: eq.id, name: eq.name, online: true, source: 'real',
      clientName: real.clientName || null,
      currentTemp: real.temp, targetTemp: eq.target,
      humidity: real.humidity || null, voltage: real.voltage || null,
      powerKw: eq.powerKw, heating, mode: heating ? 'aquecendo' : 'mantendo',
      resistance: eq.resistance, alert,
      alertMessage: alert ? `Desvio de ${deviation.toFixed(1)}°C do alvo` : null,
      updatedAt: new Date(real.receivedAt).toISOString()
    };
  }
  return simulateTelemetry(eq);
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Sensor-Token,X-Session'
    });
    return res.end();
  }

  if (req.method === 'GET' && pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, service: business.appName, time: new Date().toISOString() });
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req);
    if (body.user === ADMIN_USER && body.pass === ADMIN_PASS) {
      const token = generateToken();
      sessions.set(token, { user: body.user, expiresAt: Date.now() + SESSION_TTL_MS });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000),
        'Cache-Control': 'no-store'
      });
      return res.end(JSON.stringify({ ok: true, user: body.user }));
    }
    return sendJson(res, 401, { error: 'Usuário ou senha incorretos.' });
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = parseCookies(req).rpSession || '';
    sessions.delete(token);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': sessionCookie('', 0),
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { error: 'Sessão inválida. Faça login novamente.' });
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, { business, equipment });
  }

  if (req.method === 'GET' && pathname === '/api/equipment') {
    return sendJson(res, 200, equipment);
  }

  if (req.method === 'POST' && pathname === '/api/sensor') {
    if (SENSOR_TOKEN) {
      const auth = req.headers['authorization'] || req.headers['x-sensor-token'] || '';
      if (auth.replace(/^Bearer\s+/i, '') !== SENSOR_TOKEN) return sendJson(res, 401, { error: 'Token de sensor inválido' });
    }
    const body = await readBody(req);
    const { id, temp, humidity, voltage, clientName } = body;
    if (!id || typeof temp !== 'number') return sendJson(res, 400, { error: 'Campos obrigatórios: id (string), temp (number)' });
    const eq = equipment.find(e => e.id === id);
    if (!eq) return sendJson(res, 404, { error: 'Equipamento não encontrado' });
    realTelemetry.set(id, { temp, humidity, voltage, clientName, receivedAt: Date.now() });
    const deviation = Math.abs(temp - eq.target);
    const alert = deviation > eq.alertThreshold;
    return sendJson(res, 200, { ok: true, equipmentId: id, temp, alert, alertMessage: alert ? `Desvio de ${deviation.toFixed(1)}°C do alvo (${eq.target}°C)` : null, receivedAt: new Date().toISOString() });
  }

  if (req.method === 'GET' && pathname === '/api/alerts') {
    const alerts = equipment.map(eq => getTelemetry(eq)).filter(t => t.source === 'real' && t.alert);
    return sendJson(res, 200, { count: alerts.length, alerts });
  }

  const telemetryMatch = pathname.match(/^\/api\/equipment\/([^/]+)\/telemetry$/);
  if (req.method === 'GET' && telemetryMatch) {
    const eq = equipment.find(e => e.id === telemetryMatch[1]);
    if (!eq) return sendJson(res, 404, { error: 'Equipamento não encontrado' });
    return sendJson(res, 200, getTelemetry(eq));
  }

  const commandMatch = pathname.match(/^\/api\/equipment\/([^/]+)\/command$/);
  if (req.method === 'POST' && commandMatch) {
    const eq = equipment.find(e => e.id === commandMatch[1]);
    if (!eq) return sendJson(res, 404, { error: 'Equipamento não encontrado' });
    const body = await readBody(req);
    return sendJson(res, 200, { ok: true, message: 'Comando recebido. Integração real via ESP32.', equipment: eq.name, received: body, at: new Date().toISOString() });
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = requestUrl.pathname;

    if (pathname === '/healthz' || pathname.startsWith('/api/') || req.method === 'OPTIONS') {
      const handled = await handleApi(req, res, pathname);
      if (handled === false) return sendJson(res, 404, { error: 'Rota não encontrada' });
      return;
    }

    if (pathname === '/login') {
      if (isAuthenticated(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      const loginFile = path.join(PUBLIC_DIR, 'login.html');
      fs.readFile(loginFile, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }

    const pathnameExt = path.extname(pathname).toLowerCase();
    const isAsset = ['.png','.jpg','.jpeg','.svg','.ico','.webmanifest','.txt'].includes(pathnameExt);

    if (!isAsset && !isAuthenticated(req)) {
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }

    const filePath = safePath(pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Acesso negado'); }

    // Deriva o content-type do arquivo real, não do pathname (ex: '/' → 'index.html')
    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (fallbackErr, fallback) => {
          if (fallbackErr) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Não encontrado'); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(fallback);
        });
        return;
      }
      res.writeHead(200, {
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600'
      });
      res.end(data);
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Erro interno' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${business.appName} rodando em http://${HOST}:${PORT}`);
  console.log(`Credenciais padrão — usuário: ${ADMIN_USER} | senha: ${ADMIN_PASS}`);
  console.log('Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente para trocar.');
  if (SENSOR_TOKEN) console.log('Sensor token ativo — ESP32 deve enviar header X-Sensor-Token.');
});
