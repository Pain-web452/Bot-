const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const multer = require('multer');

const PORT = process.env.PORT || 25029;
const HOST = '0.0.0.0';
const AUTH_DIR = 'auth_info_baileys';

const MIN_DELAY_SECONDS = 3;
const DEFAULT_DELAY_SECONDS = 10;
const SEND_RETRY = 1;
const RETRY_WAIT_MS = 2000;
const WATCHDOG_INTERVAL_MS = 30000;

let sock = null;
let pairingCode = null;
let isPaired = false;
let currentPhone = null;
let pairingRequested = false;
let isConnecting = false;
let lastError = null;
let connectedAt = null;
let serverStartTime = Date.now();

let groupsCache = {};

const bulkState = {
  running: false,
  stopFlag: false,
  sent: 0,
  failed: 0,
  tasks: 0,
  total: 0,
  remaining: 0,
  cycle: 0,
  msgIndex: 0,
  targetIndex: 0,
  totalTargets: 0,
  currentMessage: '',
  currentTarget: '',
  targets: [],
  messages: [],
  delayMs: DEFAULT_DELAY_SECONDS * 1000,
  logs: [],
  logId: 0,
  startedAt: null,
  workerAlive: false,
  lastBeat: 0,
  groupNameLock: '',
  groupPhotoLock: 'any',
};

// ===== GROUP EVENT WATCHER STATE =====
const watcherState = {
  enabled: false,
  message: '',
  watchName: true,
  watchPhoto: true,
  intervalSec: 45,
  snapshots: {},
  events: [],
  eventId: 0,
  stats: { nameChanges: 0, photoChanges: 0, sent: 0, failed: 0 },
  timer: null,
  lastCheck: 0,
};

// ===== MASTER LOCK (owner-only) =====
const masterLock = {
  enabled: false,
  password: '',
  setAt: null,
};

function checkOwnerAuth(req) {
  if (!masterLock.enabled) return true;
  const key =
    req.headers['x-owner-key'] ||
    (req.body && req.body.ownerKey) ||
    req.query.ownerKey;
  return key === masterLock.password;
}

function pushLog(type, msg) {
  bulkState.logs.push({ id: ++bulkState.logId, ts: Date.now(), type, msg });
  if (bulkState.logs.length > 500) bulkState.logs.splice(0, bulkState.logs.length - 500);
  const icons = { ok: '✅', err: '❌', warn: '⚠️', info: 'ℹ️' };
  console.log(`${icons[type] || '•'} ${msg}`);
}

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function getGroupsFromStore() {
  const out = [];
  try {
    if (sock && sock.store && sock.store.groupMetadata) {
      const map = sock.store.groupMetadata;
      map.forEach((v) => {
        out.push({
          id: v.id,
          name: v.subject || '',
          size: v.participants ? v.participants.length : 0,
        });
      });
    }
  } catch (_) {}
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isSocketReady() {
  return !!(sock && isPaired);
}

function parseMessagesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const seen = new Set();
  const out = [];
  content.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  });
  return out;
}

// Accepts phone numbers AND group JIDs (auto-filled UIDs)
function parseNumbers(raw) {
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  String(raw).split(/[\r\n,;\s]+/).forEach((tok) => {
    const t = tok.trim();
    if (!t) return;

    if (/@g\.us$/i.test(t)) {
      if (seen.has(t)) return;
      seen.add(t);
      out.push({ jid: t, label: '[G] ' + t });
      return;
    }

    const digits = t.replace(/[^\d]/g, '');
    if (!digits || digits.length < 8 || digits.length > 15) return;
    const jid = digits + '@s.whatsapp.net';
    if (seen.has(jid)) return;
    seen.add(jid);
    out.push({ jid, label: '[N] +' + digits });
  });
  return out;
}

async function groupHasPhoto(jid) {
  try {
    if (!sock) return false;
    const url = await sock.profilePictureUrl(jid, 'image');
    return !!url;
  } catch (_) {
    return false;
  }
}

