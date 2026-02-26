const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────
const INTERNAL_KEY = process.env.INTERNAL_WEBHOOK_KEY || 'supersecret-key-2026';

function auth(req, res, next) {
  const key = req.headers['x-internal-key'] || req.headers['internal_webhook_key'];
  if (key !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Database setup ───────────────────────────────────────────
const DB_PATH = process.env.SQLITE_DB_PATH || path.join('/tmp', 'contractor_ads.db');
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    location TEXT,
    status TEXT DEFAULT 'pending_approval',
    campaign_id TEXT,
    ad_set_id TEXT,
    budget REAL,
    max_daily_spend REAL,
    image_url TEXT,
    customer_phone TEXT,
    ad_content TEXT,
    metadata TEXT,
    error_details TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
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

console.log('Database ready at:', DB_PATH);

// ── Health check ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Contractor Ad API running' });
});

// ── POST /api/webhook/ads/create ─────────────────────────────
app.post('/api/webhook/ads/create', auth, (req, res) => {
  try {
    const { ad_content, budget, status, metadata } = req.body;

    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

    if (!meta || !meta.service_type) {
      return res.status(400).json({ error: 'Missing metadata.service_type', received: req.body });
    }

    const result = db.prepare(`
      INSERT INTO ads (service_type, location, status, budget, max_daily_spend, image_url, customer_phone, ad_content, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      meta.service_type,
      meta.location || '',
      status || 'pending_approval',
      budget || 0,
      meta.max_daily_spend || 50,
      meta.image_url || '',
      meta.customer_phone || '',
      typeof ad_content === 'string' ? ad_content : JSON.stringify(ad_content),
      JSON.stringify(meta)
    );

    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error('Create ad error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/ads/:id ─────────────────────────────────────────
app.get('/api/ads/:id', auth, (req, res) => {
  try {
    const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    res.json(ad);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/ads/:id ───────────────────────────────────────
app.patch('/api/ads/:id', auth, (req, res) => {
  try {
    const fields = req.body;
    const allowed = ['status', 'campaign_id', 'ad_set_id', 'error_details', 'notes'];
    const updates = Object.keys(fields).filter(k => allowed.includes(k));

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const setClause = updates.map(k => `${k} = ?`).join(', ');
    const values = updates.map(k => fields[k]);

    db.prepare(`UPDATE ads SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...values, req.params.id);

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/ads/by-campaign/:campaign_id ────────────────────
app.get('/api/ads/by-campaign/:campaign_id', auth, (req, res) => {
  try {
    const ad = db.prepare('SELECT * FROM ads WHERE campaign_id = ? LIMIT 1').get(req.params.campaign_id);
    if (!ad) return res.status(404).json({ error: 'Ad not found' });
    res.json(ad);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start server ─────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
