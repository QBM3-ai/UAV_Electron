import requests
import time
import json

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

def set_capture_path(path):
    """
    设置捕获文件的保存路径
    参数:
        path (str): 要设置的文件夹路径
    返回:
        dict: 包含 success 和 message 的字典
    """
    try:
        url = f"{CONTROL_URL}/set_capture_path"
        resp = requests.post(url, json={'path': path})
        result = resp.json()
        print(f"Set capture path response: {resp.status_code} - {result}")
        return result
    except Exception as e:
        print(f"Failed to set capture path: {e}")
        return {'success': False, 'error': str(e)}

def get_capture_path():
    """
    获取当前的捕获保存路径
    返回:
        dict: 包含 success 和 path 的字典
    """
    try:
        url = f"{CONTROL_URL}/get_capture_path"
        resp = requests.get(url)
        result = resp.json()
        print(f"Get capture path response: {resp.status_code} - {result}")
        return result
    except Exception as e:
        print(f"Failed to get capture path: {e}")
        return {'success': False, 'error': str(e)}

def set_timestamp_folder(enable):
    """
    设置是否创建时间戳文件夹
    参数:
        enable (bool): True-创建时间戳文件夹, False-直接保存在所选文件夹内
    返回:
        dict: 包含 success 和 message 的字典
    """
    try:
        url = f"{CONTROL_URL}/set_timestamp_folder"
        # Convert to noTimestamp (inverted logic)
        no_timestamp = not enable
        resp = requests.post(url, json={'noTimestamp': no_timestamp}, timeout=10)
        result = resp.json()
        print(f"Set timestamp folder response: {resp.status_code} - {result}")
        return result
    except Exception as e:
        print(f"Failed to set timestamp folder option: {e}")
        return {'success': False, 'error': str(e)}

def get_timestamp_folder():
    """
    获取当前是否创建时间戳文件夹的设置
    返回:
        dict: 包含 success 和 enabled 的字典 (enabled=True表示创建时间戳文件夹)
    """
    try:
        url = f"{CONTROL_URL}/get_timestamp_folder"
        resp = requests.get(url)
        result = resp.json()
        print(f"Get timestamp folder response: {resp.status_code} - {result}")
        return result
    except Exception as e:
        print(f"Failed to get timestamp folder option: {e}")
        return {'success': False, 'error': str(e)}

def capture_single_frame():
    """
    启动一键单帧捕获，捕获所有四个通道的第一帧并自动停止
    返回:
        dict: 包含 success, message 和 frames 的字典
              frames 是一个字典，包含四个通道的图像文件路径
              例如: {'1': 'D:/path/frame_10000000.jpg', '2': 'D:/path/frame_20000000.jpg', ...}
    """
    try:
        url = f"{CONTROL_URL}/capture_single_frame"
        print("Starting single frame capture...")
        resp = requests.post(url, timeout=30)  # 30s timeout for capture to complete
        result = resp.json()
        print(f"Single frame capture response: {resp.status_code} - {result}")
        return result
    except Exception as e:
        print(f"Failed to capture single frame: {e}")
        return {'success': False, 'error': str(e)}

# 1. 一键连接图传
#control_electron("connect")

# 等待连接稳定
#time.sleep(2)

# 2. 设置捕获保存路径 (Set Capture Path)
#result = set_capture_path("D:\\123\\123")
#if result.get('success'):
#    print(f"Capture path set to: {result.get('path')}")

# 3. 获取当前保存路径 (Get Capture Path)
#result = get_capture_path()
#if result.get('success'):
#    print(f"Current capture path: {result.get('path')}")

# 4. 设置是否创建时间戳文件夹
# True = 创建时间戳文件夹   False = 不创建，直接保存在所选文件夹内
#result = set_timestamp_folder(False)  # 不创建时间戳文件夹
#if result.get('success'):
#    print(f"Timestamp folder setting updated")

# 5. 获取当前时间戳文件夹设置 (Get Timestamp Folder)
#result = get_timestamp_folder()
#if result.get('success'):
#    enabled = result.get('enabled')
#    print(f"Create timestamp folder: {enabled}")

# 6. 一键捕获 (Connect All - Start Capture) - 使用默认设置
#control_electron("capture")

# 或者 7. 一键捕获 - 强制指定 FPS 为 5
#control_electron("capture", fps=5)

# 8. 一键单帧捕获，并获取文件位置
#result = capture_single_frame()
#if result.get('success'):
#    frames = result.get('frames', {})
#    print("Single frame captured:")
#    for ch_id, frame_path in frames.items():
#        print(f"  Channel {ch_id}: {frame_path}")

# 9. 停止捕获 (Stop Capture)
#control_electron("stop_capture")

result = capture_single_frame()
if result.get('success'):
    frames = result.get('frames', {})
    print("Single frame captured:")
    for ch_id, frame_path in frames.items():
        print(f"  Channel {ch_id}: {frame_path}")