// ===== Watcher helpers =====
function addWatcherEvent(jid, gname, type, oldVal, newVal, ok, err) {
  watcherState.events.push({
    id: ++watcherState.eventId,
    ts: Date.now(),
    jid,
    gname,
    type,
    oldVal: oldVal || '',
    newVal: newVal || '',
    ok: !!ok,
    err: err || '',
  });
  if (watcherState.events.length > 300) {
    watcherState.events.splice(0, watcherState.events.length - 300);
  }
  const icon = type === 'name' ? '📝' : '📷';
  pushLog(ok ? 'ok' : 'err', `${icon} ${type} change in "${gname}"${ok ? ' → message sent' : ' → FAILED: ' + (err || '')}`);
}

async function buildGroupSnapshot() {
  const out = {};
  const jids = Object.keys(groupsCache).filter((j) => j.endsWith('@g.us'));
  for (const jid of jids) {
    const meta = groupsCache[jid];
    let photo = null;
    try {
      photo = await sock.profilePictureUrl(jid, 'image');
    } catch (_) { photo = null; }
    out[jid] = { name: (meta && meta.name) || '', photo };
  }
  return out;
}

async function fireWatcherEvent(jid, type, oldVal, newVal) {
  const meta = groupsCache[jid];
  const gname = (meta && meta.name) || jid;

  let text = watcherState.message || '';
  if (!text.trim()) {
    pushLog('warn', `Watcher event in "${gname}" but no message set — skipped`);
    return;
  }

  text = text
    .replace(/\{\{group\}\}/g, gname)
    .replace(/\{\{type\}\}/g, type === 'name' ? 'name' : 'photo')
    .replace(/\{\{old\}\}/g, oldVal || '—')
    .replace(/\{\{new\}\}/g, newVal || '—');

  try {
    await sock.sendMessage(jid, { text });
    watcherState.stats.sent++;
    if (type === 'name') watcherState.stats.nameChanges++;
    else watcherState.stats.photoChanges++;
    addWatcherEvent(jid, gname, type, oldVal, newVal, true);
  } catch (e) {
    watcherState.stats.failed++;
    addWatcherEvent(jid, gname, type, oldVal, newVal, false, e.message);
  }
}

async function runWatcherCheck() {
  if (!watcherState.enabled || !isSocketReady()) return;
  try {
    const fresh = await buildGroupSnapshot();
    const old = watcherState.snapshots;

    for (const jid of Object.keys(fresh)) {
      const n = fresh[jid];
      const o = old[jid];
      if (!o) continue;

      if (watcherState.watchName && o.name !== n.name && n.name) {
        await fireWatcherEvent(jid, 'name', o.name, n.name);
      }
      if (watcherState.watchPhoto && o.photo !== n.photo) {
        await fireWatcherEvent(jid, 'photo', o.photo ? 'old-photo' : 'none', n.photo ? 'new-photo' : 'removed');
      }
    }

    watcherState.snapshots = fresh;
    watcherState.lastCheck = Date.now();
  } catch (e) {
    pushLog('warn', 'Watcher check failed: ' + e.message);
  }
}

function startWatcherLoop() {
  if (watcherState.timer) clearInterval(watcherState.timer);
  watcherState.timer = setInterval(runWatcherCheck, watcherState.intervalSec * 1000);
}

function stopWatcherLoop() {
  if (watcherState.timer) { clearInterval(watcherState.timer); watcherState.timer = null; }
}

// ===== Safe send with retry =====
async function safeSend(jid, text) {
  let lastErr = null;
  for (let attempt = 0; attempt <= SEND_RETRY; attempt++) {
    try {
      if (!isSocketReady()) throw new Error('socket not ready');
      await sock.sendMessage(jid, { text });
      return { ok: true };
    } catch (e) {
      lastErr = e;
      if (attempt < SEND_RETRY) {
        pushLog('warn', `Retry ${attempt + 1}/${SEND_RETRY} → ${jid}: ${e.message}`);
        await sleep(RETRY_WAIT_MS);
      }
    }
  }
  return { ok: false, error: lastErr ? lastErr.message : 'unknown' };
}

