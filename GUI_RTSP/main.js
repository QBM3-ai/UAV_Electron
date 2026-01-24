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

ipcMain.handle('start-capture', async (event, { id, url, baseDir }) => {
    try {
        // Path logic: baseDir/CH{id}/{timestamp}/
        // Beijing Time (UTC+8)
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const bjDate = new Date(utc + (3600000 * 8));
        
        const pad = (n) => n.toString().padStart(2, '0');
        const timestamp = `${bjDate.getFullYear()}-${pad(bjDate.getMonth() + 1)}-${pad(bjDate.getDate())}_${pad(bjDate.getHours())}-${pad(bjDate.getMinutes())}-${pad(bjDate.getSeconds())}`;
        
        const channelDir = path.join(baseDir, `CH${id}`);
        const sessionDir = path.join(channelDir, timestamp);
        
        console.log(`[Main] Start Capture Channel ${id} to ${sessionDir}`);
        await channels[id].startCapture(url, sessionDir);
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
