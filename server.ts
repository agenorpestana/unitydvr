import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import mysql from 'mysql2/promise';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs-extra';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3007; // Production port
const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');
const DISK_LIMIT_GB = 100; // Default limit
const JWT_SECRET = process.env.JWT_SECRET || 'unity-dvr-secret-key-2026';

// Store active FFmpeg processes for recording
const activeProcesses: Map<number, ChildProcess> = new Map();

// Store active FFmpeg processes for live streaming
const liveStreams: Map<number, { process: ChildProcess, wss: WebSocketServer }> = new Map();

// Database connection (MySQL for Production)
let db: mysql.Pool;

async function initDb() {
  try {
    db = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'unity_dvr',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS cameras (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        rtsp_url VARCHAR(500) NOT NULL,
        type VARCHAR(50) DEFAULT 'rtsp',
        is_active BOOLEAN DEFAULT TRUE,
        status VARCHAR(50) DEFAULT 'stopped'
      )
    `);

    // Migration: Add new columns if they don't exist
    const columnsToAdd = [
      { name: 'type', type: 'VARCHAR(50) DEFAULT "rtsp"' },
      { name: 'cloud_id', type: 'VARCHAR(255)' },
      { name: 'ip', type: 'VARCHAR(255)' },
      { name: 'port', type: 'INT DEFAULT 34567' },
      { name: 'username', type: 'VARCHAR(255)' },
      { name: 'password', type: 'VARCHAR(255)' },
      { name: 'channel', type: 'INT DEFAULT 0' }
    ];

    for (const col of columnsToAdd) {
      try {
        await db.execute(`ALTER TABLE cameras ADD COLUMN ${col.name} ${col.type}`);
        console.log(`Column "${col.name}" added to cameras table`);
      } catch (err: any) {
        if (err.code !== 'ER_DUP_COLUMN_NAME') {
          console.error(`Error adding "${col.name}" column:`, err);
        }
      }
    }

    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin'
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(255) NOT NULL UNIQUE,
        \`value\` TEXT NOT NULL
      )
    `);

    // Seed Storage Limit
    const [settings]: any = await db.execute('SELECT * FROM settings WHERE `key` = ?', ['storage_limit_gb']);
    if (settings.length === 0) {
      await db.execute('INSERT INTO settings (`key`, `value`) VALUES (?, ?)', ['storage_limit_gb', '100']);
      console.log('Default storage limit seeded');
    }

    // Seed Super Admin
    const [users]: any = await db.execute('SELECT * FROM users WHERE email = ?', ['suporte@unityautomacoes.com.br']);
    if (users.length === 0) {
      const hashedPassword = await bcrypt.hash('200616', 10);
      await db.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', 
        ['suporte@unityautomacoes.com.br', hashedPassword, 'superadmin']);
      console.log('Super Admin seeded');
    }

    console.log('Database initialized (MySQL)');
  } catch (err) {
    console.error('Database connection failed:', err);
  }
}

// Auth Middleware
const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    (req as any).user = user;
    next();
  });
};

const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (user && (user.role === 'admin' || user.role === 'superadmin')) {
    next();
  } else {
    res.status(403).json({ message: 'Acesso negado: Apenas administradores' });
  }
};