// ===== Continuous worker loop =====
async function runWorker() {
  if (bulkState.workerAlive) return;
  bulkState.workerAlive = true;
  pushLog('info', 'Worker started — 24/7 loop active');

  try {
    while (!bulkState.stopFlag) {
      if (!isSocketReady()) {
        bulkState.lastBeat = Date.now();
        await sleep(3000);
        continue;
      }

      for (let mi = 0; mi < bulkState.messages.length && !bulkState.stopFlag; mi++) {
        const msg = bulkState.messages[mi];
        bulkState.msgIndex = mi;
        bulkState.currentMessage = msg;

        for (let ti = 0; ti < bulkState.targets.length && !bulkState.stopFlag; ti++) {
          const t = bulkState.targets[ti];
          bulkState.targetIndex = ti;
          bulkState.currentTarget = t.label;
          bulkState.lastBeat = Date.now();

          if (!isSocketReady()) {
            pushLog('warn', 'Socket temporarily unavailable — waiting to resume');
            break;
          }

          try {
            const res = await safeSend(t.jid, msg);
            if (res.ok) {
              bulkState.sent++;
              pushLog('ok', `Cycle ${bulkState.cycle + 1} | Msg ${mi + 1}/${bulkState.messages.length} → ${t.label}`);
            } else {
              bulkState.failed++;
              pushLog('err', `Msg ${mi + 1} → ${t.label}: ${res.error}`);
            }
          } catch (e) {
            bulkState.failed++;
            pushLog('err', `Unexpected send error → ${t.label}: ${e.message}`);
          }

          bulkState.remaining = bulkState.messages.length - (mi + 1);

          if (!bulkState.stopFlag) {
            await sleep(bulkState.delayMs);
          }
        }

        if (!isSocketReady() && !bulkState.stopFlag) break;
      }

      if (!bulkState.stopFlag) {
        bulkState.cycle++;
        bulkState.remaining = bulkState.messages.length;
        bulkState.msgIndex = 0;
        bulkState.targetIndex = 0;
        pushLog('info', `Cycle ${bulkState.cycle} completed — restarting from Message 1`);
      }
    }
  } catch (loopErr) {
    pushLog('err', 'Worker crashed: ' + loopErr.message);
    if (!bulkState.stopFlag) {
      pushLog('warn', 'Worker auto-restarting in 3s...');
      bulkState.workerAlive = false;
      bulkState.running = true;
      setTimeout(() => { runWorker(); }, 3000);
      return;
    }
  } finally {
    if (bulkState.stopFlag) {
      bulkState.running = false;
      bulkState.stopFlag = false;
      bulkState.workerAlive = false;
      bulkState.currentMessage = '';
      bulkState.currentTarget = '';
      pushLog('info', `Task stopped — Sent: ${bulkState.sent}, Failed: ${bulkState.failed}, Cycles: ${bulkState.cycle}`);
    } else {
      bulkState.workerAlive = false;
    }
  }
}

setInterval(() => {
  if (bulkState.running && !bulkState.workerAlive) {
    pushLog('warn', 'Watchdog: worker not alive — restarting');
    runWorker();
  }
}, WATCHDOG_INTERVAL_MS);

