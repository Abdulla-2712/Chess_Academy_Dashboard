// Messages Library — level → session → messages
let levelsData = [];
let selectedLevelId = null;
let selectedSession = null;
/** @type {Array<object>} */
let levelMessagesCache = [];
let editingMessageId = null;
let imageRemovedFlag = false;

document.addEventListener('DOMContentLoaded', () => {
  if (!API.requireAuth()) return;
  initTopBar();
  initMessagesUi();
  loadLevels();
});

function initMessagesUi() {
  document.getElementById('message-form-close').addEventListener('click', closeMessageFormModal);
  document.getElementById('message-form-cancel').addEventListener('click', closeMessageFormModal);
  document.getElementById('btn-add-message').addEventListener('click', openAddMessageModal);

  document.getElementById('message-form-modal').addEventListener('click', (e) => {
    if (e.target.id === 'message-form-modal') closeMessageFormModal();
  });
  document.getElementById('image-lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'image-lightbox' || e.target.id === 'image-lightbox-close') {
      document.getElementById('image-lightbox').classList.remove('show');
    }
  });
  document.getElementById('image-lightbox-close').addEventListener('click', () => {
    document.getElementById('image-lightbox').classList.remove('show');
  });

  document.getElementById('message-form').addEventListener('submit', onMessageFormSubmit);

  document.getElementById('message-image').addEventListener('change', (e) => {
    const f = e.target.files[0];
    const wrap = document.getElementById('message-image-preview-wrap');
    const img = document.getElementById('message-image-preview');
    imageRemovedFlag = false;
    const note = document.getElementById('message-current-image-note');
    if (f) note.style.display = 'none';
    if (f) {
      const url = URL.createObjectURL(f);
      img.src = url;
      wrap.style.display = 'block';
    } else {
      wrap.style.display = 'none';
      img.src = '';
    }
  });

  document.getElementById('message-remove-image-btn').addEventListener('click', () => {
    document.getElementById('message-image').value = '';
    document.getElementById('message-image-preview-wrap').style.display = 'none';
    document.getElementById('message-image-preview').src = '';
    imageRemovedFlag = true;
    document.getElementById('message-current-image-note').style.display = 'none';
  });

  document.querySelectorAll('.visibility-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.visibility-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('message-is-public').value = btn.dataset.public;
    });
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showToast(msg) {
  let el = document.getElementById('app-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2000);
}

function absoluteMediaUrl(imageUrl) {
  if (!imageUrl) return '';
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) return imageUrl;
  const path = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
  return `${window.location.origin}${path}`;
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
  const abs = absoluteMediaUrl(imageUrl);
  try {
    const imageResponse = await fetch(abs);
    const imageBlob = await imageResponse.blob();
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([messageText], { type: 'text/plain' }),
        [imageBlob.type]: imageBlob,
      }),
    ]);
    showToast('Text and image copied! ✅');
  } catch (err) {
    try {
      await navigator.clipboard.writeText(messageText);
    } catch (_) {
      /* still try download */
    }
    downloadImage(imageUrl);
    showToast('Text copied + image downloading! ✅');
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
  const abs = absoluteMediaUrl(imageUrl);
  try {
    const imageResponse = await fetch(abs);
    const imageBlob = await imageResponse.blob();
    await navigator.clipboard.write([new ClipboardItem({ [imageBlob.type]: imageBlob })]);
    showToast('Image copied! ✅');
  } catch (err) {
    downloadImage(imageUrl);
    showToast('Image downloading! ✅');
  }
}

async function loadLevels() {
  const grid = document.getElementById('level-grid');
  try {
    levelsData = await API.get('/levels');
    if (!levelsData.length) {
      grid.innerHTML = '<div class="empty-text">No levels configured.</div>';
      return;
    }
    grid.innerHTML = levelsData
      .map(
        (l) => `
      <button type="button" class="level-card" data-level-id="${l.id}" data-level-num="${l.level_number}">
        <span class="level-card-num">${l.level_number}</span>
        <span class="level-card-label">Level</span>
      </button>`
      )
      .join('');

    grid.querySelectorAll('.level-card').forEach((btn) => {
      btn.addEventListener('click', () => onLevelSelect(parseInt(btn.dataset.levelId, 10)));
    });
  } catch (err) {
    grid.innerHTML = `<div class="empty-text">${escapeHtml(err.message)}</div>`;
  }
}

