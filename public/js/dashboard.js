// Dashboard — Today's Sessions
let currentSessionId = null;

document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;
  initTopBar();
  renderDate();
  loadTodaySessions();
  setupModal();
});

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
          <button class="btn btn-sm btn-ghost" onclick="openStatusModal(${s.id}, '${formatTime(s.scheduled_time)}', ${s.level_number}, ${s.session_number}, '${s.status}', '${(s.notes || '').replace(/'/g, "\\'")}')">
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
}

function openStatusModal(id, time, level, sessionNum, currentStatus, notes) {
  currentSessionId = id;
  document.getElementById('modal-session-info').innerHTML = `
    <div style="font-size: 0.9rem; color: var(--text-secondary);">
      <strong>${time}</strong> · Level ${level} · Session ${sessionNum} of 8
    </div>
    <div style="margin-top: 8px;">Current: ${getStatusBadge(currentStatus)}</div>
  `;
  document.getElementById('session-notes').value = notes || '';
  document.getElementById('status-modal').classList.add('show');
}

function closeModal() {
  document.getElementById('status-modal').classList.remove('show');
  currentSessionId = null;
}

async function updateStatus(status) {
  if (!currentSessionId) return;

  try {
    const notes = document.getElementById('session-notes').value.trim();
    await API.patch(`/sessions/${currentSessionId}/status`, { status, notes: notes || undefined });
    closeModal();
    loadTodaySessions();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