// FFmpeg Logic for Recording
async function startRecording(camera: any) {
  console.log(`Attempting to start recording for camera ${camera.id} (${camera.name})`);
  if (activeProcesses.has(camera.id)) {
    console.log(`Camera ${camera.id} is already recording.`);
    return;
  }

  const camDir = path.join(RECORDINGS_DIR, `cam_${camera.id}`);
  await fs.ensureDir(camDir);

  const args = [
    ...(camera.rtsp_url.startsWith('rtsp') ? ['-rtsp_transport', 'tcp'] : []),
    '-analyzeduration', '1000000',
    '-probesize', '1000000',
    '-i', camera.rtsp_url,
    '-c', 'copy',
    '-map', '0:v',
    '-f', 'segment',
    '-segment_time', '300',
    '-segment_format', 'mp4',
    '-strftime', '1',
    '-reset_timestamps', '1',
    path.join(camDir, '%Y-%m-%d_%H-%M-%S.mp4')
  ];

  const ffmpeg = spawn('ffmpeg', args);
  activeProcesses.set(camera.id, ffmpeg);

  ffmpeg.stderr.on('data', (data) => {
    console.log(`FFmpeg recording stderr [cam ${camera.id}]:`, data.toString());
  });

  ffmpeg.on('error', (err) => {
    console.error(`FFmpeg recording error for camera ${camera.id}:`, err);
  });

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg recording for camera ${camera.id} exited with code ${code}`);
    if (code !== 0 && code !== null) {
      console.error(`FFmpeg recording for camera ${camera.id} crashed or failed to start.`);
    }
    activeProcesses.delete(camera.id);
    updateCameraStatus(camera.id, 'stopped');
  });

  updateCameraStatus(camera.id, 'recording');
}

function stopRecording(cameraId: number) {
  console.log(`Stopping recording for camera ${cameraId}`);
  const process = activeProcesses.get(cameraId);
  if (process) {
    process.kill('SIGTERM');
    activeProcesses.delete(cameraId);
    updateCameraStatus(cameraId, 'stopped');
  } else {
    console.log(`No active recording process found for camera ${cameraId}`);
  }
}

async function updateCameraStatus(id: number, status: string) {
  if (!db) return;
  try {
    await db.execute('UPDATE cameras SET status = ? WHERE id = ?', [status, id]);
  } catch (err) {
    console.error(`Failed to update camera status for ${id}:`, err);
  }
}

// Storage Monitoring Logic
async function getFolderSize(dir: string): Promise<number> {
  let size = 0;
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        size += await getFolderSize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (err) {
    console.error('Error calculating folder size:', err);
  }
  return size;
}

async function cleanupOldRecordings() {
  try {
    const [rows]: any = await db.execute('SELECT `value` FROM settings WHERE `key` = ?', ['storage_limit_gb']);
    const limitGB = parseInt(rows[0]?.value || '100');
    const limitBytes = limitGB * 1024 * 1024 * 1024;

    let currentSize = await getFolderSize(RECORDINGS_DIR);
    
    if (currentSize > limitBytes) {
      console.log(`Storage limit reached (${(currentSize / (1024**3)).toFixed(2)}GB > ${limitGB}GB). Cleaning up...`);
      
      // Get all mp4 files across all camera directories
      const allFiles: { path: string, mtime: Date, size: number }[] = [];
      const camDirs = await fs.readdir(RECORDINGS_DIR);
      
      for (const camDir of camDirs) {
        const fullCamPath = path.join(RECORDINGS_DIR, camDir);
        if ((await fs.stat(fullCamPath)).isDirectory()) {
          const files = await fs.readdir(fullCamPath);
          for (const file of files) {
            if (file.endsWith('.mp4')) {
              const filePath = path.join(fullCamPath, file);
              const stats = await fs.stat(filePath);
              allFiles.push({ path: filePath, mtime: stats.mtime, size: stats.size });
            }
          }
        }
      }

      // Sort by oldest first
      allFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      for (const file of allFiles) {
        if (currentSize <= limitBytes * 0.9) break; // Stop when we're at 90% of limit
        
        await fs.remove(file.path);
        currentSize -= file.size;
        console.log(`Deleted old recording: ${file.path}`);
      }
    }
  } catch (err) {
    console.error('Storage cleanup failed:', err);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupOldRecordings, 5 * 60 * 1000);

// Live Streaming Logic (RTSP to MPEG-TS for JSMpeg)
function setupLiveStream(camera: any) {
  if (liveStreams.has(camera.id)) return;
  console.log(`Setting up live stream for camera ${camera.id}: ${camera.rtsp_url}`);

  const wss = new WebSocketServer({ noServer: true });
  
  const args = [
    ...(camera.rtsp_url.startsWith('rtsp') ? ['-rtsp_transport', 'tcp'] : []),
    '-i', camera.rtsp_url,
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-bf', '0',
    '-'
  ];

  const ffmpeg = spawn('ffmpeg', args);
  liveStreams.set(camera.id, { process: ffmpeg, wss });

  let firstChunk = true;
  ffmpeg.stdout.on('data', (data) => {
    if (firstChunk) {
      console.log(`First chunk of data received for camera ${camera.id}`);
      firstChunk = false;
    }
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });

  ffmpeg.stderr.on('data', (data) => {
    console.log(`FFmpeg live stderr [cam ${camera.id}]:`, data.toString());
  });

  ffmpeg.on('error', (err) => {
    console.error(`FFmpeg live stream error for camera ${camera.id}:`, err);
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  ffmpeg.on('close', () => {
    console.log(`FFmpeg live stream for camera ${camera.id} stopped`);
    clearInterval(interval);
    liveStreams.delete(camera.id);
  });

  wss.on('connection', (ws: any) => {
    console.log(`New viewer for camera ${camera.id}. Total viewers: ${wss.clients.size}`);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
      if (wss.clients.size === 0) {
        console.log(`No more viewers for camera ${camera.id}, stopping stream`);
        ffmpeg.kill('SIGTERM');
      }
    });
  });
}

// Disk Management
async function cleanupDisk() {
  try {
    const limitBytes = DISK_LIMIT_GB * 1024 * 1024 * 1024;
    let totalSize = 0;
    const files: { path: string, mtime: number, size: number }[] = [];

    const scan = async (dir: string) => {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          await scan(fullPath);
        } else if (item.endsWith('.mp4')) {
          totalSize += stats.size;
          files.push({ path: fullPath, mtime: stats.mtimeMs, size: stats.size });
        }
      }
    };

    if (await fs.pathExists(RECORDINGS_DIR)) {
      await scan(RECORDINGS_DIR);
    }

    if (totalSize > limitBytes) {
      files.sort((a, b) => a.mtime - b.mtime);
      for (const file of files) {
        if (totalSize <= limitBytes * 0.9) break;
        await fs.remove(file.path);
        totalSize -= file.size;
      }
    }
  } catch (err) {
    console.error('Disk cleanup failed:', err);
  }
}

// API Routes
app.use(cors());
app.use(express.json());

app.use('/recordings', express.static(RECORDINGS_DIR));

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows]: any = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return res.status(401).json({ message: 'Credenciais inválidas' });

    const user = rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ message: 'Credenciais inválidas' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ message: 'Erro no servidor' });
  }
});

app.get('/api/cameras', authenticateToken, async (req, res) => {
  const [rows] = await db.execute('SELECT * FROM cameras');
  res.json(rows);
});

app.post('/api/cameras', authenticateToken, isAdmin, async (req, res) => {
  const { name, rtsp_url, type, cloud_id, ip, port, username, password, channel } = req.body;
  const [result]: any = await db.execute(
    'INSERT INTO cameras (name, rtsp_url, type, cloud_id, ip, port, username, password, channel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [name, rtsp_url || '', type || 'rtsp', cloud_id || null, ip || null, port || 34567, username || null, password || null, channel || 0]
  );
  res.json({ id: result.insertId, name, rtsp_url, type: type || 'rtsp', is_active: true, status: 'stopped' });
});

app.put('/api/cameras/:id', authenticateToken, isAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, rtsp_url, type, cloud_id, ip, port, username, password, channel } = req.body;
  
  try {
    const [rows]: any = await db.execute('SELECT * FROM cameras WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).send('Camera not found');
    
    const oldCamera = rows[0];
    const urlChanged = oldCamera.rtsp_url !== rtsp_url;
    
    await db.execute(
      'UPDATE cameras SET name = ?, rtsp_url = ?, type = ?, cloud_id = ?, ip = ?, port = ?, username = ?, password = ?, channel = ? WHERE id = ?',
      [name, rtsp_url || '', type || 'rtsp', cloud_id || null, ip || null, port || 34567, username || null, password || null, channel || 0, id]
    );
    
    if (urlChanged && activeProcesses.has(id)) {
      stopRecording(id);
      // We don't automatically restart here to avoid issues, 
      // but the user can toggle it back on. 
      // Or we could restart if it was recording.
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar câmera' });
  }
});

app.delete('/api/cameras/:id', authenticateToken, isAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  stopRecording(id);
  await db.execute('DELETE FROM cameras WHERE id = ?', [id]);
  await fs.remove(path.join(RECORDINGS_DIR, `cam_${id}`));
  res.json({ success: true });
});

app.post('/api/cameras/:id/toggle', authenticateToken, isAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const [rows]: any = await db.execute('SELECT * FROM cameras WHERE id = ?', [id]);
  if (rows.length === 0) return res.status(404).send('Camera not found');

  const camera = rows[0];
  if (activeProcesses.has(id)) {
    stopRecording(id);
  } else {
    await startRecording(camera);
  }
  res.json({ success: true });
});

// User Management Routes
app.get('/api/users', authenticateToken, isAdmin, async (req, res) => {
  const [rows] = await db.execute('SELECT id, email, role FROM users');
  res.json(rows);
});

app.post('/api/users', authenticateToken, isAdmin, async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.execute('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [email, hashedPassword, role]);
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ message: 'E-mail já cadastrado' });
    } else {
      res.status(500).json({ message: 'Erro ao criar usuário' });
    }
  }
});

app.delete('/api/users/:id', authenticateToken, isAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const user = (req as any).user;
  
  // Prevent self-deletion
  if (user.id === id) {
    return res.status(400).json({ message: 'Você não pode excluir seu próprio usuário' });
  }

  await db.execute('DELETE FROM users WHERE id = ?', [id]);
  res.json({ success: true });
});

app.get('/api/storage/status', authenticateToken, async (req, res) => {
  try {
    const [rows]: any = await db.execute('SELECT `value` FROM settings WHERE `key` = ?', ['storage_limit_gb']);
    const limitGB = parseInt(rows[0]?.value || '100');
    const usedBytes = await getFolderSize(RECORDINGS_DIR);
    const usedGB = usedBytes / (1024 * 1024 * 1024);
    
    res.json({
      limitGB,
      usedGB: parseFloat(usedGB.toFixed(2)),
      freeGB: parseFloat((limitGB - usedGB).toFixed(2)),
      percentUsed: Math.min(100, (usedGB / limitGB) * 100)
    });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao obter status do armazenamento' });
  }
});

app.post('/api/storage/limit', authenticateToken, isAdmin, async (req, res) => {
  const { limitGB } = req.body;
  if (!limitGB || isNaN(limitGB)) return res.status(400).json({ message: 'Limite inválido' });
  
  try {
    await db.execute('UPDATE settings SET `value` = ? WHERE `key` = ?', [limitGB.toString(), 'storage_limit_gb']);
    res.json({ success: true });
    // Trigger immediate cleanup check
    cleanupOldRecordings();
  } catch (err) {
    res.status(500).json({ message: 'Erro ao atualizar limite de armazenamento' });
  }
});

app.get('/api/recordings/:cameraId', authenticateToken, async (req, res) => {
  const camId = req.params.cameraId;
  const camDir = path.join(RECORDINGS_DIR, `cam_${camId}`);
  
  if (!(await fs.pathExists(camDir))) {
    return res.json([]);
  }

  const files = await fs.readdir(camDir);
  const recordings = files
    .filter(f => f.endsWith('.mp4'))
    .map(f => {
      const stats = fs.statSync(path.join(camDir, f));
      return {
        name: f,
        url: `/recordings/cam_${camId}/${f}`,
        size: stats.size,
        time: stats.mtime
      };
    })
    .sort((a, b) => b.time.getTime() - a.time.getTime());

  res.json(recordings);
});

app.delete('/api/recordings/:cameraId/:filename', authenticateToken, async (req, res) => {
  const { cameraId, filename } = req.params;
  const filePath = path.join(RECORDINGS_DIR, `cam_${cameraId}`, filename);
  
  try {
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ message: 'Arquivo não encontrado' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Erro ao excluir arquivo' });
  }
});

app.post('/api/recordings/bulk-delete', authenticateToken, async (req, res) => {
  const { recordings } = req.body; // Array of { cameraId, filename }
  
  try {
    for (const rec of recordings) {
      const filePath = path.join(RECORDINGS_DIR, `cam_${rec.cameraId}`, rec.filename);
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao excluir arquivos' });
  }
});

async function startServer() {
  await initDb();
  await fs.ensureDir(RECORDINGS_DIR);

  // Auto-start active cameras (only if DB is connected)
  if (db) {
    try {
      const [rows]: any = await db.execute('SELECT * FROM cameras WHERE is_active = 1');
      for (const cam of rows) {
        startRecording(cam);
      }
    } catch (err) {
      console.error('Failed to auto-start cameras:', err);
    }
  }

  setInterval(cleanupDisk, 10 * 60 * 1000);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Handle WebSocket upgrades for live streaming
  server.on('upgrade', async (request, socket, head) => {
    const { pathname } = new URL(request.url!, `http://${request.headers.host}`);
    console.log(`Upgrade request for ${pathname}`);
    
    if (pathname.startsWith('/api/stream/')) {
      const cameraId = parseInt(pathname.split('/').pop()!);
      const [rows]: any = await db.execute('SELECT * FROM cameras WHERE id = ?', [cameraId]);
      
      if (rows.length > 0) {
        const camera = rows[0];
        if (!liveStreams.has(cameraId)) {
          setupLiveStream(camera);
        }
        const stream = liveStreams.get(cameraId);
        if (stream) {
          stream.wss.handleUpgrade(request, socket, head, (ws) => {
            stream.wss.emit('connection', ws, request);
          });
        }
      } else {
        socket.destroy();
      }
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Unity DVR running on http://localhost:${PORT}`);
  });

  // Cleanup on exit
  const cleanup = () => {
    console.log('Cleaning up processes...');
    activeProcesses.forEach(p => p.kill('SIGTERM'));
    liveStreams.forEach(s => s.process.kill('SIGTERM'));
    process.exit();
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

startServer();
