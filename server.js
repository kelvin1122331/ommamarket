const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

function loadDotEnv() {
  const envFile = path.join(__dirname, '.env');
  try {
    const content = fs.readFileSync(envFile, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Could not read .env:', error.message);
  }
}

loadDotEnv();

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'kelvin5757');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : crypto.randomBytes(32).toString('hex'));
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1_000_000;
const COOKIE_NAME = IS_PRODUCTION ? '__Host-ommamarket_session' : 'ommamarket_session';

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('Missing ADMIN_PASSWORD or SESSION_SECRET. Configure them before starting the server.');
  process.exit(1);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

let products = [];
const sessions = new Map();
const loginAttempts = new Map();
let passwordSalt;
let passwordHash;

function now() {
  return Date.now();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashSessionToken(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(token).digest('hex');
}

function derivePassword(password) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, passwordSalt, 64, { N: 16_384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function verifyAdminPassword(password) {
  const candidate = await derivePassword(password);
  return candidate.length === passwordHash.length && crypto.timingSafeEqual(candidate, passwordHash);
}

async function ensureDataFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  for (const file of [PRODUCTS_FILE, SESSIONS_FILE]) {
    try {
      await fsp.access(file, fs.constants.F_OK);
    } catch {
      await fsp.writeFile(file, '[]\n', { encoding: 'utf8', mode: 0o600 });
    }
  }
}

async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (error) {
    console.error(`Could not read ${path.basename(file)}:`, error.message);
    return fallback;
  }
}

async function atomicWrite(file, value) {
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fsp.rename(temporaryFile, file);
}

let productsWriteQueue = Promise.resolve();
let sessionsWriteQueue = Promise.resolve();

function persistProducts() {
  productsWriteQueue = productsWriteQueue
    .catch(() => undefined)
    .then(() => atomicWrite(PRODUCTS_FILE, products));
  return productsWriteQueue;
}

function serializeSessions() {
  return [...sessions.values()];
}

function persistSessions() {
  sessionsWriteQueue = sessionsWriteQueue
    .catch(() => undefined)
    .then(() => atomicWrite(SESSIONS_FILE, serializeSessions()));
  return sessionsWriteQueue;
}

function cleanupExpiredSessions() {
  let changed = false;
  for (const [tokenHash, session] of sessions) {
    if (session.expiresAt <= now()) {
      sessions.delete(tokenHash);
      changed = true;
    }
  }
  if (changed) void persistSessions();
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function sessionCookie(token) {
  return serializeCookie(COOKIE_NAME, token, {
    maxAge: SESSION_TTL_MS / 1000,
    sameSite: 'Lax',
    secure: IS_PRODUCTION,
  });
}

function expiredSessionCookie() {
  return serializeCookie(COOKIE_NAME, '', {
    maxAge: 0,
    sameSite: 'Lax',
    secure: IS_PRODUCTION,
  });
}

function getSession(req) {
  cleanupExpiredSessions();
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = sessions.get(tokenHash);
  if (!session || session.expiresAt <= now()) return null;
  return { token, tokenHash, session };
}

function createSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const session = {
    tokenHash,
    username,
    csrfToken: crypto.randomBytes(24).toString('base64url'),
    createdAt: now(),
    expiresAt: now() + SESSION_TTL_MS,
  };
  sessions.set(tokenHash, session);
  void persistSessions();
  return { token, session };
}

function destroySession(auth) {
  if (!auth) return;
  sessions.delete(auth.tokenHash);
  void persistSessions();
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'"
  );
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  securityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(extraHeaders)) response.setHeader(key, value);
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, message) {
  securityHeaders(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.end(message);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (total === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }));
      }
    });

    request.on('error', reject);
  });
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const forwardedHost = request.headers['x-forwarded-host'];
    const trustedHosts = [request.headers.host, forwardedHost]
      .filter(Boolean)
      .flatMap((value) => String(value).split(',').map((part) => part.trim()));
    return trustedHosts.includes(originHost);
  } catch {
    return false;
  }
}

