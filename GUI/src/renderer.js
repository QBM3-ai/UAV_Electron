const { ipcRenderer } = require('electron');

// --- Navigation ---
const navBtns = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');

navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Remove active class from all buttons and pages
        navBtns.forEach(b => b.classList.remove('active'));
        pages.forEach(p => {
            p.classList.remove('active');
            p.style.display = 'none'; // Ensure hide
        });

        // Add active to clicked button
        btn.classList.add('active');
        
        // Show target page
        const targetId = btn.getAttribute('data-target');
        const targetPage = document.getElementById(targetId);
        targetPage.classList.add('active');
        targetPage.style.display = targetId === 'page-home' ? 'grid' : 'flex';
    });
});

// --- Pane Expansion ---
const expandBtns = document.querySelectorAll('.btn-expand');

expandBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const pane = btn.closest('.pane');
        const isExpanded = pane.classList.contains('expanded');
        
        // Close all first
        document.querySelectorAll('.pane').forEach(p => {
            p.classList.remove('expanded');
            // Reset icon
            const b = p.querySelector('.btn-expand');
            if(b) b.innerText = '🗖';
        });

        if (!isExpanded) {
            pane.classList.add('expanded');
            btn.innerText = '🗕'; // Restore icon
        }
    });
});

// --- Launch QGC (Simple) ---
const btnLaunchQGC = document.getElementById('btn-launch-qgc');

if (btnLaunchQGC) {
    btnLaunchQGC.addEventListener('click', () => {
        ipcRenderer.send('launch-qgc');
        // Visual feedback
        const originalText = btnLaunchQGC.innerHTML;
        btnLaunchQGC.innerHTML = "<span>⌛</span> 启动中...";
        btnLaunchQGC.style.opacity = "0.7";
        btnLaunchQGC.disabled = true;
    });
}

ipcRenderer.on('launch-qgc-reply', (event, arg) => {
    if (btnLaunchQGC) {
        btnLaunchQGC.disabled = false;
        btnLaunchQGC.style.opacity = "1";

        if (arg.success) {
            // Show Success State
            btnLaunchQGC.innerHTML = "<span style='color: #4ec9b0;'>✔</span> QGC 已启动";
            btnLaunchQGC.style.borderColor = "#4ec9b0";
            
            // Optional: Revert after 5 seconds so user can launch again if they closed it
            setTimeout(() => {
                btnLaunchQGC.innerHTML = "<span>✈</span> 启动路径规划 (QGC)";
                btnLaunchQGC.style.borderColor = "";
            }, 5000);
        } else {
            btnLaunchQGC.innerHTML = "<span>✈</span> 启动路径规划 (QGC)";
            if (arg.type === 'not_found') {
                showToast('请先安装超维空间QGC后重试');
            } else {
                showToast('启动失败: ' + arg.error);
            }
        }
    }
});

// --- Resizer Logic ---
const resizer = document.getElementById('resizer');
const paneUpper = document.getElementById('pane-upper');
const paneLower = document.getElementById('pane-lower');
const pageHome = document.getElementById('page-home');

