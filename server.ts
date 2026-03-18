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
const PORT = 3007; // Production port
const RECORDINGS_DIR = path.join(process.cwd(), 'recordings');
const DISK_LIMIT_GB = 100; // Default limit
const JWT_SECRET = process.env.JWT_SECRET || 'unity-dvr-secret-key-2026';

// Store active FFmpeg processes for recording
const activeProcesses: Map<number, ChildProcess> = new Map();

// Store active FFmpeg processes for live streaming
const liveStreams: Map<number, { process: ChildProcess, wss: WebSocketServer }> = new Map();

// Database connection (MySQL for Production)
let db: mysql.Connection;

async function initDb() {
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'unity_dvr',
    });

    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin'
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS cameras (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        rtsp_url VARCHAR(500) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        status VARCHAR(50) DEFAULT 'stopped'
      )
    `);

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

// FFmpeg Logic for Recording
async function startRecording(camera: any) {
  if (activeProcesses.has(camera.id)) return;

  const camDir = path.join(RECORDINGS_DIR, `cam_${camera.id}`);
  await fs.ensureDir(camDir);

  const args = [
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,
    '-c', 'copy',
    '-map', '0',
    '-f', 'segment',
    '-segment_time', '300',
    '-segment_format', 'mp4',
    '-strftime', '1',
    '-reset_timestamps', '1',
    path.join(camDir, '%Y-%m-%d_%H-%M-%S.mp4')
  ];

  const ffmpeg = spawn('ffmpeg', args);
  activeProcesses.set(camera.id, ffmpeg);

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg recording for camera ${camera.id} exited with code ${code}`);
    activeProcesses.delete(camera.id);
    updateCameraStatus(camera.id, 'stopped');
  });

  updateCameraStatus(camera.id, 'recording');
}

function stopRecording(cameraId: number) {
  const process = activeProcesses.get(cameraId);
  if (process) {
    process.kill('SIGTERM');
    activeProcesses.delete(cameraId);
    updateCameraStatus(cameraId, 'stopped');
  }
}

async function updateCameraStatus(id: number, status: string) {
  await db.execute('UPDATE cameras SET status = ? WHERE id = ?', [status, id]);
}

// Live Streaming Logic (RTSP to MPEG-TS for JSMpeg)
function setupLiveStream(camera: any) {
  if (liveStreams.has(camera.id)) return;

  const wss = new WebSocketServer({ noServer: true });
  
  const args = [
    '-rtsp_transport', 'tcp',
    '-i', camera.rtsp_url,
    '-f', 'mpegts',
    '-codec:v', 'mpeg1video',
    '-s', '640x360',
    '-b:v', '800k',
    '-r', '30',
    '-bf', '0',
    '-'
  ];

  const ffmpeg = spawn('ffmpeg', args);
  liveStreams.set(camera.id, { process: ffmpeg, wss });

  ffmpeg.stdout.on('data', (data) => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });

  ffmpeg.on('close', () => {
    console.log(`FFmpeg live stream for camera ${camera.id} stopped`);
    liveStreams.delete(camera.id);
  });

  wss.on('connection', (ws) => {
    console.log(`New viewer for camera ${camera.id}`);
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

app.post('/api/cameras', authenticateToken, async (req, res) => {
  const { name, rtsp_url } = req.body;
  const [result]: any = await db.execute(
    'INSERT INTO cameras (name, rtsp_url) VALUES (?, ?)',
    [name, rtsp_url]
  );
  res.json({ id: result.insertId, name, rtsp_url, is_active: true, status: 'stopped' });
});

app.delete('/api/cameras/:id', authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  stopRecording(id);
  await db.execute('DELETE FROM cameras WHERE id = ?', [id]);
  await fs.remove(path.join(RECORDINGS_DIR, `cam_${id}`));
  res.json({ success: true });
});

app.post('/api/cameras/:id/toggle', authenticateToken, async (req, res) => {
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

async function startServer() {
  await initDb();
  await fs.ensureDir(RECORDINGS_DIR);

  // Auto-start active cameras (only if DB is connected)
  if (db) {
    const [rows]: any = await db.execute('SELECT * FROM cameras WHERE is_active = 1');
    for (const cam of rows) {
      startRecording(cam);
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
}

startServer();
