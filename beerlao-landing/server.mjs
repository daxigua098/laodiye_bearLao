import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DATA_DIR = join(ROOT, 'data');
const STORE_PATH = join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_USER = process.env.ADMIN_USER || 'beerlao';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'beerlao-demo';
const DEMO_MODE = process.env.DEMO_MODE !== '0';
const MAX_BODY = 32 * 1024;
const STATUSES = new Set(['new', 'contacted', 'quoted', 'won', 'lost']);
const EVENT_TYPES = new Set(['page_view', 'cta_click', 'scroll_75']);
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
]);

await mkdir(DATA_DIR, { recursive: true });
let store = await loadStore();
let writeQueue = Promise.resolve();

function emptyStore() {
  return { events: [], leads: [], meta: { demo: false, createdAt: new Date().toISOString() } };
}

async function loadStore() {
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, 'utf8'));
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      meta: { demo: Boolean(parsed.meta?.demo), createdAt: parsed.meta?.createdAt || new Date().toISOString() },
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read store:', error.message);
    return emptyStore();
  }
}

function persist() {
  const snapshot = JSON.stringify(store, null, 2);
  writeQueue = writeQueue.then(() => writeFile(STORE_PATH, snapshot, 'utf8'));
  return writeQueue;
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

const limits = new Map();
function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const item = limits.get(key);
  if (!item || item.reset <= now) {
    limits.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  item.count += 1;
  return item.count > limit;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Invalid JSON');
    error.status = 400;
    throw error;
  }
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function isAdmin(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const split = decoded.indexOf(':');
  if (split < 0) return false;
  return safeEqual(decoded.slice(0, split), ADMIN_USER) && safeEqual(decoded.slice(split + 1), ADMIN_PASSWORD);
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  res.writeHead(401, {
    'www-authenticate': 'Basic realm="Beerlao Admin", charset="UTF-8"',
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end('Authentication required');
  return false;
}

function cleanText(value, max = 80) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeSource(value) {
  const raw = cleanText(value || 'direct', 80).toLowerCase().replace(/^www\./, '');
  if (!raw) return 'direct';
  const aliases = [
    ['facebook.com', 'facebook'], ['facebook', 'facebook'], ['fb', 'facebook'], ['meta', 'facebook'],
    ['tiktok.com', 'tiktok'], ['tiktok', 'tiktok'], ['tt', 'tiktok'],
    ['instagram.com', 'instagram'], ['instagram', 'instagram'], ['ins', 'instagram'], ['ig', 'instagram'], ['insta', 'instagram'],
    ['google.com', 'google'], ['google', 'google'], ['adwords', 'google'],
    ['bing.com', 'bing'], ['bing', 'bing'], ['microsoft', 'bing'],
    ['yandex.com', 'yandex'], ['yandex', 'yandex'],
    ['douyin.com', 'douyin'], ['douyin', 'douyin'],
    ['baidu.com', 'baidu'], ['baidu', 'baidu'],
    ['weixin.qq.com', 'wechat'], ['wechat', 'wechat'], ['weixin', 'wechat'], ['wx', 'wechat'],
    ['xhslink.com', 'xiaohongshu'], ['xiaohongshu', 'xiaohongshu'], ['xhs', 'xiaohongshu'],
  ];
  for (const [needle, source] of aliases) if (raw.includes(needle)) return source;
  return raw;
}

function sourceOf(input) {
  return normalizeSource(input?.source || input?.utmSource || 'direct');
}

function dayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateRange(url) {
  const raw = Number(url.searchParams.get('days') || 30);
  const days = Math.max(1, Math.min(365, Number.isFinite(raw) ? raw : 30));
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const dates = [];
  for (let d = new Date(start); d <= end && dates.length < 366; d.setDate(d.getDate() + 1)) dates.push(dayKey(d));
  return { days, start, end, dates };
}

function inRange(value, range) {
  const time = new Date(value).getTime();
  return time >= range.start.getTime() && time <= range.end.getTime();
}

function maskPhone(phone) {
  return String(phone || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
}

function aggregate(range, sourceFilter = 'all') {
  const events = store.events.filter((event) => inRange(event.createdAt, range));
  const leads = store.leads.filter((lead) => inRange(lead.createdAt, range));
  const sourceMatches = (item) => sourceFilter === 'all' || sourceOf(item) === sourceFilter;
  const filteredEvents = events.filter(sourceMatches);
  const filteredLeads = leads.filter(sourceMatches);
  const visitors = new Set();
  const ctaVisitors = new Set();
  const daily = new Map(range.dates.map((date) => [date, { date, visitors: new Set(), clicks: new Set(), leads: 0 }]));
  const sourceMap = new Map();

  for (const event of filteredEvents) {
    if (event.type === 'page_view' && event.visitorId) {
      visitors.add(event.visitorId);
      const d = daily.get(dayKey(event.createdAt));
      if (d) d.visitors.add(event.visitorId);
    }
    if (event.type === 'cta_click' && event.visitorId) {
      ctaVisitors.add(event.visitorId);
      const d = daily.get(dayKey(event.createdAt));
      if (d) d.clicks.add(event.visitorId);
    }
  }

  for (const lead of filteredLeads) {
    const d = daily.get(dayKey(lead.createdAt));
    if (d) d.leads += 1;
  }

  const allSources = new Set(['direct', ...filteredEvents.map(sourceOf), ...filteredLeads.map(sourceOf)]);
  for (const source of allSources) {
    const sourceEvents = filteredEvents.filter((event) => sourceOf(event) === source);
    const sourceLeads = filteredLeads.filter((lead) => sourceOf(lead) === source);
    const sourceVisitors = new Set(sourceEvents.filter((event) => event.type === 'page_view').map((event) => event.visitorId).filter(Boolean));
    const sourceClicks = new Set(sourceEvents.filter((event) => event.type === 'cta_click').map((event) => event.visitorId).filter(Boolean));
    sourceMap.set(source, {
      source,
      visitors: sourceVisitors.size,
      clicks: sourceClicks.size,
      leads: sourceLeads.length,
      conversionRate: sourceVisitors.size ? (sourceLeads.length / sourceVisitors.size) * 100 : 0,
    });
  }

  const series = [...daily.values()].map((item) => ({
    date: item.date,
    visitors: item.visitors.size,
    clicks: item.clicks.size,
    leads: item.leads,
  }));
  const statusCounts = Object.fromEntries([...STATUSES].map((status) => [status, filteredLeads.filter((lead) => lead.status === status).length]));
  const recentLeads = [...filteredLeads]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8)
    .map((lead) => ({ ...lead, phoneMasked: maskPhone(lead.phone) }));

  return {
    demo: store.meta.demo,
    updatedAt: new Date().toISOString(),
    range: { days: range.days, from: range.dates[0], to: range.dates.at(-1) },
    metrics: {
      visitors: visitors.size,
      ctaClicks: ctaVisitors.size,
      leads: filteredLeads.length,
      conversionRate: visitors.size ? (filteredLeads.length / visitors.size) * 100 : 0,
      clickRate: visitors.size ? (ctaVisitors.size / visitors.size) * 100 : 0,
    },
    statusCounts,
    series,
    sources: [...sourceMap.values()].sort((a, b) => b.visitors - a.visitors),
    recentLeads,
  };
}

function seededDemo() {
  let seed = 20261020;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pick = (items) => items[Math.floor(rand() * items.length)];
  const sources = ['douyin', 'tiktok', 'facebook', 'instagram', 'wechat', 'baidu', 'google', 'xiaohongshu', 'direct'];
  const names = ['陈先生', '李女士', '王先生', '赵女士', '周先生', '杨女士', '黄先生', '吴女士'];
  const cities = ['上海', '北京', '广州', '深圳', '成都', '杭州', '昆明', '西双版纳'];
  const counts = [48, 61, 55, 74, 69, 88, 82, 101, 96, 118, 107, 132, 126, 149];
  const events = [];
  const leads = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let dayIndex = 0; dayIndex < counts.length; dayIndex += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - (counts.length - 1 - dayIndex));
    for (let i = 0; i < counts[dayIndex]; i += 1) {
      const visitorId = `demo-${dayKey(date)}-${i + 1}`;
      const sessionId = `session-${dayKey(date)}-${i + 1}`;
      const source = rand() < 0.42 ? pick(sources.slice(0, 4)) : pick(sources);
      const baseHour = 9 + Math.floor(rand() * 13);
      const createdAt = new Date(date);
      createdAt.setHours(baseHour, Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      const common = {
        visitorId, sessionId, source, campaign: source === 'direct' ? 'brand' : `q4-${source}`,
        path: '/', referrer: source === 'direct' ? '' : `https://${source}.example/`,
        userAgent: 'Demo data', demo: true,
      };
      events.push({ id: randomUUID(), type: 'page_view', createdAt: createdAt.toISOString(), ...common });
      if (rand() < 0.18) {
        const clickAt = new Date(createdAt.getTime() + Math.floor(rand() * 4 + 1) * 60000);
        events.push({ id: randomUUID(), type: 'cta_click', createdAt: clickAt.toISOString(), ...common });
        if (rand() < 0.38) {
          const leadAt = new Date(clickAt.getTime() + Math.floor(rand() * 8 + 1) * 60000);
          const statusRoll = rand();
          const status = statusRoll < 0.46 ? 'new' : statusRoll < 0.7 ? 'contacted' : statusRoll < 0.88 ? 'quoted' : statusRoll < 0.96 ? 'won' : 'lost';
          const quantityRoll = rand();
          leads.push({
            id: randomUUID(),
            name: pick(names),
            phone: `139${String(10000000 + Math.floor(rand() * 89999999)).slice(-8)}`,
            city: pick(cities),
            quantity: quantityRoll < 0.58 ? 1 : quantityRoll < 0.86 ? 2 : quantityRoll < 0.96 ? 5 : 10,
            status,
            source,
            campaign: common.campaign,
            visitorId,
            sessionId,
            createdAt: leadAt.toISOString(),
            consent: true,
            demo: true,
          });
        }
      }
    }
  }
  return { events, leads, meta: { demo: true, createdAt: new Date().toISOString() } };
}

async function handleApi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/events') {
    if (rateLimited(`event:${clientIp(req)}`, 180, 60_000)) return json(res, 429, { error: 'Too many events' });
    const input = await readJson(req);
    if (!EVENT_TYPES.has(input.type)) return json(res, 422, { error: 'Invalid event type' });
    if (!cleanText(input.visitorId, 80)) return json(res, 422, { error: 'Missing visitor id' });
    store.events.push({
      id: randomUUID(), type: input.type,
      visitorId: cleanText(input.visitorId, 80), sessionId: cleanText(input.sessionId, 80),
      path: cleanText(input.path || '/', 200), referrer: cleanText(input.referrer, 300),
      source: sourceOf(input), campaign: cleanText(input.campaign, 80),
      userAgent: cleanText(req.headers['user-agent'], 300), createdAt: new Date().toISOString(),
    });
    await persist();
    return json(res, 202, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/leads') {
    if (rateLimited(`lead:${clientIp(req)}`, 5, 10 * 60_000)) return json(res, 429, { error: 'Too many submissions' });
    const input = await readJson(req);
    const name = cleanText(input.name, 30);
    const phone = cleanText(input.phone, 20);
    const city = cleanText(input.city, 30);
    const quantity = Number(input.quantity);
    if (name.length < 2) return json(res, 422, { error: '请填写姓名' });
    if (!/^1[3-9]\d{9}$/.test(phone)) return json(res, 422, { error: '请填写有效的手机号' });
    if (city.length < 2) return json(res, 422, { error: '请填写城市' });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) return json(res, 422, { error: '请选择预计数量' });
    if (input.consent !== true) return json(res, 422, { error: '请同意信息使用说明' });
    const lead = {
      id: randomUUID(), name, phone, city, quantity,
      status: 'new', source: sourceOf(input), campaign: cleanText(input.campaign, 80),
      visitorId: cleanText(input.visitorId, 80), sessionId: cleanText(input.sessionId, 80),
      createdAt: new Date().toISOString(), consent: true, demo: false,
    };
    store.leads.push(lead);
    await persist();
    return json(res, 201, { ok: true, lead: { id: lead.id, status: lead.status } });
  }

  if (!requireAdmin(req, res)) return;

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    const range = dateRange(url);
    const source = cleanText(url.searchParams.get('source') || 'all', 32).toLowerCase();
    return json(res, 200, aggregate(range, source || 'all'));
  }

  if (req.method === 'GET' && url.pathname === '/api/leads') {
    const range = dateRange(url);
    const source = cleanText(url.searchParams.get('source') || 'all', 32).toLowerCase();
    const status = cleanText(url.searchParams.get('status') || 'all', 20).toLowerCase();
    const leads = store.leads
      .filter((lead) => inRange(lead.createdAt, range))
      .filter((lead) => source === 'all' || sourceOf(lead) === source)
      .filter((lead) => status === 'all' || lead.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 200)
      .map((lead) => ({ ...lead, phoneMasked: maskPhone(lead.phone) }));
    return json(res, 200, { demo: store.meta.demo, updatedAt: new Date().toISOString(), leads });
  }

  const match = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
  if (req.method === 'PATCH' && match) {
    const lead = store.leads.find((item) => item.id === match[1]);
    if (!lead) return json(res, 404, { error: 'Lead not found' });
    const input = await readJson(req);
    if (!STATUSES.has(input.status)) return json(res, 422, { error: 'Invalid status' });
    lead.status = input.status;
    lead.updatedAt = new Date().toISOString();
    await persist();
    return json(res, 200, { ok: true, lead: { ...lead, phoneMasked: maskPhone(lead.phone) } });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/demo') {
    if (!DEMO_MODE) return json(res, 403, { error: 'Demo mode disabled' });
    const input = await readJson(req);
    if (input.action === 'seed') {
      store = seededDemo();
      await persist();
      return json(res, 200, { ok: true, demo: true });
    }
    if (input.action === 'clear') {
      store.events = store.events.filter((event) => !event.demo);
      store.leads = store.leads.filter((lead) => !lead.demo);
      store.meta.demo = false;
      await persist();
      return json(res, 200, { ok: true, demo: false });
    }
    return json(res, 422, { error: 'Unknown action' });
  }

  return json(res, 404, { error: 'Not found' });
}

function isBlockedPath(pathname) {
  const name = pathname.toLowerCase();
  return name === '/server.mjs' || name.startsWith('/data/') || name.includes('..') || name.includes('/.');
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  if ((pathname === '/admin.html' || pathname.startsWith('/api/')) && !requireAdmin(req, res)) return;
  if (isBlockedPath(pathname)) return json(res, 404, { error: 'Not found' });
  const filePath = resolve(ROOT, `.${pathname}`);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': pathname === '/index.html' || pathname === '/admin.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frame-options': 'DENY',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT') return json(res, 404, { error: 'Not found' });
    console.error(error);
    return json(res, 500, { error: 'Server error' });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Beerlao landing: http://${HOST}:${PORT}`);
  console.log(`Beerlao admin:   http://${HOST}:${PORT}/admin`);
  console.log(`Admin user:      ${ADMIN_USER}`);
  if (!process.env.ADMIN_PASSWORD) console.warn('Using demo password. Set ADMIN_PASSWORD before any public deployment.');
  if (store.meta.demo) console.log('Store currently contains demo data. Clear it from the admin screen before launch.');
});


