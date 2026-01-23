const Stream = require('node-rtsp-stream');
const path = require('path');
const { spawn } = require('child_process');

// 1. 配置参数
let VIDEO_FILE = path.join(__dirname, '1.mp4');

// Fix path if packed in ASAR (FFmpeg needs real path)
if (VIDEO_FILE.includes('app.asar')) {
    VIDEO_FILE = VIDEO_FILE.replace('app.asar', 'app.asar.unpacked');
}

const WS_PORT = 9999;
const UDP_STREAM_URL = 'udp://127.0.0.1:1234?pkt_size=1316';

console.log("========================================");
console.log("启动无人机图传模拟服务 (UAV Stream Sim)");
console.log(`[Source] 文件: ${VIDEO_FILE}`);
console.log(`[Target] WebSocket 端口: ${WS_PORT}`);
console.log("========================================");

// 定义全局变量以便管理
let feeder = null;
let stream = null;
let exiting = false;

// 2. 启动本地推流 (Feeder)
// 作用：将本地文件循环读取，并以正常播放速度(-re)推送到UDP端口
// 这样模拟了一个永远在线的真实RTSP/UDP摄像头信号
function startFeeder() {
    if (exiting) return;

    const args = [
        '-re',                // 以原始帧率读取 (关键: 模拟实时流)
        '-stream_loop', '-1', // 无限循环
        '-i', VIDEO_FILE,     // 输入文件
        
        // --- 视频编码优化 ---
        '-f', 'mpegts',       // 封装格式
        '-c:v', 'mpeg1video', // 编码格式
        // '-r', '30',           // 移除强制帧率，使用原视频帧率
        '-b:v', '2500k',      // 提高码率以应对原分辨率
        '-maxrate', '3500k',  
        '-bufsize', '5000k',  
        '-bf', '0',           // 禁用B帧 (降低延迟)
        
        UDP_STREAM_URL        // 输出地址
    ];

    console.log(`[Feeder] 启动推流: ffmpeg ${args.join(' ')}`);
    
    feeder = spawn('ffmpeg', args);

    // 处理启动失败（如未安装 ffmpeg）
    feeder.on('error', (err) => {
        if (err.code === 'ENOENT') {
            const errTitle = "[严重错误] 未找到 ffmpeg";
            const errMsg = "请在终端运行: sudo apt install ffmpeg";
            console.error('\n' + '='.repeat(40));
            console.error(errTitle);
            console.error(errMsg);
            console.error('='.repeat(40) + '\n');
        } else {
            console.error('[Feeder] 进程错误:', err);
        }
    });

    feeder.stderr.on('data', (data) => {
        // FFmpeg 日志通常在 stderr
        // 过滤掉大量日志，只显示关键信息
        const msg = data.toString();
        // 如果想看进度，取消下面注释
        // process.stdout.write(msg); 
    });

    feeder.on('close', (code) => {
        if (!exiting) {
             console.log(`[Feeder] 进程退出 (Code: ${code})，3秒后重启...`);
             feeder = null;
             setTimeout(startFeeder, 3000);
        }
    });
}

// 3. 启动 WebSocket 转码服务器 (Server)
// 作用：接收 UDP 信号，封装为 JSMpeg 可播放的 WebSocket 流
function startServer() {
    if (exiting) return;
    // 稍微延迟启动，确保 Feeder 已经开始推流
    setTimeout(() => {
        if (exiting) return;
        console.log(`[Server] 启动 WebSocket 流服务...`);
        
        try {
            stream = new Stream({
                name: 'uav-sim',
                streamUrl: UDP_STREAM_URL,
                wsPort: WS_PORT,
                ffmpegOptions: { 
                    '-stats': '', // 显示统计信息
                    // '-r': 30      // 移除强制帧率
                }
            });
            console.log(`[Server] ✅ 服务就绪! 请在客户端连接 ws://localhost:${WS_PORT}`);
        } catch (e) {
            console.error("[Server] 启动失败:", e);
        }
    }, 2000);
}

// 4. 退出清理逻辑
function cleanup() {
    if (exiting) return;
    exiting = true;
    console.log('[Cleanup] 正在停止所有服务...');

    if (feeder) {
        try {
            feeder.kill(); 
            // 如果需要更强力的杀死：
            // process.kill(feeder.pid, 'SIGKILL');
        } catch(e) {}
        feeder = null;
    }

    if (stream) {
        try {
            stream.stop();
        } catch(e) {}
        stream = null;
    }
}

// 监听退出信号
process.on('SIGINT', () => { cleanup(); process.exit(); });
process.on('SIGTERM', () => { cleanup(); process.exit(); });
process.on('exit', cleanup);

// 执行
startFeeder();
startServer();

