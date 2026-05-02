const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/groups — list all groups for the logged-in coach
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.coach_id, g.level_id, g.name,
              g.whatsapp_link,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as start_date,
              g.day_of_week, g.time_slot::text, g.status, g.notes, g.created_at,
              l.level_number, l.price_per_session, l.total_price,
              (SELECT COUNT(*) FROM sessions s WHERE s.group_id = g.id AND s.status IN ('confirmed', 'excused_absence', 'no_show', 'substitute_given', 'substitute_taken')) as completed_sessions
       FROM groups g
       JOIN levels l ON g.level_id = l.id
       WHERE g.coach_id = $1
       ORDER BY g.created_at DESC`,
      [req.coach.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get groups error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/groups/:id — get single group with sessions
router.get('/:id', auth, async (req, res) => {
  try {
    const groupResult = await pool.query(
      `SELECT g.id, g.coach_id, g.level_id, g.name,
              g.whatsapp_link,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as start_date,
              g.day_of_week, g.time_slot::text, g.status, g.notes, g.created_at,
              l.level_number, l.price_per_session, l.total_price
       FROM groups g
       JOIN levels l ON g.level_id = l.id
       WHERE g.id = $1 AND g.coach_id = $2`,
      [req.params.id, req.coach.id]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const sessionsResult = await pool.query(
      `SELECT s.id, s.group_id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text, s.status, s.substitute_coach_id, s.notes, s.created_at
       FROM sessions s
       WHERE s.group_id = $1
       ORDER BY s.session_number`,
      [req.params.id]
    );

    const group = groupResult.rows[0];
    group.sessions = sessionsResult.rows;
    res.json(group);
  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/groups — create a new group + auto-generate 8 sessions
router.post('/', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { level_id, start_date, day_of_week, time_slot, name, notes, whatsapp_link } = req.body;

    if (!level_id || !start_date || !day_of_week || !time_slot) {
      return res.status(400).json({ error: 'Level, start date, day of week, and time slot are required' });
    }

    // Validate start_date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      return res.status(400).json({ error: 'Start date must be in YYYY-MM-DD format' });
    }

    // Verify level exists
    const levelResult = await client.query('SELECT * FROM levels WHERE id = $1', [level_id]);
    if (levelResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid level' });
    }

    await client.query('BEGIN');

    // Create group
    const groupResult = await client.query(
      `INSERT INTO groups (coach_id, level_id, name, whatsapp_link, start_date, day_of_week, time_slot, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.coach.id,
        level_id,
        name || null,
        whatsapp_link && String(whatsapp_link).trim() ? String(whatsapp_link).trim() : null,
        start_date,
        day_of_week,
        time_slot,
        notes || null,
      ]
    );

    const group = groupResult.rows[0];

    // Auto-generate 8 sessions — always generate all 8, regardless of whether dates are past
    // Parse the start_date as a local date (YYYY-MM-DD) to avoid timezone shift
    const [year, month, day] = start_date.split('-').map(Number);
    const startDateObj = new Date(year, month - 1, day); // local date, no timezone issues

    for (let i = 0; i < 8; i++) {
      const sessionDate = new Date(startDateObj);
      sessionDate.setDate(startDateObj.getDate() + i * 7);
      // Format back to YYYY-MM-DD without timezone issues
      const y = sessionDate.getFullYear();
      const m = String(sessionDate.getMonth() + 1).padStart(2, '0');
      const d = String(sessionDate.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      await client.query(
        `INSERT INTO sessions (group_id, session_number, scheduled_date, scheduled_time)
         VALUES ($1, $2, $3, $4)`,
        [group.id, i + 1, dateStr, time_slot]
      );
    }

    await client.query('COMMIT');

    // Fetch the full group with sessions using TO_CHAR for consistent date strings
    const fullGroup = await pool.query(
      `SELECT g.id, g.coach_id, g.level_id, g.name,
              g.whatsapp_link,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as start_date,
              g.day_of_week, g.time_slot::text, g.status, g.notes, g.created_at,
              l.level_number, l.price_per_session, l.total_price
       FROM groups g JOIN levels l ON g.level_id = l.id
       WHERE g.id = $1`,
      [group.id]
    );

    const sessions = await pool.query(
      `SELECT s.id, s.group_id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text, s.status, s.substitute_coach_id, s.notes, s.created_at
       FROM sessions s
       WHERE s.group_id = $1
       ORDER BY s.session_number`,
      [group.id]
    );

    const result = fullGroup.rows[0];
    result.sessions = sessions.rows;
    res.status(201).json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/groups/:id — update group details
router.patch('/:id', auth, async (req, res) => {
  try {
    const { time_slot, notes, name, day_of_week, level_id, start_date, status, whatsapp_link } = req.body;

    // Verify ownership
    const existing = await pool.query(
      'SELECT * FROM groups WHERE id = $1 AND coach_id = $2',
      [req.params.id, req.coach.id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (time_slot !== undefined) {
      updates.push(`time_slot = $${paramIdx++}`);
      values.push(time_slot);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIdx++}`);
      values.push(notes);
    }
    if (name !== undefined) {
      updates.push(`name = $${paramIdx++}`);
      values.push(name);
    }
    if (day_of_week !== undefined) {
      updates.push(`day_of_week = $${paramIdx++}`);
      values.push(day_of_week);
    }
    if (level_id !== undefined) {
      updates.push(`level_id = $${paramIdx++}`);
      values.push(level_id);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramIdx++}`);
      values.push(start_date);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIdx++}`);
      values.push(status);
    }
    if (whatsapp_link !== undefined) {
      updates.push(`whatsapp_link = $${paramIdx++}`);
      values.push(whatsapp_link && String(whatsapp_link).trim() ? String(whatsapp_link).trim() : null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE groups SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/groups/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM groups WHERE id = $1 AND coach_id = $2 RETURNING id',
      [req.params.id, req.coach.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    res.json({ message: 'Group deleted' });
  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
