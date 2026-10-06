const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestWaWebVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const P = require('pino');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let sock;
let isConnected = false;
let isConnecting = false;
let reconnectAttempts = 0;

const SESSION_DIR = path.join(process.env.DATA_DIR || __dirname, 'auth_info');
console.log('Session directory:', SESSION_DIR);

async function connectToWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    // ✅ नया WhatsApp Web version (पुराना fetchLatestBaileysVersion bug देता है)
    const { version, isLatest } = await fetchLatestWaWebVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),   // ✅ compatible browser
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2000,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
            io.emit('status', 'Connecting...');
            console.log('Connecting...');
        }

        if (connection === 'open') {
            isConnected = true;
            isConnecting = false;
            reconnectAttempts = 0;
            io.emit('status', 'Running');
            console.log('✅ WhatsApp Connected!');
        }

        if (connection === 'close') {
            isConnected = false;
            isConnecting = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log('Connection closed. Status code:', statusCode);

            if (statusCode !== DisconnectReason.loggedOut) {
                reconnectAttempts++;
                const delay = Math.min(5000 * reconnectAttempts, 30000);
                console.log(`Reconnecting in ${delay / 1000}s...`);
                io.emit('status', 'Reconnecting...');
                setTimeout(connectToWhatsApp, delay);
            } else {
                console.log('Logged out. Delete auth_info and redeploy.');
                io.emit('status', 'Logged Out');
            }
        }
    });
}

connectToWhatsApp();

// --- API Routes ---
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 🔑 Pairing Code API
app.post('/api/pairing-code', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Number required' });

    const cleanNumber = phoneNumber.replace(/\D/g, '');
    if (cleanNumber.length < 10) return res.status(400).json({ error: 'Invalid number' });

    try {
        if (sock?.authState?.creds?.registered) {
            return res.status(400).json({ error: 'Already linked. Logout from WhatsApp first.' });
        }

        // Socket ready होने का इंतज़ार करो
        let waited = 0;
        while ((!sock?.ws?.isOpen) && waited < 15000) {
            await new Promise(r => setTimeout(r, 500));
            waited += 500;
        }

        if (!sock?.ws?.isOpen) {
            return res.status(500).json({
                error: 'WhatsApp not ready. Render service redeploy karke 30 sec ke andar try karo.'
            });
        }

        console.log('Requesting pairing code for:', cleanNumber);
        const code = await sock.requestPairingCode(cleanNumber);
        console.log('🔑 Pairing Code:', code);
        res.json({ code });
    } catch (err) {
        console.log('Pairing error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// 📋 Groups Fetch
app.get('/api/groups', async (req, res) => {
    if (!isConnected) return res.status(503).json({ error: 'Not connected' });
    try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.values(groups).map(g => ({
            id: g.id,
            name: g.subject,
            size: g.participants?.length || 0
        }));
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 💬 Send Messages
app.post('/api/send', async (req, res) => {
    if (!isConnected || !sock) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    const { targets, message } = req.body;
    if (!targets || !targets.length) {
        return res.status(400).json({ error: 'No targets selected' });
    }

    let sent = 0, failed = 0;
    for (const target of targets) {
        try {
            await sock.sendMessage(target, { text: message });
            sent++;
            io.emit('log', `✅ Sent to ${target}`);
        } catch (err) {
            failed++;
            io.emit('log', `❌ Failed ${target}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    res.json({ success: true, sent, failed });
});

io.on('connection', (socket) => {
    console.log('UI Connected');
    socket.emit('status', isConnected ? 'Running' : (isConnecting ? 'Connecting...' : 'Disconnected'));
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
