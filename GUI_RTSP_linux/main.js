const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const StreamHandler = require('./src/stream_handler');
const fs = require('fs');

// Manage 4 channels
const channels = {
    1: new StreamHandler(1, 9901),
    2: new StreamHandler(2, 9902),
    3: new StreamHandler(3, 9903),
    4: new StreamHandler(4, 9904),
};

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.loadFile('index.html');

    win.on('closed', () => {
        Object.values(channels).forEach(h => h.cleanup());
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
     Object.values(channels).forEach(h => h.cleanup());
});

// IPC Handlers
ipcMain.handle('connect-stream', async (event, { id, url }) => {
    try {
        console.log(`[Main] Connect Channel ${id} to ${url}`);
        await channels[id].startStream(url);
        return { success: true, wsUrl: `ws://localhost:${channels[id].wsPort}` };
    } catch (error) {
        console.error(`[Main] Error connecting channel ${id}:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('disconnect-stream', async (event, { id }) => {
    try {
        channels[id].stopStream();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('start-capture', async (event, { id, url, baseDir, fps }) => {
    try {
        // Path logic: baseDir/CH{id}/{timestamp}/
        // Beijing Time (UTC+8)
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const bjDate = new Date(utc + (3600000 * 8));
        
        const pad = (n) => n.toString().padStart(2, '0');
        // Removed seconds from timestamp as requested
        const timestamp = `${bjDate.getFullYear()}-${pad(bjDate.getMonth() + 1)}-${pad(bjDate.getDate())}_${pad(bjDate.getHours())}-${pad(bjDate.getMinutes())}`;
        
        const channelDir = path.join(baseDir, `CH${id}`);
        const sessionDir = path.join(channelDir, timestamp);
        
        console.log(`[Main] Start Capture Channel ${id} to ${sessionDir} (FPS: ${fps})`);
        await channels[id].startCapture(url, sessionDir, fps);
        return { success: true, path: sessionDir };
    } catch (error) {
        console.error(`[Main] Error capturing channel ${id}:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-capture', async (event, { id }) => {
    try {
        await channels[id].stopCapture();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Forwarding IPC
ipcMain.handle('start-forward', async (event, { id, url, serverUrl }) => {
    try {
        await channels[id].startForwarding(url, serverUrl);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('stop-forward', async (event, { id, serverUrl }) => {
    try {
        await channels[id].stopForwarding(serverUrl);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

// Server / Upload Logic
ipcMain.handle('update-upload-config', (event, { id, enabled, uploadUrl }) => {
    if (channels[id]) {
        channels[id].setUploadConfig(enabled, uploadUrl);
    }
    return { success: true };
});

// --- Python Control Server ---
const http = require('http');
const CONTROL_PORT = 12345;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const searchParams = url.searchParams;

    if (req.method === 'POST' || req.method === 'GET') {
        if (pathname === '/connect') {
            const wins = BrowserWindow.getAllWindows();
            wins.forEach(w => w.webContents.send('python-control', { command: 'connect-all' }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Connect signal sent' }));
        } else if (pathname === '/capture') {
            const fps = searchParams.get('fps');
            const wins = BrowserWindow.getAllWindows();
            
            // Wait for Renderer to finish starting captures
            ipcMain.once('python-capture-complete', () => {
                const paths = {};
                for (let i = 1; i <= 4; i++) {
                    if (channels[i] && channels[i].currentCaptureDir) {
                        paths[i] = channels[i].currentCaptureDir;
                    } else {
                        paths[i] = null;
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    message: 'Capture started', 
                    fps,
                    paths: paths
                }));
            });

            // Send signal
            wins.forEach(w => w.webContents.send('python-control', { command: 'capture-all', data: { fps } }));
            
            // Fallback timeout (optional but good practice)
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ success: false, error: 'Timeout waiting for renderer' }));
                }
            }, 10000);

        } else if (pathname === '/stop_capture') {
            const wins = BrowserWindow.getAllWindows();
            wins.forEach(w => w.webContents.send('python-control', { command: 'stop-capture-all' }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: 'Stop capture signal sent' }));
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    } else {
        res.writeHead(405);
        res.end('Method Not Allowed');
    }
});

server.listen(CONTROL_PORT, () => {
    console.log(`[Main] Control Server listening on port ${CONTROL_PORT}`);
});
