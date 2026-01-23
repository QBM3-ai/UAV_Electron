const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); // Import JWT
const nodemailer = require('nodemailer'); 
const path = require('path');
const multer = require('multer'); // Import Multer
const fs = require('fs');

const app = express();
const PORT = 3000;
const ADMIN_TOKEN = 'secret-admin-token-123'; // Simple admin protection
const JWT_SECRET = 'uav-secret-key-change-this-in-production'; 

// --- Email Configuration ---
// 建议使用 QQ邮箱 或 163邮箱 的 SMTP 服务
const EMAIL_CONFIG = {
    service: '163', // 'QQ', '163', 'Gmail', 或使用 host/port 配置
    auth: {
        user: 'qbmpcpu3@163.com', // 发送者邮箱
        pass: 'WKfgA369XWpvtyKU' // SMTP 授权码 (不是邮箱登录密码)
    }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

// Middleware
app.use(cors());
app.use(bodyParser.json());
// Serve static files for Admin Panel
app.use('/admin', express.static(path.join(__dirname, 'public')));
// Serve Update Files
app.use('/updates', express.static(path.join(__dirname, 'updates')));

// Configure Multer for Update Uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'updates');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        // Always save as 'setup.exe' or keep original? 
        // Better store with version or generic name. Let's use generic for simplicity of clients.
        // Actually, for download security/caching, versioning is better.
        // But to keep it simple: setup.exe
        cb(null, 'UAV_Setup_Latest.exe'); 
    }
});
const upload = multer({ storage: storage });

// Token Verification Middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Bearer <token>
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ success: false, message: '未授权: 缺少令牌' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: '令牌无效或已过期' });
        req.user = user;
        next();
    });
};

// Database Setup (SQLite)
const dbPath = path.resolve(__dirname, 'users.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');
        
        // Create Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account TEXT UNIQUE,
            password TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error("Error creating table:", err);
            } else {
                console.log("Users table ready.");
            }
        });

        // Create Verifications Table
        db.run(`CREATE TABLE IF NOT EXISTS verifications (
            email TEXT PRIMARY KEY,
            code TEXT,
            expires_at INTEGER
        )`, (err) => {
            if (err) console.error("Error creating verification table:", err);
        });
    }
});

// Routes

// 0. Send Verification Code Endpoint
app.post('/api/send-code', (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, message: '请输入有效的邮箱地址' });
    }

    // Check if email already registered
    db.get(`SELECT id FROM users WHERE account = ?`, [email], (err, row) => {
        if (row) {
            return res.status(400).json({ success: false, message: '该邮箱已被注册' });
        }

        // Generate Code (6 digits)
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

        // Store/Update in DB
        const sql = `INSERT OR REPLACE INTO verifications (email, code, expires_at) VALUES (?, ?, ?)`;
        db.run(sql, [email, code, expiresAt], (err) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, message: '验证码存储失败' });
            }

            // Send Email
            const mailOptions = {
                from: `"UAV Admin" <${EMAIL_CONFIG.auth.user}>`,
                to: email,
                subject: 'UAV Platform 注册验证码',
                text: `您的注册验证码是: ${code}。有效期为5分钟，请勿告诉他人。`
            };

            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Send mail error:', error);
                    return res.status(500).json({ success: false, message: '邮件发送失败，请检查服务器配置' });
                }
                res.json({ success: true, message: '验证码已发送' });
            });
        });
    });
});

// 1. Register Endpoint
app.post('/api/register', (req, res) => {
    const { account, password, code } = req.body;

    if (!account || !password || !code) {
        return res.status(400).json({ success: false, message: '请填写完整信息 (含验证码)' });
    }

    // Verify Code
    db.get(`SELECT code, expires_at FROM verifications WHERE email = ?`, [account], (err, row) => {
        if (err || !row) {
            return res.status(400).json({ success: false, message: '请先获取验证码' });
        }

        if (Date.now() > row.expires_at) {
            return res.status(400).json({ success: false, message: '验证码已过期，请重新获取' });
        }

        if (row.code !== code) {
            return res.status(400).json({ success: false, message: '验证码错误' });
        }

        // Code Valid -> Create User
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(password, salt);

        const sql = `INSERT INTO users (account, password) VALUES (?, ?)`;
        
        db.run(sql, [account, hash], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ success: false, message: '该账号已被注册' });
                }
                console.error(err);
                return res.status(500).json({ success: false, message: '服务器内部错误' });
            }
            
            // Delete used code
            db.run(`DELETE FROM verifications WHERE email = ?`, [account]);

            res.json({ success: true, message: '注册成功', userId: this.lastID });
        });
    });
});

