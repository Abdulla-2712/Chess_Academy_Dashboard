const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getStatus, sendMessageToGroup } = require('../services/whatsapp');
const qrcode = require('qrcode');
const pool = require('../db/pool');

router.get('/status', auth, async (req, res) => {
  const status = getStatus();
  let qrDataUrl = null;
  if (status.qr) {
    qrDataUrl = await qrcode.toDataURL(status.qr);
  }
  res.json({ ready: status.ready, qr: qrDataUrl });
});

router.post('/send', auth, async (req, res) => {
  const group_id = parseInt(req.body.group_id, 10);
  const message_id = parseInt(req.body.message_id, 10);

  if (Number.isNaN(group_id) || Number.isNaN(message_id)) {
    return res.status(400).json({ error: 'group_id and message_id are required' });
  }

  try {
    const groupResult = await pool.query(
      `SELECT g.*, l.level_number
       FROM groups g
       JOIN levels l ON g.level_id = l.id
       WHERE g.id = $1 AND g.coach_id = $2`,
      [group_id, req.coach.id]
    );

    if (!groupResult.rows.length) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    if (!group.whatsapp_link) {
      return res.status(400).json({ error: 'No WhatsApp link saved for this group' });
    }

    const msgResult = await pool.query(
      `SELECT * FROM session_messages
       WHERE id = $1
         AND level_id = $2
         AND (is_public = TRUE OR coach_id = $3)`,
      [message_id, group.level_id, req.coach.id]
    );

    if (!msgResult.rows.length) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const message = msgResult.rows[0];

    await sendMessageToGroup(group.whatsapp_link, message.message_text, message.image_path);

    res.json({ success: true });
  } catch (err) {
    console.error('WhatsApp send error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
