import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

let autoReplies = {};
let sock = null;

function loadMessagesFromTxtFile() {
    const filePath = path.join('uploads', 'messages.txt');
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const lines = fileContent.split(\(/\r\)?\n/);
            autoReplies = {}; 
            let currentKeyword = null;
            let currentMessageLines = [];

            lines.forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
                    if (currentKeyword && currentMessageLines.length > 0) {
                        autoReplies[currentKeyword] = currentMessageLines.join('\n').trim();
                    }
                    currentKeyword = trimmedLine.slice(1, -1).toLowerCase().trim();
                    currentMessageLines = [];
                } else {
                    if (currentKeyword !== null) currentMessageLines.push(line);
                }
            });

            if (currentKeyword && currentMessageLines.length > 0) {
                autoReplies[currentKeyword] = currentMessageLines.join('\n').trim();
            }
            console.log('📚 TXT Multi-line replies loaded.');
        } catch (error) {
            console.error('❌ File error:', error.message);
        }
    }
}

app.post('/upload-messages', upload.single('messages'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const targetPath = path.join('uploads', 'messages.txt');
    try {
        fs.renameSync(req.file.path, targetPath);
        loadMessagesFromTxtFile();
        res.send('Processed.');
    } catch (e) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send('Error.');
    }
});

// API endpoint browser par code dikhane ke liye
app.get('/get-code', async (req, res) => {
    const phone = req.query.phone;
    if (!phone) return res.json({ success: false, message: 'Phone number missing' });
    const cleanNumber = phone.replace(/[^0-9]/g, '');

    if (sock && !sock.authState.creds.registered) {
        try {
            let code = await sock.requestPairingCode(cleanNumber);
            return res.json({ success: true, code: code });
        } catch (err) {
            return res.json({ success: false, message: err.message });
        }
    } else {
        return res.json({ success: false, message: 'Already connected or initializing.' });
    }
});

async function startWhatsAppServer() {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_session');
    
    sock = makeWASocket.default({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);
    loadMessagesFromTxtFile();

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWhatsAppServer();
        } else if (connection === 'open') {
            console.log('🚀 WhatsApp Server Online 24/7!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages;
        if (!msg.key.fromMe && m.type === 'notify') {
            const fromNumber = msg.key.remoteJid;
            const incomingText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

            if (incomingText) {
                const cleanText = incomingText.toLowerCase().trim();
                if (autoReplies[cleanText]) {
                    await sock.sendMessage(fromNumber, { text: autoReplies[cleanText] });
                }
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Web portal active on port ${PORT}`);
    startWhatsAppServer();
});
