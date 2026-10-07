const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const sessions = {};
const liveStats = { totalSessions: 0, paired: 0, startTime: Date.now() };

// Calculate server Uptime
function getUptime() {
    const diff = Date.now() - liveStats.startTime;
    const hrs = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const secs = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
}

// Initialize WhatsApp Session
async function initWhatsApp(sessionId, phoneNumber = null, socketEmit = null) {
    const authFolder = path.join(__dirname, 'sessions', `session_${sessionId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sessions[sessionId] = { sock, status: 'connecting', number: phoneNumber };

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && phoneNumber && socketEmit) {
            try {
                setTimeout(async () => {
                    let code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
                    socketEmit('pairing_code', { sessionId, code });
                }, 3000);
            } catch (err) {
                console.error("Pairing code error:", err);
            }
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            sessions[sessionId].status = 'disconnected';
            io.emit('log', { msg: `[Session ${sessionId}] Disconnected. Reconnecting: ${shouldReconnect}` });
            if (shouldReconnect) {
                initWhatsApp(sessionId, phoneNumber);
            } else {
                delete sessions[sessionId];
                fs.rmSync(authFolder, { recursive: true, force: true });
            }
            updateStats();
        } else if (connection === 'open') {
            sessions[sessionId].status = 'connected';
            const userNumber = sock.user.id.split(':')[0];
            sessions[sessionId].number = userNumber;
            io.emit('log', { msg: `[Session ${sessionId}] Successfully Paired with ${userNumber}` });
            updateStats();
        }
    });
}

function updateStats() {
    const active = Object.keys(sessions);
    liveStats.totalSessions = active.length;
    liveStats.paired = active.filter(id => sessions[id].status === 'connected').length;
    io.emit('stats', {
        totalSessions: liveStats.totalSessions,
        paired: liveStats.paired,
        uptime: getUptime()
    });
}

setInterval(updateStats, 1000);

// Web sockets for front-end real-time actions
io.on('connection', (socket) => {
    updateStats();

    socket.on('request_pairing', async (data) => {
        const { sessionId, phoneNumber } = data;
        io.emit('log', { msg: `[Session ${sessionId}] Requesting pairing code for ${phoneNumber}...` });
        initWhatsApp(sessionId, phoneNumber, (event, payload) => {
            socket.emit(event, payload);
        });
    });

    socket.on('start_bulk', async (config) => {
        const { sessionId, targets, messages, delay, haterPrefix, lastHaterSuffix } = config;
        const session = sessions[sessionId];

        if (!session || session.status !== 'connected') {
            socket.emit('log', { msg: `❌ Error: Selected Session ${sessionId} is not connected.` });
            return;
        }

        io.emit('bulk_status', { status: 'Running', sent: 0, remaining: targets.length });

        let count = 0;
        for (let target of targets) {
            try {
                const cleanTarget = target.trim().replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                
                // Cycle loop through message strings
                for (let rawMsg of messages) {
                    if (!rawMsg.trim()) continue;
                    
                    const finalMessage = `${haterPrefix ? haterPrefix + ' ' : ''}${rawMsg.trim()}${lastHaterSuffix ? ' ' + lastHaterSuffix : ''}`;
                    
                    await session.sock.sendMessage(cleanTarget, { text: finalMessage });
                    count++;

                    io.emit('log', { msg: `[🟢 SENT] Session ${sessionId} -> Target: ${target} | Msg: ${finalMessage}` });
                    io.emit('bulk_status', { status: 'Running', sent: count, remaining: targets.length - count });

                    // Custom user configured delay
                    await new Promise(resolve => setTimeout(resolve, delay * 1000));
                }
            } catch (err) {
                io.emit('log', { msg: `❌ Failed to send to ${target}: ${err.message}` });
            }
        }
        io.emit('bulk_status', { status: 'Completed', sent: count, remaining: 0 });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
