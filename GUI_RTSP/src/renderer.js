const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

const players = {};
const captureState = {};
const frameCounters = {}; // Stores frame count per second
const fpsIntervals = {};  // Stores interval IDs for updating FPS

// --- Toast Notification ---
function showToast(message, duration = 3000) {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// --- Python Control Listener ---
ipcRenderer.on('python-control', async (event, { command, data }) => {
    console.log(`[Python Control] Received: ${command}`, data);
    if (command === 'connect-all') {
        connectAll();
    } else if (command === 'capture-all') {
        const fps = (data && data.fps) ? parseInt(data.fps) : null;
        // Explicitly START capture (control logic usually implies 'do X')
        // Using startCaptureAll ensures idempotency (if already captured, does nothing)
        await startCaptureAll(fps);
        ipcRenderer.send('python-capture-complete');
    } else if (command === 'stop-capture-all') {
        stopCaptureAll();
    } else if (command === 'capture-single-frame') {
        // Start single frame capture and wait for completion
        await captureSingleFrameForPython();
    } else if (command === 'set-capture-path') {
        // Update capture path from Python control
        const newPath = data.path;
        if (newPath) {
            captureBaseDir = newPath;
            localStorage.setItem('captureBaseDir', newPath);
            document.getElementById('capture-path').value = newPath;
            console.log(`[Python Control] Capture path updated to: ${newPath}`);
        }
    } else if (command === 'get-capture-path') {
        // Send current capture path back to main process
        ipcRenderer.send('python-path-response', captureBaseDir || '');
    } else if (command === 'set-timestamp-folder') {
        // Update timestamp folder setting from Python control
        const noTimestamp = data.noTimestamp;
        if (typeof noTimestamp === 'boolean') {
            const checkbox = document.getElementById('no-timestamp-folder');
            if (checkbox) {
                checkbox.checked = noTimestamp;
                localStorage.setItem('noTimestampFolder', noTimestamp);
                updateCapturePathHint(noTimestamp);
                console.log(`[Python Control] Timestamp folder setting updated: noTimestamp=${noTimestamp}`);
            }
        }
    } else if (command === 'get-timestamp-folder') {
        // Send current timestamp folder setting back to main process
        const noTimestamp = document.getElementById('no-timestamp-folder')?.checked || false;
        ipcRenderer.send('python-timestamp-response', noTimestamp);
    }
});

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
let captureBaseDir = localStorage.getItem('captureBaseDir');

if (!captureBaseDir) {
    // Default to 'captures' folder in current working directory
    captureBaseDir = path.join(process.cwd(), 'captures');
    // Ensure it exists
    if (!fs.existsSync(captureBaseDir)) {
        try {
            fs.mkdirSync(captureBaseDir, { recursive: true });
        } catch (e) {
            console.error('Failed to create default capture directory:', e);
        }
    }
}

if (captureBaseDir) {
    document.getElementById('capture-path').value = captureBaseDir;
}

// Memory: Restore no-timestamp-folder option
const noTimestampFolder = localStorage.getItem('noTimestampFolder') === 'true';
if (noTimestampFolder) {
    document.getElementById('no-timestamp-folder').checked = true;
    updateCapturePathHint(true);
}

// Listen to checkbox change
document.getElementById('no-timestamp-folder').addEventListener('change', (e) => {
    const checked = e.target.checked;
    localStorage.setItem('noTimestampFolder', checked);
    updateCapturePathHint(checked);
});

function updateCapturePathHint(noTimestamp) {
    const hint = document.getElementById('capture-path-hint');
    if (noTimestamp) {
        hint.textContent = '捕获文件将直接保存在所选文件夹内，不创建时间戳子文件夹。';
    } else {
        hint.textContent = '将在该目录下创建时间戳文件夹，每次捕获的文件保存在对应的时间戳文件夹内。';
    }
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

async function captureAll(fpsOverride = null) {
    const allBtn = document.getElementById('btn-capture-all');
    let allCapturing = true;

    // Check if all are capturing
    for (let id = 1; id <= 4; id++) {
        if (!captureState[id]) {
            allCapturing = false;
            break;
        }
    }

    // Toggle Logic happens here only if called without explicit stop
    // But since this function is 'captureAll', it generally toggles 'All' button state.
    // However, for Python control, we might want explicit start.
    // If Python calls captureAll, it lands here.
    
    // If not all are capturing, we start remaining.
    // If all ARE capturing, we stop all.
    
    if (allCapturing) {
        await stopCaptureAll();
    } else {
        await startCaptureAll(fpsOverride);
    }
}

async function startCaptureAll(fpsOverride = null) {
    const allBtn = document.getElementById('btn-capture-all');
    for (let id = 1; id <= 4; id++) {
        if (!captureState[id]) {
            await toggleCapture(id, fpsOverride);
            await new Promise(r => setTimeout(r, 200));
        }
    }
    allBtn.textContent = "一键停止捕获";
    allBtn.classList.add('capturing');
    allBtn.style.backgroundColor = "#F44336"; 
}

async function stopCaptureAll() {
    const allBtn = document.getElementById('btn-capture-all');
    for (let id = 1; id <= 4; id++) {
        if (captureState[id]) {
            await toggleCapture(id);
        }
    }
    allBtn.textContent = "一键捕获所有";
    allBtn.classList.remove('capturing');
    allBtn.style.backgroundColor = "#FF9800";
}

// --- Single Frame Capture ---
let singleFrameMonitoring = false;

async function captureSingleFrame() {
    const btn = document.getElementById('btn-single-frame');
    
    if (singleFrameMonitoring) {
        // Already in progress, ignore
        return;
    }
    
    if (!captureBaseDir) {
        return alert('请先选择保存路径 (Please select save path first)');
    }
    
    singleFrameMonitoring = true;
    btn.disabled = true;
    btn.textContent = '捕获中...';
    btn.style.backgroundColor = '#9E9E9E';
    
    try {
        // Start monitoring for first frame
        const monitorResult = await ipcRenderer.invoke('start-single-frame-monitor', { captureDir: captureBaseDir });
        
        if (!monitorResult.success) {
            // 0-numbered frames already exist
            singleFrameMonitoring = false;
            btn.disabled = false;
            btn.textContent = '一键单帧捕获';
            btn.style.backgroundColor = '#4CAF50';
            showToast('❌ ' + monitorResult.error, 5000);
            return;
        }
        
        // Start capturing all channels at 3 FPS
        for (let id = 1; id <= 4; id++) {
            if (!captureState[id]) {
                await toggleCapture(id, 3);  // 3 FPS for single frame capture
                await new Promise(r => setTimeout(r, 200));
            }
        }
        
        console.log('[Single Frame] Capture started at 3 FPS, waiting for first frame from all channels...');
        
    } catch (error) {
        console.error('[Single Frame] Error:', error);
        alert('单帧捕获失败: ' + error.message);
        singleFrameMonitoring = false;
        btn.disabled = false;
        btn.textContent = '一键单帧捕获';
        btn.style.backgroundColor = '#4CAF50';
    }
}

// Listen for single frame capture completion
ipcRenderer.on('single-frame-complete', async (event, framePaths) => {
    console.log('[Single Frame] All channels captured first frame, stopping...');
    
    // Stop all captures
    for (let id = 1; id <= 4; id++) {
        if (captureState[id]) {
            await toggleCapture(id);
        }
    }
    
    // Reset button
    const btn = document.getElementById('btn-single-frame');
    btn.disabled = false;
    btn.textContent = '一键单帧捕获';
    btn.style.backgroundColor = '#4CAF50';
    singleFrameMonitoring = false;
    
    showToast('✅ 单帧捕获完成！所有通道已保存第一帧。');
});

// Python control version - no UI updates, just return paths
async function captureSingleFrameForPython() {
    if (singleFrameMonitoring) {
        console.log('[Python Single Frame] Already in progress');
        return;
    }
    
    if (!captureBaseDir) {
        ipcRenderer.send('python-single-frame-complete', {});
        return;
    }
    
    singleFrameMonitoring = true;
    
    try {
        // Setup listener for completion
        ipcRenderer.once('single-frame-complete', async (event, framePaths) => {
            console.log('[Python Single Frame] All channels captured first frame, stopping...');
            console.log('[Python Single Frame] Received frame paths:', framePaths);
            
            // Stop all captures
            for (let id = 1; id <= 4; id++) {
                if (captureState[id]) {
                    await toggleCapture(id);
                }
            }
            
            singleFrameMonitoring = false;
            
            console.log('[Python Single Frame] Returning frame paths to Python:', framePaths);
            ipcRenderer.send('python-single-frame-complete', framePaths || {});
        });
        
        // Start monitoring for first frame
        const monitorResult = await ipcRenderer.invoke('start-single-frame-monitor', { captureDir: captureBaseDir });
        
        if (!monitorResult.success) {
            // 0-numbered frames already exist
            singleFrameMonitoring = false;
            console.log('[Python Single Frame] Error:', monitorResult.error);
            ipcRenderer.send('python-single-frame-complete', {
                error: monitorResult.error,
                existingChannels: monitorResult.existingChannels
            });
            return;
        }
        
        // Start capturing all channels at 3 FPS
        for (let id = 1; id <= 4; id++) {
            if (!captureState[id]) {
                await toggleCapture(id, 3);  // 3 FPS for single frame capture
                await new Promise(r => setTimeout(r, 200));
            }
        }
        
        console.log('[Python Single Frame] Capture started at 3 FPS, waiting for first frame from all channels...');
        
    } catch (error) {
        console.error('[Python Single Frame] Error:', error);
        singleFrameMonitoring = false;
        ipcRenderer.send('python-single-frame-complete', {});
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

async function toggleCapture(id, fpsOverride = null) {
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
        
        // Get FPS setting (Override > UI)
        let fps = fpsOverride;
        if (fps === null) {
            if (document.querySelector('input[name="capture-fps"][value="custom"]').checked) {
                const val = document.getElementById('custom-fps-input').value;
                fps = val ? parseInt(val) : null;
            }
        } else {
             // Sync UI or just use parameter
             // Try sync UI for visual feedback
             try {
                 const radio = document.querySelector('input[name="capture-fps"][value="custom"]');
                 const fpsInput = document.getElementById('custom-fps-input');
                 if(radio && fpsInput) {
                     radio.checked = true;
                     fpsInput.disabled = false;
                     fpsInput.value = fps;
                 }
             } catch(e) {}
             fps = parseInt(fps);
        }

        btn.textContent = 'Init...';
        const noTimestampFolder = document.getElementById('no-timestamp-folder').checked;
        const res = await ipcRenderer.invoke('start-capture', { id, url, baseDir: captureBaseDir, fps, noTimestampFolder });
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
