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

ipcMain.handle('start-capture', async (event, { id, url, baseDir, fps, noTimestampFolder }) => {
    try {
        let sessionDir;
        
        if (noTimestampFolder) {
            // Save directly to the selected folder without creating a timestamp subfolder
            sessionDir = baseDir;
        } else {
            // Path logic: baseDir/{timestamp}/
            // Beijing Time (UTC+8)
            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const bjDate = new Date(utc + (3600000 * 8));
            
            const pad = (n) => n.toString().padStart(2, '0');
            // Removed seconds from timestamp as requested
            const timestamp = `${bjDate.getFullYear()}-${pad(bjDate.getMonth() + 1)}-${pad(bjDate.getDate())}_${pad(bjDate.getHours())}-${pad(bjDate.getMinutes())}`;
            
            // All channels save to the same timestamp folder
            sessionDir = path.join(baseDir, timestamp);
        }
        
        console.log(`[Main] Start Capture Channel ${id} to ${sessionDir} (FPS: ${fps}, NoTimestamp: ${noTimestampFolder})`);
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

// Get channel capture directory
ipcMain.handle('get-channel-capture-dir', async (event, { id }) => {
    try {
        const dir = channels[id]?.currentCaptureDir;
        return { success: true, dir: dir || null };
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

// --- Single Frame Capture Monitoring ---
let singleFrameWatchers = {};
let singleFrameStatus = {};
let singleFrameMonitorActive = false;

ipcMain.handle('start-single-frame-monitor', async (event, { captureDir }) => {
    console.log('[Main] Starting single frame monitor');
    console.log('[Main] Checking capture directory:', captureDir);
    
    // Check if 0-numbered frames already exist
    const existingFrames = [];
    if (captureDir && fs.existsSync(captureDir)) {
        for (let id = 1; id <= 4; id++) {
            const startNum = id * 10000000;
            const zeroFramePath = path.join(captureDir, `frame_${startNum.toString().padStart(8, '0')}.jpg`);
            if (fs.existsSync(zeroFramePath)) {
                existingFrames.push(id);
                console.log(`[Main] Channel ${id}: 0-numbered frame already exists: ${zeroFramePath}`);
            }
        }
    }
    
    // If any 0-numbered frames exist, return error
    if (existingFrames.length > 0) {
        const errorMsg = `捕获文件夹中已存在0号帧文件（通道: ${existingFrames.join(', ')}），请先清理文件后再进行单帧捕获。`;
        console.log(`[Main] ${errorMsg}`);
        return { 
            success: false, 
            error: errorMsg,
            existingChannels: existingFrames
        };
    }
    
    singleFrameMonitorActive = true;
    singleFrameStatus = { 1: false, 2: false, 3: false, 4: false };
    
    // Start watching for each channel
    for (let id = 1; id <= 4; id++) {
        watchChannelFirstFrame(id, event.sender);
    }
    
    return { success: true };
});

function watchChannelFirstFrame(channelId, sender) {
    // Check periodically if the first frame file exists
    const checkInterval = setInterval(() => {
        if (!singleFrameMonitorActive) {
            clearInterval(checkInterval);
            return;
        }
        
        const captureDir = channels[channelId].currentCaptureDir;
        if (!captureDir) {
            return; // Not capturing yet
        }
        
        // First frame filename: frame_{channelId}0000000.jpg
        const startNum = channelId * 10000000;
        const firstFramePath = path.join(captureDir, `frame_${startNum.toString().padStart(8, '0')}.jpg`);
        
        if (fs.existsSync(firstFramePath)) {
            console.log(`[Main] Channel ${channelId} first frame detected: ${firstFramePath}`);
            singleFrameStatus[channelId] = true;
            clearInterval(checkInterval);
            
            // Check if all channels have captured first frame
            const allCaptured = Object.values(singleFrameStatus).every(status => status === true);
            if (allCaptured && singleFrameMonitorActive) {
                console.log('[Main] All channels captured first frame!');
                singleFrameMonitorActive = false;
                
                // Wait 1 second before cleanup
                setTimeout(async () => {
                    const framePaths = await cleanupAndRenameSingleFrames();
                    sender.send('single-frame-complete', framePaths);
                }, 1000);
            }
        }
    }, 100); // Check every 100ms
    
    // Cleanup after timeout (30 seconds)
    setTimeout(() => {
        if (singleFrameMonitorActive) {
            clearInterval(checkInterval);
        }
    }, 30000);
}

// Clean up extra frames and rename to frame_X0000000.jpg
async function cleanupAndRenameSingleFrames() {
    console.log('[Main] Cleaning up and renaming single frame captures...');
    
    const framePaths = {};
    
    for (let channelId = 1; channelId <= 4; channelId++) {
        const captureDir = channels[channelId]?.currentCaptureDir;
        if (!captureDir || !fs.existsSync(captureDir)) {
            console.log(`[Main] Channel ${channelId}: No capture directory found`);
            continue;
        }
        
        try {
            const startNum = channelId * 10000000;
            const targetFileName = `frame_${startNum.toString().padStart(8, '0')}.jpg`;
            
            // Read all files in the capture directory
            const files = fs.readdirSync(captureDir);
            
            // Filter frame files for this channel (frame_1xxxxxxx.jpg, frame_2xxxxxxx.jpg, etc.)
            const channelPrefix = `frame_${channelId}`;
            const frameFiles = files.filter(file => 
                file.startsWith(channelPrefix) && file.endsWith('.jpg')
            ).sort();
            
            if (frameFiles.length === 0) {
                console.log(`[Main] Channel ${channelId}: No frame files found`);
                continue;
            }
            
            if (frameFiles.length < 2) {
                console.log(`[Main] Channel ${channelId}: Only ${frameFiles.length} frame(s), need at least 2`);
                continue;
            }
            
            // Get the second-to-last frame file (to avoid potentially corrupted last frame)
            const keepFrameFile = frameFiles[frameFiles.length - 2];
            const keepFramePath = path.join(captureDir, keepFrameFile);
            const targetPath = path.join(captureDir, targetFileName);
            
            console.log(`[Main] Channel ${channelId}: Found ${frameFiles.length} frames, keeping: ${keepFrameFile} (second-to-last)`);
            
            // Delete all other frames
            for (const file of frameFiles) {
                if (file !== keepFrameFile) {
                    const filePath = path.join(captureDir, file);
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`[Main] Channel ${channelId}: Deleted ${file}`);
                    } catch (e) {
                        console.error(`[Main] Channel ${channelId}: Failed to delete ${file}:`, e);
                    }
                }
            }
            
            // Rename the kept frame to frame_X0000000.jpg
            if (keepFrameFile !== targetFileName) {
                try {
                    // If target already exists, delete it first
                    if (fs.existsSync(targetPath)) {
                        fs.unlinkSync(targetPath);
                    }
                    fs.renameSync(keepFramePath, targetPath);
                    console.log(`[Main] Channel ${channelId}: Renamed ${keepFrameFile} -> ${targetFileName}`);
                } catch (e) {
                    console.error(`[Main] Channel ${channelId}: Failed to rename:`, e);
                }
            } else {
                console.log(`[Main] Channel ${channelId}: Already named correctly`);
            }
            
            // Save the final frame path
            framePaths[channelId] = targetPath;
            
        } catch (error) {
            console.error(`[Main] Channel ${channelId}: Error during cleanup:`, error);
        }
    }
    
    console.log('[Main] Single frame cleanup completed');
    console.log('[Main] Final frame paths:', framePaths);
    return framePaths;
}

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
        } else if (pathname === '/capture_single_frame') {
            const wins = BrowserWindow.getAllWindows();
            
            if (wins.length === 0) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'No window available' }));
                return;
            }
            
            console.log('[Main] /capture_single_frame endpoint called');
            
            // Wait for Renderer to complete single frame capture
            ipcMain.once('python-single-frame-complete', (event, result) => {
                console.log('[Main] Received python-single-frame-complete with result:', result);
                
                // Check if there's an error (0-numbered frames exist)
                if (result && result.error) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: result.error,
                        existingChannels: result.existingChannels
                    }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Single frame capture completed',
                        frames: result
                    }));
                }
            });
            
            // Send signal to start single frame capture
            console.log('[Main] Sending capture-single-frame command to renderer');
            wins.forEach(w => w.webContents.send('python-control', { command: 'capture-single-frame' }));
            
            // Fallback timeout
            setTimeout(() => {
                if (!res.writableEnded) {
                    console.log('[Main] Timeout waiting for single frame capture');
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Timeout waiting for single frame capture' }));
                }
            }, 30000);
        } else if (pathname === '/set_capture_path') {
            // Handle POST request with JSON body
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const newPath = data.path;
                    
                    if (!newPath) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'Path is required' }));
                        return;
                    }
                    
                    // Check if path exists
                    if (!fs.existsSync(newPath)) {
                        // Try to create it
                        try {
                            fs.mkdirSync(newPath, { recursive: true });
                        } catch (e) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: `Failed to create path: ${e.message}` }));
                            return;
                        }
                    }
                    
                    // Send to renderer to update UI
                    const wins = BrowserWindow.getAllWindows();
                    if (wins.length > 0) {
                        wins.forEach(w => w.webContents.send('python-control', { 
                            command: 'set-capture-path', 
                            data: { path: newPath } 
                        }));
                    } else {
                        console.log('[Main] No window available to send capture path');
                    }
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Capture path updated', 
                        path: newPath 
                    }));
                } catch (e) {
                    console.error('[Main] Error parsing capture path request:', e);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${e.message}` }));
                }
            });
            req.on('error', (e) => {
                console.error('[Main] Request error:', e);
                if (!res.writableEnded) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
        } else if (pathname === '/get_capture_path') {
            // Wait for renderer to send back the current path
            ipcMain.once('python-path-response', (event, currentPath) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    path: currentPath 
                }));
            });
            
            const wins = BrowserWindow.getAllWindows();
            wins.forEach(w => w.webContents.send('python-control', { command: 'get-capture-path' }));
            
            // Fallback timeout
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Timeout waiting for path' }));
                }
            }, 5000);
        } else if (pathname === '/set_timestamp_folder') {
            // Handle POST request with JSON body
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const noTimestamp = data.noTimestamp;
                    
                    if (typeof noTimestamp !== 'boolean') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'noTimestamp must be a boolean' }));
                        return;
                    }
                    
                    // Send to renderer to update UI
                    const wins = BrowserWindow.getAllWindows();
                    if (wins.length > 0) {
                        wins.forEach(w => w.webContents.send('python-control', { 
                            command: 'set-timestamp-folder', 
                            data: { noTimestamp } 
                        }));
                    } else {
                        console.log('[Main] No window available to send timestamp folder setting');
                    }
                    
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Timestamp folder setting updated',
                        noTimestamp 
                    }));
                } catch (e) {
                    console.error('[Main] Error parsing timestamp folder request:', e);
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${e.message}` }));
                }
            });
            req.on('error', (e) => {
                console.error('[Main] Request error:', e);
                if (!res.writableEnded) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
        } else if (pathname === '/get_timestamp_folder') {
            // Wait for renderer to send back the current setting
            ipcMain.once('python-timestamp-response', (event, noTimestamp) => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    success: true, 
                    noTimestamp,
                    enabled: !noTimestamp  // enabled means timestamp folder IS created
                }));
            });
            
            const wins = BrowserWindow.getAllWindows();
            wins.forEach(w => w.webContents.send('python-control', { command: 'get-timestamp-folder' }));
            
            // Fallback timeout
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Timeout waiting for setting' }));
                }
            }, 5000);
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