if (resizer && paneUpper && paneLower) {
    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        // Calculate new height for header
        // e.clientY is relative to viewport.
        // We need to check offset from container top if necessary, but here page-home fills body minus nav
        const navHeight = 40; 
        const containerHeight = pageHome.clientHeight;
        const newUpperHeight = e.clientY - navHeight;

        // Min constraints
        if (newUpperHeight > 100 && newUpperHeight < (containerHeight - 100)) {
            // Use flex-basis or explicit height.
            // Since pane-upper has flex: 1, we should change that to fixed, or adjust lower height
            // Let's set Upper to fixed height and Lower to Flex, or vice versa.
            // Current CSS: Upper flex:1, Lower height:300px.
            // So resizing means changing Lower Height.
            
            // Mouse Y moves Down -> Lower Height Decreases
            // Mouse Y moves Up -> Lower Height Increases
            
            const newLowerHeight = containerHeight - newUpperHeight - 5; // 5 is resizer height
            paneLower.style.height = `${newLowerHeight}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
        }
    });
}



// --- Mock MAVLink Data ---
const btnConnectMav = document.getElementById('btn-connect-mavlink');
let mavInterval = null;

if (btnConnectMav) {
    btnConnectMav.addEventListener('click', () => {
        if (mavInterval) {
            clearInterval(mavInterval);
            mavInterval = null;
            btnConnectMav.innerText = "连接数据流 (模拟)";
            return;
        }

        btnConnectMav.innerText = "断开连接";
        
        // Mock data updates
        mavInterval = setInterval(() => {
            document.getElementById('val-alt').innerText = (100 + Math.random() * 5).toFixed(1) + ' m';
            document.getElementById('val-speed').innerText = (10 + Math.random() * 2).toFixed(1) + ' m/s';
            document.getElementById('val-batt').innerText = Math.floor(80 + Math.random() * 5) + ' %';
            document.getElementById('val-gps').innerText = Math.floor(12 + Math.random() * 3);
            document.getElementById('val-att').innerText = (Math.random()*2 - 1).toFixed(1) + ' / ' + (Math.random()*2 - 1).toFixed(1);
            document.getElementById('val-mode').innerText = "STABILIZED";
        }, 500);
    });
}

// --- Mock Modeling Server ---
const btnConnectServer = document.getElementById('btn-connect-server');
const btnUpload = document.getElementById('btn-upload-data');
const btnTestPly = document.getElementById('btn-test-ply');
const serverStatus = document.getElementById('server-status');
const progress = document.getElementById('upload-progress');

if (btnTestPly) {
    btnTestPly.addEventListener('click', () => {
        ipcRenderer.send('open-ply-test');
    });
}

if (btnConnectServer) {
    btnConnectServer.addEventListener('click', () => {
        serverStatus.innerText = "状态: 正在连接...";
        setTimeout(() => {
            serverStatus.innerText = "状态: 已连接 (192.168.1.100)";
            serverStatus.style.color = "#4ec9b0";
            btnUpload.disabled = false;
            btnConnectServer.innerText = "断开连接";
        }, 1500);
    });
}

if (btnUpload) {
    btnUpload.addEventListener('click', () => {
        progress.style.display = 'block';
        let val = 0;
        const upInt = setInterval(() => {
            val += 2;
            progress.value = val;
            if (val >= 100) {
                clearInterval(upInt);
                alert('上传完成！开始建模...');
                progress.style.display = 'none';
            }
        }, 50);
    });
}

// --- Video Streaming ---
let player = null;
const btnStreamConnect = document.getElementById('btn-stream-connect');
const modalStream = document.getElementById('stream-config-modal');
const btnStreamConfirm = document.getElementById('btn-stream-confirm');
const btnStreamCancel = document.getElementById('btn-stream-cancel');
const btnStreamSim = document.getElementById('btn-stream-sim');
const inputStreamUrl = document.getElementById('stream-url-input');

// --- Simulation Control ---
let isSimulating = false;

if (btnStreamSim) {
    btnStreamSim.addEventListener('click', () => {
        if (!isSimulating) {
            ipcRenderer.send('start-sim');
            btnStreamSim.innerHTML = "<span>⏳</span> 启动中...";
            btnStreamSim.disabled = true;
            btnStreamSim.style.opacity = "0.7";
        } else {
            ipcRenderer.send('stop-sim');
             // Optimistic UI update, or wait for reply
            btnStreamSim.innerHTML = "<span>⏳</span> 停止中...";
            btnStreamSim.disabled = true;
        }
    });

    ipcRenderer.on('start-sim-reply', (event, arg) => {
        if (!arg.success) {
            alert("启动仿真失败: " + arg.message);
            isSimulating = false;
            resetSimBtn();
        }
    });

    ipcRenderer.on('sim-ready', () => {
        isSimulating = true;
        btnStreamSim.disabled = false;
        btnStreamSim.style.opacity = "1";
        btnStreamSim.innerHTML = "<span>🛑</span> 停止仿真";
        btnStreamSim.style.backgroundColor = "#d9534f"; // Red
        showToast("图传服务已就绪 (Port: 9999)");
        
        // Auto-fill local URL
        if (inputStreamUrl) inputStreamUrl.value = "ws://localhost:9999";
    });

    ipcRenderer.on('sim-stopped', () => {
        isSimulating = false;
        resetSimBtn();
        showToast("图传服务已停止");
    });

    ipcRenderer.on('stop-sim-reply', () => {
        // usually followed by sim-stopped, but just in case
        if (isSimulating) {
             // wait for close event
        }
    });
}

function resetSimBtn() {
    if (btnStreamSim) {
        btnStreamSim.disabled = false;
        btnStreamSim.style.opacity = "1";
        btnStreamSim.innerHTML = "<span>⚡</span> 开启仿真";
        btnStreamSim.style.backgroundColor = "#28a745"; // Green
    }
}

if (btnStreamConnect && modalStream) {
    btnStreamConnect.addEventListener('click', () => {
        // Toggle logic: If connected, disconnect
        if (player) {
            try {
                player.destroy();
                player = null;
            } catch(e) { console.error('Error destroying player:', e); }
            
            // Reset UI
            btnStreamConnect.innerHTML = "<span>📡</span> 连接图传";
            btnStreamConnect.style.color = ""; 
            btnStreamConnect.style.backgroundColor = "";
            btnStreamConnect.classList.remove('connected');
            
            // Clear canvas by replacing it with a fresh clone (handles WebGL context lock)
            const videoCanvas = document.getElementById('video-canvas');
            if (videoCanvas) {
                const newCanvas = videoCanvas.cloneNode(true);
                videoCanvas.parentNode.replaceChild(newCanvas, videoCanvas);
            }
        } else {
            // Not connected -> Show modal
            modalStream.style.display = 'block';
            centerModal(modalStream);
        }
    });

    btnStreamCancel.addEventListener('click', () => {
        modalStream.style.display = 'none';
    });

    btnStreamConfirm.addEventListener('click', () => {
        const streamUrl = inputStreamUrl.value;
        if (streamUrl) {
            connectStream(streamUrl);
            modalStream.style.display = 'none';
        }
    });
}

// --- Media Actions ---
const btnSnap = document.getElementById('btn-snap');
const btnRecord = document.getElementById('btn-record');
const btnSettings = document.getElementById('btn-media-settings');
const modalSettings = document.getElementById('media-settings-modal');
const btnSettingsClose = document.getElementById('btn-settings-close');

const inputSnapPath = document.getElementById('snap-path-input');
const inputRecordPath = document.getElementById('record-path-input');
const btnBrowseSnap = document.getElementById('btn-browse-snap');
const btnBrowseRecord = document.getElementById('btn-browse-record');

// Default Paths (will be empty, fallback to system default in main process)
let snapDir = ""; 
let recordDir = "";

// Initialize default paths
ipcRenderer.invoke('get-desktop-path').then(path => {
    if (path) {
        snapDir = path;
        recordDir = path;
        if (inputSnapPath) inputSnapPath.value = path;
        if (inputRecordPath) inputRecordPath.value = path;
    }
});

// Recording State
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// --- Toast Notification ---
function showToast(message) {
    let toast = document.querySelector('.toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    
    // Auto hide after 2 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// --- Draggable Logic ---
function makeDraggable(modal) {
    const header = modal.querySelector('h3');
    if (!header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        // Initial setup for drag (convert centering to absolute position)
        const rect = modal.getBoundingClientRect();
        
        // Since we are now direct child of body, we can just use rect.left/top
        startLeft = rect.left;
        startTop = rect.top;

        modal.style.margin = '0';
        modal.style.transform = 'none'; // removing translate(-50%, -50%)
        modal.style.left = `${startLeft}px`;
        modal.style.top = `${startTop}px`;
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        e.preventDefault();
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        modal.style.left = `${startLeft + dx}px`;
        modal.style.top = `${startTop + dy}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

// Initialize Draggable Modals
if (modalStream) makeDraggable(modalStream);
if (modalSettings) makeDraggable(modalSettings);

// 1. Settings Modal Logic
if (btnSettings) {
    btnSettings.addEventListener('click', () => {
        modalSettings.style.display = 'block';
        centerModal(modalSettings);
    });
    btnSettingsClose.addEventListener('click', () => {
        modalSettings.style.display = 'none';
    });
    
    // Browse Snapshot Dir
    btnBrowseSnap.addEventListener('click', async () => {
        const path = await ipcRenderer.invoke('select-directory');
        if (path) {
            snapDir = path;
            inputSnapPath.value = path;
        }
    });

    // Browse Record Dir
    btnBrowseRecord.addEventListener('click', async () => {
        const path = await ipcRenderer.invoke('select-directory');
        if (path) {
            recordDir = path;
            inputRecordPath.value = path;
        }
    });
}

function centerModal(modal) {
    // Force reset to center
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
    modal.style.margin = '0';
}

// 2. Snapshot Logic
if (btnSnap) {
    btnSnap.addEventListener('click', async () => {
        const videoCanvas = document.getElementById('video-canvas');
        if (!player) {
            alert('请先连接图传');
            return;
        }
        
        // Flash effect
        videoCanvas.style.opacity = "0.5";
        setTimeout(() => videoCanvas.style.opacity = "1", 100);

        // Capture
        const dataURL = videoCanvas.toDataURL('image/png');
        const buffer = Buffer.from(dataURL.split(',')[1], 'base64');
        
        const res = await ipcRenderer.invoke('save-snapshot', { buffer, dir: snapDir });
        if (res.success) {
            showToast('截图已保存');
        } else {
            showToast('保存截图失败: ' + res.error);
        }
    });
}

// 3. Recording Logic
if (btnRecord) {
    btnRecord.addEventListener('click', () => {
        const videoCanvas = document.getElementById('video-canvas');
        if (!player) {
             alert('请先连接图传');
             return;
        }

        if (!isRecording) {
            // Start Recording
            try {
                const stream = videoCanvas.captureStream(); // Auto FPS to reduce stutter
                mediaRecorder = new MediaRecorder(stream, { 
                    mimeType: 'video/webm; codecs=vp9',
                    videoBitsPerSecond: 5000000 // 5 Mbps
                });
                
                recordedChunks = [];
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        recordedChunks.push(event.data);
                    }
                };
                
                mediaRecorder.onstop = async () => {
                    const blob = new Blob(recordedChunks, { type: 'video/webm' });
                    const arrayBuffer = await blob.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    
                    const res = await ipcRenderer.invoke('save-recording', { buffer, dir: recordDir });
                    if (res.success) {
                        showToast('录像已保存');
                    } else {
                        showToast('保存录像失败: ' + res.error);
                    }
                };

                mediaRecorder.start(100); // 100ms timeslice
                isRecording = true;
                
                // UI Update
                btnRecord.innerHTML = "<span>⏹</span> 停止录像";
                btnRecord.style.backgroundColor = "#d9534f";
                btnRecord.classList.add('recording');
                
            } catch (e) {
                console.error("Recording init failed", e);
                alert("无法启动录制 (不支持的格式或环境): " + e.message);
            }
        } else {
            // Stop Recording
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            isRecording = false;
            
            // UI Update
            btnRecord.innerHTML = "<span>⏺</span> 录像";
            btnRecord.style.backgroundColor = "";
            btnRecord.classList.remove('recording');
        }
    });
}

