// Groups page logic
let levels = [];

document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;
  initTopBar();
  loadLevels();
  loadGroups();
  setupModals();
});

async function loadLevels() {
  try {
    levels = await API.get('/levels');
    const selects = [document.getElementById('group-level'), document.getElementById('sub-level')];
    selects.forEach(sel => {
      if (!sel) return;
      levels.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.id;
        opt.textContent = `Level ${l.level_number} — ${formatMoney(l.price_per_session)}/session (${formatMoney(l.total_price)} total)`;
        sel.appendChild(opt);
      });
    });
  } catch (err) {
    console.error('Failed to load levels:', err);
  }
}

async function loadGroups() {
  const container = document.getElementById('groups-container');

  try {
    const groups = await API.get('/groups');

    if (!groups || groups.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <div class="empty-title">No groups yet</div>
          <div class="empty-text">Tap the + button to create your first coaching group.</div>
        </div>
      `;
      return;
    }

    // Separate active and completed
    const active = groups.filter(g => g.status === 'active');
    const completed = groups.filter(g => g.status === 'completed');

    // Day order: Friday → Thursday
    const dayOrder = ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'];

    let html = '';

    if (active.length > 0) {
      html += `<div class="section"><div class="section-title">Active Groups</div>`;

      // Group by day_of_week
      const byDay = {};
      active.forEach(g => {
        const day = g.day_of_week || 'Unknown';
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(g);
      });

      // Sort each day's groups by time ascending
      Object.values(byDay).forEach(arr => {
        arr.sort((a, b) => (a.time_slot || '').localeCompare(b.time_slot || ''));
      });

      // Render in Friday→Thursday order
      let cardIdx = 0;
      dayOrder.forEach(day => {
        if (!byDay[day] || byDay[day].length === 0) return;
        html += `<div class="day-group-header">${day}</div>`;
        byDay[day].forEach(g => {
          html += renderGroupCard(g, cardIdx++);
        });
      });

      // Any days not in the standard list (edge case)
      Object.keys(byDay).forEach(day => {
        if (!dayOrder.includes(day)) {
          html += `<div class="day-group-header">${day}</div>`;
          byDay[day].forEach(g => {
            html += renderGroupCard(g, cardIdx++);
          });
        }
      });

      html += `</div>`;
    }

    if (completed.length > 0) {
      html += `<div class="section"><div class="section-title">Completed</div>`;
      html += completed.map((g, i) => renderGroupCard(g, i + active.length)).join('');
      html += `</div>`;
    }

    // Add substitute button
    html += `
      <div class="mt-lg">
        <button class="btn btn-info btn-block" onclick="openSubModal()">
          🔄 I Took a Substitute Session
        </button>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Failed to load groups</div>
        <div class="empty-text">${err.message}</div>
      </div>
    `;
  }
}

function renderGroupCard(g, idx) {
  const completedCount = parseInt(g.completed_sessions) || 0;
  const progress = (completedCount / 8) * 100;

  return `
    <div class="group-card animate-in" style="animation-delay: ${idx * 60}ms"
         onclick="window.location.href='/group-detail.html?id=${g.id}'">
      <div class="group-header">
        <span class="group-level">${g.name || 'Group #' + g.id} — Level ${g.level_number}</span>
        <span class="badge badge-${g.status}">${g.status}</span>
      </div>
      <div class="group-info">
        <span>${g.day_of_week}s at ${formatTime(g.time_slot)}</span>
        <span>Started ${formatDate(g.start_date)}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
      <div class="group-footer">
        <span class="group-progress">${completedCount}/8 sessions</span>
        <span class="group-value">${formatMoney(g.total_price)}</span>
      </div>
    </div>
  `;
}

function setupModals() {
  // Add Group Modal
  const fabBtn = document.getElementById('fab-add');
  const addOverlay = document.getElementById('add-group-modal');

  fabBtn.addEventListener('click', () => addOverlay.classList.add('show'));
  addOverlay.addEventListener('click', (e) => {
    if (e.target === addOverlay) closeAddModal();
  });

  // Auto-fill day of week when date changes
  const dateInput = document.getElementById('group-start-date');
  dateInput.addEventListener('change', () => {
    document.getElementById('group-day').value = getDayOfWeek(dateInput.value);
  });

  // Add Group Form
  document.getElementById('add-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const wa = document.getElementById('group-whatsapp-link')?.value?.trim();
      const data = {
        level_id: parseInt(document.getElementById('group-level').value),
        start_date: document.getElementById('group-start-date').value,
        day_of_week: document.getElementById('group-day').value,
        time_slot: document.getElementById('group-time').value,
        name: document.getElementById('group-name').value || undefined,
        notes: document.getElementById('group-notes').value || undefined,
      };
      if (wa) data.whatsapp_link = wa;

      if (!data.day_of_week) {
        data.day_of_week = getDayOfWeek(data.start_date);
      }

      await API.post('/groups', data);
      closeAddModal();
      loadGroups();
    } catch (err) {
      showAlert('add-alert', err.message);
    }
  });

  // Sub modal
  const subOverlay = document.getElementById('sub-modal');
  subOverlay.addEventListener('click', (e) => {
    if (e.target === subOverlay) closeSubModal();
  });

  document.getElementById('sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = {
        level_id: parseInt(document.getElementById('sub-level').value),
        scheduled_date: document.getElementById('sub-date').value,
        scheduled_time: document.getElementById('sub-time').value,
        session_number: parseInt(document.getElementById('sub-session-num').value) || 1,
        notes: document.getElementById('sub-notes').value || undefined,
      };

      await API.post('/sessions/substitute', data);
      closeSubModal();
      showAlert('alert', 'Substitute session added!', 'success');
      document.getElementById('alert').classList.add('show');
    } catch (err) {
      showAlert('sub-alert', err.message);
    }
  });
}

function closeAddModal() {
  document.getElementById('add-group-modal').classList.remove('show');
}

function openSubModal() {
  document.getElementById('sub-modal').classList.add('show');
}

function closeSubModal() {
  document.getElementById('sub-modal').classList.remove('show');
}
