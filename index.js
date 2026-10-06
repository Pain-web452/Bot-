import makeWASocketModule, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
const makeWASocket = makeWASocketModule.default || makeWASocketModule;

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

// Automatic uploads folder creation
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));

// Default Text (Agar koi file upload na ho)
let globalReplyMessage = "Namaste! 🙏\nHumari automated service me aapka swagat hai.\nHum jald hi aap se sampark karenge.";
let sock = null;

// Simple file reading strategy
function loadMessagesFromTxtFile() {
    const filePath = path.join(UPLOADS_DIR, 'messages.txt');
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
            if (fileContent) {
                globalReplyMessage = fileContent;
                console.log('📚 TXT file text successfully loaded into memory.');
            }
        } catch (error) {
            console.error('File reading issue:', error.message);
        }
    }
}

app.post('/upload-messages', upload.single('messages'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');
    const targetPath = path.join(UPLOADS_DIR, 'messages.txt');
    try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
        fs.renameSync(req.file.path, targetPath);
        loadMessagesFromTxtFile();
        res.send('Done');
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send('Error');
    }
});

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
        return res.json({ success: false, message: 'Bot status not ready' });
    }
});

async function startWhatsAppServer() {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_session');
    
    // Fixed initialization line here
    sock = makeWASocket({
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
            console.log('🚀 WhatsApp Server Connected Successfully!');
        }
    });

    // ANY MESSAGE INCOMING LOGIC (NO KEYWORDS)
    sock.ev.on('messages.upsert', async (m) => {
        const msgList = m.messages;
        if (msgList && msgList.length > 0) {
            const msg = msgList[0];
            
            // Checking message is received from other person (Not fromMe)
            if (msg && !msg.key.fromMe && m.type === 'notify') {
                const fromNumber = msg.key.remoteJid;
                
                // Skip status or group updates, target normal chats only
                if (fromNumber && fromNumber.endsWith('@s.whatsapp.net')) {
                    try {
                        await sock.sendMessage(fromNumber, { text: globalReplyMessage });
                        console.log(`✉️ Replied to incoming notification: ${fromNumber}`);
                    } catch (sendErr) {
                        console.error('Message delivery error:', sendErr.message);
                    }
                }
            }
        }
    });
}

app.listen(PORT, () => {
    console.log(`Web portal active on port ${PORT}`);
    startWhatsAppServer().catch(err => console.error("Fatal startup error:", err));
});
