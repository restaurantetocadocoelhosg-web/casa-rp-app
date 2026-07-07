'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SENSOR_TOKEN = process.env.SENSOR_TOKEN || null;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || null;
const TELEMETRY_FRESH_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min entre alertas por equipamento

const ADMIN_USER = process.env.ADMIN_USER || 'casarp';
// Sem senha padrão hardcoded: se a env não existir, gera uma aleatória e loga
// (defina ADMIN_PASS no Railway para manter a sua senha)
const ADMIN_PASS = process.env.ADMIN_PASS || crypto.randomBytes(9).toString('base64url');
const ADMIN_PASS_GERADA = !process.env.ADMIN_PASS;

const HISTORY_MAX = 288;            // ~24h de leituras a cada 5 min
const LOGIN_MAX_TENTATIVAS = 8;     // por IP por minuto
const LOGIN_JANELA_MS = 60 * 1000;

// Persistência do histórico no Supabase (tabela thermo_leituras)
const SUPABASE_URL = process.env.SUPABASE_URL || null;
const SUPABASE_KEY = process.env.SUPABASE_KEY || null;
const supabaseAtivo = Boolean(SUPABASE_URL && SUPABASE_KEY);

function supabaseHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  }, extra || {});
}

// grava sem travar a resposta do sensor; erro só vai pro log
function gravarLeituraSupabase(leitura) {
  if (!supabaseAtivo) return;
  fetch(`${SUPABASE_URL}/rest/v1/thermo_leituras`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(leitura)
  }).then(r => {
    if (!r.ok) console.error(`[supabase] insert falhou: HTTP ${r.status}`);
  }).catch(err => console.error('[supabase] insert erro:', err.message));
}

