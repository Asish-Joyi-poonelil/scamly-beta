import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeEmail, sanitizeText } from './lib/heuristics.mjs';
import { runAiAnalysis } from './lib/ai.mjs';
import { combineResults } from './lib/combine.mjs';
import { storeFeedback } from './lib/feedback.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 3000);
const rateWindowMs = 60_000;
const rateLimitMap = new Map();

function currentAnalyzeLimit() {
  return Number(process.env.ANALYZE_RPM || 20);
}

function getAllowedOrigin(origin) {
  if (!origin) return '*';
  if (origin.startsWith('chrome-extension://')) return origin;
  if (process.env.PUBLIC_SITE_URL && origin === process.env.PUBLIC_SITE_URL) return origin;
  const allowed = String(process.env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : '';
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, maxBytes = 200_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('Request body too large.');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function applyAnalyzeRateLimit(req) {
  const key = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const item = rateLimitMap.get(key) || { count: 0, resetAt: now + rateWindowMs };
  if (item.resetAt < now) {
    item.count = 0;
    item.resetAt = now + rateWindowMs;
  }
  item.count += 1;
  rateLimitMap.set(key, item);
  return item.count <= currentAnalyzeLimit();
}

function trimEmailPayload(email = {}) {
  return {
    provider: sanitizeText(email.provider || '').slice(0, 40),
    hostname: sanitizeText(email.hostname || '').slice(0, 120),
    subject: sanitizeText(email.subject || '').slice(0, 320),
    sender: sanitizeText(email.sender || '').slice(0, 320),
    body: sanitizeText(email.body || '').slice(0, 5000),
    links: Array.isArray(email.links)
      ? email.links.slice(0, 20).map((link) => ({
          href: sanitizeText(link?.href || '').slice(0, 500),
          text: sanitizeText(link?.text || '').slice(0, 300)
        }))
      : []
  };
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

async function serveStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  let filePath = path.join(publicDir, reqPath === '/' ? 'index.html' : reqPath.replace(/^\//, ''));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (!path.extname(filePath)) filePath += '.html';
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    const fallback = await fs.readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    json(res, 200, {
      status: 'ok',
      service: 'scamly-ai-backend',
      ai_enabled: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      feedback_storage: process.env.SUPABASE_URL ? 'supabase' : 'local-file'
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    if (!applyAnalyzeRateLimit(req)) {
      json(res, 429, { error: 'Too many Deep AI Check requests. Please try again in a minute.' });
      return;
    }
    try {
      const body = await readJsonBody(req);
      const email = trimEmailPayload(body.email || {});
      if (!email.subject && !email.body) {
        json(res, 400, { error: 'No usable email content was provided.' });
        return;
      }
      const localResult = analyzeEmail(email);
      const aiResult = await runAiAnalysis({ email, localResult });
      const combined = combineResults(localResult, aiResult.ai);
      json(res, 200, {
        ok: true,
        analysis: {
          mode: 'hybrid_ai',
          local: localResult,
          ai: aiResult.ai,
          combined,
          model: aiResult.model,
          request_id: aiResult.request_id,
          analyzedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Analyze error:', error);
      json(res, 500, { error: error?.message || 'Deep AI Check failed.' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/feedback') {
    try {
      const body = await readJsonBody(req);
      const payload = {
        provider: sanitizeText(body.provider || ''),
        subject: sanitizeText(body.subject || ''),
        score: Number.isFinite(Number(body.score)) ? Number(body.score) : null,
        severity: sanitizeText(body.severity || ''),
        verdict: sanitizeText(body.verdict || ''),
        feedback_type: sanitizeText(body.feedback_type || 'general'),
        message: sanitizeText(body.message || '').slice(0, 4000),
        email: sanitizeText(body.email || '').slice(0, 320),
        user_agent: sanitizeText(req.headers['user-agent'] || ''),
        page_url: sanitizeText(body.page_url || '').slice(0, 500)
      };
      if (!payload.message) {
        json(res, 400, { error: 'Feedback message is required.' });
        return;
      }
      const result = await storeFeedback(payload);
      json(res, 200, { ok: true, ...result });
    } catch (error) {
      console.error('Feedback error:', error);
      json(res, 500, { error: error?.message || 'Could not save feedback.' });
    }
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Scamly backend listening on http://localhost:${port}`);
});
