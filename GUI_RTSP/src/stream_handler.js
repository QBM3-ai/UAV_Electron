const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static').replace(
    'app.asar',
    'app.asar.unpacked'
);
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
        
        // Forwarding State
        this.forwardProcess = null;
        this.isForwarding = false;

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

        this.streamProcess = spawn(ffmpegPath, args);
        
        this.streamProcess.stdout.on('data', (data) => {
             // Check if wss is still valid and has clients
             if (this.wss && this.wss.clients) {
                 this.wss.clients.forEach((c) => {
                    if (c.readyState === WebSocket.OPEN) c.send(data);
                });
             }
        });
        
        this.streamProcess.stderr.on('data', (data) => {
            // console.log(`[FFmpeg View ${this.id}] ${data}`);
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

    // --- Forwarding ---
    async startForwarding(rtspUrl, serverUrl) {
        if (this.isForwarding) return;

        try {
            // 1. Handshake w/ Python Server
            // Assume serverUrl is base like http://ip:5000
            // Remove trailing slash if any
            const baseUrl = serverUrl.replace(/\/$/, "");
            
            console.log(`[CH${this.id}] Handshake with ${baseUrl}/start_capture`);
            const res = await axios.post(`${baseUrl}/start_capture`, { channel_id: this.id });
            
            if (!res.data.success) {
                throw new Error(res.data.error || 'Server rejected request');
            }

            const targetPort = res.data.port;
            const urlObj = new URL(baseUrl);
            const targetHost = urlObj.hostname;

            console.log(`[CH${this.id}] Handshake OK. Forwarding to ${targetHost}:${targetPort}`);

            // 2. Start FFmpeg
            const isRtsp = rtspUrl.startsWith('rtsp');
            const args = [
                ...(isRtsp ? ['-rtsp_transport', 'tcp'] : []),
                '-i', rtspUrl,
                '-c', 'copy',
                '-f', 'mpegts',
                `tcp://${targetHost}:${targetPort}`
            ];

            this.forwardProcess = spawn(ffmpegPath, args);
            this.isForwarding = true;

            this.forwardProcess.stderr.on('data', (data) => {
               console.log(`[Forward CH${this.id}] ${data}`);
            });
            
            this.forwardProcess.on('close', (code) => {
                console.log(`[Forward CH${this.id}] FFmpeg exited with code ${code}`);
                this.isForwarding = false;
                this.forwardProcess = null;
            });

        } catch (error) {
            console.error(`[Forward CH${this.id}] Error:`, error.message);
            throw error;
        }
    }

    async stopForwarding(serverUrl) {
        if (this.forwardProcess) {
            this.forwardProcess.kill();
            this.forwardProcess = null;
        }
        this.isForwarding = false;

        // Notify server to stop saving
        try {
            const baseUrl = serverUrl.replace(/\/$/, "");
            await axios.post(`${baseUrl}/stop_capture`, { channel_id: this.id });
        } catch (error) {
            console.warn(`[CH${this.id}] Failed to notify server stop:`, error.message);
        }
    }

    // --- Capture ---
    async startCapture(rtspUrl, saveDir, fps = null) {
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, { recursive: true });
        }

        this.currentCaptureDir = saveDir;
        this.isCapturing = true;

        this.startWatcher(saveDir);

        // Calculate start number based on Channel ID (e.g. 10000000)
        const startNum = this.id * 10000000;
        
        // --- 1. Create Timestamp Log File ---
        const logPath = path.join(saveDir, `timestamps_CH${this.id}.txt`);
        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        // Header
        logStream.write("Filename,PTS_Time,System_Time\n");

        const isRtsp = rtspUrl.startsWith('rtsp');
        
        // --- 2. Build FFmpeg Command ---
        // Add 'showinfo' filter to get frame metadata in stderr
        const vfFilters = [];
        if (fps) {
            vfFilters.push(`fps=${fps}`);
        }
        vfFilters.push('showinfo'); // This prints "n:.. pts_time:..." lines

        const args = [
             ...(isRtsp ? ['-rtsp_transport', 'tcp'] : []),
             '-i', rtspUrl,
             '-f', 'image2',
             '-vf', vfFilters.join(','), // Combine filters
             '-start_number', startNum.toString(),
             path.join(saveDir, 'frame_%08d.jpg')
        ];

        this.captureProcess = spawn(ffmpegPath, args);

        // --- 3. Parse Metadata & Log ---
        let currentFrameIndex = 0;
        let firstPts = null;
        let referenceTime = 0;
        
        this.captureProcess.stderr.on('data', (data) => {
             const output = data.toString();
             // console.log(`[FFmpeg Capture ${this.id}] ${output}`);

             // Parse showinfo lines
             // e.g. "n:   0 pts: 12345 pts_time:0.040000 ..."
             const lines = output.split('\n');
             lines.forEach(line => {
                if (line.includes('pts_time:')) {
                    const match = line.match(/pts_time:([\d\.]+)/);
                    if (match) {
                        const ptsTime = parseFloat(match[1]);
                        
                        // Initialize reference time on first frame
                        if (firstPts === null) {
                            firstPts = ptsTime;
                            referenceTime = Date.now();
                        }
                        
                        const frameNum = startNum + currentFrameIndex;
                        const filename = `frame_${frameNum}.jpg`;
                        
                        // Calculate time based on PTS delta to smooth out buffering jitter
                        // PTS is in seconds
                        const timeOffset = (ptsTime - firstPts) * 1000;
                        const currentFrameTime = referenceTime + timeOffset;
                        
                        // Beijing Time (UTC+8)
                        const bjOffset = 8 * 60 * 60 * 1000;
                        const bjDate = new Date(currentFrameTime + bjOffset);
                        const sysTime = bjDate.toISOString().replace('T', ' ').replace('Z', '');

                        logStream.write(`${filename},${ptsTime},${sysTime}\n`);
                        currentFrameIndex++;
                    }
                }
             });
        }); 

        // Handle stream close to close file
        this.captureProcess.on('close', () => {
             if (logStream) logStream.end();
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
