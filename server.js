const express = require('express');
const path = require('path');
// नोट: आप अपनी सुविधा के अनुसार fca-project या कोई भी वर्किंग fca लाइब्रेरी इस्तेमाल कर सकते हैं
const login = require('fca-project-or-any-active-fca'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// फ्रंटएंड से डेटा प्राप्त करने का रूट
app.post('/api/start-bot', (req, res) => {
    const { appState, prefix, adminId } = req.body;

    if (!appState || !adminId) {
        return res.status(400).json({ success: false, message: "AppState और Admin ID डालना जरूरी है!" });
    }

    try {
        // AppState को ऑब्जेक्ट में बदलना
        const parsedAppState = JSON.parse(appState);

        // फेसबुक लॉगिन प्रोसेस शुरू
        login({ appState: parsedAppState }, (err, api) => {
            if (err) {
                console.error("लॉगिन फेल हो गया:", err);
                return res.status(500).json({ success: false, message: "फेसबुक लॉगिन फेल: " + err.message });
            }

            // बोट कॉन्फ़िगरेशन सेटिंग्स
            const botPrefix = prefix || "/";
            api.setOptions({ listenEvents: true, selfListen: false });

            console.log(`बोट सफलतापूर्वक चालू हो गया! प्रिफिक्स: ${botPrefix}, एडमिन ID: ${adminId}`);

            // एडमिन को एक नोटिफिकेशन मैसेज भेजना
            api.sendMessage(`Hello Boss! Your bot has been successfully activated via Arjun Thakur Bot Penal. ✨`, adminId);

            // मैसेज सुनने और रिप्लाई देने का लॉजिक (Listen Loop)
            api.listenMqtt((listenErr, event) => {
                if (listenErr) return console.error(listenErr);

                if (event.type === "message" && event.body) {
                    const messageBody = event.body.trim();

                    // बेसिक कमांड चेक (जैसे: /ping या /help)
                    if (messageBody.startsWith(botPrefix)) {
                        const command = messageBody.slice(botPrefix.length).toLowerCase();

                        if (command === "ping") {
                            api.sendMessage("Pong! बोट एकदम सही काम कर रहा है। 🚀", event.threadID, event.messageID);
                        } else if (command === "help") {
                            api.sendMessage("उपलब्ध कमांड्स: \n1. /ping - बोट स्टेटस चेक करने के लिए।\n2. /help - मदद के लिए।", event.threadID, event.messageID);
                        }
                        // आप यहाँ अपनी पसंद के और कमांड्स भी जोड़ सकते हैं
                    }
                }
            });
        });

        // फ्रंटएंड को तुरंत रिस्पॉन्स देना
        res.json({ success: true, message: "बोट बैकएंड में सफलतापूर्वक शुरू कर दिया गया है!" });

    } catch (error) {
        res.status(400).json({ success: false, message: "अमान्य JSON (Invalid AppState Format)" });
    }
});

app.listen(PORT, () => {
    console.log(`सर्वर http://localhost:${PORT} पर चल रहा है`);
});
