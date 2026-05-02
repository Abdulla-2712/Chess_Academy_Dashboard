// Holidays page logic
document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;
  initTopBar();
  loadHolidays();
  setupForm();
});

async function loadHolidays() {
  const container = document.getElementById('holidays-list');
  try {
    const holidays = await API.get('/holidays');
    if (!holidays || holidays.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: var(--space-xl) 0;">
          <div class="empty-icon">🗓️</div>
          <div class="empty-title">No holidays saved</div>
          <div class="empty-text">Add a holiday above to automatically shift affected sessions.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = holidays.map(h => `
      <div class="holiday-card animate-in">
        <div class="holiday-info">
          <div class="holiday-name">${h.name}</div>
          <div class="holiday-dates">
            ${formatDate(h.start_date)}
            ${h.start_date !== h.end_date ? ` → ${formatDate(h.end_date)}` : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="deleteHoliday(${h.id})">Delete</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-text">${err.message}</div></div>`;
  }
}

function setupForm() {
  const form = document.getElementById('holiday-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('holiday-name').value.trim();
    const start_date = document.getElementById('holiday-start').value;
    const end_date = document.getElementById('holiday-end').value;

    if (!name || !start_date || !end_date) {
      showAlert('holiday-alert', 'All fields are required.', 'error');
      return;
    }
    if (start_date > end_date) {
      showAlert('holiday-alert', 'Start date must be before or equal to end date.', 'error');
      return;
    }

    const btn = document.getElementById('save-holiday-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
      const result = await API.post('/holidays', { name, start_date, end_date });
      showAlert('holiday-alert', result.message, 'success');
      form.reset();
      loadHolidays();
    } catch (err) {
      showAlert('holiday-alert', err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Holiday & Shift Sessions';
    }
  });
}

async function deleteHoliday(id) {
  if (!confirm('Delete this holiday? Note: session dates will NOT be auto-reversed.')) return;
  try {
    await API.delete(`/holidays/${id}`);
    loadHolidays();
  } catch (err) {
    showAlert('holiday-alert', err.message, 'error');
  }
}
