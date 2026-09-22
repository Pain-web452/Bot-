document.getElementById('startBtn').addEventListener('click', function() {
    const token = document.getElementById('botToken').value.trim();
    const ownerId = document.getElementById('ownerId').value.trim();

    if (token === "" || ownerId === "") {
        alert("Please enter your Bot Token and Owner ID!");
        return;
    }

    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');

    statusText.innerText = "Running";
    statusText.className = "status-running";
    statusDot.className = "dot-green";
    
    console.log("Jerry Bot initialized on frontend.");
});

document.getElementById('stopBtn').addEventListener('click', function() {
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');

    statusText.innerText = "Stopped";
    statusText.className = "status-stopped";
    statusDot.className = "dot-red";
});
