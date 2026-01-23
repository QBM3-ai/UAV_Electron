const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http'); // we need both depending on URL

// --- Linux GPU Compatibility Fixes ---
if (process.platform === 'linux') {
    // 强制开启 SwiftShader 软渲染回退，防止黑屏
    app.commandLine.appendSwitch('enable-unsafe-swiftshader');
    // 忽略 GPU 黑名单，尽可能使用硬件加速
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    // 只有在显卡支持时开启，否则可能会导致 crash，先保守开启 webgl
    // app.commandLine.appendSwitch('enable-gpu-rasterization'); 
}

const { exec, spawn } = require('child_process');
// const Stream = require('node-rtsp-stream'); // Moved to external sim_stream_server.js

// let stream = null; 

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false // For simple prototype, enables require in renderer
        }
    });

    win.loadFile('src/index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // Stream logic moved to sim_stream_server.js to simulate external device
});

app.on('window-all-closed', () => {
    // if (stream) stream.stop();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// QGC Path
let QGC_PATH = "";
let QGC_EXE_NAME = "QGroundControl";

if (process.platform === 'win32') {
    QGC_PATH = "C:\\Program Files\\QGroundControl\\bin\\QGroundControl.exe";
} else if (process.platform === 'linux') {
    // Try reliable locations or use a relative path
    // Assumption: User puts QGC AppImage in Home directory for easy access
    QGC_PATH = path.join(app.getPath('home'), 'QGroundControl.AppImage');
    // If not check current dir
    if (!fs.existsSync(QGC_PATH)) {
        QGC_PATH = path.join(__dirname, '..', '..', 'QGroundControl.AppImage'); // Dev env
    }
} else {
    // Mac or other
    QGC_PATH = "/Applications/QGroundControl.app";
}

// --- Simulation Server Control ---
let simProcess = null;

// --- Update System ---

ipcMain.handle('check-update', async (event, serverUrl) => {
    return new Promise((resolve) => {
        const url = `${serverUrl}/updates/latest.json`;
        const client = url.startsWith('https') ? https : http;
        
        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                resolve({ success: false, message: `Server returned ${res.statusCode}` });
                return;
            }
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(data);
                    const currentVersion = app.getVersion();
                    
                    // Simple string comparison for version
                    if (info.version !== currentVersion) {
                        resolve({ 
                            success: true, 
                            hasUpdate: true, 
                            remoteVersion: info.version,
                            currentVersion: currentVersion,
                            notes: info.notes,
                            downloadUrl: serverUrl + info.url // Construct absolute URL
                        });
                    } else {
                        resolve({ success: true, hasUpdate: false });
                    }
                } catch (e) {
                    resolve({ success: false, message: 'Invalid JSON from server' });
                }
            });
        }).on('error', (e) => {
            resolve({ success: false, message: e.message });
        });
    });
});

ipcMain.handle('download-update', async (event, url) => {
    return new Promise((resolve) => {
        const ext = process.platform === 'win32' ? '.exe' : '.AppImage';
        const tempPath = path.join(app.getPath('temp'), `update_package${ext}`);
        const file = fs.createWriteStream(tempPath);
        const client = url.startsWith('https') ? https : http;

        const request = client.get(url, (res) => {
             if (res.statusCode !== 200) {
                resolve({ success: false, message: `Download failed: ${res.statusCode}` });
                return;
            }

            const totalLength = parseInt(res.headers['content-length'], 10);
            let downloaded = 0;
            
            // Speed calculation variables
            let lastTime = Date.now();
            let lastDownloaded = 0;

            res.on('data', (chunk) => {
                downloaded += chunk.length;
                file.write(chunk); 
                
                const now = Date.now();
                // Throttle updates to every 500ms to avoid UI jank
                if (now - lastTime >= 500) { 
                    const timeDiff = (now - lastTime) / 1000; // in seconds
                    const bytesDiff = downloaded - lastDownloaded;
                    const speed = bytesDiff / timeDiff; // bytes/sec
                    
                    if (totalLength) {
                        const percent = (downloaded / totalLength) * 100;
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('download-progress', {
                                percent: percent.toFixed(1),
                                speed: speed,
                                transferred: downloaded,
                                total: totalLength
                            });
                        }
                    }
                    
                    lastTime = now;
                    lastDownloaded = downloaded;
                }
            });

            res.on('end', () => {
                file.end(); // close stream
            });

            file.on('finish', () => {
                file.close();
                resolve({ success: true, filePath: tempPath });
            });
        });

        request.on('error', (err) => {
            fs.unlink(tempPath, () => {}); 
            resolve({ success: false, message: err.message });
        });
    });
});