function connectStream(url) {
    if (window.JSMpeg) {
        const videoCanvas = document.getElementById('video-canvas');
        if (videoCanvas) {
            // Destroy existing player if any
            if (player) {
                try {
                    player.destroy();
                } catch(e) { console.error(e); }
                player = null;
            }

            console.log(`Connecting to stream: ${url}`);
            try {
                // Ensure WebGL context is created with preserveDrawingBuffer: true to fix black snapshots
                const gl = videoCanvas.getContext('webgl', { preserveDrawingBuffer: true }) || 
                           videoCanvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });

                player = new JSMpeg.Player(url, {
                    canvas: videoCanvas,
                    audio: false, 
                    pauseWhenHidden: false, 
                    videoBufferSize: 512 * 1024,
                    onSourceEstablished: () => {
                        console.log('JSMpeg Source Established');
                        // Update button to "Disconnect" state
                        btnStreamConnect.innerHTML = "<span>🔌</span> 取消连接";
                        btnStreamConnect.style.color = "#ffffff";
                        btnStreamConnect.style.backgroundColor = "#d9534f"; // Red background
                        btnStreamConnect.classList.add('connected');
                    }
                });
            } catch (e) {
                console.error("JSMpeg init failed", e);
                alert("连接失败: " + e.message);
            }
        }
    } else {
        console.error('JSMpeg library not loaded.');
    }
}