// ===== WhatsApp connection =====
async function connectToWhatsApp(phone) {
  if (!phone) throw new Error('Phone number required');
  if (isConnecting) throw new Error('Connection already in progress');
  if (isPaired) throw new Error('Already paired');

  isConnecting = true;
  currentPhone = phone;
  pairingCode = null;
  lastError = null;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      mobile: false,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('groups.upsert', (groups) => {
      groups.forEach((g) => {
        groupsCache[g.id] = {
          id: g.id,
          name: g.subject || '',
          size: g.participants ? g.participants.length : 0,
        };
      });
    });

    sock.ev.on('groups.update', (updates) => {
      updates.forEach((u) => {
        if (groupsCache[u.id]) {
          if (u.subject) groupsCache[u.id].name = u.subject;
        } else if (u.id) {
          groupsCache[u.id] = { id: u.id, name: u.subject || '', size: 0 };
        }
      });

      // Instant name-change watcher trigger
      if (watcherState.enabled && watcherState.watchName) {
        updates.forEach((u) => {
          if (!u.subject || !u.id) return;
          const prev = watcherState.snapshots[u.id];
          if (prev && prev.name && prev.name !== u.subject) {
            const oldName = prev.name;
            prev.name = u.subject;
            fireWatcherEvent(u.id, 'name', oldName, u.subject);
          } else if (!prev) {
            watcherState.snapshots[u.id] = { name: u.subject, photo: null };
          }
        });
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting' && !sock.authState.creds.registered && !pairingRequested) {
        pairingRequested = true;
        try {
          await sleep(1000);
          pairingCode = await sock.requestPairingCode(phone);
          console.log(`\n📱 PAIRING CODE for ${phone}: ${pairingCode}\n`);
          pushLog('info', `Pairing code for ${phone}: ${pairingCode}`);
          lastError = null;
        } catch (err) {
          console.error('❌ Pairing code error:', err.message);
          lastError = err.message;
          pairingCode = null;
          pairingRequested = false;
          isConnecting = false;
        }
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp connected!');
        isPaired = true;
        pairingCode = null;
        pairingRequested = false;
        isConnecting = false;
        connectedAt = new Date().toISOString();
        lastError = null;
        pushLog('ok', `WhatsApp connected (${phone})`);

        setTimeout(() => {
          try {
            const groups = getGroupsFromStore();
            groups.forEach((g) => { groupsCache[g.id] = g; });
            pushLog('info', `Loaded ${groups.length} groups into cache`);
          } catch (e) {
            console.error('Group cache load error:', e.message);
          }
        }, 3000);

        setTimeout(async () => {
          try {
            watcherState.snapshots = await buildGroupSnapshot();
            pushLog('info', `Watcher snapshot ready (${Object.keys(watcherState.snapshots).length} groups)`);
          } catch (_) {}
        }, 5000);

        if (bulkState.running && !bulkState.workerAlive) {
          pushLog('info', 'Reconnect detected — resuming bulk worker');
          runWorker();
        }
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        pushLog('warn', `Connection closed (code ${statusCode})`);

        isPaired = false;
        isConnecting = false;

        if (bulkState.running) {
          pushLog('warn', 'Socket dropped — worker will auto-resume after reconnect');
        }

        if (shouldReconnect && currentPhone) {
          pairingRequested = false;
          setTimeout(() => connectToWhatsApp(currentPhone).catch(console.error), 3000);
        } else if (statusCode === DisconnectReason.loggedOut) {
          pairingCode = null;
          pairingRequested = false;
          currentPhone = null;
          if (bulkState.running) {
            bulkState.stopFlag = true;
            pushLog('warn', 'Logged out — stopping bulk worker');
          }
        }
      }
    });
  } catch (err) {
    isConnecting = false;
    lastError = err.message;
    throw err;
  }
}