function requireAdmin(request, response, { csrf = true } = {}) {
  if (!isSameOrigin(request)) {
    sendJson(response, 403, { message: 'Permintaan lintas origin ditolak.' });
    return null;
  }

  const auth = getSession(request);
  if (!auth) {
    sendJson(response, 401, { message: 'Sesi admin tidak valid atau sudah berakhir.' });
    return null;
  }

  if (csrf && request.headers['x-csrf-token'] !== auth.session.csrfToken) {
    sendJson(response, 403, { message: 'Token keamanan tidak valid.' });
    return null;
  }

  return auth;
}

function getClientAddress(request) {
  return request.socket.remoteAddress || 'unknown';
}

function loginRateLimit(address) {
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 8;
  const timestamp = now();
  const current = (loginAttempts.get(address) || []).filter((entry) => timestamp - entry < windowMs);
  loginAttempts.set(address, current);
  return {
    blocked: current.length >= maxAttempts,
    retryAfter: current.length ? Math.ceil((windowMs - (timestamp - current[0])) / 1000) : 0,
  };
}

function registerLoginFailure(address) {
  const current = loginAttempts.get(address) || [];
  current.push(now());
  loginAttempts.set(address, current);
}

function resetLoginFailures(address) {
  loginAttempts.delete(address);
}

function safeUrl(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} wajib diisi.`);
  }
  if (value.length > 2_000) throw new Error(`${fieldName} terlalu panjang.`);

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${fieldName} harus berupa URL yang valid.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${fieldName} harus menggunakan HTTP atau HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${fieldName} tidak boleh memuat kredensial.`);
  }
  return parsed.toString();
}

function nextProductId() {
  let id = Date.now();
  while (productById(id) !== -1) id += 1;
  return id;
}

function normalizeProduct(input, existingId = null) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const price = Number(input.price);

  if (!name || name.length > 140) throw new Error('Nama produk wajib diisi dan maksimal 140 karakter.');
  if (!description || description.length > 600) throw new Error('Deskripsi wajib diisi dan maksimal 600 karakter.');
  if (!Number.isSafeInteger(price) || price < 0 || price > 999_999_999) {
    throw new Error('Harga harus berupa angka Rupiah yang valid.');
  }

  return {
    id: existingId ?? nextProductId(),
    name,
    image: safeUrl(input.image, 'URL gambar'),
    description,
    price,
    shopeeLink: safeUrl(input.shopeeLink, 'Link Shopee afiliasi'),
  };
}

