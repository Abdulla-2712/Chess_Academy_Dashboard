const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();

function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Check if a date string falls within any holiday range
function isInHoliday(dateStr, holidays) {
  return holidays.some(h => dateStr >= h.start_date && dateStr <= h.end_date);
}

// GET /api/holidays
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name,
              TO_CHAR(start_date, 'YYYY-MM-DD') as start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') as end_date,
              created_at
       FROM holidays WHERE coach_id = $1 ORDER BY start_date`,
      [req.coach.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get holidays error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/holidays — add holiday and shift affected sessions
router.post('/', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date) {
      return res.status(400).json({ error: 'Name, start date, and end date are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
    }
    if (start_date > end_date) {
      return res.status(400).json({ error: 'Start date must be before end date' });
    }

    await client.query('BEGIN');

    // Save the holiday
    await client.query(
      `INSERT INTO holidays (coach_id, name, start_date, end_date) VALUES ($1, $2, $3, $4)`,
      [req.coach.id, name, start_date, end_date]
    );

    // Fetch ALL current holidays for this coach (including the new one) for overlap checks
    const allHolidaysResult = await client.query(
      `SELECT TO_CHAR(start_date,'YYYY-MM-DD') as start_date, TO_CHAR(end_date,'YYYY-MM-DD') as end_date
       FROM holidays WHERE coach_id = $1`,
      [req.coach.id]
    );
    const allHolidays = allHolidaysResult.rows;

    // Get all pending/delayed sessions from coach's groups, ordered by group + session number
    const sessionsResult = await client.query(
      `SELECT s.id, s.group_id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date
       FROM sessions s
       JOIN groups g ON s.group_id = g.id
       WHERE g.coach_id = $1
         AND s.status IN ('pending', 'excused_delayed')
       ORDER BY s.group_id, s.session_number`,
      [req.coach.id]
    );

    let affectedSessions = 0;
    const affectedGroups = new Set();

    // Group sessions by group_id
    const byGroup = {};
    sessionsResult.rows.forEach(s => {
      if (!byGroup[s.group_id]) byGroup[s.group_id] = [];
      byGroup[s.group_id].push(s);
    });

    // For each group, shift affected sessions and maintain weekly spacing
    for (const [groupId, sessions] of Object.entries(byGroup)) {
      let shifted = false;

      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const originalDate = s.scheduled_date;

        // Check if this session falls in a holiday
        if (isInHoliday(originalDate, allHolidays)) {
          // Shift forward until clear
          let newDate = parseLocalDate(originalDate);
          do {
            newDate.setDate(newDate.getDate() + 7);
          } while (isInHoliday(dateToStr(newDate), allHolidays));

          const newDateStr = dateToStr(newDate);
          await client.query(
            `UPDATE sessions SET scheduled_date = $1, is_rescheduled = TRUE WHERE id = $2`,
            [newDateStr, s.id]
          );
          sessions[i] = { ...s, scheduled_date: newDateStr };
          affectedSessions++;
          affectedGroups.add(parseInt(groupId));
          shifted = true;
        } else if (shifted) {
          // All subsequent sessions must also shift by 7 days to maintain spacing
          const newDate = parseLocalDate(s.scheduled_date);
          newDate.setDate(newDate.getDate() + 7);
          let newDateStr = dateToStr(newDate);
          // Also check if new date is in a holiday
          while (isInHoliday(newDateStr, allHolidays)) {
            const d = parseLocalDate(newDateStr);
            d.setDate(d.getDate() + 7);
            newDateStr = dateToStr(d);
          }
          await client.query(
            `UPDATE sessions SET scheduled_date = $1, is_rescheduled = TRUE WHERE id = $2`,
            [newDateStr, s.id]
          );
          sessions[i] = { ...s, scheduled_date: newDateStr };
          affectedSessions++;
          affectedGroups.add(parseInt(groupId));
        }
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: `${affectedSessions} sessions across ${affectedGroups.size} groups have been shifted`,
      affected_sessions: affectedSessions,
      affected_groups: affectedGroups.size,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Add holiday error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM holidays WHERE id = $1 AND coach_id = $2 RETURNING id',
      [req.params.id, req.coach.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    res.json({ message: 'Holiday deleted (sessions are not auto-reversed)' });
  } catch (err) {
    console.error('Delete holiday error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
