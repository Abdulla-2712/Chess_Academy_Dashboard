const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

let client = null;
let clientReady = false;
let currentQR = null;

function initWhatsApp() {
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './whatsapp-session',
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', (qr) => {
    currentQR = qr;
    clientReady = false;
    qrcode.generate(qr, { small: true });
    console.log('WhatsApp QR Code generated — scan it at /whatsapp-status.html');
  });

  client.on('ready', () => {
    clientReady = true;
    currentQR = null;
    console.log('✅ WhatsApp client is ready!');
  });

  client.on('disconnected', (reason) => {
    clientReady = false;
    console.log('WhatsApp disconnected:', reason);
    setTimeout(() => initWhatsApp(), 5000);
  });

  client.initialize();
}

function resolveImagePath(imagePath) {
  if (!imagePath) return null;
  const normalized = String(imagePath).replace(/^\//, '').replace(/^uploads\//, '');
  const abs = path.join(process.cwd(), 'uploads', normalized);
  return fs.existsSync(abs) ? abs : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDetachedFrameError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('detached frame') || msg.includes('execution context was destroyed');
}

/** Extract invite token from common WhatsApp group URL shapes */
function parseInviteCodeFromLink(link) {
  const s = String(link).trim();
  let tail =
    s.split('chat.whatsapp.com/')[1]?.split(/[?#]/)[0]?.trim() ||
    s.split('invite/')[1]?.split(/[?#]/)[0]?.trim() ||
    null;
  if (!tail) return null;
  tail = tail.replace(/^invite\//i, '').trim();
  return tail || null;
}

/** Walk invite metadata from getInviteInfo() and find a @g.us JID */
function findGroupJidInInviteInfo(obj, depth = 0) {
  if (!obj || depth > 10) return null;
  if (typeof obj === 'string' && /@g\.us$/i.test(obj)) return obj;
  if (typeof obj === 'object') {
    const ser = obj._serialized;
    if (typeof ser === 'string' && /@g\.us$/i.test(ser)) return ser;
    if (obj.server === 'g.us' && obj.user && typeof obj.user === 'string') {
      return `${obj.user}@g.us`;
    }
    for (const k of Object.keys(obj)) {
      const found = findGroupJidInInviteInfo(obj[k], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve GroupChat from an invite link / code (whatsapp-web.js has no acceptGroupInvite;
 * Chat objects do not expose inviteCode for .find()).
 */
async function resolveGroupChatFromInvite(client, inviteCode) {
  let groupJid = null;
  try {
    const info = await client.getInviteInfo(inviteCode);
    groupJid = findGroupJidInInviteInfo(info);
  } catch (e) {
    console.warn('WhatsApp getInviteInfo:', e.message || e);
  }

  if (groupJid) {
    try {
      const chat = await client.getChatById(groupJid);
      if (chat && chat.isGroup) return chat;
    } catch (e) {
      console.warn('WhatsApp getChatById (from invite info):', e.message || e);
    }
  }

  try {
    const joinedId = await client.acceptInvite(inviteCode);
    const chat = await client.getChatById(joinedId);
    if (chat && chat.isGroup) return chat;
  } catch (e) {
    console.warn('WhatsApp acceptInvite:', e.message || e);
  }

  const chats = await client.getChats();
  for (const c of chats) {
    if (!c.isGroup) continue;
    try {
      const codeRes = await c.getInviteCode();
      const code = typeof codeRes === 'string' ? codeRes : codeRes?.code;
      if (code && code === inviteCode) return c;
    } catch (_) {
      /* not admin or unavailable */
    }
  }

  throw new Error('Group not found — make sure you are a member of this group');
}

async function sendMessageToGroup(groupInviteLink, messageText, imagePath) {
  if (!clientReady || !client) {
    throw new Error('WhatsApp client is not ready');
  }

  const inviteCode = parseInviteCodeFromLink(groupInviteLink);
  if (!inviteCode) throw new Error('Invalid WhatsApp group link');

  // WhatsApp Web can reload internally; retry once on detached-frame style puppeteer errors.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const chat = await resolveGroupChatFromInvite(client, inviteCode);
      const absoluteImagePath = resolveImagePath(imagePath);
      if (absoluteImagePath) {
        const media = MessageMedia.fromFilePath(absoluteImagePath);
        await chat.sendMessage(media, { caption: messageText });
      } else {
        await chat.sendMessage(messageText);
      }
      return true;
    } catch (err) {
      const canRetry = attempt === 1 && isDetachedFrameError(err);
      if (canRetry) {
        console.warn('WhatsApp detached frame detected. Retrying send once...');
        await sleep(1500);
        continue;
      }

      if (isDetachedFrameError(err)) {
        throw new Error(
          'WhatsApp Web reloaded in the background. Please try again in a few seconds or reconnect from /whatsapp-status.html'
        );
      }
      throw err;
    }
  }
  throw new Error('WhatsApp send failed');
}

function getStatus() {
  return {
    ready: clientReady,
    qr: currentQR,
  };
}

module.exports = { initWhatsApp, sendMessageToGroup, getStatus };
