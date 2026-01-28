import os
import time
import subprocess
import socket
import threading
from flask import Flask, request, jsonify
from datetime import datetime

app = Flask(__name__)

# Config
BASE_CAPTURE_DIR = os.path.join(os.getcwd(), 'forwarded_captures')
FFMPEG_CMD = 'ffmpeg' # Ensure ffmpeg is in system PATH

# Store active processes: { channel_id: { 'process': subprocess.Popen, 'port': int } }
active_channels = {}

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def ensure_dir(path):
    if not os.path.exists(path):
        os.makedirs(path)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'message': 'Python RTSP Backend Ready'})

@app.route('/start_capture', methods=['POST'])
def start_capture():
    data = request.json
    channel_id = data.get('channel_id')
    
    if not channel_id:
        return jsonify({'success': False, 'error': 'channel_id required'}), 400

    channel_id = str(channel_id)
    
    # Stop existing if any
    if channel_id in active_channels:
        stop_channel(channel_id)

    # Prepare directories
    # Logic: forwarded_captures/CH{id}/{timestamp}/
    # Beijing Time (UTC+8) roughly matches system time if configured, or just use system local time
    now_str = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    save_dir = os.path.join(BASE_CAPTURE_DIR, f'CH{channel_id}', now_str)
    ensure_dir(save_dir)

    # Pick a port
    port = get_free_port()

    # Start ffmpeg listener
    # Command: ffmpeg -y -i tcp://0.0.0.0:{port}?listen -f image2 {save_dir}/frame_%08d.jpg
    # Note: Using -y to overwrite if needed, though timestamp dirs prevent collision
    # Using 'tcp://0.0.0.0:{port}?listen' allows the client to connect to us.
    
    cmd = [
        FFMPEG_CMD,
        '-y',
        '-f', 'mpegts', # Explicitly expect mpegts from Electron
        '-i', f'tcp://0.0.0.0:{port}?listen',
        '-f', 'image2',
        os.path.join(save_dir, 'frame_%08d.jpg')
    ]

    print(f"[Server] Starting capture for CH{channel_id} on port {port} -> {save_dir}")
    print(f"[Server] CMD: {' '.join(cmd)}")

    try:
        # Run in background. Stderr to console for debug.
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=None)
        
        active_channels[channel_id] = {
            'process': proc,
            'port': port,
            'dir': save_dir
        }
        
        return jsonify({
            'success': True, 
            'port': port,
            'message': f'Listening on port {port}'
        })

    except Exception as e:
        print(f"[Server] Error starting ffmpeg: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/stop_capture', methods=['POST'])
def stop_capture_route():
    data = request.json
    channel_id = str(data.get('channel_id'))
    
    if stop_channel(channel_id):
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'message': 'Channel was not running'})

def stop_channel(channel_id):
    if channel_id in active_channels:
        info = active_channels[channel_id]
        proc = info['process']
        print(f"[Server] Stopping CH{channel_id}")
        
        # Kill ffmpeg
        try:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        except Exception as e:
            print(f"Error killing process: {e}")
            
        del active_channels[channel_id]
        return True
    return False

if __name__ == '__main__':
    # Run server
    # Listen on all interfaces so Electron can connect via IP if needed, or localhost
    print("Starting Python RTSP Server on port 5000...")
    ensure_dir(BASE_CAPTURE_DIR)
    app.run(host='0.0.0.0', port=5000)