function productById(id) {
  return products.findIndex((product) => String(product.id) === String(id));
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    sendText(response, 400, 'Bad Request');
    return;
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    const file = await fsp.readFile(filePath);
    securityHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    response.setHeader('Cache-Control', path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600');
    response.end(file);
  } catch (error) {
    if (error.code === 'ENOENT') sendText(response, 404, 'Not Found');
    else {
      console.error('Static file error:', error);
      sendText(response, 500, 'Internal Server Error');
    }
  }
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === 'GET' && pathname === '/api/products') {
    sendJson(response, 200, { products });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/auth/me') {
    const auth = getSession(request);
    sendJson(response, 200, auth
      ? {
          authenticated: true,
          user: { username: auth.session.username },
          csrfToken: auth.session.csrfToken,
          expiresAt: auth.session.expiresAt,
        }
      : { authenticated: false });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/login') {
    if (!isSameOrigin(request)) {
      sendJson(response, 403, { message: 'Permintaan lintas origin ditolak.' });
      return;
    }

    const address = getClientAddress(request);
    const rate = loginRateLimit(address);
    if (rate.blocked) {
      sendJson(response, 429, { message: 'Terlalu banyak percobaan. Coba lagi nanti.' }, { 'Retry-After': String(rate.retryAfter) });
      return;
    }

    let body;
    try {
      body = await readRequestBody(request);
    } catch (error) {
      sendJson(response, error.statusCode || 400, { message: error.message });
      return;
    }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const usernameValid = username === ADMIN_USERNAME;
    const passwordValid = password.length > 0 && await verifyAdminPassword(password);

    if (!usernameValid || !passwordValid) {
      registerLoginFailure(address);
      sendJson(response, 401, { message: 'Username atau Password salah!' });
      return;
    }

    resetLoginFailures(address);
    const created = createSession(username);
    sendJson(response, 200, {
      authenticated: true,
      user: { username },
      csrfToken: created.session.csrfToken,
      expiresAt: created.session.expiresAt,
    }, { 'Set-Cookie': sessionCookie(created.token) });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/auth/logout') {
    const auth = requireAdmin(request, response);
    if (!auth) return;
    destroySession(auth);
    sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': expiredSessionCookie() });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/products') {
    if (!requireAdmin(request, response)) return;
    let body;
    try {
      body = await readRequestBody(request);
    } catch (error) {
      sendJson(response, error.statusCode || 400, { message: error.message });
      return;
    }

    try {
      const product = normalizeProduct(body);
      products.unshift(product);
      await persistProducts();
      sendJson(response, 201, { product });
    } catch (error) {
      sendJson(response, 400, { message: error.message });
    }
    return;
  }

  const productMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (productMatch && request.method === 'PUT') {
    if (!requireAdmin(request, response)) return;
    const index = productById(decodeURIComponent(productMatch[1]));
    if (index === -1) {
      sendJson(response, 404, { message: 'Produk tidak ditemukan.' });
      return;
    }

    let body;
    try {
      body = await readRequestBody(request);
    } catch (error) {
      sendJson(response, error.statusCode || 400, { message: error.message });
      return;
    }

    try {
      const product = normalizeProduct(body, products[index].id);
      products[index] = product;
      await persistProducts();
      sendJson(response, 200, { product });
    } catch (error) {
      sendJson(response, 400, { message: error.message });
    }
    return;
  }

  if (productMatch && request.method === 'DELETE') {
    if (!requireAdmin(request, response)) return;
    const index = productById(decodeURIComponent(productMatch[1]));
    if (index === -1) {
      sendJson(response, 404, { message: 'Produk tidak ditemukan.' });
      return;
    }

    const [deleted] = products.splice(index, 1);
    await persistProducts();
    sendJson(response, 200, { product: deleted });
    return;
  }

  sendJson(response, 404, { message: 'Endpoint tidak ditemukan.' });
}

async function requestHandler(request, response) {
  securityHeaders(response);

  if (!request.url) {
    sendText(response, 400, 'Bad Request');
    return;
  }

  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendText(response, 400, 'Bad Request');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendText(response, 405, 'Method Not Allowed');
    return;
  }

  const staticAliases = {
    '/home': '/home.html',
    '/produk': '/produk.html',
    '/cara-kerja': '/cara-kerja.html',
  };
  await serveStatic(request, response, staticAliases[url.pathname] || url.pathname);
}

async function bootstrap() {
  await ensureDataFiles();

  const loadedProducts = await readJson(PRODUCTS_FILE, []);
  products = Array.isArray(loadedProducts) ? loadedProducts : [];

  const loadedSessions = await readJson(SESSIONS_FILE, []);
  if (Array.isArray(loadedSessions)) {
    for (const session of loadedSessions) {
      if (session && typeof session.tokenHash === 'string' && session.expiresAt > now()) {
        sessions.set(session.tokenHash, session);
      }
    }
  }

  passwordSalt = crypto.randomBytes(16);
  passwordHash = crypto.scryptSync(ADMIN_PASSWORD, passwordSalt, 64, { N: 16_384, r: 8, p: 1 });

  const server = http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      console.error('Unhandled request error:', error);
      if (!response.headersSent) sendJson(response, 500, { message: 'Terjadi kesalahan pada server.' });
      else response.destroy();
    });
  });

  server.listen(PORT, HOST, () => {
    console.log(`ommamarket running on http://${HOST}:${PORT}`);
    if (!IS_PRODUCTION && !process.env.ADMIN_PASSWORD) {
      console.warn('Using the development admin password fallback. Set ADMIN_PASSWORD before deployment.');
    }
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error('Could not start ommamarket:', error);
  process.exit(1);
});
