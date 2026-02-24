app.post('/api/webhook/ads/create', auth, (req, res) => {
  try {
    const { ad_content, budget, status, metadata } = req.body;
    
    // Handle metadata being either a string or object
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    
    if (!meta || !meta.service_type) {
      return res.status(400).json({ error: 'Missing metadata.service_type', received: req.body });
    }

    const result = run(
      `INSERT INTO ads (service_type, location, status, budget, max_daily_spend, image_url, customer_phone, ad_content, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meta.service_type,
        meta.location,
        status || 'pending_approval',
        budget,
        meta.max_daily_spend,
        meta.image_url,
        meta.customer_phone,
        typeof ad_content === 'string' ? ad_content : JSON.stringify(ad_content),
        JSON.stringify(meta)
      ]
    );
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    console.error('Create ad error:', e);
    res.status(500).json({ error: e.message });
  }
});
