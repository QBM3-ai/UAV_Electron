const { ipcRenderer } = require('electron');

const players = {};
const captureState = {};
const frameCounters = {}; // Stores frame count per second
const fpsIntervals = {};  // Stores interval IDs for updating FPS

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


// --- Settings Logic ---
async function selectFolder() {
    const path = await ipcRenderer.invoke('select-folder');
    if (path) {
        captureBaseDir = path;
        localStorage.setItem('captureBaseDir', path);
        document.getElementById('capture-path').value = path;
    }
}

function toggleFpsInput() {
    const isCustom = document.querySelector('input[name="capture-fps"][value="custom"]').checked;
    document.getElementById('custom-fps-input').disabled = !isCustom;
}

// Ensure toggleFpsInput is global
window.toggleFpsInput = toggleFpsInput;

// --- Server/Forwarding Logic ---
let isServerConnected = false;
let serverUrl = '';
let isForwarding = false;

async function toggleServerConnect() {
    const btn = document.getElementById('btn-server-connect');
    const input = document.getElementById('server-url');
    const status = document.getElementById('server-status');
    const fwdBtn = document.getElementById('btn-start-forward');

    if (isServerConnected) {
        // Disconnect
        isServerConnected = false;
        btn.textContent = '连接服务器';
        btn.classList.remove('connected'); 
        btn.style.backgroundColor = '#007acc';
        status.textContent = '未连接';
        status.className = ''; 
        input.disabled = false;
        fwdBtn.disabled = true;
        
        if (isForwarding) {
            await toggleForwarding(); // Force stop forwarding
        }
    } else {
        // Connect
        const url = input.value;
        if (!url) return alert('Please enter Server URL');

        // Simple check (maybe ping health?)
        try {
            // Optional: Check health
            // await fetch(url + '/health');
        } catch (e) { }

        isServerConnected = true;
        serverUrl = url;
        btn.textContent = '断开服务器';
        btn.style.backgroundColor = '#F44336';
        status.textContent = '已连接';
        status.classList.add('connected');
        input.disabled = true;
        fwdBtn.disabled = false;
    }
}

async function toggleForwarding() {
    console.log('Toggle Forwarding Clicked');
    const btn = document.getElementById('btn-start-forward');
    const status = document.getElementById('forward-status');
    
    if (isForwarding) {
        console.log('Stopping forwarding...');
        // Stop
        btn.disabled = true; // Prevent double click
        status.textContent = '正在停止...';
        
        for (let id = 1; id <= 4; id++) {
            try {
                await ipcRenderer.invoke('stop-forward', { id, serverUrl });
            } catch (e) { console.error(e); }
        }
        
        isForwarding = false;
        btn.disabled = false;
        btn.textContent = '开启转发 (Start Forwarding)';
        btn.style.backgroundColor = '';
        status.textContent = '已停止转发';
    } else {
        console.log('Starting forwarding...');
        // Start
        if (!isServerConnected) {
            alert('请先连接服务器');
            return;
        }
        
        btn.disabled = true;
        status.textContent = '正在启动转发...';
        
        let startedCount = 0;
        const promises = [];

        for (let id = 1; id <= 4; id++) {
            const checked = document.getElementById(`upload-ch${id}`).checked;
            // Get RTSP URL from input
            const rtspUrl = document.getElementById(`rtsp-${id}`).value;
            console.log(`Checking CH${id}: checked=${checked}, url=${rtspUrl}`);
            
            if (checked && rtspUrl) {
                promises.push(
                    ipcRenderer.invoke('start-forward', { id, url: rtspUrl, serverUrl })
                        .then(res => {
                            console.log(`Start CH${id} result:`, res);
                            if (res.success) startedCount++;
                            else console.error(`Failed to start CH${id}:`, res.error);
                        })
                        .catch(err => console.error(`IPC Error CH${id}:`, err))
                );
            }
        }
        
        await Promise.all(promises);
        
        isForwarding = true;
        btn.disabled = false;
        btn.textContent = '停止转发 (Stop Forwarding)';
        btn.style.backgroundColor = '#F44336';
        status.textContent = `正在转发 (活跃通道: ${startedCount})`;
    }
}

// Deprecated: updateUploadConfigs listener removed



// --- Main Monitor Logic ---

