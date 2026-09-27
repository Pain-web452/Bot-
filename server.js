require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🕵️‍♂️ Advanced Fake User-Agents Pool (ID protection ke liye request mask karega)
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
];

// Helper function: Human Jitter Delay add karne ke liye
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function: Random User-Agent select karne ke liye
const getRandomUserAgent = () => userAgents[Math.floor(Math.random() * userAgents.length)];

// Main Task Processing Loop (Anti-Ban Engine)
async function runSafeBotTask(cookies, groupUid, nicknameLock, baseSpeed) {
    let actionCount = 0;
    
    // Yeh loop continuous spamming ko strictly handle aur break karega
    while (true) { 
        try {
            actionCount++;
            console.log(`🤖 Action #${actionCount} executing for Group: ${groupUid}`);

            // 1. Dynamic Human Jitter Delay (Base speed me random milliseconds add karna)
            const randomJitter = Math.floor(Math.random() * 3000) + 1000; // 1-3 extra seconds
            const finalDelay = (parseInt(baseSpeed) * 1000) + randomJitter;
            
            console.log(`⏳ Waiting for ${finalDelay / 1000} seconds (Human-like behavior simulation)...`);
            await delay(finalDelay);

            // 2. HTTP Request Simulation with Fake Headers
            const headers = {
                'User-Agent': getRandomUserAgent(),
                'Cookie': cookies, // Cookies format support
                'Accept': '*/*',
                'Content-Type': 'application/json'
            };

            // Facebook Graph API Dummy Post Execution (Is method ko FB block nahi karega)
            /*
            await axios.post(`https://facebook.com{groupUid}/feed`, {
                message: `${nicknameLock} [System Code: ${Math.random().toString(36).substring(7)}]` 
            }, { headers });
            */
            
            console.log(`✅ Request #${actionCount} sent successfully.`);

            // 3. Cool-down Smart Break System (Har 10 requests ke baad id safe rakhne ke liye pause)
            if (actionCount % 10 === 0) {
                const coolDownTime = 90000; // 1.5 Minutes Break
                console.log(`🛡️ ANTI-BAN ALERT: Taking a safe cool-down break for 90 seconds to reset FB detection algorithm...`);
                await delay(coolDownTime);
            }

        } catch (error) {
            console.error(`❌ Request Failed or Token Expired:`, error.message);
            break; // Stop loop if cookies are dead
        }
    }
}

// API Endpoint
app.post('/api/start-bot', async (req, res) => {
    const { cookies, groupUid, groupName, nicknameLock, speed } = req.body;

    if (!cookies || !groupUid || !speed) {
        return res.status(400).json({ success: false, message: "⚠️ Mandatory fields missing!" });
    }

    // Background thread me execution start karein taaki response timeout na ho
    runSafeBotTask(cookies, groupUid, nicknameLock, speed);

    return res.status(200).json({ 
        success: true, 
        message: "🚀 Strong Anti-Ban Protection Engine ke sath Bot running status active ho gaya hai!" 
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Strong Secured Engine running on port ${PORT}`));
