import requests
import time

CONTROL_URL = "http://localhost:12345"

def control_electron(action, fps=None):
    try:
        url = f"{CONTROL_URL}/{action}"
        params = {}
        if fps:
            params['fps'] = fps
            
        print(f"Sending {action} command..." + (f" (FPS: {fps})" if fps else ""))
        resp = requests.post(url, params=params)
        print(f"Response: {resp.status_code} - {resp.text}")
    except Exception as e:
        print(f"Failed to connect to Electron app: {e}")

# 1. 一键连接 (Connect All)
#control_electron("connect")

# 等待连接稳定
time.sleep(2)

# 2. 一键捕获 (Connect All - Start Capture) - 使用默认设置
#control_electron("capture")

# 或者 3. 一键捕获 - 强制指定 FPS 为 5
#control_electron("capture", fps=5)

# 4. 停止捕获 (Stop Capture)
#control_electron("stop_capture")