// --- Auth System (Frontend) ---

// Configuration - 请将此处IP改为您的CentOS服务器的实际IP地址，如果是本地测试则用 localhost
const SERVER_URL = "http://106.15.186.34:3000"; 
// const SERVER_URL = "http://192.168.1.100:3000"; // 示例

// --- Utilities ---
function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// --- Login Modal Logic ---
const btnLogin = document.getElementById('btn-login');
const btnRegister = document.getElementById('btn-register'); // Moved up
const btnCheckUpdate = document.getElementById('btn-check-update'); // Added missing definition
const loginModal = document.getElementById('login-modal');
const btnCloseLogin = document.getElementById('btn-close-login');
const btnSubmitLogin = document.getElementById('btn-submit-login');

// Auto Login Function (Token Based)
const TOKEN_KEY = 'uav_auth_token';

async function tryAutoLogin() {
    const token = localStorage.getItem(TOKEN_KEY);
    
    // Cleanup old insecure storage if exists
    if (localStorage.getItem('uav_password')) {
        localStorage.removeItem('uav_account');
        localStorage.removeItem('uav_password');
    }

    if (token) {
        console.log("Found token, verifying session...");
        try {
            const response = await fetch(`${SERVER_URL}/api/me`, {
                method: 'GET',
                headers: { 
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                console.log("Token verified successfully");
                updateUILoggedIn(result.user.account);
                showToast(`自动登录成功: ${result.user.account}`);
            } else {
                console.warn("Token expired or invalid:", result.message);
                localStorage.removeItem(TOKEN_KEY);
                showToast("登录已过期，请重新登录");
            }
        } catch (error) {
            console.error("Auto login verification error:", error);
        }
    }
}

function updateUILoggedIn(accountName) {
    if (btnLogin) btnLogin.style.display = 'none';
    if (btnRegister) btnRegister.style.display = 'none';
    
    // Hide existing auth container logic
    const authContainer = document.querySelector('.auth-container');
    if(authContainer) {
        // Check if we already have a user badge to avoid duplicates
        if(document.getElementById('user-badge-container')) return;

        // Don't hide the whole container, just the login/register buttons if needed, 
        // OR move the update button. 
        // Simpler approach: Hide auth container, recreate user container WITH update button.
        authContainer.style.display = 'none';
        
        const navBar = document.getElementById('nav-bar');
        const userContainer = document.createElement('div');
        userContainer.id = 'user-badge-container';
        userContainer.style.marginLeft = 'auto'; // Right align
        userContainer.style.paddingRight = '15px';
        userContainer.style.display = 'flex';
        userContainer.style.alignItems = 'center';
        userContainer.style.gap = '10px';

        // Re-add "Check Update" button here
        const updateBtnClone = document.createElement('button');
        updateBtnClone.textContent = '检查更新';
        updateBtnClone.style.background = 'transparent';
        updateBtnClone.style.border = '1px solid #aaa';
        updateBtnClone.style.color = '#aaa';
        updateBtnClone.style.fontSize = '12px';
        updateBtnClone.style.padding = '2px 8px';
        updateBtnClone.style.borderRadius = '3px';
        updateBtnClone.style.cursor = 'pointer';
        
        // Bind the exact same click event! 
        // Since we can't easily clone event listeners, we'll manually call the click on the original hidden button
        updateBtnClone.addEventListener('click', () => {
             const originalBtn = document.getElementById('btn-check-update');
             if(originalBtn) originalBtn.click();
        });

        const userBadge = document.createElement('div');
        userBadge.style.color = '#4ec9b0';
        userBadge.style.fontWeight = 'bold';
        userBadge.innerHTML = `👤 ${accountName}`;
        
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = '退出';
        logoutBtn.style.background = 'transparent';
        logoutBtn.style.border = '1px solid #d9534f';
        logoutBtn.style.color = '#d9534f';
        logoutBtn.style.fontSize = '12px';
        logoutBtn.style.padding = '2px 8px';
        logoutBtn.style.borderRadius = '3px';
        logoutBtn.style.cursor = 'pointer';
        
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem(TOKEN_KEY);
            location.reload(); // Simple reload to reset state
        });
        
        userContainer.appendChild(updateBtnClone);
        userContainer.appendChild(userBadge);
        userContainer.appendChild(logoutBtn);
        navBar.appendChild(userContainer);
    }
}

