const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..', 'public');     // static files
const DATA_DIR = path.join(__dirname, '..', 'data');   // runtime data
const DATA_FILE = path.join(DATA_DIR, 'data.json');    // legacy JSON migration
const DB_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, 'vah-health.db');
const sessions = new Map();

const database = new DatabaseSync(DB_FILE);
database.exec('PRAGMA journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    state_json TEXT
  )
`);

function migrateJsonDatabase() {
  const userCount = database.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount > 0 || !fs.existsSync(DATA_FILE)) return;

  try {
    const legacy = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const insert = database.prepare(`
      INSERT OR IGNORE INTO users (email, name, password_hash, state_json)
      VALUES (@email, @name, @passwordHash, @state)
    `);
    for (const user of Object.values(legacy.users || {})) {
      insert.run({
        email: user.email,
        name: user.name,
        passwordHash: user.passwordHash,
        state: user.state ? JSON.stringify(user.state) : null
      });
    }
    console.log('Imported existing users from data.json into SQLite.');
  } catch (error) {
    console.error('Could not migrate data.json:', error.message);
  }
}

migrateJsonDatabase();

function getUser(email) {
  const row = database.prepare('SELECT email, name, password_hash, state_json FROM users WHERE email = ?').get(email);
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    state: row.state_json ? JSON.parse(row.state_json) : null
  };
}

function saveUser(user) {
  database.prepare(`
    INSERT INTO users (email, name, password_hash, state_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      state_json = excluded.state_json
  `).run(user.email, user.name, user.passwordHash, user.state ? JSON.stringify(user.state) : null);
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  });
  response.end(JSON.stringify(payload));
}

function getBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function authenticatedUser(request) {
  const authHeader = request.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const email = sessions.get(token);
  return email ? getUser(email) : null;
}

function userResponse(user) {
  return { name: user.name, email: user.email };
}

function handleApi(request, response, pathname) {
  if (request.method === 'POST' && (pathname === '/api/auth/register' || pathname === '/api/auth/login')) {
    return getBody(request).then(body => {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || !password) return sendJson(response, 400, { error: 'Email and password are required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(response, 400, { error: 'Enter a valid email address.' });
      }
      if (password.length < 8) {
        return sendJson(response, 400, { error: 'Password must be at least 8 characters.' });
      }

      const existing = getUser(email);
      if (pathname.endsWith('/register')) {
        if (existing) return sendJson(response, 409, { error: 'An account with this email already exists.' });
        if (!String(body.name || '').trim()) return sendJson(response, 400, { error: 'Full name is required.' });
        const newUser = {
          name: String(body.name || 'Alex Patel').trim() + ' (Student)',
          email,
          passwordHash: hashPassword(password),
          state: null
        };
        saveUser(newUser);
      } else {
        if (!existing || existing.passwordHash !== hashPassword(password)) {
          return sendJson(response, 401, { error: 'Invalid email or password.' });
        }
      }

      const user = getUser(email);
      const token = createToken();
      sessions.set(token, email);
      return sendJson(response, 200, { token, user: userResponse(user), state: user.state });
    }).catch(error => sendJson(response, 400, { error: error.message }));
  }

  if (request.method === 'GET' && pathname === '/api/state') {
    const user = authenticatedUser(request);
    if (!user) return sendJson(response, 401, { error: 'Authentication required.' });
    return sendJson(response, 200, { state: user.state });
  }

  if (request.method === 'PUT' && pathname === '/api/state') {
    const user = authenticatedUser(request);
    if (!user) return sendJson(response, 401, { error: 'Authentication required.' });
    return getBody(request).then(body => {
      user.state = body.state || null;
      saveUser(user);
      sendJson(response, 200, { state: user.state });
    }).catch(error => sendJson(response, 400, { error: error.message }));
  }

  if (request.method === 'POST' && pathname === '/api/demo') {
    const email = 'demo@vah.health';
    let user = getUser(email);
    if (!user) {
      user = {
        name: 'Alex Patel (Student)',
        email,
        passwordHash: hashPassword(crypto.randomBytes(16).toString('hex')),
        state: null
      };
      saveUser(user);
    }
    const token = createToken();
    sessions.set(token, email);
    return sendJson(response, 200, { token, user: userResponse(user), state: user.state });
  }

  return sendJson(response, 404, { error: 'API route not found.' });
}

function serveStatic(request, response, pathname) {
  const requestedPath = pathname === '/' ? '/main.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, requestedPath));
  if (!filePath.startsWith(ROOT)) return sendJson(response, 403, { error: 'Forbidden.' });

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return response.end('Not found');
    }
    const extension = path.extname(filePath);
    const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (request.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
    });
    return response.end();
  }
  if (pathname.startsWith('/api/')) return handleApi(request, response, pathname);
  serveStatic(request, response, pathname);
});

server.listen(PORT, () => {
  console.log(`VAH Health is running at http://localhost:${PORT}`);
});
