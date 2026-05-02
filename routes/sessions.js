const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

// Helper: format date parts safely to YYYY-MM-DD without timezone issues
function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Helper: parse YYYY-MM-DD as local date
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// GET /api/sessions/today — today's sessions for dashboard
router.get('/today', auth, async (req, res) => {
  try {
    const today = dateToStr(new Date());
    const result = await pool.query(
      `SELECT s.id, s.group_id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text, s.status, s.notes, s.is_rescheduled,
              g.name as group_name,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as group_start_date,
              l.level_number, l.price_per_session
       FROM sessions s
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE g.coach_id = $1
         AND (s.scheduled_date = $2 OR (s.status = 'excused_delayed' AND s.scheduled_date <= $2))
       ORDER BY s.scheduled_time`,
      [req.coach.id, today]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get today sessions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/sessions/:id/status — update session status
router.patch('/:id/status', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { status, notes } = req.body;
    // excused_absence from the UI maps to excused_delayed in the DB
    const dbStatus = status === 'excused_absence' ? 'excused_delayed' : status;
    const validStatuses = ['pending', 'confirmed', 'excused_absence', 'excused_delayed', 'no_show', 'substitute_given', 'substitute_taken'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    // Verify the session belongs to the coach
    const sessionResult = await client.query(
      `SELECT s.id, s.group_id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text, s.status,
              g.coach_id,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as group_start_date,
              g.id as gid,
              l.price_per_session, l.level_number
       FROM sessions s
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE s.id = $1`,
      [req.params.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const session = sessionResult.rows[0];
    if (session.coach_id !== req.coach.id) {
      return res.status(403).json({ error: 'Not your session' });
    }

    await client.query('BEGIN');

    // Delete any existing earnings for this session and coach (allow status re-assignment)
    await client.query(
      'DELETE FROM earnings WHERE session_id = $1 AND coach_id = $2',
      [req.params.id, req.coach.id]
    );

    // Build update fields
    const updateFields = ['status = $1'];
    const updateValues = [dbStatus];
    let paramIdx = 2;

    if (notes !== undefined) {
      updateFields.push(`notes = $${paramIdx++}`);
      updateValues.push(notes);
    }

    updateValues.push(req.params.id);
    await client.query(
      `UPDATE sessions SET ${updateFields.join(', ')} WHERE id = $${paramIdx}`,
      updateValues
    );

    // Calculate payout date for own group: last session's scheduled_date
    const lastSessionResult = await client.query(
      `SELECT TO_CHAR(MAX(scheduled_date), 'YYYY-MM-DD') as last_date
       FROM sessions WHERE group_id = $1`,
      [session.gid]
    );
    const payoutDateStr = lastSessionResult.rows[0].last_date || session.scheduled_date;

    // ===== Earning logic per status =====
    if (dbStatus === 'confirmed') {
      // ✅ Confirmed: I did this session — earn full price
      await client.query(
        `INSERT INTO earnings (coach_id, session_id, amount, earn_type, payout_date)
         VALUES ($1, $2, $3, 'own_group', $4)`,
        [req.coach.id, req.params.id, session.price_per_session, payoutDateStr]
      );
    } else if (dbStatus === 'no_show') {
      // ❌ No Show: missed without excuse, someone else covered — deduction applied
      await client.query(
        `INSERT INTO earnings (coach_id, session_id, amount, earn_type, payout_date)
         VALUES ($1, $2, $3, 'no_show_penalty', $4)`,
        [req.coach.id, req.params.id, -parseFloat(session.price_per_session), payoutDateStr]
      );
    }
    // 🔄 substitute_given: no earning, no deduction — someone else covered, counts as done
    // 🤒 excused_delayed: no earning, no deduction, does NOT count toward progress
    // 🔁 substitute_taken: handled via POST /sessions/substitute

    // Auto-complete group only when ALL sessions are resolved (not pending or excused_delayed)
    const pendingCount = await client.query(
      `SELECT COUNT(*) FROM sessions
       WHERE group_id = $1 AND status IN ('pending', 'excused_delayed')`,
      [session.gid]
    );
    if (parseInt(pendingCount.rows[0].count) === 0) {
      await client.query(
        `UPDATE groups SET status = 'completed' WHERE id = $1`,
        [session.gid]
      );
    } else {
      // Reopen group if it was completed
      await client.query(
        `UPDATE groups SET status = 'active' WHERE id = $1 AND status = 'completed'`,
        [session.gid]
      );
    }

    await client.query('COMMIT');

    // Return updated session with full info
    const updated = await pool.query(
      `SELECT s.id, s.group_id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text, s.status, s.notes, s.is_rescheduled,
              l.level_number, l.price_per_session,
              g.name as group_name
       FROM sessions s
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE s.id = $1`,
      [req.params.id]
    );

    res.json(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update session status error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/sessions/:id/notes — update session notes only
router.patch('/:id/notes', auth, async (req, res) => {
  try {
    const { notes } = req.body;

    const sessionResult = await pool.query(
      `SELECT s.id FROM sessions s
       JOIN groups g ON s.group_id = g.id
       WHERE s.id = $1 AND g.coach_id = $2`,
      [req.params.id, req.coach.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await pool.query('UPDATE sessions SET notes = $1 WHERE id = $2', [notes, req.params.id]);
    res.json({ message: 'Notes updated' });
  } catch (err) {
    console.error('Update notes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/sessions/:id — delete a single session (removes its earnings too)
router.delete('/:id', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    // Verify ownership
    const sessionResult = await client.query(
      `SELECT s.id, s.group_id FROM sessions s
       JOIN groups g ON s.group_id = g.id
       WHERE s.id = $1 AND g.coach_id = $2`,
      [req.params.id, req.coach.id]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM earnings WHERE session_id = $1', [req.params.id]);
    await client.query('DELETE FROM sessions WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');

    res.json({ message: 'Session deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Delete session error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST /api/sessions/substitute — add substitute session (I covered someone else's group)
router.post('/substitute', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { level_id, scheduled_date, scheduled_time, session_number, notes } = req.body;

    if (!level_id || !scheduled_date || !scheduled_time) {
      return res.status(400).json({ error: 'Level, date, and time are required' });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled_date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
    }

    const levelResult = await client.query('SELECT * FROM levels WHERE id = $1', [level_id]);
    if (levelResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid level' });
    }
    const level = levelResult.rows[0];

    await client.query('BEGIN');

    // Create a virtual "completed" group for this substitute session
    const [y, m, d] = scheduled_date.split('-').map(Number);
    const sessionDateObj = new Date(y, m - 1, d);
    const dayName = sessionDateObj.toLocaleDateString('en-US', { weekday: 'long' });

    const groupResult = await client.query(
      `INSERT INTO groups (coach_id, level_id, name, start_date, day_of_week, time_slot, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7)
       RETURNING id`,
      [req.coach.id, level_id, 'Substitute Session', scheduled_date, dayName, scheduled_time, notes || 'Substitute session']
    );
    const group = groupResult.rows[0];

    const sessionResult = await client.query(
      `INSERT INTO sessions (group_id, session_number, scheduled_date, scheduled_time, status, notes)
       VALUES ($1, $2, $3, $4, 'confirmed', $5)
       RETURNING id`,
      [group.id, session_number || 1, scheduled_date, scheduled_time, notes || null]
    );
    const sessionRow = sessionResult.rows[0];

    // Payout = session date + 14 days
    const payoutDate = new Date(sessionDateObj);
    payoutDate.setDate(payoutDate.getDate() + 14);
    const payoutDateStr = dateToStr(payoutDate);

    await client.query(
      `INSERT INTO earnings (coach_id, session_id, amount, earn_type, payout_date)
       VALUES ($1, $2, $3, 'substitute_taken', $4)`,
      [req.coach.id, sessionRow.id, level.price_per_session, payoutDateStr]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Substitute session added',
      earning: { amount: level.price_per_session, payout_date: payoutDateStr },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add substitute error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
