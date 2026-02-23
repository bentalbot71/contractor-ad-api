const express = require('express');
const Database = require('better-sqlite3');
const app = express();
app.use(express.json());

const DB_PATH = process.env.SQLITE_DB_PATH || '/data/contractor_ads.db';
const INTERNAL_KEY = process.env.INTERNAL_WEBHOOK_KEY;
const PORT = process.env.PORT || 3001;

const auth = (req, res, next) => {
  if (req.headers['x-internal-key'] !== INTERNAL_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

function getDb() {
  const db = new Database(DB_PATH);
  db.exec(`
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
    );
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
    );
  `);
  return db;
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// POST /api/webhook/ads/create
app.post('/api/webhook/ads/create', auth, (req, res) => {
  try {
    const { ad_content, budget, status, metadata } = req.body;
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO ads (service_type, location, status, budget, max_daily_spend, image_url, customer_phone, ad_content, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metadata.service_type,
      metadata.location,
      status || 'pending_approval',
      budget,
      metadata.max_daily_spend,
      metadata.image_url,
      metadata.customer_phone,
      typeof ad_content === 'string' ? ad_content : JSON.stringify(ad_content),
      JSON.stringify(metadata)
    );
    db.close();
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ads/:id
app.get('/api/ads/:id', auth, (req, res) => {
  try {
    const db = getDb();
    const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
    db.close();
    if (!ad) return res.status(404).json({ error: 'Not found' });
    res.json(ad);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/ads/:id
app.patch('/api/ads/:id', auth, (req, res) => {
  try {
    const db = getDb();
    const fields = req.body;
    const allowedFields = ['status', 'campaign_id', 'ad_set_id', 'fb_ad_ids', 'notes', 'error_details'];
    const toUpdate = Object.keys(fields).filter(k => allowedFields.includes(k));
    if (toUpdate.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    const sets = toUpdate.map(k => `${k} = ?`).join(', ');
    const values = [...toUpdate.map(k => fields[k]), req.params.id];
    db.prepare(`UPDATE ads SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values);
    db.close();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ads/by-campaign/:campaign_id
app.get('/api/ads/by-campaign/:campaign_id', auth, (req, res) => {
  try {
    const db = getDb();
    const ad = db.prepare('SELECT * FROM ads WHERE campaign_id = ?').get(req.params.campaign_id);
    db.close();
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
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO leads (lead_id, campaign_id, ad_id, name, email, phone, zip_code, service_interest, message, created_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(lead_id, campaign_id, ad_id, name, email, phone, zip_code, service_interest, message, created_time);
    db.close();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
```

4. Click **Commit changes** → **Commit changes**

---

Your repo now has 2 files and looks like this:
```
contractor-ad-api/
  index.js
  package.json
