import subprocess
import time
import os
import signal
import sys

# Configuration
VIDEO_FILE = '1.mp4'
BASE_PORT = 8551
NUM_CHANNELS = 4
FFMPEG_CMD = 'ffmpeg'

if not os.path.exists(VIDEO_FILE):
    print(f"Error: {VIDEO_FILE} not found in current directory: {os.getcwd()}")
    sys.exit(1)

processes = []

def start_streams():
    print(f"Starting {NUM_CHANNELS} simulated streams from {VIDEO_FILE}...")
    
    for i in range(NUM_CHANNELS):
        port = BASE_PORT + i
        # Use Multicast IP range (224.0.0.0/4), e.g., 239.0.0.1
        # This allows multiple clients (Monitor + Forwarder) to listen to the same stream simultaneously.
        url = f'udp://239.0.0.1:{port}?pkt_size=1316'
        
        # FFmpeg command to stream file via UDP
        cmd = [
            FFMPEG_CMD,
            '-re',                # Read input at native frame rate
            '-stream_loop', '-1', # Loop infinitely
            '-i', VIDEO_FILE,
            '-f', 'mpegts',       # MPEG-TS format for UDP
            '-c:v', 'mpeg1video', # Transcode to mpeg1video (optional, but robust)
            '-r', '25',           # Force 25 fps for MPEG-1 compatibility
            '-b:v', '2000k',      # Bitrate
            '-bf', '0',           # No B-frames for lower latency
            url
        ]
        
        print(f"[Stream {i+1}] pushing to {url}")
        # Redirect stderr to devnull to reduce noise, or keep it for debugging
        proc = subprocess.Popen(
            cmd
            # Removed stderr/stdout redirection to see errors
        )
        processes.append(proc)

    print("\nStreams are running. Press Ctrl+C to stop.")
    print("Use the following URLs in your Electron Client:")
    for i in range(NUM_CHANNELS):
        print(f"CH {i+1}: udp://239.0.0.1:{BASE_PORT+i}?pkt_size=1316")

def stop_streams(signum, frame):
    print("\nStopping streams...")
    for p in processes:
        p.terminate()
    sys.exit(0)

if __name__ == '__main__':
    signal.signal(signal.SIGINT, stop_streams)
    signal.signal(signal.SIGTERM, stop_streams)
    
    start_streams()
    
    # Keep alive
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stop_streams(None, None)
