const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const P = require('pino');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

let sock;
let isConnected = false;
let pairingCodeRequested = false;

const SESSION_DIR = path.join(process.env.DATA_DIR || __dirname, 'auth_info');
console.log('Session directory:', SESSION_DIR);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,   // QR बंद, Pairing Code चालू
        logger: P({ level: 'silent' }),
        browser: ["RK RAJA XWD", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Pairing Code सिर्फ एक बार माँगें
        if ((qr || connection === 'connecting') && !sock.authState.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true;
            try {
                const phoneNumber = process.env.PHONE_NUMBER; // Render env से
                if (!phoneNumber) {
                    console.log('❌ PHONE_NUMBER env variable सेट नहीं है');
                    io.emit('log', 'PHONE_NUMBER env missing');
                    return;
                }
                const code = await sock.requestPairingCode(phoneNumber);
                console.log('🔑 Pairing Code:', code);
                io.emit('pairing_code', code);
            } catch (err) {
                console.log('Pairing error:', err.message);
                pairingCodeRequested = false;
            }
        }

        if (connection === 'open') {
            isConnected = true;
            io.emit('status', 'Running');
            console.log('✅ WhatsApp Connected!');
        }

        if (connection === 'close') {
            isConnected = false;
            pairingCodeRequested = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                connectToWhatsApp();
            }
        }
    });
}

connectToWhatsApp();

// --- Group Fetch ---
async function fetchGroups() {
    if (!sock || !isConnected) return [];
    try {
        const groups = await sock.groupFetchAllParticipating();
        return Object.values(groups).map(g => ({
            id: g.id,
            name: g.subject,
            size: g.participants?.length || 0
        }));
    } catch (err) {
        console.log('Group fetch error:', err.message);
        return [];
    }
}

// --- API Routes ---
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/groups', async (req, res) => {
    if (!isConnected) return res.status(503).json({ error: 'Not connected' });
    const groups = await fetchGroups();
    res.json(groups);
});

app.post('/api/send', async (req, res) => {
    if (!isConnected || !sock) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    const { targets, message } = req.body; // targets = array of group IDs
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
        await new Promise(r => setTimeout(r, 3000)); // 3 सेकंड डिले
    }
    res.json({ success: true, sent, failed });
});

io.on('connection', (socket) => {
    console.log('UI Connected');
    socket.emit('status', isConnected ? 'Running' : 'Disconnected');
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
