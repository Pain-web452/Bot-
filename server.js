const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const login = require('@dongdev/fca-unofficial');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let botApi = null;
let botInterval = null;
let botRunning = false;
let currentMessages = [];
let messageIndex = 0;

function sendLog(msg) {
    console.log(msg);
    io.emit('log', msg);
}

// Cookies parse - "c_user=...; xs=..." ya JSON array dono support
function parseCookies(cookieInput) {
    if (!cookieInput || cookieInput.trim() === '') return null;

    try {
        const parsed = JSON.parse(cookieInput);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* not JSON */ }

    const cookies = [];
    const pairs = cookieInput.split(';');
    for (let pair of pairs) {
        pair = pair.trim();
        if (!pair) continue;
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const key = pair.substring(0, idx).trim();
        const value = pair.substring(idx + 1).trim();
        if (key && value) {
            cookies.push({
                key: key,
                value: value,
                domain: ".facebook.com",
                path: "/"
            });
        }
    }
    return cookies.length > 0 ? cookies : null;
}

// Save messages
app.post('/save-messages', (req, res) => {
    const { messages } = req.body;
    currentMessages = messages.filter(m => m.trim() !== '');
    sendLog(`💾 ${currentMessages.length} messages load ho gaye`);
    res.json({ status: 'saved', count: currentMessages.length });
});

app.get('/get-messages', (req, res) => {
    res.json({ messages: currentMessages });
});

// Start bot
app.post('/start', async (req, res) => {
    if (botRunning) return res.json({ status: 'already_running' });

    const { primaryCookies, backupCookies, targetId, haterName } = req.body;

    if (!targetId || targetId.trim() === '') {
        return res.json({ status: 'error', message: 'Target ID daalein' });
    }

    if (currentMessages.length === 0) {
        return res.json({ status: 'error', message: 'Pehle messages file upload karein' });
    }

    let appState = parseCookies(primaryCookies);
    let usingBackup = false;

    if (!appState) {
        sendLog('⚠️ Primary cookies invalid, backup try kar raha hoon...');
        appState = parseCookies(backupCookies);
        usingBackup = true;
    }

    if (!appState) {
        return res.json({ status: 'error', message: 'Primary aur Backup dono cookies invalid hain' });
    }

    try {
        sendLog(usingBackup ? '⏳ Backup cookies se login try...' : '⏳ Primary cookies se login try...');

        botApi = await login({ appState }, {
            appState,
            listenEvents: true,
            emitReady: true,
            autoReconnect: true,
            randomUserAgent: true
        });

        sendLog(`✅ Login successful! ID: ${botApi.getCurrentUserID()}`);
        botApi.on('ready', () => sendLog('🚀 Bot ready!'));

        botApi.listenMqtt((err, event) => {
            if (err) return sendLog('❌ Listen error: ' + err);
            if (event.type === 'message' && event.body) {
                sendLog(`📩 Message: ${event.body}`);
                if (event.body === '/ping') botApi.sendMessage('pong', event.threadID);
            }
        });

        botRunning = true;
        messageIndex = 0;

        // Har 5 second message bhejega
        const INTERVAL_MS = 5000;

        botInterval = setInterval(() => {
            if (currentMessages.length === 0) return;

            let msg = currentMessages[messageIndex % currentMessages.length];
            if (haterName && haterName.trim() !== '') {
                msg = haterName.trim() + ' ' + msg;
            }

            botApi.sendMessage(msg, targetId, (err) => {
                if (err) return sendLog('❌ Send fail: ' + err);
                sendLog(`[${new Date().toLocaleTimeString()}] ✅ Bheja: "${msg}"`);
                messageIndex++;
            });
        }, INTERVAL_MS);

        sendLog(`⏳ Bot started! Har 5 second message jayega (${currentMessages.length} messages loop honge)`);
        res.json({ status: 'started' });
    } catch (err) {
        sendLog('❌ Login fail: ' + err.message);
        res.json({ status: 'error', message: err.message });
    }
});

// Stop bot
app.post('/stop', (req, res) => {
    if (botInterval) clearInterval(botInterval);
    botRunning = false;
    botApi = null;
    sendLog('🛑 Bot stopped');
    res.json({ status: 'stopped' });
});

io.on('connection', (socket) => {
    sendLog('✅ Dashboard client connected');
});

server.listen(3000, () => {
    console.log('🌐 Panel chalu: http://localhost:3000');
});