ipcMain.handle('install-update', async (event, filePath) => {
    shell.openPath(filePath); // Run the installer
    // Optionally quit: app.quit();
    return { success: true };
});

ipcMain.on('start-sim', (event) => {
    if (simProcess) {
        event.reply('start-sim-reply', { success: true, message: "Already running" });
        return;
    }

    const scriptPath = path.join(__dirname, '..', 'sim_stream_server.js');
    console.log(`Starting simulation: ${scriptPath}`);

    simProcess = require('child_process').fork(scriptPath, [], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    
    // Ensure child process is killed when main process exits
    app.on('before-quit', () => {
        if (simProcess) {
            simProcess.kill('SIGINT');
        }
    });

    simProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        // console.log(`[Sim]: ${msg}`);
        if (msg.includes('✅ 服务就绪')) {
            event.sender.send('sim-ready', { success: true });
        }
    });

    simProcess.stderr.on('data', (data) => {
        console.error(`[Sim Error]: ${data}`);
    });

    simProcess.on('close', (code) => {
        console.log(`Simulation process exited with code ${code}`);
        simProcess = null;
        // Broadcast to all windows, or reply to the sender if stored.
        // For simplicity, we just won't rely on this for UI toggle unless needed.
        // But we can send an event.
        if (!event.sender.isDestroyed()) {
             event.sender.send('sim-stopped');
        }
    });
    
    event.reply('start-sim-reply', { success: true, status: 'starting' });
});

ipcMain.on('stop-sim', (event) => {
    if (simProcess) {
        simProcess.kill();
        simProcess = null;
        event.reply('stop-sim-reply', { success: true });
    } else {
        event.reply('stop-sim-reply', { success: false, message: "Not running" });
    }
});

// Test PLY Viewer
ipcMain.on('open-ply-test', () => {
    const testWin = new BrowserWindow({
        width: 1024,
        height: 768,
        title: "3D Evolution Viewer",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    testWin.loadFile('src/test_ply_viewer.html');
});

ipcMain.on('launch-qgc', (event) => {
    // Simple Launch without embedding
    console.log(`Attempting to launch QGC at: ${QGC_PATH}`);

    if (!fs.existsSync(QGC_PATH)) {
        event.reply('launch-qgc-reply', { success: false, error: `QGC not found at ${QGC_PATH}`, type: 'not_found' });
        return;
    }

    const checkCmd = process.platform === 'win32' 
        ? `tasklist /FI "IMAGENAME eq ${QGC_EXE_NAME}.exe"`
        : `pgrep -x "${QGC_EXE_NAME}"`;

    exec(checkCmd, (err, stdout) => {
         const isRunning = process.platform === 'win32' 
             ? stdout.includes(QGC_EXE_NAME) 
             : stdout.trim().length > 0; // pgrep returns PID if found
         
         if (!isRunning) {
             console.log("Spawning QGC...");
             
             // Ensure executable on Linux
             if (process.platform === 'linux') {
                 try {
                     fs.chmodSync(QGC_PATH, '755');
                 } catch(e) { console.error("Chmod failed", e); }
             }

             const subprocess = spawn(QGC_PATH, [], {
                 detached: true,
                 stdio: 'ignore' 
             });

             subprocess.on('error', (err) => {
                console.error("Failed to spawn QGC", err);
                event.reply('launch-qgc-reply', { success: false, error: err.message });
             });

             subprocess.unref();

             // Reply success immediately 
             event.reply('launch-qgc-reply', { success: true });

        } else {
             console.log("QGC already running");
             event.reply('launch-qgc-reply', { success: true, message: "Already running" });
        }
    });
});

// --- Media Handlers ---

// Select Directory
ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    return result.filePaths[0];
});

// Get Desktop Path
ipcMain.handle('get-desktop-path', () => {
    return app.getPath('desktop');
});

// Save Snapshot
ipcMain.handle('save-snapshot', async (event, { buffer, dir }) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `snapshot_${timestamp}.png`;
        const savePath = path.join(dir || app.getPath('desktop'), filename);
        
        fs.writeFileSync(savePath, buffer);
        return { success: true, path: savePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Save Recording
ipcMain.handle('save-recording', async (event, { buffer, dir }) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `recording_${timestamp}.webm`;
        const savePath = path.join(dir || app.getPath('desktop'), filename);
        
        fs.writeFileSync(savePath, buffer);
        return { success: true, path: savePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});