// ============================================================
// EMBEDDED HTML
// ============================================================
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>9AMAN X YAMDHUD — Control Center</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:#050507;color:#e2e8f0;min-height:100vh;overflow-x:hidden;position:relative;
  }
  body::before{
    content:"";position:fixed;inset:0;z-index:-2;
    background:
      radial-gradient(1200px 800px at 15% 10%, rgba(255,0,60,.18), transparent 60%),
      radial-gradient(900px 600px at 85% 90%, rgba(255,0,60,.14), transparent 65%),
      linear-gradient(135deg,#050507 0%,#0b0b12 55%,#050507 100%);
  }
  body::after{
    content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;
    background-image:
      linear-gradient(115deg, transparent 40%, rgba(255,0,60,.06) 41%, transparent 42%),
      linear-gradient(115deg, transparent 60%, rgba(255,0,60,.05) 61%, transparent 62%),
      repeating-linear-gradient(115deg, rgba(255,255,255,.015) 0 1px, transparent 1px 60px);
    mask-image:radial-gradient(circle at 50% 40%, #000 30%, transparent 90%);
  }
  .streaks{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
  .streaks span{
    position:absolute;height:1px;width:220px;left:-30%;
    background:linear-gradient(90deg,transparent,#ff003c,transparent);
    filter:drop-shadow(0 0 6px #ff003c);opacity:.55;
    animation:streak 7s linear infinite;
  }
  .streaks span:nth-child(2){top:25%;animation-delay:1.5s;animation-duration:9s}
  .streaks span:nth-child(3){top:55%;animation-delay:3s;animation-duration:8s}
  .streaks span:nth-child(4){top:78%;animation-delay:4.5s;animation-duration:10s}
  @keyframes streak{from{transform:translateX(0) rotate(-12deg)}to{transform:translateX(160vw) rotate(-12deg)}}

  .container{max-width:1180px;margin:0 auto;padding:28px 18px 60px;position:relative;z-index:1}

  .brand{text-align:center;margin-bottom:26px}
  .brand h1{
    font-size:clamp(22px,4vw,38px);font-weight:900;letter-spacing:3px;
    background:linear-gradient(180deg,#ffffff 0%,#c9c9d6 45%,#ff003c 130%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    text-shadow:0 0 26px rgba(255,0,60,.45);
    font-family:"Orbitron","Rajdhani",-apple-system,sans-serif;
  }
  .brand h1 .x{color:#ff003c;-webkit-text-fill-color:#ff003c;text-shadow:0 0 18px #ff003c}
  .brand p{color:#8b8b9c;font-size:11px;letter-spacing:3px;margin-top:6px;text-transform:uppercase}

  .tabs{display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;justify-content:center}
  .tab{
    padding:11px 20px;border-radius:12px;font-size:12px;font-weight:700;letter-spacing:2px;
    text-transform:uppercase;cursor:pointer;border:1px solid rgba(255,0,60,.35);
    background:rgba(255,0,60,.05);color:#ff5277;transition:.2s;
  }
  .tab.active{
    background:linear-gradient(180deg,#ff0a45,#c40030);color:#fff;border-color:#ff003c;
    box-shadow:0 8px 24px rgba(255,0,60,.35),inset 0 1px 0 rgba(255,255,255,.25);
  }
  .tab:hover:not(.active){background:rgba(255,0,60,.12)}

  .panel{display:none}
  .panel.active{display:block;animation:fade .3s ease}
  @keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

  .layout{display:grid;grid-template-columns:400px 1fr;gap:20px}
  @media(max-width:900px){.layout{grid-template-columns:1fr}}

  .card{
    position:relative;
    background:linear-gradient(155deg, rgba(20,20,28,.72), rgba(10,10,15,.55));
    border:1px solid rgba(255,0,60,.28);
    border-radius:18px;padding:24px;margin-bottom:20px;
    backdrop-filter:blur(16px) saturate(140%);
    -webkit-backdrop-filter:blur(16px) saturate(140%);
    box-shadow:
      0 20px 50px rgba(0,0,0,.55),
      inset 0 1px 0 rgba(255,255,255,.05),
      0 0 32px rgba(255,0,60,.06);
  }
  .card::before{
    content:"";position:absolute;inset:-1px;border-radius:18px;padding:1px;
    background:linear-gradient(135deg, rgba(255,0,60,.55), transparent 40%, transparent 60%, rgba(255,0,60,.35));
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
    -webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;opacity:.7;
  }
  .card