async function onLevelSelect(levelId) {
  selectedLevelId = levelId;
  selectedSession = null;
  levelMessagesCache = [];

  document.querySelectorAll('.level-card').forEach((el) => {
    el.classList.toggle('selected', parseInt(el.dataset.levelId, 10) === levelId);
  });

  document.getElementById('session-section').style.display = 'block';
  document.getElementById('messages-section').style.display = 'none';

  const sessionGrid = document.getElementById('session-grid');
  sessionGrid.innerHTML = '<div class="loading-container"><div class="spinner"></div></div>';

  try {
    levelMessagesCache = await API.get(`/messages?level_id=${levelId}`);
    const counts = {};
    for (let i = 1; i <= 8; i++) counts[i] = 0;
    levelMessagesCache.forEach((m) => {
      counts[m.session_number] = (counts[m.session_number] || 0) + 1;
    });

    sessionGrid.innerHTML = '';
    for (let s = 1; s <= 8; s++) {
      const n = counts[s];
      const label = `${n} message${n === 1 ? '' : 's'}`;
      const badge = `<span class="session-badge ${n === 0 ? 'session-badge-empty' : ''}">${label}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'session-card';
      btn.dataset.session = String(s);
      btn.innerHTML = `<span class="session-card-title">Session ${s}</span>${badge}`;
      btn.addEventListener('click', () => onSessionSelect(s));
      sessionGrid.appendChild(btn);
    }
  } catch (err) {
    sessionGrid.innerHTML = `<div class="empty-text">${escapeHtml(err.message)}</div>`;
  }
}

function onSessionSelect(sessionNum) {
  selectedSession = sessionNum;
  document.querySelectorAll('.session-card').forEach((el) => {
    el.classList.toggle('selected', parseInt(el.dataset.session, 10) === sessionNum);
  });

  document.getElementById('messages-section').style.display = 'block';
  renderMessagesList();
}

function renderMessagesList() {
  const container = document.getElementById('messages-list');
  const coach = API.getCoach();
  const coachId = coach && coach.id;

  const list = levelMessagesCache.filter((m) => m.session_number === selectedSession);

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: var(--space-xl) 0;">
        <div class="empty-icon">💬</div>
        <div class="empty-title">No messages yet</div>
        <div class="empty-text">Add one with the button above.</div>
      </div>`;
    return;
  }

  container.innerHTML = list
    .map((m) => {
      const isOwner = coachId && m.coach_id === coachId;
      const visBadge = m.is_public
        ? '<span class="badge badge-public-msg">🌍 Public</span>'
        : '<span class="badge badge-private-msg">🔒 Private</span>';
      const thumb = m.image_url
        ? `<button type="button" class="message-thumb-btn" data-full="${escapeHtml(m.image_url)}">
             <img src="${escapeHtml(m.image_url)}" alt="" class="message-thumb">
           </button>`
        : '';
      const titleBlock = m.title ? `<div class="message-card-title">${escapeHtml(m.title)}</div>` : '';
      const actions = isOwner
        ? `<div class="message-card-actions">
             <button type="button" class="btn btn-sm btn-ghost" data-edit-id="${m.id}">Edit</button>
             <button type="button" class="btn btn-sm btn-danger" data-delete-id="${m.id}">Delete</button>
           </div>`
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

      return `
        <div class="message-card animate-in" data-id="${m.id}">
          <div class="message-card-top">
            ${titleBlock}
            <div class="message-card-meta">
              ${visBadge}
              <span class="message-owner">by ${escapeHtml(m.owner_name || 'Coach')}</span>
            </div>
          </div>
          <div class="message-card-body">${escapeHtml(m.message_text)}</div>
          ${thumb}
          <div class="message-card-footer">
            ${actions}
            ${copyRow}
          </div>
        </div>`;
    })
    .join('');

  container.querySelectorAll('.message-thumb-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-full');
      document.getElementById('image-lightbox-img').src = url;
      document.getElementById('image-lightbox').classList.add('show');
    });
  });

  container.querySelectorAll('[data-edit-id]').forEach((btn) => {
    btn.addEventListener('click', () => openEditMessageModal(parseInt(btn.dataset.editId, 10)));
  });

  container.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', () => deleteMessage(parseInt(btn.dataset.deleteId, 10)));
  });

  container.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const mode = btn.dataset.copy;
      const m = list.find((x) => x.id === id);
      if (!m) return;
      if (mode === 'all' && m.image_url) copyAll(m.message_text, m.image_url);
      else if (mode === 'text') copyText(m.message_text);
      else if (mode === 'image' && m.image_url) copyImage(m.image_url);
    });
  });
}