// Call auto login on startup
tryAutoLogin();

// --- Download Modal & Update Logic ---

// Make download modal draggable
const downloadModal = document.getElementById('download-modal');
if (downloadModal) {
    // Need to select the header explicitly if it's dynamic, but 'makeDraggable' usually finds h2/h3
    // Let's modify makeDraggable slightly or just use it as is if it targets h2
    makeDraggable(downloadModal);
}

// Format bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', async () => {
        const originalText = btnCheckUpdate.innerText;
        btnCheckUpdate.innerText = "Check...";
        btnCheckUpdate.disabled = true;

        try {
            const result = await ipcRenderer.invoke('check-update', SERVER_URL);
            
            if (!result.success) {
                showToast("检查更新失败: " + result.message);
            } else if (result.hasUpdate) {
                if(confirm(`发现新版本 ${result.remoteVersion}!\n\n${result.notes}\n\n是否下载并安装？`)) {
                    
                    // Show Download Progress Modal
                    const progressSpeed = document.getElementById('download-status-speed');
                    const progressPercent = document.getElementById('download-status-percent');
                    const progressSize = document.getElementById('download-status-size');
                    const progressBar = document.getElementById('download-progress-bar');
                    
                    if(downloadModal) {
                         downloadModal.classList.add('show');
                         progressBar.style.width = '0%';
                         if(progressPercent) progressPercent.innerText = '0%';
                         centerModal(downloadModal);
                    }

                    // Setup listener
                    // data: { percent, speed (bytes/s), transferred, total }
                    const progressHandler = (event, data) => {
                         if(progressPercent) progressPercent.innerText = data.percent + '%';
                         if(progressBar) progressBar.style.width = data.percent + '%';
                         
                         if(progressSpeed) {
                             progressSpeed.innerText = formatBytes(data.speed) + '/s';
                         }
                         if(progressSize) {
                             progressSize.innerText = `${formatBytes(data.transferred)} / ${formatBytes(data.total)}`;
                         }
                    };
                    ipcRenderer.on('download-progress', progressHandler);
                    
                    const downRes = await ipcRenderer.invoke('download-update', result.downloadUrl);
                    
                    // Cleanup
                    ipcRenderer.removeListener('download-progress', progressHandler);
                    if(downloadModal) downloadModal.classList.remove('show');

                    if (downRes.success) {
                        // ... install ...
                        await ipcRenderer.invoke('install-update', downRes.filePath);
                    } else {
                        showToast("下载失败: " + downRes.message);
                    }
                } else {
                    showToast("已取消更新");
                }
            } else {
                showToast("当前已是最新版本");
            }
        } catch (e) {
            console.error(e);
            showToast("Update Error: " + e.message);
        } finally {
            btnCheckUpdate.innerText = originalText;
            btnCheckUpdate.disabled = false;
        }
    });
}