async function connectAll() {
    const allBtn = document.getElementById('btn-connect-all');
    let allConnected = true;

    // Check if all are connected
    for (let id = 1; id <= 4; id++) {
        const btn = document.querySelector(`#panel-${id} .btn-connect`);
        if (!btn.classList.contains('connected')) {
            allConnected = false;
            break;
        }
    }

    if (allConnected) {
        // Disconnect all
        for (let id = 1; id <= 4; id++) {
            const btn = document.querySelector(`#panel-${id} .btn-connect`);
            if (btn.classList.contains('connected')) {
                await toggleConnect(id);
            }
        }
        allBtn.textContent = "一键连接所有";
        allBtn.style.backgroundColor = "#007acc";
    } else {
        // Connect all (only those not connected)
        for (let id = 1; id <= 4; id++) {
            const btn = document.querySelector(`#panel-${id} .btn-connect`);
            if (!btn.classList.contains('connected')) {
                await toggleConnect(id);
            }
        }
        allBtn.textContent = "一键断开所有";
        allBtn.style.backgroundColor = "#F44336";
    }
}

async function captureAll() {
    const allBtn = document.getElementById('btn-capture-all');
    let allCapturing = true;

    // Check if all are capturing
    for (let id = 1; id <= 4; id++) {
        if (!captureState[id]) {
            allCapturing = false;
            break;
        }
    }

    if (allCapturing) {
        // Stop all
        for (let id = 1; id <= 4; id++) {
            if (captureState[id]) {
                await toggleCapture(id);
            }
        }
        allBtn.textContent = "一键捕获所有";
        allBtn.classList.remove('capturing'); // Optional style
    } else {
        // Start all
        for (let id = 1; id <= 4; id++) {
            if (!captureState[id]) {
                await toggleCapture(id);
                // Add a small delay to prevent resource contention
                await new Promise(r => setTimeout(r, 150));
            }
        }
        allBtn.textContent = "一键停止捕获";
        allBtn.classList.add('capturing'); // Optional style
    }
}

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
            if (fpsIntervals[id]) {
                clearInterval(fpsIntervals[id]);
                delete fpsIntervals[id];
            }
            document.getElementById(`fps-${id}`).style.display = 'none';
            
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
            const ov = container.querySelector('.status-overlay');
            const fpsB = container.querySelector('.fps-bubble');
            container.innerHTML = '<canvas></canvas>'; 
            container.appendChild(ov); 
            container.appendChild(fpsB);
            
            fpsB.style.display = 'block';
            frameCounters[id] = 0;
            
            // Start FPS updater
            if (fpsIntervals[id]) clearInterval(fpsIntervals[id]);
            fpsIntervals[id] = setInterval(() => {
                fpsB.textContent = `FPS: ${frameCounters[id]}`;
                frameCounters[id] = 0;
            }, 1000);

            const canvas = container.querySelector('canvas');

            players[id] = new JSMpeg.Player(res.wsUrl, {
                canvas: canvas,
                autoplay: true,
                audio: false,      
                onVideoDecode: () => {
                   frameCounters[id]++;
                },
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
    
    if (captureState[id]) {
        // Stop Capture
        const res = await ipcRenderer.invoke('stop-capture', { id });
        if (res.success) {
            captureState[id] = false;
            btn.classList.remove('capturing');
            btn.textContent = '捕获';
        }
    } else {
        // Start Capture
        if (!url) return alert('请输入RTSP地址 (Please enter RTSP URL)');
        if (!captureBaseDir) return alert('请先选择保存路径 (Please select save path first)');
        
        // Get FPS setting
        let fps = null;
        if (document.querySelector('input[name="capture-fps"][value="custom"]').checked) {
            const val = document.getElementById('custom-fps-input').value;
            fps = val ? parseInt(val) : null;
        }

        btn.textContent = 'Init...';
        const res = await ipcRenderer.invoke('start-capture', { id, url, baseDir: captureBaseDir, fps });
        if (res.success) {
            captureState[id] = true;
            btn.classList.add('capturing');
            btn.textContent = '停止';
            console.log(`Capture started at ${res.path} (FPS: ${fps || 'Source'})`);
        } else {
            btn.textContent = '捕获';
            alert('Capture failed: ' + res.error);
        }
    }
}
