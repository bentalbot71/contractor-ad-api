const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DB_PATH = process.env.SQLITE_DB_PATH || '/app/data/contractor_ads.db';
const INTERNAL_KEY = process.env.INTERNAL_WEBHOOK_KEY;
const PORT = process.env.PORT || 3001;

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Auth middleware
const auth = (req, res, next) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Load or create DB
let SQL;
let db;

async function initDb() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL,
      location TEXT NOT NULL,
      status TEXT DEFAULT 'pending_approval',
      campaign_id TEXT,
      ad_set_id TEXT,
      fb_ad_ids TEXT,
      budget REAL,
      max_daily_spend REAL,
      image_url TEXT,
      customer_phone TEXT,
      ad_content TEXT,
      metadata TEXT,
      notes TEXT,
      error_details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT UNIQUE,
      campaign_id TEXT,
      ad_id TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      zip_code TEXT,
      service_interest TEXT,
      message TEXT,
      created_time TEXT,
      logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDb();
  console.log('Database initialized at', DB_PATH);
}

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  // Get last insert rowid
  const result = queryOne('SELECT last_insert_rowid() as id');
  return { lastInsertRowid: result ? result['last_insert_rowid()'] : null };
}

// ── Routes ──────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// POST /api/webhook/ads/create
app.post('/api/webhook/ads/create', auth, (req, res) => {
  try {
    const { ad_content, budget, status, metadata } = req.body;
    const result = run(
      `INSERT INTO ads (service_type, location, status, budget, max_daily_spend, image_url, customer_phone, ad_content, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metadata.service_type,
        metadata.location,
        status || 'pending_approval',
        budget,
        metadata.max_daily_spend,
        metadata.image_url,
        metadata.customer_phone,
        typeof ad_content === 'string' ? ad_content : JSON.stringify(ad_content),
        JSON.stringify(metadata)
      ]
    );
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ads/:id
app.get('/api/ads/:id', auth, (req, res) => {
  try {
    const ad = queryOne('SELECT * FROM ads WHERE id = ?', [req.params.id]);
    if (!ad) return res.status(404).json({ error: 'Not found' });
    res.json(ad);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/ads/:id
app.patch('/api/ads/:id', auth, (req, res) => {
  try {
    const fields = req.body;
    const allowed = ['status', 'campaign_id', 'ad_set_id', 'fb_ad_ids', 'notes', 'error_details'];
    const toUpdate = Object.keys(fields).filter(k => allowed.includes(k));
    if (toUpdate.length === 0) return res.status(400).json({ error: 'No valid fields' });
    const sets = toUpdate.map(k => `${k} = ?`).join(', ');
    const values = [...toUpdate.map(k => fields[k]), req.params.id];
    run(`UPDATE ads SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ads/by-campaign/:campaign_id
app.get('/api/ads/by-campaign/:campaign_id', auth, (req, res) => {
  try {
    const ad = queryOne('SELECT * FROM ads WHERE campaign_id = ?', [req.params.campaign_id]);
    if (!ad) return res.status(404).json({ error: 'Not found' });
    res.json(ad);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/leads
app.post('/api/leads', auth, (req, res) => {
  try {
    const { lead_id, campaign_id, ad_id, name, email, phone, zip_code, service_interest, message, created_time } = req.body;
    run(
      `INSERT OR IGNORE INTO leads (lead_id, campaign_id, ad_id, name, email, phone, zip_code, service_interest, message, created_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id, campaign_id, ad_id, name, email, phone, zip_code, service_interest, message, created_time]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => console.log(`Running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
