// Dashboard — Today's Sessions
let currentSessionId = null;
let currentSessionData = null;
let todaySessionsMap = {};

document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;
  initTopBar();
  renderDate();
  loadTodaySessions();
  setupModal();
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
        'image/png': finalBlob,
      }),
    ]);
    showToast('Text and image copied! ✅ Paste into WhatsApp');
  } catch (err) {
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

async function copyImage(imageUrl) {
  try {
    const absoluteUrl = imageUrl.startsWith('http')
      ? imageUrl
      : window.location.origin + (imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`);

    const response = await fetch(absoluteUrl);
    if (!response.ok) throw new Error('Failed to fetch image');
    const blob = await response.blob();

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
    downloadImage(imageUrl);
    showToast('Could not copy — image downloading instead ⬇️');
  }
}

function renderDate() {
  const now = new Date();
  document.getElementById('day-name').textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
  document.getElementById('date-full').textContent = now.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function loadTodaySessions() {
  const container = document.getElementById('sessions-container');

  try {
    const sessions = await API.get('/sessions/today');

    if (!sessions || sessions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">♟️</div>
          <div class="empty-title">No sessions today</div>
          <div class="empty-text">Enjoy your day off! Check your upcoming sessions in Groups.</div>
        </div>
      `;
      return;
    }

    todaySessionsMap = {};
    sessions.forEach((s) => {
      todaySessionsMap[s.id] = s;
    });

    container.innerHTML = sessions.map((s, i) => {
      const isDelayed = s.status === 'excused_delayed';
      const isRescheduled = s.is_rescheduled;

      let statusBadgesHtml = getStatusBadge(s.status);
      if (isDelayed) {
        statusBadgesHtml += ` <span class="badge badge-delayed">⏱️ Delayed</span>`;
      }
      if (isRescheduled) {
        statusBadgesHtml += ` <span class="badge badge-rescheduled">📅 Rescheduled</span>`;
      }

      return `
      <div class="session-card animate-in" style="animation-delay: ${i * 60}ms">
        <div class="session-header">
          <span class="session-time">${formatTime(s.scheduled_time)}</span>
          <span class="session-level">Level ${s.level_number}</span>
        </div>
        <div class="session-meta">
          <span>Session ${s.session_number} of 8</span>
          <span>${s.group_name || 'Group #' + s.group_id}</span>
        </div>
        <div class="flex-between" style="flex-wrap:wrap; gap:4px;">
          <div style="display:flex; gap:4px; flex-wrap:wrap;">${statusBadgesHtml}</div>
          <button class="btn btn-sm btn-ghost" onclick="openStatusModal(${s.id})">
            Update
          </button>
        </div>
        ${s.notes ? `<div class="session-notes">${s.notes}</div>` : ''}
      </div>
    `}).join('');

  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Failed to load sessions</div>
        <div class="empty-text">${err.message}</div>
      </div>
    `;
  }
}

function setupModal() {
  const overlay = document.getElementById('status-modal');
  const closeBtn = document.getElementById('modal-close');

  closeBtn.addEventListener('click', () => closeModal());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

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
}

function openStatusModal(id) {
  const s = todaySessionsMap[id];
  if (!s) return;
  currentSessionId = id;
  currentSessionData = s;
  document.getElementById('modal-session-info').innerHTML = `
    <div style="font-size: 0.9rem; color: var(--text-secondary);">
      <strong>${formatTime(s.scheduled_time)}</strong> · Level ${s.level_number} · Session ${s.session_number} of 8
    </div>
    <div style="margin-top: 8px;">Current: ${getStatusBadge(s.status)}</div>
  `;
  document.getElementById('session-notes').value = s.notes || '';
  document.getElementById('status-modal').classList.add('show');
}

function closeModal() {
  document.getElementById('status-modal').classList.remove('show');
  currentSessionId = null;
  currentSessionData = null;
}

function closeSessionMessageModal() {
  const el = document.getElementById('session-message-modal');
  if (!el) return;
  el.classList.remove('show');
  el.style.display = 'none';
}

function closeAllModals() {
  closeModal();
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

function openWhatsAppLink() {
  const link = currentSessionData?.whatsapp_link ? String(currentSessionData.whatsapp_link).trim() : '';
  if (!link) return;
  window.open(link, '_blank', 'noopener');
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

async function fetchSessionMessages(levelId, sessionNum, groupId, whatsappLink) {
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

    const canWa = !!(whatsappLink && String(whatsappLink).trim());
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
             <button type="button" class="btn btn-sm" data-wa-send data-group-id="${groupId}" data-msg-id="${m.id}"
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

function openSessionMessageModal(sessionData) {
  const modal = document.getElementById('session-message-modal');
  if (!modal) return;

  currentSessionData = sessionData;
  const titleEl = document.getElementById('session-message-title');
  if (titleEl) {
    titleEl.textContent = `Session ${sessionData.session_number} of 8 — Level ${sessionData.level_number} 📚`;
  }

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
  modal.classList.add('show');

  setWhatsAppButtonStateFromLink(sessionData.whatsapp_link);
  fetchSessionMessages(
    sessionData.level_id,
    sessionData.session_number,
    sessionData.group_id,
    sessionData.whatsapp_link
  );
}

async function updateStatus(status) {
  if (!currentSessionId) return;

  try {
    const sessionData = currentSessionData ? { ...currentSessionData } : null;
    const notes = document.getElementById('session-notes').value.trim();
    await API.patch(`/sessions/${currentSessionId}/status`, { status, notes: notes || undefined });

    await loadTodaySessions();

    if (status === 'confirmed' && sessionData) {
      closeAllModals();
      setTimeout(() => {
        openSessionMessageModal(sessionData);
      }, 400);
      return;
    }

    closeAllModals();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