async function historicoSupabase(equipmentId) {
  if (!supabaseAtivo) return null;
  try {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/thermo_leituras` +
      `?equipment_id=eq.${encodeURIComponent(equipmentId)}` +
      `&created_at=gte.${encodeURIComponent(desde)}` +
      `&select=temp,created_at&order=created_at.asc&limit=${HISTORY_MAX}`;
    const r = await fetch(url, { headers: supabaseHeaders() });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows.map(x => ({ temp: Number(x.temp), at: new Date(x.created_at).getTime() }));
  } catch (err) {
    console.error('[supabase] history erro:', err.message);
    return null;
  }
}

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
const telemetryHistory = new Map(); // id -> [{temp, at}] (últimas HISTORY_MAX leituras)
const sessions = new Map();
const alertCooldown = new Map();
const loginAttempts = new Map();    // ip -> {count, resetAt}

function loginBloqueado(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const agora = Date.now();
  const reg = loginAttempts.get(ip);
  if (!reg || reg.resetAt < agora) {
    loginAttempts.set(ip, { count: 1, resetAt: agora + LOGIN_JANELA_MS });
    return false;
  }
  reg.count += 1;
  return reg.count > LOGIN_MAX_TENTATIVAS;
}

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

function sessionCookie(token, maxAge, req) {
  const https = req && (req.headers['x-forwarded-proto'] === 'https');
  return `rpSession=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${https ? '; Secure' : ''}`;
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

// Dispara webhook n8n com cooldown de 5 min por equipamento
function dispararAlertaN8n(payload) {
  if (!N8N_WEBHOOK_URL) return;

  const agora = Date.now();
  const ultimoAlerta = alertCooldown.get(payload.equipmentId) || 0;
  if (agora - ultimoAlerta < ALERT_COOLDOWN_MS) return;
  alertCooldown.set(payload.equipmentId, agora);

  try {
    const body = JSON.stringify({ body: payload });
    const url = new URL(N8N_WEBHOOK_URL);
    const lib = url.protocol === 'https:' ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = lib.request(opts, res => {
      console.log(`[n8n] Alerta enviado: ${payload.equipmentId} (${payload.temp}°C) → HTTP ${res.statusCode}`);
    });
    req.on('error', err => console.error('[n8n] Erro webhook:', err.message));
    req.write(body);
    req.end();
  } catch (err) {
    console.error('[n8n] Erro ao montar requisição:', err.message);
  }
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
    if (loginBloqueado(req)) {
      return sendJson(res, 429, { error: 'Muitas tentativas. Aguarde 1 minuto e tente de novo.' });
    }
    const body = await readBody(req);
    if (body.user === ADMIN_USER && body.pass === ADMIN_PASS) {
      const token = generateToken();
      sessions.set(token, { user: body.user, expiresAt: Date.now() + SESSION_TTL_MS });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000, req),
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
      'Set-Cookie': sessionCookie('', 0, req),
      'Cache-Control': 'no-store'
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  // /api/sensor fica ANTES do gate de sessão: o ESP32 autentica por SENSOR_TOKEN,
  // não por cookie (antes disso o sensor real tomava 401 e nunca entrava dado real)
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

    const hist = telemetryHistory.get(id) || [];
    hist.push({ temp, at: Date.now() });
    if (hist.length > HISTORY_MAX) hist.splice(0, hist.length - HISTORY_MAX);
    telemetryHistory.set(id, hist);

    gravarLeituraSupabase({
      equipment_id: id, temp,
      humidity: (typeof humidity === 'number') ? humidity : null,
      voltage: (typeof voltage === 'number') ? voltage : null,
      client_name: clientName || null
    });

    const deviation = Math.abs(temp - eq.target);
    const alert = deviation > eq.alertThreshold;
    const alertMessage = alert ? `Desvio de ${deviation.toFixed(1)}°C do alvo (${eq.target}°C)` : null;

    if (alert) {
      dispararAlertaN8n({
        equipmentId: id,
        equipment: eq.name,
        temp,
        targetTemp: eq.target,
        alert,
        alertMessage,
        clientName: clientName || null,
        receivedAt: new Date().toISOString()
      });
    }

    return sendJson(res, 200, { ok: true, equipmentId: id, temp, alert, alertMessage, receivedAt: new Date().toISOString() });
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

  if (req.method === 'GET' && pathname === '/api/alerts') {
    const alerts = equipment.map(eq => getTelemetry(eq)).filter(t => t.source === 'real' && t.alert);
    return sendJson(res, 200, { count: alerts.length, alerts });
  }

  // Visão geral: status de todos os equipamentos (p/ badges dos cards e chip do topo)
  if (req.method === 'GET' && pathname === '/api/overview') {
    const items = equipment.map(eq => {
      const t = getTelemetry(eq);
      return { id: t.equipmentId, source: t.source, temp: t.currentTemp, alert: t.alert, alertMessage: t.alertMessage, name: t.name };
    });
    const reais = items.filter(i => i.source === 'real');
    return sendJson(res, 200, { live: reais.length, alerts: reais.filter(i => i.alert), items });
  }

  const historyMatch = pathname.match(/^\/api\/equipment\/([^/]+)\/history$/);
  if (req.method === 'GET' && historyMatch) {
    const eq = equipment.find(e => e.id === historyMatch[1]);
    if (!eq) return sendJson(res, 404, { error: 'Equipamento não encontrado' });
    // fonte primária: Supabase (sobrevive a redeploy); fallback: memória
    const doBanco = await historicoSupabase(eq.id);
    const history = (doBanco && doBanco.length) ? doBanco : (telemetryHistory.get(eq.id) || []);
    return sendJson(res, 200, { equipmentId: eq.id, target: eq.target, history, source: (doBanco && doBanco.length) ? 'supabase' : 'memoria' });
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
  if (ADMIN_PASS_GERADA) {
    console.log(`⚠ ADMIN_PASS não definida no ambiente — senha temporária desta execução: ${ADMIN_PASS}`);
    console.log('  Defina ADMIN_USER e ADMIN_PASS nas variáveis do Railway para uma senha fixa.');
  }
  if (SENSOR_TOKEN) console.log('Sensor token ativo — ESP32 deve enviar header X-Sensor-Token.');
  if (N8N_WEBHOOK_URL) console.log(`Alertas n8n ativos → ${N8N_WEBHOOK_URL}`);
});
