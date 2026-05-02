// Earnings page logic
document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;
  initTopBar();
  loadEarnings();
});

async function loadEarnings() {
  const summaryContainer = document.getElementById('summary-container');
  const earningsContainer = document.getElementById('earnings-container');

  try {
    const data = await API.get('/earnings');

    // Render Net Summary
    summaryContainer.innerHTML = `
      <div class="stat-card stat-card-wide animate-in" style="border-color: var(--primary-light); background: var(--primary-glow); margin-bottom: var(--space-md);">
        <div class="stat-label">Net Expected</div>
        <div class="stat-value ${data.summary.net_expected >= 0 ? 'positive' : 'negative'}" style="font-size:1.6rem;">${formatMoney(data.summary.net_expected)}</div>
      </div>
      <div class="stat-grid animate-in">
        <div class="stat-card">
          <div class="stat-label">Confirmed Earned</div>
          <div class="stat-value positive">${formatMoney(data.summary.confirmed_earned)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Expected (Pending)</div>
          <div class="stat-value accent">${formatMoney(data.summary.expected_pending)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Deductions</div>
          <div class="stat-value negative">${data.summary.deductions > 0 ? '-' : ''}${formatMoney(data.summary.deductions)}</div>
        </div>
      </div>
    `;

    let html = '';

    // ===== Payout Schedule Section =====
    if (data.payout_schedule && data.payout_schedule.length > 0) {
      html += `<div class="section">
        <div class="section-title">📆 Upcoming Payout Schedule</div>`;

      data.payout_schedule.forEach(p => {
        const dateObj = new Date(p.date + 'T00:00:00');
        const longDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
        html += `
          <div class="payout-schedule-block">
            <div class="payout-schedule-header">
              <span class="payout-schedule-date">📅 ${longDate}</span>
              <span class="payout-schedule-total">${formatMoney(p.total)}</span>
            </div>
            <div class="payout-schedule-entries">
              ${p.entries.map(e => `
                <div class="payout-schedule-entry">
                  <div class="pse-info">
                    ${e.type === 'substitute_taken'
                      ? `<span class="badge badge-substitute" style="margin-right:6px;">SUB</span>`
                      : ''}
                    <span class="pse-name">${e.group_name || 'Group'}</span>
                    <span class="pse-level"> · Level ${e.level_number}</span>
                  </div>
                  <div class="pse-actions">
                    <span class="pse-amount">${formatMoney(e.amount)}</span>
                    <button class="btn btn-sm btn-success mark-paid-btn"
                            onclick="markGroupPaid(${e.group_id}, '${(e.group_name || 'Group').replace(/'/g, "\\'")}', ${e.level_number})"
                            title="Mark as paid">✓ Paid</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });

      html += `</div>`;
    }



    // C — Deductions
    if (data.deductions.items.length > 0) {
      html += `<div class="section">
        <div class="section-title">❌ Deductions — ${formatMoney(data.deductions.total)}</div>`;

      data.deductions.items.forEach(e => {
        html += `
          <div class="earning-item">
            <div class="earning-info">
              <div class="earning-label">Level ${e.level_number} · Session ${e.session_number} — No Show</div>
              <div class="earning-date">${formatDate(e.scheduled_date)}</div>
            </div>
            <div class="earning-amount negative">${formatMoney(e.amount)}</div>
          </div>
        `;
      });

      html += `</div>`;
    }

    if (!html) {
      html = `
        <div class="empty-state">
          <div class="empty-icon">💰</div>
          <div class="empty-title">No earnings yet</div>
          <div class="empty-text">Start confirming sessions to see your earnings here.</div>
        </div>
      `;
    }

    earningsContainer.innerHTML = html;
  } catch (err) {
    summaryContainer.innerHTML = '';
    earningsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Failed to load earnings</div>
        <div class="empty-text">${err.message}</div>
      </div>
    `;
  }
}

// Fix 3 — Mark a group's earnings as paid
async function markGroupPaid(groupId, groupName, levelNumber) {
  if (!confirm(`Confirm you received payment for ${groupName} / Level ${levelNumber}?`)) {
    return;
  }
  try {
    const result = await API.post('/earnings/mark-paid', { group_id: groupId });
    // Show brief success feedback
    const alert = document.getElementById('earnings-alert');
    if (alert) {
      alert.className = 'alert alert-success show';
      alert.textContent = result.message;
      setTimeout(() => alert.classList.remove('show'), 4000);
    }
    // Refresh earnings data without full page reload
    loadEarnings();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
