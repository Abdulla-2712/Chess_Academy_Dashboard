const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

const UPLOAD_REL = 'messages';
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const messagesDir = path.join(uploadsRoot, 'messages');

fs.mkdirSync(messagesDir, { recursive: true });

const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, messagesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const useExt = allowedExt.has(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${useExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExt.has(ext)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
    }
    cb(null, true);
  },
});

function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Image must be 5MB or less' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Only jpg, png, gif, or webp images are allowed' });
    }
    return res.status(400).json({ error: err.message || 'Upload error' });
  }
  next(err);
}

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function webPathFromRelative(rel) {
  if (!rel) return null;
  const normalized = rel.replace(/^\//, '');
  return `/uploads/${normalized}`;
}

function diskPathFromRelative(rel) {
  if (!rel) return null;
  const normalized = rel.replace(/^\//, '').replace(/^uploads\//, '');
  return path.join(uploadsRoot, normalized);
}

function deleteImageFile(relPath) {
  if (!relPath) return;
  const full = path.resolve(diskPathFromRelative(relPath));
  const safeRoot = path.resolve(messagesDir);
  if (!full.startsWith(safeRoot)) return;
  if (fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch (e) {
      console.error('Delete image file error:', e.message);
    }
  }
}

function selectMessageRow() {
  return `m.id, m.coach_id, m.level_id, m.session_number, m.title, m.message_text, m.image_path,
          m.is_public, m.created_at, m.updated_at, c.name AS owner_name`;
}

// GET /api/messages?level_id=&session_number= (session_number optional — omit for all sessions in level)
router.get('/', auth, async (req, res) => {
  try {
    const levelId = req.query.level_id;
    if (!levelId) {
      return res.status(400).json({ error: 'level_id is required' });
    }

    const sessionNum = req.query.session_number;
    const params = [levelId, req.coach.id];
    let sql = `
      SELECT ${selectMessageRow()}
      FROM session_messages m
      JOIN coaches c ON m.coach_id = c.id
      WHERE m.level_id = $1
        AND (m.is_public = TRUE OR m.coach_id = $2)`;

    if (sessionNum !== undefined && sessionNum !== '') {
      const n = parseInt(sessionNum, 10);
      if (Number.isNaN(n) || n < 1 || n > 8) {
        return res.status(400).json({ error: 'session_number must be between 1 and 8' });
      }
      sql += ` AND m.session_number = $3`;
      params.push(n);
    }

    sql += ` ORDER BY m.session_number ASC, m.created_at DESC`;

    const result = await pool.query(sql, params);
    const rows = result.rows.map((row) => ({
      ...row,
      image_url: row.image_path ? webPathFromRelative(row.image_path) : null,
    }));
    res.json(rows);
  } catch (err) {
    console.error('List messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/messages/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const result = await pool.query(
      `SELECT ${selectMessageRow()}
       FROM session_messages m
       JOIN coaches c ON m.coach_id = c.id
       WHERE m.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const row = result.rows[0];
    if (!row.is_public && row.coach_id !== req.coach.id) {
      return res.status(403).json({ error: 'Not allowed to view this message' });
    }

    res.json({
      ...row,
      image_url: row.image_path ? webPathFromRelative(row.image_path) : null,
    });
  } catch (err) {
    console.error('Get message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/messages
router.post('/', auth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return multerErrorHandler(err, req, res, next);
    next();
  });
}, async (req, res) => {
  try {
    const { title, message_text, level_id, session_number } = req.body;
    const is_public = parseBool(req.body.is_public, false);

    if (!message_text || !String(message_text).trim()) {
      return res.status(400).json({ error: 'message_text is required' });
    }
    if (!level_id) {
      return res.status(400).json({ error: 'level_id is required' });
    }
    const sn = parseInt(session_number, 10);
    if (Number.isNaN(sn) || sn < 1 || sn > 8) {
      return res.status(400).json({ error: 'session_number must be between 1 and 8' });
    }

    const levelCheck = await pool.query('SELECT id FROM levels WHERE id = $1', [level_id]);
    if (levelCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid level' });
    }

    let imageRel = null;
    if (req.file) {
      imageRel = path.join(UPLOAD_REL, req.file.filename).replace(/\\/g, '/');
    }

    const insert = await pool.query(
      `INSERT INTO session_messages (coach_id, level_id, session_number, title, message_text, image_path, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.coach.id,
        level_id,
        sn,
        title && String(title).trim() ? String(title).trim() : null,
        String(message_text).trim(),
        imageRel,
        is_public,
      ]
    );

    const owner = await pool.query('SELECT name FROM coaches WHERE id = $1', [req.coach.id]);
    const row = insert.rows[0];
    res.status(201).json({
      ...row,
      owner_name: owner.rows[0]?.name || req.coach.name,
      image_url: row.image_path ? webPathFromRelative(row.image_path) : null,
    });
  } catch (err) {
    console.error('Create message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id
router.put('/:id', auth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return multerErrorHandler(err, req, res, next);
    next();
  });
}, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const existing = await pool.query('SELECT * FROM session_messages WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (existing.rows[0].coach_id !== req.coach.id) {
      return res.status(403).json({ error: 'Only the owner can edit this message' });
    }

    const prev = existing.rows[0];
    const { title, message_text } = req.body;
    const is_public = req.body.is_public !== undefined ? parseBool(req.body.is_public, false) : prev.is_public;
    const remove_image = parseBool(req.body.remove_image, false);

    if (!message_text || !String(message_text).trim()) {
      return res.status(400).json({ error: 'message_text is required' });
    }

    let imageRel = prev.image_path;
    if (remove_image) {
      deleteImageFile(prev.image_path);
      imageRel = null;
    }
    if (req.file) {
      deleteImageFile(prev.image_path);
      imageRel = path.join(UPLOAD_REL, req.file.filename).replace(/\\/g, '/');
    }

    const result = await pool.query(
      `UPDATE session_messages
       SET title = $1, message_text = $2, image_path = $3, is_public = $4, updated_at = NOW()
       WHERE id = $5 AND coach_id = $6
       RETURNING *`,
      [
        title !== undefined ? (String(title).trim() || null) : prev.title,
        String(message_text).trim(),
        imageRel,
        is_public,
        id,
        req.coach.id,
      ]
    );

    const row = result.rows[0];
    const owner = await pool.query('SELECT name FROM coaches WHERE id = $1', [req.coach.id]);
    res.json({
      ...row,
      owner_name: owner.rows[0]?.name || req.coach.name,
      image_url: row.image_path ? webPathFromRelative(row.image_path) : null,
    });
  } catch (err) {
    console.error('Update message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/messages/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const existing = await pool.query('SELECT * FROM session_messages WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (existing.rows[0].coach_id !== req.coach.id) {
      return res.status(403).json({ error: 'Only the owner can delete this message' });
    }

    deleteImageFile(existing.rows[0].image_path);

    await pool.query('DELETE FROM session_messages WHERE id = $1 AND coach_id = $2', [id, req.coach.id]);
    res.json({ message: 'Message deleted' });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
