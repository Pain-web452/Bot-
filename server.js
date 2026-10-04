const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const login = require('nexus-fca');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let botApi = null;
let botInterval = null;
let botRunning = false;

function sendLog(msg) {
    console.log(msg);
    io.emit('log', msg);
}

// Bot start karne ka route — ab cookies body se aayengi
app.post('/start', async (req, res) => {
    if (botRunning) return res.json({ status: 'already_running' });

    const { groupId, interval, cookies } = req.body;

    if (!cookies || cookies.trim() === '') {
        return res.json({ status: 'error', message: 'Cookies paste karein' });
    }

    let appState;
    try {
        appState = JSON.parse(cookies);
        if (!Array.isArray(appState)) throw new Error('Cookies array format mein honi chahiye');
    } catch (e) {
        sendLog('❌ Cookies JSON format galat hai: ' + e.message);
        return res.json({ status: 'error', message: 'Cookies ka format galat hai' });
    }

    try {
        sendLog('⏳ Login try kar raha hoon...');

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
        const ms = interval * 1000;
        sendLog(`⏳ Har ${interval} second mein message bhejega...`);

        botInterval = setInterval(() => {
            botApi.sendMessage('Hello from bot!', groupId, (err) => {
                if (err) return sendLog('❌ Send fail: ' + err);
                sendLog(`[${new Date().toLocaleTimeString()}] ✅ Message bhej diya`);
            });
        }, ms);

        res.json({ status: 'started' });
    } catch (err) {
        sendLog('❌ Login fail: ' + err.message);
        res.json({ status: 'error', message: err.message });
    }
});

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
