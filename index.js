const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const multer = require('multer'); // फाइल अपलोड करने के लिए
const fs = require('fs');

const app = express();
const port = 3000;

// Multer सेटअप (फाइल स्टोर करने के लिए)
const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// WhatsApp क्लाइंट इनिशियलाइज
const client = new Client({ authStrategy: new LocalAuth() });
client.on('qr', (qr) => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('WhatsApp Client READY!'));
client.initialize();

// ग्लोबल वेरिएबल्स
let shouldStop = false;
let loadedMessages = []; // फाइल से लोड की गई लाइन्स

// 1. message.txt फाइल अपलोड और रीड करने का रूट (Step 2)
app.post('/api/upload-messages', upload.single('messageFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Kripya valid .txt file upload karein." });
    }

    try {
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // फाइल को लाइन-बाय-लाइन तोड़कर एरे (Array) में सेव करें और खाली लाइन हटा दें
        loadedMessages = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        // टेम्परेरी फाइल डिलीट करें
        fs.unlinkSync(filePath);

        console.log(`Loaded ${loadedMessages.length} messages from file.`);
        res.json({ status: "Success", total_messages: loadedMessages.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "File read karne me dikkat aayi." });
    }
});

// 2. ग्रुप्स की लिस्ट फ़ेच करने का रूट
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

// 3. सिलेक्टिव ग्रुप्स में लाइन-बाय-लाइन विद प्रिफिक्स मैसेज भेजने का रूट
app.post('/api/start-broadcast', async (req, res) => {
    const { groups, haterName, delayTime } = req.body;
    shouldStop = false;

    if (loadedMessages.length === 0) {
        return res.status(400).json({ error: "Pehle message.txt file upload karein!" });
    }

    res.json({ status: "Processing started" });

    // हर सिलेक्टेड ग्रुप पर लूप चलाएं
    for (let g = 0; g < groups.length; g++) {
        const groupId = groups[g];

        // उस ग्रुप के लिए message.txt की हर लाइन को एक-एक करके भेजें
        for (let m = 0; m < loadedMessages.length; m++) {
            if (shouldStop) {
                console.log("⚠️ User dwara beech me hi rok diya gaya.");
                break;
            }

            try {
                // प्रिफिक्स (Hater Name) के साथ मैसेज तैयार करें
                const finalMessage = `${haterName} ${loadedMessages[m]}`;
                
                await client.sendMessage(groupId, finalMessage);
                console.log(`🚀 Sent: "${finalMessage}" to group: ${groupId}`);

                // नंबर बैन से बचने के लिए डिले (डिफ़ॉल्ट 2 सेकंड या यूजर इनपुट)
                const waitTime = (delayTime || 2) * 1000;
                await new Promise(resolve => setTimeout(resolve, waitTime));

            } catch (err) {
                console.error(`❌ Failed to send message to ${groupId}:`, err);
            }
        }
        
        if (shouldStop) break;
    }
});

// 4. रोकने का रूट
app.post('/api/stop-broadcast', (req, res) => {
    shouldStop = true;
    res.json({ status: "Stopping signal sent." });
});

app.listen(port, () => console.log(`Server: http://localhost:${port}`));