// --- Login Setup ---
if (btnLogin && loginModal) {
    makeDraggable(loginModal);
    
    btnLogin.addEventListener('click', () => {
        loginModal.classList.add('show');
        // Reset Inputs
        document.getElementById('login-password').value = '';
    });

    if (btnCloseLogin) {
        btnCloseLogin.addEventListener('click', () => {
            loginModal.classList.remove('show');
        });
    }
    
    // Submit Login
    btnSubmitLogin.addEventListener('click', async () => {
        const account = document.getElementById('login-account').value;
        const password = document.getElementById('login-password').value;
        
        if(!account || !password) {
            showToast("请输入账号和密码");
            return;
        }
        
        btnSubmitLogin.disabled = true;
        btnSubmitLogin.textContent = "登录中...";
        
        try {
            const response = await fetch(`${SERVER_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account, password })
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                showToast(`登录成功: 欢迎回来, ${result.user.account}`);
                loginModal.classList.remove('show');
                
                // Save Token securely (instead of password)
                localStorage.setItem(TOKEN_KEY, result.token);

                // Update UI to show logged in state
                updateUILoggedIn(result.user.account);

            } else {
                showToast(result.message || "登录失败");
            }
        } catch (error) {
            console.error(error);
            showToast("连接服务器失败");
        } finally {
            btnSubmitLogin.disabled = false;
            btnSubmitLogin.textContent = "登录";
        }
    });
}

// --- Register Modal Logic ---
// const btnRegister = document.getElementById('btn-register'); // Moved to top
const registerModal = document.getElementById('register-modal');
const btnCloseRegister = document.getElementById('btn-close-register');
const btnSubmitRegister = document.getElementById('btn-submit-register');
const btnSendCode = document.getElementById('btn-send-code');

// Setup Register
if (btnRegister && registerModal) {
    makeDraggable(registerModal);

    btnRegister.addEventListener('click', () => {
        registerModal.classList.add('show');
        document.getElementById('reg-password').value = '';
        if(document.getElementById('reg-code')) document.getElementById('reg-code').value = '';
    });

    if (btnCloseRegister) {
        btnCloseRegister.addEventListener('click', () => {
            registerModal.classList.remove('show');
        });
    }

    // Send Validation Code
    if (btnSendCode) {
        btnSendCode.addEventListener('click', async () => {
            const email = document.getElementById('reg-account').value;
            if (!email || !email.includes('@')) {
                showToast("请输入有效的邮箱地址");
                return;
            }

            btnSendCode.disabled = true;
            let countdown = 60;
            const originalText = "获取验证码";
            btnSendCode.textContent = `发送中...`;

            try {
                const response = await fetch(`${SERVER_URL}/api/send-code`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                
                const result = await response.json();
                
                if (response.ok && result.success) {
                    showToast("验证码已发送，请查收邮件");
                    
                    // Start Countdown
                    btnSendCode.textContent = `${countdown}s 后重试`;
                    const timer = setInterval(() => {
                        countdown--;
                        if (countdown <= 0) {
                            clearInterval(timer);
                            btnSendCode.disabled = false;
                            btnSendCode.textContent = "重新获取";
                        } else {
                            btnSendCode.textContent = `${countdown}s 后重试`;
                        }
                    }, 1000);
                    
                } else {
                    showToast(result.message || "发送失败");
                    btnSendCode.disabled = false;
                    btnSendCode.textContent = originalText;
                }
            } catch (e) {
                console.error(e);
                showToast("网络错误: " + e.message);
                btnSendCode.disabled = false;
                btnSendCode.textContent = originalText;
            }
        });
    }

    // Submit Register
    btnSubmitRegister.addEventListener('click', async () => {
        // Updated to include 'code'
        const account = document.getElementById('reg-account').value;
        const password = document.getElementById('reg-password').value;
        const codeInput = document.getElementById('reg-code');
        const code = codeInput ? codeInput.value : '';
        
        if(!account || !password || !code) {
            showToast("请填写完整信息（含验证码）");
            return;
        }

        btnSubmitRegister.disabled = true;
        btnSubmitRegister.textContent = "注册中...";

        try {
            const response = await fetch(`${SERVER_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ account, password, code })
            });

            const result = await response.json();
            
            if (response.ok && result.success) {
                showToast(`注册成功 (ID: ${result.userId})，请登录`);
                registerModal.classList.remove('show');
                // Switch to login?
                if(loginModal) loginModal.classList.add('show');
            } else {
                showToast(result.message || "注册失败");
            }
        } catch (error) {
            console.error(error);
            showToast("注册请求失败，请检查网络");
        } finally {
            btnSubmitRegister.disabled = false;
            btnSubmitRegister.textContent = "注册";
        }
    });
}


