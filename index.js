import makeWASocketModule, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
const makeWASocket = makeWASocketModule.default || makeWASocketModule;

import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const upload = multer({ dest: 'uploads/' });
app.use(express.static('public'));

let globalReplyMessage = "Hello! Yeh ek automated broadcast message hai.";
let sock = null;

function loadMessagesFromTxtFile() {
    const filePath = path.join(UPLOADS_DIR, 'messages.txt');
    if (fs.existsSync(filePath)) {
        try {
            const fileContent = fs.readFileSync(filePath, 'utf-8').trim();
            if (fileContent) {
                globalReplyMessage = fileContent;
                console.log('📚 TXT file text loaded successfully.');
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
        res.send('Processed.');
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).send('Error.');
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
        return res.json({ success: false, message: 'Bot not ready.' });
    }
});

// NAYA ROUTE: SAARE GROUPS ME MESSAGE BROADCAST KARNE KE LIYE
app.get('/broadcast-groups', async (req, res) => {
    if (!sock) return res.status(500).send('WhatsApp connected nahi hai.');

    try {
        // WhatsApp se saare chats/groups fetch karna
        const chats = await sock.groupFetchAllParticipating();
        const groupIds = Object.keys(chats);

        if (groupIds.length === 0) {
            return res.send('Aapka account kisi bhi group (GC) me added nahi hai.');
        }

        console.log(`📢 Total ${groupIds.length} groups mile. Message bhejra hu...`);

        // Har group me baari-baari message bhejna loop chalakar
        for (const groupId of groupIds) {
            try {
                await sock.sendMessage(groupId, { text: globalReplyMessage });
                console.log(`✅ Message sent to group: ${chats[groupId].subject}`);
                
                // Safe delay timer (3 seconds) taki antispam system trigger na ho
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (err) {
                console.error(`❌ Group ${groupId} me message nahi gaya:`, err.message);
            }
        }

        res.send(`Broadcast complete! Total ${groupIds.length} groups me message bhej diya gaya.`);
    } catch (error) {
        console.error('Group fetch error:', error);
        res.status(500).send('Groups fetch karne me dikkat aayi.');
    }
});

async function startWhatsAppServer() {
    const { state, saveCreds } = await useMultiFileAuthState('whatsapp_session');
    
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
            console.log('🚀 WhatsApp Server Connected and Group Broadcast Ready!');
        }
    });
}

app.listen(PORT, () => {
    console.log(`Web portal active on port ${PORT}`);
    startWhatsAppServer().catch(err => console.error("Startup error:", err));
});
