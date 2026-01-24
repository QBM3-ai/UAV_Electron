const { spawn } = require('child_process');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class StreamHandler {
    constructor(id, wsPort) {
        this.id = id;
        this.wsPort = wsPort;
        this.streamProcess = null;
        this.captureProcess = null;
        this.wss = null;
        
        // State
        this.isCapturing = false;
        
        // Upload State
        this.uploadEnabled = false; 
        this.uploadUrl = null;
        this.uploadQueue = [];
        this.isUploading = false;
        this.watcher = null;
        
        this.currentCaptureDir = null;
    }

    // --- Streaming ---
    async startStream(rtspUrl) {
        this.stopStream();
        this.wss = new WebSocket.Server({ port: this.wsPort });
        
        this.wss.on('connection', (socket) => {
            socket.send(Buffer.from([0x4a, 0x53, 0x6d, 0x70]));
        });

        const isRtsp = rtspUrl.startsWith('rtsp');
        const args = [
            ...(isRtsp ? ['-rtsp_transport', 'tcp'] : []), // Only use rtsp_transport for RTSP
            '-i', rtspUrl,
            '-f', 'mpegts',
            '-codec:v', 'mpeg1video',
            '-b:v', '1000k',
            '-bf', '0',
            '-r', '25', // Should match source roughly or 25/30
            '-' 
        ];

        this.streamProcess = spawn('ffmpeg', args);
        
        this.streamProcess.stdout.on('data', (data) => {
             // Check if wss is still valid and has clients
             if (this.wss && this.wss.clients) {
                 this.wss.clients.forEach((c) => {
                    if (c.readyState === WebSocket.OPEN) c.send(data);
                });
             }
        });
        
        this.streamProcess.stderr.on('data', (data) => {
            console.log(`[FFmpeg View ${this.id}] ${data}`);
        });
    }

    stopStream() {
        if (this.streamProcess) {
            this.streamProcess.kill();
            this.streamProcess = null;
        }
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
    }

    // --- Capture ---
    async startCapture(rtspUrl, saveDir) {
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }

        this.currentCaptureDir = saveDir;
        this.isCapturing = true;

        this.startWatcher(saveDir);

        // Match capture FPS logic
        const isRtsp = rtspUrl.startsWith('rtsp');
        const args = [
             ...(isRtsp ? ['-rtsp_transport', 'tcp'] : []),
             '-i', rtspUrl,
             '-f', 'image2',
             // '-vf', 'fps=25', // Removed to capture all frames (source 15fps)
             path.join(saveDir, 'frame_%08d.jpg')
        ];

        this.captureProcess = spawn('ffmpeg', args);
        this.captureProcess.stderr.on('data', (data) => {
             // Log capture errors
             console.log(`[FFmpeg Capture ${this.id}] ${data}`);
        }); 
    }

    async stopCapture() {
        if (this.captureProcess) {
            this.captureProcess.kill();
            this.captureProcess = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        this.isCapturing = false;
        this.currentCaptureDir = null;
    }

    // --- Upload Configuration ---
    setUploadConfig(enabled, url) {
        this.uploadEnabled = enabled;
        this.uploadUrl = url;
    }

    // --- Upload Logic ---
    startWatcher(dir) {
        this.watcher = fs.watch(dir, (eventType, filename) => {
            if (eventType === 'rename' && filename && filename.endsWith('.jpg')) {
                if (this.uploadEnabled && this.uploadUrl) {
                    const filePath = path.join(dir, filename);
                    this.uploadQueue.push(filePath);
                    this.processUploadQueue();
                }
            }
        });
    }

    async processUploadQueue() {
        if (this.isUploading || this.uploadQueue.length === 0) return;

        this.isUploading = true;
        const filePath = this.uploadQueue.shift();

        try {
            await new Promise(r => setTimeout(r, 100)); // Buffer
            if (fs.existsSync(filePath)) {
                await this.uploadFile(filePath);
            }
        } catch (e) {
            // Log
        } finally {
            this.isUploading = false;
            if (this.uploadQueue.length > 0) {
                setImmediate(() => this.processUploadQueue());
            }
        }
    }

    async uploadFile(filePath) {
        try {
            const form = new FormData();
            form.append('frame', fs.createReadStream(filePath));
            form.append('channel', this.id);
            form.append('timestamp', Date.now());

            await axios.post(this.uploadUrl, form, {
                headers: { ...form.getHeaders() },
                maxBodyLength: Infinity
            });
        } catch (error) {
            console.error(`Upload failed CH${this.id}: ${error.code}`);
        }
    }

    cleanup() {
        this.stopStream();
        this.stopCapture();
    }
}

module.exports = StreamHandler;
