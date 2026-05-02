// API Helper — handles JWT token and fetch calls
const API = {
  BASE_URL: '/api',

  getToken() {
    return localStorage.getItem('chess_trainer_token');
  },

  setToken(token) {
    localStorage.setItem('chess_trainer_token', token);
  },

  getCoach() {
    const data = localStorage.getItem('chess_trainer_coach');
    return data ? JSON.parse(data) : null;
  },

  setCoach(coach) {
    localStorage.setItem('chess_trainer_coach', JSON.stringify(coach));
  },

  logout() {
    localStorage.removeItem('chess_trainer_token');
    localStorage.removeItem('chess_trainer_coach');
    window.location.href = '/login.html';
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  requireAuth() {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  async fetch(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.logout();
          return;
        }
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (err) {
      throw err;
    }
  },

  get(endpoint) {
    return this.fetch(endpoint);
  },

  post(endpoint, body) {
    return this.fetch(endpoint, { method: 'POST', body });
  },

  patch(endpoint, body) {
    return this.fetch(endpoint, { method: 'PATCH', body });
  },

  delete(endpoint) {
    return this.fetch(endpoint, { method: 'DELETE' });
  },

  /** multipart/form-data — do not set Content-Type (browser sets boundary) */
  async fetchForm(endpoint, formData, method = 'POST') {
    const url = `${this.BASE_URL}${endpoint}`;
    const headers = {};
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, { method, headers, body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        this.logout();
        return;
      }
      throw new Error(data.error || 'Request failed');
    }
    return data;
  },
};

// ===== Safe Date Utilities =====

/**
 * Safely parse a date value. Handles:
 * - null/undefined/empty → null
 * - ISO strings like "2024-04-24T00:00:00.000Z"
 * - Plain date strings like "2024-04-24"
 * - Already-Date objects from JSON (comes as string after JSON.parse)
 * Returns null if the value cannot be parsed into a valid Date.
 */
function safeDate(val) {
  if (!val) return null;
  // If val is already a string in YYYY-MM-DD format, append time to avoid timezone issues
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const d = new Date(val + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Extract a YYYY-MM-DD string from a date value safely.
 * Handles ISO strings, Date objects, and plain date strings.
 */
function safeDateStr(val) {
  if (!val) return null;
  // If it's already a plain YYYY-MM-DD string, return it
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }
  // If it's an ISO string, extract the date part
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    return val.slice(0, 10);
  }
  // Try to parse it as a Date
  const d = safeDate(val);
  if (!d) return null;
  // Format as YYYY-MM-DD using local date parts to avoid timezone shift
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Utility functions
function formatDate(dateStr) {
  const dateOnly = safeDateStr(dateStr);
  if (!dateOnly) return 'Date unavailable';
  const date = new Date(dateOnly + 'T00:00:00');
  if (isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [hourStr, minuteStr] = timeStr.split(':');
  let hour = parseInt(hourStr);
  const minute = minuteStr || '00';
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${ampm}`;
}

function formatMoney(amount) {
  return `${parseFloat(amount).toLocaleString('en-EG')} EGP`;
}

function getStatusBadge(status) {
  const map = {
    pending: { class: 'badge-pending', label: 'Pending', icon: '⏳' },
    confirmed: { class: 'badge-confirmed', label: 'Confirmed', icon: '✅' },
    excused_absence: { class: 'badge-excused', label: 'Excused', icon: '🤒' },
    excused_delayed: { class: 'badge-excused', label: 'Delayed', icon: '🤒' },
    no_show: { class: 'badge-noshow', label: 'No Show', icon: '❌' },
    substitute_given: { class: 'badge-substitute', label: 'Sub Given', icon: '🔄' },
    substitute_taken: { class: 'badge-substitute', label: 'Sub Taken', icon: '🔄' },
  };
  const s = map[status] || { class: 'badge-pending', label: status, icon: '❓' };
  return `<span class="badge ${s.class}">${s.icon} ${s.label}</span>`;
}

function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = message;
  setTimeout(() => el.classList.remove('show'), 5000);
}

function getDayOfWeek(dateStr) {
  const dateOnly = safeDateStr(dateStr);
  if (!dateOnly) return '';
  const date = new Date(dateOnly + 'T00:00:00');
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

// Init top bar with coach name
function initTopBar() {
  const coach = API.getCoach();
  const nameEl = document.getElementById('coach-name');
  if (nameEl && coach) {
    nameEl.textContent = coach.name;
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => API.logout());
  }
}
