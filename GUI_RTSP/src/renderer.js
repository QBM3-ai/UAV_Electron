const { ipcRenderer } = require('electron');

const players = {};
const captureState = {};

// --- Navigation ---
const navBtns = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const target = btn.dataset.target;
        pages.forEach(p => p.classList.remove('active'));
        document.getElementById(target).classList.add('active');
    });
});

// --- State ---
let captureBaseDir = localStorage.getItem('captureBaseDir') || '';
if (captureBaseDir) {
    document.getElementById('capture-path').value = captureBaseDir;
}

// Memory: Restore RTSP addresses
[1,2,3,4].forEach(id => {
    const saved = localStorage.getItem(`rtspAddress_${id}`);
    if (saved) {
        document.getElementById(`rtsp-${id}`).value = saved;
    }
    
    // Memory: Save on change
    document.getElementById(`rtsp-${id}`).addEventListener('input', (e) => {
        localStorage.setItem(`rtspAddress_${id}`, e.target.value);
    });
});

let isServerConnected = false;
let serverUrl = '';

// --- Settings Logic ---
async function selectFolder() {
    const path = await ipcRenderer.invoke('select-folder');
    if (path) {
        captureBaseDir = path;
        localStorage.setItem('captureBaseDir', path);
        document.getElementById('capture-path').value = path;
    }
}

// --- Server/Upload Logic ---
async function toggleServerConnect() {
    const btn = document.getElementById('btn-server-connect');
    const input = document.getElementById('server-url');
    const status = document.getElementById('server-status');
    const channelChecks = [1,2,3,4].map(id => document.getElementById(`upload-ch${id}`));

    if (isServerConnected) {
        // Disconnect
        isServerConnected = false;
        btn.textContent = '连接服务器';
        btn.classList.remove('connected'); 
        btn.style.backgroundColor = '#007acc';
        status.textContent = '未连接';
        status.className = ''; 
        input.disabled = false;
        
        for (let id = 1; id <= 4; id++) {
            await ipcRenderer.invoke('update-upload-config', { id, enabled: false, uploadUrl: null });
        }
    } else {
        // Connect
        const url = input.value;
        if (!url) return alert('Please enter Server URL');

        isServerConnected = true;
        serverUrl = url;
        btn.textContent = '断开服务器';
        btn.style.backgroundColor = '#F44336';
        status.textContent = '已开启上传服务';
        status.classList.add('connected');
        input.disabled = true;

        await updateUploadConfigs();
    }
}

[1,2,3,4].forEach(id => {
    document.getElementById(`upload-ch${id}`).addEventListener('change', () => {
        if (isServerConnected) {
             updateUploadConfigs();
        }
    });
});

async function updateUploadConfigs() {
    for (let id = 1; id <= 4; id++) {
        const checked = document.getElementById(`upload-ch${id}`).checked;
        const enabled = isServerConnected && checked;
        await ipcRenderer.invoke('update-upload-config', { 
            id, 
            enabled, 
            uploadUrl: serverUrl 
        });
    }
}


// --- Main Monitor Logic ---

async function toggleConnect(id) {
    const btn = document.querySelector(`#panel-${id} .btn-connect`);
    const input = document.querySelector(`#panel-${id} .rtsp-input`);
    const status = document.getElementById(`status-${id}`);
    
    if (btn.classList.contains('connected')) {
        const res = await ipcRenderer.invoke('disconnect-stream', { id });
        if (res.success) {
            if (players[id]) {
                players[id].destroy();
                delete players[id];
            }
            btn.classList.remove('connected');
            btn.textContent = '连接';
            status.textContent = 'Disconnected';
            input.disabled = false;
        }
    } else {
        const url = input.value;
        if (!url) return alert('Please enter RTSP URL');

        status.textContent = 'Connecting...';
        input.disabled = true;

        const res = await ipcRenderer.invoke('connect-stream', { id, url });
        if (res.success) {
            btn.classList.add('connected');
            btn.textContent = '断开';
            status.textContent = '🔴 Live';

            const container = document.getElementById(`container-${id}`); 
            // Re-create canvas, but keep the status overlay
            const ov = container.querySelector('.status-overlay');
            container.innerHTML = '<canvas></canvas>'; 
            container.appendChild(ov); // Move it back
            
            const canvas = container.querySelector('canvas');

            players[id] = new JSMpeg.Player(res.wsUrl, {
                canvas: canvas,
                autoplay: true,
                audio: false, 
            });
        } else {
            status.textContent = 'Error';
            input.disabled = false;
            alert('Connection failed: ' + res.error);
        }
    }
}

async function toggleCapture(id) {
    const btn = document.querySelector(`#panel-${id} .btn-capture`);
    const input = document.querySelector(`#panel-${id} .rtsp-input`); 
    const url = input.value;
    
    if (!captureBaseDir) {
        alert("请先在「服务器与设置」中设置捕获保存路径！");
        // Show the settings page
        navBtns.forEach(b => b.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        document.querySelector('[data-target="page-settings"]').classList.add('active');
        document.getElementById('page-settings').classList.add('active');
        return;
    }

    if (captureState[id]) {
        // Stop
        const res = await ipcRenderer.invoke('stop-capture', { id });
        if (res.success) {
            captureState[id] = false;
            btn.classList.remove('capturing');
            btn.textContent = '捕获';
        }
    } else {
        // Start
        if (!url) return alert('No URL');
        
        btn.textContent = 'Init...';
        const res = await ipcRenderer.invoke('start-capture', { id, url, baseDir: captureBaseDir });
        if (res.success) {
            captureState[id] = true;
            btn.classList.add('capturing');
            btn.textContent = '停止';
            console.log(`Capture started at ${res.path}`);
        } else {
            btn.textContent = '捕获';
            alert('Capture failed: ' + res.error);
        }
    }
}
