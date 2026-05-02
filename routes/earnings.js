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

// GET /api/earnings
router.get('/', auth, async (req, res) => {
  try {
    const today = dateToStr(new Date());

    // A — Confirmed earnings
    const confirmed = await pool.query(
      `SELECT e.id, e.amount, e.earn_type, e.is_paid,
              TO_CHAR(e.payout_date, 'YYYY-MM-DD') as payout_date,
              s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text,
              l.level_number, g.name as group_name
       FROM earnings e
       JOIN sessions s ON e.session_id = s.id
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE e.coach_id = $1 AND e.earn_type IN ('own_group','substitute_taken') AND e.amount > 0
       ORDER BY e.payout_date, s.scheduled_date`,
      [req.coach.id]
    );

    // B — Expected (pending + excused_delayed)
    const expected = await pool.query(
      `SELECT s.id, s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              s.scheduled_time::text, s.status,
              l.level_number, l.price_per_session,
              g.id as group_id, g.name as group_name,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as group_start_date
       FROM sessions s
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE g.coach_id = $1 AND s.status IN ('pending','excused_delayed') AND g.status = 'active'
       ORDER BY s.scheduled_date`,
      [req.coach.id]
    );

    // C — Deductions
    const deductions = await pool.query(
      `SELECT e.id, e.amount,
              TO_CHAR(e.payout_date, 'YYYY-MM-DD') as payout_date,
              s.session_number,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              l.level_number, g.name as group_name
       FROM earnings e
       JOIN sessions s ON e.session_id = s.id
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE e.coach_id = $1 AND e.earn_type = 'no_show_penalty'
       ORDER BY s.scheduled_date`,
      [req.coach.id]
    );

    const confirmedTotal = confirmed.rows.reduce((s, e) => s + parseFloat(e.amount), 0);
    const expectedTotal = expected.rows.reduce((s, e) => s + parseFloat(e.price_per_session), 0);
    const deductionsTotal = deductions.rows.reduce((s, e) => s + Math.abs(parseFloat(e.amount)), 0);

    // ===== Payout Schedule =====
    const scheduleMap = {};

    // Own active groups: payout = last session's scheduled_date
    const activeGroups = await pool.query(
      `SELECT g.id, g.name,
              TO_CHAR(g.start_date, 'YYYY-MM-DD') as start_date,
              l.level_number, l.price_per_session,
              COUNT(s.id) FILTER (WHERE s.status IN ('pending','confirmed','excused_delayed')) as relevant_count,
              COUNT(s.id) FILTER (WHERE s.status = 'confirmed') as confirmed_count,
              TO_CHAR(MAX(s.scheduled_date), 'YYYY-MM-DD') as last_session_date
       FROM groups g
       JOIN levels l ON g.level_id = l.id
       LEFT JOIN sessions s ON s.group_id = g.id
       WHERE g.coach_id = $1 AND g.status = 'active'
       GROUP BY g.id, g.name, g.start_date, l.level_number, l.price_per_session
       ORDER BY g.start_date`,
      [req.coach.id]
    );

    activeGroups.rows.forEach(g => {
      // Payout date = last session's scheduled_date for this group
      const key = g.last_session_date || g.start_date;
      if (key < today) return;
      if (!scheduleMap[key]) scheduleMap[key] = { date: key, entries: [], total: 0 };
      const count = parseInt(g.relevant_count) || 0;
      const amount = count * parseFloat(g.price_per_session);
      if (amount > 0) {
        scheduleMap[key].entries.push({
          type: 'own_group',
          group_id: g.id,
          group_name: g.name || `Group #${g.id}`,
          level_number: g.level_number,
          sessions_count: count,
          price_per_session: g.price_per_session,
          amount,
        });
        scheduleMap[key].total += amount;
      }
    });

    // Substitute taken: payout = session_date + 14 days
    const subEarnings = await pool.query(
      `SELECT e.amount,
              TO_CHAR(e.payout_date, 'YYYY-MM-DD') as payout_date,
              TO_CHAR(s.scheduled_date, 'YYYY-MM-DD') as scheduled_date,
              l.level_number,
              s.group_id
       FROM earnings e
       JOIN sessions s ON e.session_id = s.id
       JOIN groups g ON s.group_id = g.id
       JOIN levels l ON g.level_id = l.id
       WHERE e.coach_id = $1 AND e.earn_type = 'substitute_taken' AND e.is_paid = FALSE`,
      [req.coach.id]
    );

    subEarnings.rows.forEach(e => {
      const key = e.payout_date;
      if (key < today) return;
      if (!scheduleMap[key]) scheduleMap[key] = { date: key, entries: [], total: 0 };
      scheduleMap[key].entries.push({
        type: 'substitute_taken',
        group_id: e.group_id,
        group_name: 'Substitute Session',
        level_number: e.level_number,
        scheduled_date: e.scheduled_date,
        amount: parseFloat(e.amount),
      });
      scheduleMap[key].total += parseFloat(e.amount);
    });

    const payoutSchedule = Object.values(scheduleMap)
      .filter(p => p.total > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      confirmed: { items: confirmed.rows, total: confirmedTotal },
      expected: { items: expected.rows, total: expectedTotal },
      deductions: { items: deductions.rows, total: deductionsTotal },
      payout_schedule: payoutSchedule,
      summary: {
        confirmed_earned: confirmedTotal,
        expected_pending: expectedTotal,
        deductions: deductionsTotal,
        net_expected: confirmedTotal + expectedTotal - deductionsTotal,
      },
    });
  } catch (err) {
    console.error('Get earnings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/earnings/mark-paid — mark all earnings for a group as paid
router.post('/mark-paid', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { group_id } = req.body;
    if (!group_id) {
      return res.status(400).json({ error: 'group_id is required' });
    }

    // Verify the group belongs to the coach
    const groupResult = await client.query(
      'SELECT id, name FROM groups WHERE id = $1 AND coach_id = $2',
      [group_id, req.coach.id]
    );
    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    await client.query('BEGIN');

    // Mark all earnings for sessions in this group as paid
    const updateResult = await client.query(
      `UPDATE earnings SET is_paid = TRUE
       WHERE coach_id = $1 AND session_id IN (
         SELECT id FROM sessions WHERE group_id = $2
       )
       RETURNING id`,
      [req.coach.id, group_id]
    );

    // Mark the group as completed
    await client.query(
      `UPDATE groups SET status = 'completed' WHERE id = $1`,
      [group_id]
    );

    await client.query('COMMIT');

    res.json({
      message: `Payment confirmed for ${groupResult.rows[0].name || 'Group #' + group_id}`,
      earnings_marked: updateResult.rows.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Mark paid error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