function setVisibilityToggle(isPublic) {
  document.querySelectorAll('.visibility-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.public === String(isPublic));
  });
  document.getElementById('message-is-public').value = String(isPublic);
}

function openAddMessageModal() {
  if (!selectedLevelId || !selectedSession) {
    showAlert('messages-alert', 'Select a level and session first.', 'error');
    return;
  }
  editingMessageId = null;
  imageRemovedFlag = false;
  document.getElementById('message-form-title').textContent = 'Add Message';
  document.getElementById('message-edit-id').value = '';
  document.getElementById('message-title').value = '';
  document.getElementById('message-text').value = '';
  document.getElementById('message-image').value = '';
  document.getElementById('message-image-preview-wrap').style.display = 'none';
  document.getElementById('message-image-preview').src = '';
  document.getElementById('message-current-image-note').style.display = 'none';
  document.getElementById('message-form-alert').classList.remove('show');
  setVisibilityToggle(false);
  document.getElementById('message-form-modal').classList.add('show');
}

function openEditMessageModal(id) {
  const m = levelMessagesCache.find((x) => x.id === id);
  if (!m) return;
  editingMessageId = id;
  imageRemovedFlag = false;
  document.getElementById('message-form-title').textContent = 'Edit Message';
  document.getElementById('message-edit-id').value = String(id);
  document.getElementById('message-title').value = m.title || '';
  document.getElementById('message-text').value = m.message_text || '';
  document.getElementById('message-image').value = '';
  const note = document.getElementById('message-current-image-note');
  const wrap = document.getElementById('message-image-preview-wrap');
  const prevImg = document.getElementById('message-image-preview');
  if (m.image_url) {
    note.textContent = 'Remove or replace the image below.';
    note.style.display = 'block';
    prevImg.src = m.image_url;
    wrap.style.display = 'block';
  } else {
    note.style.display = 'none';
    prevImg.src = '';
    wrap.style.display = 'none';
  }
  document.getElementById('message-form-alert').classList.remove('show');
  setVisibilityToggle(!!m.is_public);
  document.getElementById('message-form-modal').classList.add('show');
}

function closeMessageFormModal() {
  document.getElementById('message-form-modal').classList.remove('show');
}

async function onMessageFormSubmit(e) {
  e.preventDefault();
  const alertEl = document.getElementById('message-form-alert');
  alertEl.classList.remove('show');

  const title = document.getElementById('message-title').value.trim();
  const message_text = document.getElementById('message-text').value.trim();
  const is_public = document.getElementById('message-is-public').value === 'true';
  const fileInput = document.getElementById('message-image');
  const file = fileInput.files[0];

  if (!message_text) {
    showAlert('message-form-alert', 'Message text is required.', 'error');
    return;
  }

  const saveBtn = document.getElementById('message-form-save');
  saveBtn.disabled = true;

  try {
    if (editingMessageId) {
      const fd = new FormData();
      fd.append('title', title);
      fd.append('message_text', message_text);
      fd.append('is_public', is_public ? 'true' : 'false');
      if (imageRemovedFlag) fd.append('remove_image', 'true');
      if (file) fd.append('image', file);
      await API.fetchForm(`/messages/${editingMessageId}`, fd, 'PUT');
    } else {
      const fd = new FormData();
      fd.append('level_id', String(selectedLevelId));
      fd.append('session_number', String(selectedSession));
      fd.append('title', title);
      fd.append('message_text', message_text);
      fd.append('is_public', is_public ? 'true' : 'false');
      if (file) fd.append('image', file);
      await API.fetchForm('/messages', fd, 'POST');
    }

    const keepSession = selectedSession;
    closeMessageFormModal();
    await onLevelSelect(selectedLevelId);
    if (keepSession) onSessionSelect(keepSession);
  } catch (err) {
    showAlert('message-form-alert', err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteMessage(id) {
  if (!confirm('Delete this message?')) return;
  try {
    const keepSession = selectedSession;
    await API.delete(`/messages/${id}`);
    await onLevelSelect(selectedLevelId);
    if (keepSession) onSessionSelect(keepSession);
  } catch (err) {
    showAlert('messages-alert', err.message, 'error');
  }
}
