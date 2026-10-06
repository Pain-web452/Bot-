const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;  // Render 会自动设置 PORT

let sock;
let isConnected = false;

// 使用绝对路径，配合 Render 的 Persistent Disk
const SESSION_DIR = path.join(process.env.DATA_DIR || __dirname, 'auth_info');
console.log('Session directory:', SESSION_DIR);

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,  // QR 会打印到 Render 日志
        logger: P({ level: 'silent' }),
        browser: ["RK RAJA XWD", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR Code generated. Check Render logs to scan.');
            io.emit('qr_required', 'QR generated - check server logs');
        }

        if (connection === 'open') {
            isConnected = true;
            io.emit('status', 'Running');
            console.log('✅ WhatsApp Connected!');
        }

        if (connection === 'close') {
            isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                connectToWhatsApp();
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

// 发送测试消息的 API
app.post('/api/send', async (req, res) => {
    if (!isConnected || !sock) {
        return res.status(503).json({ error: 'WhatsApp not connected' });
    }
    
    const { target, message } = req.body;
    try {
        await sock.sendMessage(target, { text: message });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

io.on('connection', (socket) => {
    console.log('UI Connected');
    socket.emit('status', isConnected ? 'Running' : 'Disconnected');
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
