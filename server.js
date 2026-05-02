require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const sessionRoutes = require('./routes/sessions');
const earningsRoutes = require('./routes/earnings');
const holidayRoutes = require('./routes/holidays');
const messageRoutes = require('./routes/messages');
const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(path.join(uploadsDir, 'messages'), { recursive: true });
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/earnings', earningsRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/messages', messageRoutes);

// Levels endpoint (public — needed for dropdowns)
app.get('/api/levels', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM levels ORDER BY level_number');
    res.json(result.rows);
  } catch (err) {
    console.error('Get levels error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  // Check if the path has an extension (e.g., .html)
  if (path.extname(req.path)) {
    return res.sendFile(path.join(__dirname, 'public', req.path));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`♟️  Chess Trainer running on port ${PORT}`);
});
