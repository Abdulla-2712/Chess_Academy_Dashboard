// Group Detail page logic
let groupData = null;
let currentSessionId = null;
let currentSessionNumber = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', () => API.logout());

  const params = new URLSearchParams(window.location.search);
  const groupId = params.get('id');
  if (!groupId) {
    window.location.href = '/groups.html';
    return;
  }

  loadGroup(groupId);
  setupModals();
});

function showToast(msg) {
  const el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2000);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absoluteMediaUrl(imageUrl) {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  const p = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${window.location.origin}${p}`;
}

function downloadImage(imageUrl) {
  const abs = absoluteMediaUrl(imageUrl);
  const a = document.createElement('a');
  a.href = abs;
  a.download = abs.split('/').pop() || 'image';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function copyAll(messageText, imageUrl) {
  try {
    const absoluteUrl = imageUrl.startsWith('http')
      ? imageUrl
      : window.location.origin + imageUrl;

    const response = await fetch(absoluteUrl);
    if (!response.ok) throw new Error('Failed to fetch image');

    const blob = await response.blob();

    // Convert to PNG for maximum clipboard compatibility
    let finalBlob = blob;
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      finalBlob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
    }

    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([messageText], { type: 'text/plain' }),
        'image/png': finalBlob
      }),
    ]);
    showToast('Text and image copied! ✅ Paste into WhatsApp');
  } catch (err) {
    console.error('Copy all failed:', err);
    try {
      await navigator.clipboard.writeText(messageText);
    } catch (_) {
      /* still try download */
    }
    downloadImage(imageUrl);
    showToast('Text copied + image downloading ⬇️');
  }
}

async function copyText(messageText) {
  try {
    await navigator.clipboard.writeText(messageText);
    showToast('Text copied! ✅');
  } catch (err) {
    showToast('Failed to copy text ❌');
  }
}

async function sendToWhatsAppGroup(btn, groupId, messageId) {
  const label = 'Send to WhatsApp Group 📤';
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const res = await fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API.getToken()}`,
      },
      body: JSON.stringify({ group_id: groupId, message_id: messageId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      API.logout();
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    if (data.success) {
      showToast('Message sent to WhatsApp group! ✅');
      btn.textContent = 'Sent ✅';
    } else {
      throw new Error(data.error || 'Send failed');
    }
  } catch (err) {
    showToast('Failed to send: ' + err.message + ' ❌');
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function copyImage(imageUrl) {
  try {
    // Must use absolute URL
    const absoluteUrl = imageUrl.startsWith('http')
      ? imageUrl
      : window.location.origin + (imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`);

    const response = await fetch(absoluteUrl);

    if (!response.ok) throw new Error('Failed to fetch image');

    const blob = await response.blob();

    // Force PNG for maximum clipboard compatibility
    let finalBlob = blob;
    if (blob.type !== 'image/png') {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      finalBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': finalBlob })]);

    showToast('Image copied to clipboard! ✅');
  } catch (err) {
    console.error('Copy image failed:', err);
    downloadImage(imageUrl);
    showToast('Could not copy — image downloading instead ⬇️');
  }
}

async function loadGroup(groupId) {
  try {
    groupData = await API.get(`/groups/${groupId}`);
    renderGroupInfo();
    renderSessions();
  } catch (err) {
    document.getElementById('group-info').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Group not found</div>
        <div class="empty-text">${err.message}</div>
      </div>
    `;
  }
}

function renderGroupInfo() {
  const g = groupData;
  // Only count sessions that are truly done (not pending, not excused_delayed)
  const completedCount = g.sessions.filter(s =>
    !['pending', 'excused_delayed'].includes(s.status)
  ).length;
  const progress = (completedCount / 8) * 100;

  // Payout date = last session's scheduled_date
  const lastSession = g.sessions.length > 0 ? g.sessions[g.sessions.length - 1] : null;
  const payoutDateStr = lastSession ? lastSession.scheduled_date.slice(0, 10) : g.start_date;

  const waBtn = g.whatsapp_link
    ? `<button class="btn btn-sm btn-primary" type="button" onclick="openWhatsAppLink()">Open WhatsApp Group 💬</button>`
    : '';

  document.getElementById('group-info').innerHTML = `
    <div class="flex-between mb-md" style="gap: var(--space-sm); align-items: flex-start;">
      <div style="min-width: 0;">
        <h1 style="margin-bottom: 0;">${g.name || 'Group #' + g.id}</h1>
      </div>
      <div style="display:flex; gap: var(--space-sm); flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end;">
        ${waBtn}
        <button class="btn btn-sm btn-ghost" onclick="openEditModal()">Edit</button>
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Level</div>
        <div class="stat-value accent">${g.level_number}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Value</div>
        <div class="stat-value">${formatMoney(g.total_price)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Schedule</div>
        <div class="stat-value" style="font-size: 0.95rem;">${g.day_of_week}s ${formatTime(g.time_slot)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Payout Date</div>
        <div class="stat-value" style="font-size: 0.85rem;">${formatDate(payoutDateStr)}</div>
      </div>
    </div>
    <div class="flex-between" style="font-size: 0.85rem; color: var(--text-secondary);">
      <span>Progress</span>
      <span>${completedCount}/8 sessions</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${progress}%"></div>
    </div>
    ${g.whatsapp_link ? `<div class="session-notes mt-md"><strong>WhatsApp Group Link:</strong><br><a href="${g.whatsapp_link}" target="_blank" rel="noopener" style="color: var(--primary-light); word-break: break-word;">${g.whatsapp_link}</a></div>` : ''}
    ${g.notes ? `<div class="session-notes mt-md">${g.notes}</div>` : ''}
  `;
}

function renderSessions() {
  const container = document.getElementById('sessions-list');
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = groupData.sessions.map((s, i) => {
    const isToday = s.scheduled_date.slice(0, 10) === today;
    const isPast = s.scheduled_date.slice(0, 10) < today;
    const isDelayed = s.status === 'excused_delayed';
    const isRescheduled = s.is_rescheduled;

    let extraBadges = '';
    if (isDelayed) {
      extraBadges += `<span class="badge badge-delayed">⏱️ Delayed — confirm manually</span>`;
    }
    if (isRescheduled) {
      extraBadges += `<span class="badge badge-rescheduled">📅 Rescheduled</span>`;
    }

    return `
      <div class="session-list-item animate-in" style="animation-delay: ${i * 50}ms; ${isToday ? 'border-color: var(--primary-light); background: var(--primary-glow);' : ''}"
           onclick="openStatusModal(${s.id}, ${s.session_number}, '${s.scheduled_date.slice(0, 10)}', '${formatTime(s.scheduled_time)}', '${s.status}', '${(s.notes || '').replace(/'/g, "\\'")}')">
        <div class="session-num">#${s.session_number}</div>
        <div class="session-date">
          <div>${formatDate(s.scheduled_date)}${isToday ? ' <strong style="color: var(--primary-light);">(Today)</strong>' : ''}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${formatTime(s.scheduled_time)}</div>
          ${extraBadges ? `<div style="margin-top:4px; display:flex; gap:4px; flex-wrap:wrap;">${extraBadges}</div>` : ''}
        </div>
        ${getStatusBadge(s.status)}
      </div>
    `;
  }).join('');
}

function setupModals() {
  // Status modal
  const statusOverlay = document.getElementById('status-modal');
  document.getElementById('modal-close').addEventListener('click', () => closeStatusModal());
  statusOverlay.addEventListener('click', (e) => {
    if (e.target === statusOverlay) closeStatusModal();
  });

  // Edit modal
  const editOverlay = document.getElementById('edit-modal');
  editOverlay.addEventListener('click', (e) => {
    if (e.target === editOverlay) closeEditModal();
  });

  // Session message modal
  const msgOverlay = document.getElementById('session-message-modal');
  const msgClose = document.getElementById('session-message-close');
  const msgClose2 = document.getElementById('btn-close-session-message');
  if (msgClose) msgClose.addEventListener('click', closeSessionMessageModal);
  if (msgClose2) msgClose2.addEventListener('click', closeSessionMessageModal);
  if (msgOverlay) {
    msgOverlay.addEventListener('click', (e) => {
      if (e.target === msgOverlay) closeSessionMessageModal();
    });
  }
  const waBtn = document.getElementById('btn-open-whatsapp');
  if (waBtn) waBtn.addEventListener('click', openWhatsAppLink);

  // Load levels for the edit dropdown
  loadLevelsForEdit();

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = {};
      const name = document.getElementById('edit-name').value;
      const time_slot = document.getElementById('edit-time').value;
      const day_of_week = document.getElementById('edit-day').value;
      const notes = document.getElementById('edit-notes').value;
      const level_id = document.getElementById('edit-level').value;
      const start_date = document.getElementById('edit-start-date').value;
      const status = document.getElementById('edit-status').value;
      const whatsapp_link = document.getElementById('edit-whatsapp-link')?.value?.trim();

      if (name !== undefined) payload.name = name || undefined;
      if (time_slot) payload.time_slot = time_slot;
      if (day_of_week) payload.day_of_week = day_of_week;
      if (notes !== undefined) payload.notes = notes || undefined;
      if (level_id) payload.level_id = parseInt(level_id);
      if (start_date) payload.start_date = start_date;
      if (status) payload.status = status;
      if (whatsapp_link !== undefined) payload.whatsapp_link = whatsapp_link || null;

      await API.patch(`/groups/${groupData.id}`, payload);
      closeEditModal();
      loadGroup(groupData.id);
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

function setWhatsAppButtonState() {
  const btn = document.getElementById('btn-open-whatsapp');
  if (!btn) return;
  const link = groupData?.whatsapp_link ? String(groupData.whatsapp_link).trim() : '';
  if (link) {
    btn.disabled = false;
    btn.title = '';
  } else {
    btn.disabled = true;
    btn.title = 'No WhatsApp link saved for this group — edit the group to add one';
  }
}

function openWhatsAppLink() {
  const link = groupData?.whatsapp_link ? String(groupData.whatsapp_link).trim() : '';
  if (!link) return;
  window.open(link, '_blank', 'noopener');
}

function closeSessionMessageModal() {
  const el = document.getElementById('session-message-modal');
  if (!el) return;
  el.classList.remove('show');
  el.style.display = 'none';
}

function closeAllModals() {
  closeStatusModal();
  closeEditModal();
  closeSessionMessageModal();
}

function setWhatsAppButtonStateFromLink(whatsappLink) {
  const waBtn = document.getElementById('btn-open-whatsapp');
  if (!waBtn) return;
  const link = whatsappLink ? String(whatsappLink).trim() : '';
  if (link) {
    waBtn.disabled = false;
    waBtn.title = '';
    waBtn.onclick = () => window.open(link, '_blank', 'noopener');
  } else {
    waBtn.disabled = true;
    waBtn.onclick = null;
    waBtn.title = 'No WhatsApp link saved for this group — edit the group to add one';
  }
}

async function fetchSessionMessages(levelId, sessionNum) {
  const bodyEl = document.getElementById('session-message-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-container"><div class="spinner"></div></div>';

  try {
    const msgs = await API.get(`/messages?level_id=${levelId}&session_number=${sessionNum}`);
    if (!msgs || msgs.length === 0) {
      bodyEl.innerHTML = `
        <div class="empty-state" style="padding: var(--space-xl) 0;">
          <div class="empty-icon">💬</div>
          <div class="empty-title">No message found for this session</div>
          <div class="empty-text">
            Add one in the <a href="/messages.html" style="color: var(--primary-light); text-decoration: none; font-weight: 600;">Messages Library</a>.
          </div>
        </div>
      `;
      return;
    }

    const canWa = !!(groupData && groupData.whatsapp_link);
    const waTitle = canWa ? '' : ' title="Save a WhatsApp group link for this group first"';

    bodyEl.innerHTML = msgs
      .map((m) => {
        const thumb = m.image_url
          ? `<a href="${escapeHtml(m.image_url)}" target="_blank" rel="noopener" class="message-thumb-btn" style="cursor:pointer;">
               <img src="${escapeHtml(m.image_url)}" alt="" class="message-thumb">
             </a>`
          : '';
        const hasImage = !!m.image_url;
        const copyRow = hasImage
          ? `<div class="message-copy-row">
               <button type="button" class="btn btn-sm btn-message-copy-all" data-copy="all" data-id="${m.id}">Copy All 📋</button>
               <button type="button" class="btn btn-sm btn-message-copy-text" data-copy="text" data-id="${m.id}">Copy Text 📝</button>
               <button type="button" class="btn btn-sm btn-message-copy-image" data-copy="image" data-id="${m.id}">Copy Image 🖼️</button>
             </div>`
          : `<div class="message-copy-row">
               <button type="button" class="btn btn-sm btn-message-copy-text" data-copy="text" data-id="${m.id}">Copy Text 📝</button>
             </div>`;
        const waBtn = `<div class="message-wa-row" style="margin-top:10px;">
             <button type="button" class="btn btn-sm" data-wa-send data-group-id="${groupData.id}" data-msg-id="${m.id}"
               style="background:#25D366;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:15px;width:100%;max-width:320px;"
               ${canWa ? '' : 'disabled'}${waTitle}>
               Send to WhatsApp Group 📤
             </button>
           </div>`;

        return `
          <div class="message-card animate-in" data-id="${m.id}">
            <div class="message-card-top">
              ${m.title ? `<div class="message-card-title">${escapeHtml(m.title)}</div>` : ''}
            </div>
            <div class="message-card-body">${escapeHtml(m.message_text)}</div>
            ${thumb}
            <div class="message-card-footer">
              ${copyRow}
              ${waBtn}
            </div>
          </div>
        `;
      })
      .join('');

    bodyEl.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id, 10);
        const mode = btn.dataset.copy;
        const m = msgs.find((x) => x.id === id);
        if (!m) return;
        if (mode === 'all' && m.image_url) copyAll(m.message_text, m.image_url);
        else if (mode === 'text') copyText(m.message_text);
        else if (mode === 'image' && m.image_url) copyImage(m.image_url);
      });
    });

    bodyEl.querySelectorAll('[data-wa-send]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gid = parseInt(btn.dataset.groupId, 10);
        const mid = parseInt(btn.dataset.msgId, 10);
        sendToWhatsAppGroup(btn, gid, mid);
      });
    });
  } catch (err) {
    bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Failed to load messages</div><div class="empty-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function openSessionMessageModal(sessionNumber, levelId, whatsappLink) {
  const modal = document.getElementById('session-message-modal');
  if (!modal) {
    console.error('session-message-modal element not found in HTML');
    return;
  }

  const titleEl = document.getElementById('session-message-title');
  if (titleEl) {
    titleEl.textContent = `Session ${sessionNumber} of 8 — Level ${groupData?.level_number ?? ''} 📚`;
  }

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
  modal.classList.add('show');

  setWhatsAppButtonStateFromLink(whatsappLink);

  fetchSessionMessages(levelId, sessionNumber);
}