// 2. Login Endpoint
app.post('/api/login', (req, res) => {
    const { account, password } = req.body;

    if (!account || !password) {
        return res.status(400).json({ success: false, message: '账号和密码不能为空' });
    }

    const sql = `SELECT * FROM users WHERE account = ?`;
    
    db.get(sql, [account], (err, row) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: '服务器查询错误' });
        }

        if (!row) {
            return res.status(404).json({ success: false, message: '账号不存在' });
        }

        // Check password
        const isMatch = bcrypt.compareSync(password, row.password);
        if (isMatch) {
            // Success
            // Generate JWT Token
            const token = jwt.sign(
                { id: row.id, account: row.account },
                JWT_SECRET,
                { expiresIn: '30d' } // Token valid for 30 days
            );

            res.json({ 
                success: true, 
                message: '登录成功', 
                token: token, // Send token to client
                user: { 
                    id: row.id, 
                    account: row.account 
                } 
            });
        } else {
            res.status(401).json({ success: false, message: '密码错误' });
        }
    });
});

// 3. User Info Endpoint (Auto-login verification)
app.get('/api/me', authenticateToken, (req, res) => {
    // If middleware passes, req.user is populated
    res.json({ 
        success: true, 
        user: { 
            id: req.user.id, 
            account: req.user.account 
        } 
    });
});

// 4. Health Check
app.get('/', (req, res) => {
    res.send('<h1>UAV Auth Server v1.1</h1><p>Admin Routes Loaded. Go to <a href="/admin">/admin</a></p>');
});

// Debug Route to verify API visibility
app.get('/api/debug-routes', (req, res) => {
    const routes = [];
    app._router.stack.forEach(function(r){
        if (r.route && r.route.path){
            routes.push(r.route.path);
        }
    });
    res.json(routes);
});

// --- ADMIN API ---

// Middleware to check Admin Token
const checkAdmin = (req, res, next) => {
    const token = req.headers['admin-token'];
    if (token === ADMIN_TOKEN) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Admin access denied' });
    }
};

// List all users
app.get('/api/admin/users', checkAdmin, (req, res) => {
    db.all("SELECT id, account, created_at FROM users", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, data: rows });
    });
});

// Delete user
app.delete('/api/admin/users/:id', checkAdmin, (req, res) => {
    const id = req.params.id;
    db.run("DELETE FROM users WHERE id = ?", id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, changes: this.changes });
    });
});

// Reset Password (to '123456')
app.post('/api/admin/users/:id/reset-password', checkAdmin, (req, res) => {
    const id = req.params.id;
    const defaultPass = '123456';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultPass, salt);
    
    db.run("UPDATE users SET password = ? WHERE id = ?", [hash, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Password reset to 123456' });
    });
});

// Publish Update Endpoint
app.post('/api/admin/publish-update', checkAdmin, upload.single('file'), (req, res) => {
    const { version, notes } = req.body;
    
    if (!req.file || !version) {
        return res.status(400).json({ success: false, message: 'Missing file or version' });
    }

    // Create Metadata
    const updateInfo = {
        version: version,
        notes: notes || '',
        url: `/updates/UAV_Setup_Latest.exe`,
        date: new Date().toISOString()
    };

    // Save latest.json
    fs.writeFileSync(path.join(__dirname, 'updates', 'latest.json'), JSON.stringify(updateInfo, null, 2));

    res.json({ success: true, message: 'Update published successfully', info: updateInfo });
});

// Start Server
app.listen(PORT, () => {
    console.log(`--------------------------------------------------`);
    console.log(`SUCCESS: Server is running on port ${PORT}`);
    console.log(`SUCCESS: Admin Panel is at http://localhost:${PORT}/admin`);
    console.log(`SUCCESS: Admin API Routes are loaded.`);
    console.log(`--------------------------------------------------`);
});
