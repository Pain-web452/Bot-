import express from 'express';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { fileURLToPath } from 'url';

const { Client, LocalAuth } = pkg;

// ES Module में __dirname को चालू करने के लिए सेटअप
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000; // Render पर डिप्लॉयमेंट के लिए

// Multer सेटअप (अपलोड की गई फाइलों को स्टोर करने के लिए)
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// WhatsApp क्लाइंट सेटअप
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Linux/Render सर्वर के लिए जरूरी
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR Code generated. Scan it with WhatsApp!');
});

client.on('ready', () => {
    console.log('WhatsApp Client is READY!');
});

client.initialize();

// ग्लोबल वेरिएबल्स
let shouldStop = false;
let loadedMessages = []; 

// 1. message.txt फाइल अपलोड रूट
app.post('/api/upload-messages', upload.single('messageFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Kripya valid .txt file upload karein." });
    }

    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // फाइल को लाइन-बाय-लाइन तोड़ें और खाली लाइन्स हटाएं
        loadedMessages = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        fs.unlinkSync(filePath); // टेम्परेरी फाइल डिलीट करें

        console.log(`Loaded ${loadedMessages.length} messages.`);
        res.json({ status: "Success", total_messages: loadedMessages.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "File read karne me dikkat aayi." });
    }
});

// 2. ग्रुप्स लिस्ट फ़ेच करने का रूट
app.get('/api/fetch-groups', async (req, res) => {
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup).map(g => ({
            id: g.id._serialized,
            name: g.name
        }));
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: "Groups fetch karne me dikkat aayi." });
    }
});

// 3. सिलेक्टिव ग्रुप्स में लाइन-बाय-लाइन प्रिफिक्स के साथ मैसेज भेजने का रूट
app.post('/api/start-broadcast', async (req, res) => {
    const { groups, haterName, delayTime } = req.body;
    shouldStop = false;

    if (loadedMessages.length === 0) {
        return res.status(400).json({ error: "Pehle message.txt file upload karein!" });
    }

    res.json({ status: "Processing started" });

    // हर सिलेक्ट किए गए ग्रुप पर लूप चलाएं
    for (let g = 0; g < groups.length; g++) {
        const groupId = groups[g];

        // उस ग्रुप में फाइल की हर लाइन को एक-एक करके भेजें
        for (let m = 0; m < loadedMessages.length; m++) {
            if (shouldStop) {
                console.log("⚠️ Stopped by user manually.");
                break;
            }

            try {
                // प्रिफिक्स (Hater Name) के साथ मैसेज कंबाइन करें
                const finalMessage = `${haterName} ${loadedMessages[m]}`;
                
                await client.sendMessage(groupId, finalMessage);
                console.log(`🚀 Sent: "${finalMessage}" to group: ${groupId}`);

                // डिले टाइमिंग (डिफ़ॉल्ट 2 सेकंड)
                const waitTime = (delayTime || 2) * 1000;
                await new Promise(resolve => setTimeout(resolve, waitTime));

            } catch (err) {
                console.error(`❌ Failed to send message to ${groupId}:`, err);
            }
        }
        
        if (shouldStop) break;
    }
});

// 4. ब्रॉडकास्ट रोकने का रूट
app.post('/api/stop-broadcast', (req, res) => {
    shouldStop = true;
    res.json({ status: "Stopping signal sent." });
});

app.listen(port, () => console.log(`Server running on port ${port}`));