async function loadLevelsForEdit() {
  try {
    const levels = await API.get('/levels');
    const sel = document.getElementById('edit-level');
    levels.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `Level ${l.level_number} — ${formatMoney(l.price_per_session)}/session`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load levels for edit:', err);
  }
}

function openStatusModal(id, num, date, time, status, notes) {
  currentSessionId = id;
  currentSessionNumber = num;
  document.getElementById('modal-session-info').innerHTML = `
    <div style="font-size: 0.9rem; color: var(--text-secondary);">
      <strong>Session ${num}</strong> · ${formatDate(date)} at ${time}
    </div>
    <div style="margin-top: 8px;">Current: ${getStatusBadge(status)}</div>
  `;
  document.getElementById('session-notes').value = notes || '';
  document.getElementById('status-modal').classList.add('show');
}

function closeStatusModal() {
  document.getElementById('status-modal').classList.remove('show');
  currentSessionId = null;
  currentSessionNumber = null;
}

async function updateSessionStatus(status) {
  if (!currentSessionId) return;
  try {
    const sessionNumber = currentSessionNumber;
    const notes = document.getElementById('session-notes').value.trim();
    await API.patch(`/sessions/${currentSessionId}/status`, { status, notes: notes || undefined });
    await loadGroup(groupData.id);

    // After successful PATCH and status === 'confirmed'
    if (status === 'confirmed') {
      // Close any existing session status modal first
      closeAllModals();

      // Small delay to let the UI update first
      setTimeout(() => {
        openSessionMessageModal(sessionNumber, groupData.level_id, groupData.whatsapp_link);
      }, 400);
      return;
    }

    closeAllModals();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function saveNotes() {
  if (!currentSessionId) return;
  try {
    const notes = document.getElementById('session-notes').value.trim();
    await API.patch(`/sessions/${currentSessionId}/notes`, { notes });
    closeStatusModal();
    loadGroup(groupData.id);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function openEditModal() {
  document.getElementById('edit-name').value = groupData.name || '';
  document.getElementById('edit-time').value = groupData.time_slot || '';
  document.getElementById('edit-day').value = groupData.day_of_week || 'Friday';
  document.getElementById('edit-notes').value = groupData.notes || '';
  const wa = document.getElementById('edit-whatsapp-link');
  if (wa) wa.value = groupData.whatsapp_link || '';
  document.getElementById('edit-start-date').value = groupData.start_date ? groupData.start_date.slice(0, 10) : '';
  document.getElementById('edit-status').value = groupData.status || 'active';

  // Set current level in dropdown (if matching)
  const levelSel = document.getElementById('edit-level');
  levelSel.value = ''; // default "keep current"

  document.getElementById('edit-modal').classList.add('show');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('show');
}

async function deleteGroup() {
  const name = groupData.name || 'Group #' + groupData.id;
  if (!confirm(`Are you sure you want to delete "${name}"?\n\nThis will permanently remove the group and ALL its sessions and earnings. This cannot be undone.`)) {
    return;
  }
  if (!confirm(`Final confirmation: DELETE "${name}" and all its data?`)) {
    return;
  }
  try {
    await API.delete(`/groups/${groupData.id}`);
    window.location.href = '/groups.html';
  } catch (err) {
    alert('Error deleting group: ' + err.message);
  }
}

