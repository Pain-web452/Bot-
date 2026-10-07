<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RK RAJA XWD - WhatsApp Control Center</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>RK RAJA XWD</h1>
            <p class="subtitle">MULTI-SESSION WHATSAPP CONTROL CENTER</p>
            <div class="nav-tabs">
                <button class="tab-btn active" onclick="switchTab('dashboard')">DASHBOARD</button>
                <button class="tab-btn" onclick="switchTab('bulksender')">BULK SENDER</button>
            </div>
        </header>

        <!-- DASHBOARD VIEW -->
        <div id="dashboard" class="tab-content active">
            <div class="panel">
                <h3>➕ ADD WHATSAPP NUMBER</h3>
                <label>SESSION ID (1, 2, 3...)</label>
                <input type="number" id="session-id" value="1">
                
                <label>PHONE NUMBER (COUNTRY CODE, NO + OR SPACES)</label>
                <input type="text" id="phone-number" placeholder="e.g. 919876543210">
                
                <button class="btn-green" onclick="getPairingCode()">GET PAIRING CODE</button>
                <div id="pairing-display" class="pairing-box"></div>
            </div>

            <div class="panel">
                <h3>📊 LIVE STATS</h3>
                <div class="stats-grid">
                    <div><small>TOTAL SESSIONS</small><h2 id="stat-total">0</h2></div>
                    <div><small>PAIRED</small><h2 id="stat-paired">0</h2></div>
                    <div><small>UPTIME</small><h2 id="stat-uptime">00:00:00</h2></div>
                </div>
            </div>

            <div class="panel">
                <h3>💬 LIVE LOG</h3>
                <div id="log-box" class="console-box"></div>
                <button class="btn-red" onclick="clearLogs()">CLEAR LOG</button>
            </div>
        </div>

        <!-- BULK SENDER VIEW -->
        <div id="bulksender" class="tab-content">
            <div class="grid-2col">
                <div class="panel">
                    <h3>📤 SEND FROM</h3>
                    <label>SELECT SESSION</label>
                    <input type="number" id="bulk-session-id" value="1">

                    <h3>🎯 MESSAGE QUEUE & TARGETS</h3>
                    <label>UPLOAD MESSAGES FILE (.TXT)</label>
                    <input type="file" id="msg-file" accept=".txt">

                    <label>SEND TO PHONE NUMBERS (ONE PER LINE)</label>
                    <textarea id="target-numbers" placeholder="919876543210&#10;919876543211"></textarea>

                    <label>HATER NAME (OPTIONAL PREFIX)</label>
                    <input type="text" id="prefix" placeholder="e.g. RK RAJA XWD">

                    <label>DELAY (SECONDS) - MIN 3S</label>
                    <input type="number" id="delay" value="10" min="3">

                    <label>LAST HATER NAME (OPTIONAL SUFFIX)</label>
                    <input type="text" id="suffix" placeholder="e.g. XWD">

                    <div class="action-buttons">
                        <button class="btn-green" onclick="startBulk()">▶ START BULK</button>
                        <button class="btn-red">⏹ STOP</button>
                    </div>
                </div>

                <div class="panel">
                    <h3>📈 BULK STATS</h3>
                    <div class="stats-grid">
                        <div><small>STATUS</small><h2 id="bulk-status" class="text-green">Idle</h2></div>
                        <div><small>SENT</small><h2 id="bulk-sent">0</h2></div>
                        <div><small>REMAINING</small><h2 id="bulk-remaining">0</h2></div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let uploadedMessages = [];

        function switchTab(tabId) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            event.target.classList.add('active');
        }

        function getPairingCode() {
            const sessionId = document.getElementById('session-id').value;
            const phoneNumber = document.getElementById('phone-number').value;
            if(!phoneNumber) return alert("Enter phone number!");
            socket.emit('request_pairing', { sessionId, phoneNumber });
        }

        document.getElementById('msg-file').addEventListener('change', function(e) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = function(progressEvent) {
                uploadedMessages = this.result.split('\n').filter(line => line.trim() !== '');
                alert(`Loaded ${uploadedMessages.length} messages from file.`);
            };
            reader.readAsText(file);
        });

        function startBulk() {
            const config = {
                sessionId: document.getElementById('bulk-session-id').value,
                targets: document.getElementById('target-numbers').value.split('\n').filter(n => n.trim() !== ''),
                messages: uploadedMessages.length ? uploadedMessages : ["Hello"],
                delay: parseInt(document.getElementById('delay').value) || 10,
                haterPrefix: document.getElementById('prefix').value,
                lastHaterSuffix: document.getElementById('suffix').value
            };
            socket.emit('start_bulk', config);
        }

        socket.on('pairing_code', (data) => {
            document.getElementById('pairing-display').innerText = `PAIRING CODE FOR SESSION ${data.sessionId}: ${data.code}`;
        });

        socket.on('log', (data) => {
            const box = document.getElementById('log-box');
            box.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${data.msg}</div>`;
            box.scrollTop = box.scrollHeight;
        });

        socket.on('stats', (data) => {
            document.getElementById('stat-total').innerText = data.totalSessions;
            document.getElementById('stat-paired').innerText = data.paired;
            document.getElementById('stat-uptime').innerText = data.uptime;
        });

        socket.on('bulk_status', (data) => {
            document.getElementById('bulk-status').innerText = data.status;
            document.getElementById('bulk-sent').innerText = data.sent;
            document.getElementById('bulk-remaining').innerText = data.remaining;
        });

        function clearLogs() { document.getElementById('log-box').innerHTML = ''; }
    </script>
</body>
</html>
