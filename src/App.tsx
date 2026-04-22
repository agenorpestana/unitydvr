import React, { useState, useEffect } from 'react';
import { Camera, Play, Square, Trash2, Plus, Database, HardDrive, Clock, ChevronRight, Video, LogOut, User, Lock, LayoutGrid, Monitor, Settings, Search, Filter, AlertCircle, Maximize2, Users, Shield, Edit } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import dayjs from 'dayjs';

interface CameraData {
  id: number;
  name: string;
  rtsp_url: string;
  type: 'rtsp' | 'onvif' | 'vms';
  cloud_id?: string;
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
  channel?: number;
  is_active: boolean;
  status: 'recording' | 'stopped' | 'error';
}

interface Recording {
  name: string;
  url: string;
  size: number;
  time: string;
}

interface UserData {
  email: string;
  role: string;
}

type TabType = 'monitoring' | 'recordings' | 'settings';

declare global {
  interface Window {
    JSMpeg: any;
  }
}

const LiveStream = ({ cameraId, name }: { cameraId: number, name: string }) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !window.JSMpeg) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/stream/${cameraId}`;
    
    const player = new window.JSMpeg.Player(url, {
      canvas: canvasRef.current,
      autoplay: true,
      audio: false,
      loop: false,
      onVideoDecode: () => {
        console.log(`Video started decoding for camera ${cameraId}`);
      }
    });

    console.log(`JSMpeg player initialized for camera ${cameraId} at ${url}`);

    return () => {
      player.destroy();
    };
  }, [cameraId]);

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen().catch(err => {
          console.error(`Error attempting to enable full-screen mode: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    }
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden group">
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 flex items-center gap-2 z-10">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] font-mono uppercase tracking-widest">{name} - LIVE</span>
      </div>
      <button 
        onClick={toggleFullscreen}
        className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-md p-2.5 rounded-xl border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-emerald-500 hover:text-black z-20"
        title="Tela Cheia"
      >
        <Maximize2 size={18} />
      </button>
    </div>
  );
};

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('unity_dvr_token'));
  const [user, setUser] = useState<UserData | null>(JSON.parse(localStorage.getItem('unity_dvr_user') || 'null'));
  const [cameras, setCameras] = useState<CameraData[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('monitoring');
  const [selectedCamera, setSelectedCamera] = useState<CameraData | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editCam, setEditCam] = useState<CameraData | null>(null);
  const [newCam, setNewCam] = useState({ 
    name: '', 
    rtsp_url: '', 
    type: 'rtsp' as 'rtsp' | 'onvif' | 'vms',
    cloud_id: '',
    ip: '',
    port: 34567,
    username: 'admin',
    password: '',
    channel: 0,
    isDualLens: false
  });
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [selectedRecordings, setSelectedRecordings] = useState<string[]>([]);
  const [storageStatus, setStorageStatus] = useState<{ limitGB: number, usedGB: number, freeGB: number, percentUsed: number } | null>(null);
  const [newLimit, setNewLimit] = useState<string>('');
  
  // User Management states
  const [users, setUsers] = useState<any[]>([]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', role: 'user' });
  const [userError, setUserError] = useState('');
  
  // Login states
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const fetchWithAuth = async (url: string, options: any = {}) => {
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    return res;
  };

  const fetchCameras = async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth('/api/cameras');
      const data = await res.json();
      setCameras(data);
    } catch (err) {
      console.error('Failed to fetch cameras', err);
    }
  };

  const fetchUsers = async () => {
    if (!token || (user?.role !== 'admin' && user?.role !== 'superadmin')) return;
    try {
      const res = await fetchWithAuth('/api/users');
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  const fetchRecordings = async (cameraId: number) => {
    if (!token) return;
    try {
      const res = await fetchWithAuth(`/api/recordings/${cameraId}`);
      const data = await res.json();
      setRecordings(data);
      setSelectedRecordings([]); // Reset selection on camera change
    } catch (err) {
      console.error('Failed to fetch recordings', err);
    }
  };

  const deleteRecording = async (filename: string) => {
    if (!selectedCamera || !confirm('Deseja excluir esta gravação?')) return;
    try {
      const res = await fetchWithAuth(`/api/recordings/${selectedCamera.id}/${filename}`, { method: 'DELETE' });
      if (res.ok) {
        fetchRecordings(selectedCamera.id);
      }
    } catch (err) {
      console.error('Failed to delete recording', err);
    }
  };

  const bulkDelete = async () => {
    if (!selectedCamera || selectedRecordings.length === 0 || !confirm(`Deseja excluir as ${selectedRecordings.length} gravações selecionadas?`)) return;
    try {
      const res = await fetchWithAuth('/api/recordings/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({
          recordings: selectedRecordings.map(filename => ({ cameraId: selectedCamera.id, filename }))
        })
      });
      if (res.ok) {
        fetchRecordings(selectedCamera.id);
      }
    } catch (err) {
      console.error('Failed to bulk delete recordings', err);
    }
  };

  const toggleRecordingSelection = (filename: string) => {
    setSelectedRecordings(prev => 
      prev.includes(filename) ? prev.filter(f => f !== filename) : [...prev, filename]
    );
  };

  const toggleAllRecordings = () => {
    if (selectedRecordings.length === recordings.length) {
      setSelectedRecordings([]);
    } else {
      setSelectedRecordings(recordings.map(r => r.name));
    }
  };

  const fetchStorageStatus = async () => {
    if (!token) return;
    try {
      const res = await fetchWithAuth('/api/storage/status');
      const data = await res.json();
      setStorageStatus(data);
      if (!newLimit) setNewLimit(data.limitGB.toString());
    } catch (err) {
      console.error('Failed to fetch storage status', err);
    }
  };

  const updateStorageLimit = async () => {
    if (!token || !newLimit) return;
    try {
      const res = await fetchWithAuth('/api/storage/limit', {
        method: 'POST',
        body: JSON.stringify({ limitGB: parseInt(newLimit) })
      });
      if (res.ok) {
        fetchStorageStatus();
        alert('Limite de armazenamento atualizado!');
      }
    } catch (err) {
      console.error('Failed to update storage limit', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchCameras();
      fetchUsers();
      fetchStorageStatus();
      const interval = setInterval(() => {
        fetchCameras();
        fetchStorageStatus();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [token]);

  useEffect(() => {
    if (selectedCamera && activeTab === 'recordings' && token) {
      fetchRecordings(selectedCamera.id);
    }
  }, [selectedCamera, activeTab, token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('unity_dvr_token', data.token);
        localStorage.setItem('unity_dvr_user', JSON.stringify(data.user));
      } else {
        setLoginError(data.message || 'Erro ao fazer login');
      }
    } catch (err) {
      setLoginError('Erro de conexão com o servidor');
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('unity_dvr_token');
    localStorage.removeItem('unity_dvr_user');
  };

  const addCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const camerasToCreate = [];
    
    // Helper to build URL for XMeye/VMS if not provided
    const buildUrl = (cam: any) => {
      if (cam.type === 'vms') {
        const address = cam.ip || cam.cloud_id;
        return `http://${cam.username}:${cam.password}@${address}:${cam.port}/user=${cam.username}&password=${cam.password}&channel=${cam.channel}&stream=0.sdp`;
      }
      return cam.rtsp_url;
    };

    if (newCam.isDualLens) {
      // Create two cameras
      camerasToCreate.push({
        ...newCam,
        name: `${newCam.name} (Lente 1)`,
        channel: 0,
        rtsp_url: buildUrl({ ...newCam, channel: 0 })
      });
      camerasToCreate.push({
        ...newCam,
        name: `${newCam.name} (Lente 2)`,
        channel: 1,
        rtsp_url: buildUrl({ ...newCam, channel: 1 })
      });
    } else {
      camerasToCreate.push({
        ...newCam,
        rtsp_url: buildUrl(newCam)
      });
    }

    for (const cam of camerasToCreate) {
      await fetchWithAuth('/api/cameras', {
        method: 'POST',
        body: JSON.stringify(cam),
      });
    }

    setNewCam({ 
      name: '', 
      rtsp_url: '', 
      type: 'rtsp',
      cloud_id: '',
      ip: '',
      port: 34567,
      username: 'admin',
      password: '',
      channel: 0,
      isDualLens: false
    });
    setShowAddModal(false);
    fetchCameras();
  };

  const updateCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editCam) return;

    // Build the URL for VMS type if it's missing or needs update
    let finalCam = { ...editCam };
    if (finalCam.type === 'vms') {
      const address = finalCam.ip || finalCam.cloud_id;
      finalCam.rtsp_url = `http://${finalCam.username}:${finalCam.password}@${address}:${finalCam.port}/user=${finalCam.username}&password=${finalCam.password}&channel=${finalCam.channel || 0}&stream=0.sdp`;
    }

    await fetchWithAuth(`/api/cameras/${editCam.id}`, {
      method: 'PUT',
      body: JSON.stringify(finalCam),
    });
    setEditCam(null);
    setShowEditModal(false);
    fetchCameras();
  };

  const toggleRecording = async (id: number) => {
    await fetchWithAuth(`/api/cameras/${id}/toggle`, { method: 'POST' });
    fetchCameras();
  };

  const deleteCamera = async (id: number) => {
    if (!confirm('Tem certeza que deseja remover esta câmera?')) return;
    await fetchWithAuth(`/api/cameras/${id}`, { method: 'DELETE' });
    if (selectedCamera?.id === id) setSelectedCamera(null);
    fetchCameras();
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserError('');
    try {
      const res = await fetchWithAuth('/api/users', {
        method: 'POST',
        body: JSON.stringify(newUser),
      });
      if (res.ok) {
        setNewUser({ email: '', password: '', role: 'user' });
        setShowAddUserModal(false);
        fetchUsers();
      } else {
        const data = await res.json();
        setUserError(data.message || 'Erro ao criar usuário');
      }
    } catch (err) {
      setUserError('Erro ao conectar com o servidor');
    }
  };

  const deleteUser = async (id: number) => {
    if (!confirm('Tem certeza que deseja remover este usuário?')) return;
    try {
      const res = await fetchWithAuth(`/api/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchUsers();
      } else {
        const data = await res.json();
        alert(data.message || 'Erro ao excluir usuário');
      }
    } catch (err) {
      console.error('Failed to delete user', err);
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#111] border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-10 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-6 sm:mb-10">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-emerald-500 rounded-[1.5rem] sm:rounded-[2rem] flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-4 sm:mb-6">
              <Video className="text-black w-10 h-10 sm:w-12 sm:h-12" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Unity DVR</h1>
            <p className="text-[10px] sm:text-sm text-white/40 font-mono uppercase tracking-widest mt-1 sm:mt-2">Segurança Inteligente</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 sm:space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">E-mail</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                <input 
                  required
                  type="email" 
                  placeholder="admin@exemplo.com"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl pl-12 pr-4 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                <input 
                  required
                  type="password" 
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl pl-12 pr-4 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                />
              </div>
            </div>

            {loginError && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-500 text-xs sm:text-sm text-center bg-red-500/10 py-2 sm:py-3 rounded-xl border border-red-500/20"
              >
                {loginError}
              </motion.p>
            )}

            <button 
              type="submit"
              className="w-full bg-emerald-500 text-black py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-base sm:text-lg hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
            >
              Acessar Painel
            </button>
          </form>

          <p className="text-center text-white/20 text-[8px] sm:text-[10px] mt-8 sm:mt-10 font-mono uppercase tracking-tighter">
            &copy; 2026 Unity Automações & Sistemas
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 sm:h-20 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-emerald-500 rounded-lg sm:rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Video className="text-black w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">Unity DVR</h1>
              <p className="text-[8px] sm:text-[10px] text-white/40 font-mono uppercase tracking-widest">Surveillance System</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center bg-white/5 rounded-2xl p-1 border border-white/5">
            <button 
              onClick={() => setActiveTab('monitoring')}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === 'monitoring' ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:text-white'}`}
            >
              <Monitor size={16} />
              Monitoramento
            </button>
            <button 
              onClick={() => setActiveTab('recordings')}
              className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === 'recordings' ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:text-white'}`}
            >
              <Clock size={16} />
              Gravações
            </button>
            {isAdmin && (
              <button 
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-medium transition-all ${activeTab === 'settings' ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20' : 'text-white/60 hover:text-white'}`}
              >
                <Settings size={16} />
                Configurações
              </button>
            )}
          </nav>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-xs font-semibold">{user?.email}</p>
              <p className="text-[10px] text-emerald-500 font-mono uppercase tracking-widest">{user?.role}</p>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:text-red-500 hover:border-red-500/30 transition-all"
              title="Sair"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8">
        <AnimatePresence mode="wait">
          {/* TAB: MONITORING */}
          {activeTab === 'monitoring' && (
            <motion.div 
              key="monitoring"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Monitoramento em Tempo Real</h2>
                <div className="flex items-center gap-2 text-[10px] sm:text-xs font-mono text-white/40">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  SISTEMA ONLINE
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                {cameras.map(cam => (
                  <div key={cam.id} className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden group">
                    <div className="aspect-video bg-black flex items-center justify-center relative">
                      <LiveStream cameraId={cam.id} name={cam.name} />
                      {cam.status === 'recording' && (
                        <div className="absolute top-4 right-4 bg-red-500 text-black px-2 py-0.5 rounded text-[10px] font-bold animate-pulse z-20">
                          REC
                        </div>
                      )}
                    </div>
                    <div className="p-4 flex items-center justify-between bg-white/[0.02]">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${cam.status === 'recording' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-white/10 text-white/40'}`}>
                          <Video size={16} />
                        </div>
                        <span className="text-sm font-semibold">{cam.name}</span>
                      </div>
                      <button 
                        onClick={() => { setSelectedCamera(cam); setActiveTab('recordings'); }}
                        className="text-[10px] font-mono uppercase tracking-widest text-white/40 hover:text-emerald-500 transition-colors"
                      >
                        Ver Gravações
                      </button>
                    </div>
                  </div>
                ))}
                {cameras.length === 0 && (
                  <div className="col-span-full py-32 text-center border-2 border-dashed border-white/5 rounded-[40px]">
                    <AlertCircle className="mx-auto text-white/10 mb-4" size={48} />
                    <p className="text-white/40">Nenhuma câmera configurada para monitoramento.</p>
                    <button onClick={() => setActiveTab('settings')} className="mt-4 text-emerald-500 text-sm font-semibold hover:underline">Ir para Configurações</button>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB: RECORDINGS */}
          {activeTab === 'recordings' && (
            <motion.div 
              key="recordings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-12 gap-8"
            >
              <div className="col-span-12 lg:col-span-4 space-y-4">
                <h2 className="text-lg sm:text-xl font-bold mb-4">Selecionar Câmera</h2>
                <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 no-scrollbar">
                  {cameras.map(cam => (
                    <button 
                      key={cam.id}
                      onClick={() => setSelectedCamera(cam)}
                      className={`flex-shrink-0 lg:flex-shrink-1 w-[200px] lg:w-full p-3 sm:p-4 rounded-xl sm:rounded-2xl border text-left transition-all flex items-center justify-between ${selectedCamera?.id === cam.id ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-white/5 border-white/5 hover:border-white/20'}`}
                    >
                      <div className="flex items-center gap-2 sm:gap-3">
                        <Camera size={16} className={selectedCamera?.id === cam.id ? 'text-emerald-500' : 'text-white/40'} />
                        <span className="text-sm font-medium truncate max-w-[120px] lg:max-w-none">{cam.name}</span>
                      </div>
                      <ChevronRight size={14} className="hidden lg:block text-white/20" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-12 lg:col-span-8 space-y-6">
                {selectedCamera ? (
                  <div className="bg-white/5 border border-white/5 rounded-2xl sm:rounded-[2.5rem] overflow-hidden">
                      <div className="p-4 sm:p-8 border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white/[0.02]">
                        <div>
                          <h2 className="text-xl sm:text-2xl font-bold">{selectedCamera.name}</h2>
                          <p className="text-[10px] sm:text-xs text-white/40 font-mono mt-1">Histórico de Gravações</p>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-4">
                          {selectedRecordings.length > 0 && (
                            <button 
                              onClick={bulkDelete}
                              className="flex items-center gap-2 bg-red-500 text-black px-3 sm:px-4 py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-bold hover:bg-red-400 transition-all shadow-lg shadow-red-500/20"
                            >
                              <Trash2 size={12} />
                              <span className="hidden xs:inline">Excluir ({selectedRecordings.length})</span>
                              <span className="xs:hidden">{selectedRecordings.length}</span>
                            </button>
                          )}
                          <div className="text-right">
                            <p className="text-[8px] sm:text-[10px] font-mono text-white/40 uppercase">Arquivos</p>
                            <p className="text-xs sm:text-sm font-bold">{recordings.length}</p>
                          </div>
                        </div>
                      </div>

                      {playingVideo && (
                        <div className="aspect-video bg-black relative group">
                          <video src={playingVideo} controls autoPlay className="w-full h-full" />
                          <button onClick={() => setPlayingVideo(null)} className="absolute top-4 right-4 sm:top-6 sm:right-6 bg-black/60 backdrop-blur-md p-2 sm:p-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                            <Square size={16} />
                          </button>
                        </div>
                      )}

                      <div className="max-h-[500px] sm:max-h-[600px] overflow-x-auto overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse min-w-[600px] sm:min-w-0">
                          <thead>
                            <tr className="text-[8px] sm:text-[10px] font-mono uppercase tracking-widest text-white/20 border-b border-white/5">
                              <th className="px-4 sm:px-8 py-3 sm:py-4 font-medium w-10">
                                <input 
                                  type="checkbox" 
                                  checked={recordings.length > 0 && selectedRecordings.length === recordings.length}
                                  onChange={toggleAllRecordings}
                                  className="w-4 h-4 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500"
                                />
                              </th>
                              <th className="px-4 sm:px-8 py-3 sm:py-4 font-medium">Arquivo</th>
                              <th className="px-4 sm:px-8 py-3 sm:py-4 font-medium">Data/Hora</th>
                              <th className="px-4 sm:px-8 py-3 sm:py-4 font-medium">Tamanho</th>
                              <th className="px-4 sm:px-8 py-3 sm:py-4 font-medium text-right">Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recordings.map((rec, i) => (
                              <tr key={i} className={`group hover:bg-white/[0.02] border-b border-white/5 transition-colors ${selectedRecordings.includes(rec.name) ? 'bg-emerald-500/5' : ''}`}>
                                <td className="px-4 sm:px-8 py-4 sm:py-5">
                                  <input 
                                    type="checkbox" 
                                    checked={selectedRecordings.includes(rec.name)}
                                    onChange={() => toggleRecordingSelection(rec.name)}
                                    className="w-4 h-4 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500"
                                  />
                                </td>
                                <td className="px-4 sm:px-8 py-4 sm:py-5">
                                  <div className="flex items-center gap-2 sm:gap-3">
                                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-white/5 flex items-center justify-center text-white/40">
                                      <Video size={16} />
                                    </div>
                                    <span className="text-xs sm:text-sm font-medium truncate max-w-[150px]">{rec.name}</span>
                                  </div>
                                </td>
                                <td className="px-4 sm:px-8 py-4 sm:py-5 text-[10px] sm:text-xs text-white/40 font-mono">
                                  {dayjs(rec.time).format('DD/MM/YYYY HH:mm:ss')}
                                </td>
                                <td className="px-4 sm:px-8 py-4 sm:py-5 text-[10px] sm:text-xs text-white/40 font-mono">
                                  {(rec.size / 1024 / 1024).toFixed(2)} MB
                                </td>
                                <td className="px-4 sm:px-8 py-4 sm:py-5 text-right">
                                  <div className="flex items-center justify-end gap-1 sm:gap-2">
                                    <button 
                                      onClick={() => setPlayingVideo(rec.url)}
                                      className="bg-emerald-500 text-black p-2 sm:p-2.5 rounded-lg sm:rounded-xl hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/10"
                                      title="Reproduzir"
                                    >
                                      <Play size={14} fill="currentColor" />
                                    </button>
                                    <button 
                                      onClick={() => deleteRecording(rec.name)}
                                      className="bg-red-500/10 text-red-500 p-2 sm:p-2.5 rounded-lg sm:rounded-xl border border-red-500/20 hover:bg-red-500 hover:text-white transition-all"
                                      title="Excluir"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      {recordings.length === 0 && (
                        <div className="py-32 text-center">
                          <Clock className="mx-auto text-white/10 mb-4" size={64} />
                          <p className="text-white/20 text-sm">Nenhuma gravação encontrada para esta câmera</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center py-40 border-2 border-dashed border-white/5 rounded-[40px] bg-white/[0.01]">
                    <Video size={60} className="text-white/10 mb-6" />
                    <h2 className="text-xl font-bold text-white/40">Selecione uma câmera ao lado</h2>
                    <p className="text-sm text-white/20 mt-2">Para navegar pelo histórico de gravações</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* TAB: SETTINGS */}
          {activeTab === 'settings' && isAdmin && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="max-w-4xl mx-auto space-y-12"
            >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Configurações</h2>
                  <p className="text-xs sm:text-sm text-white/40 mt-1">Gerencie suas câmeras e parâmetros de armazenamento.</p>
                </div>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="w-full sm:w-auto bg-emerald-500 text-black px-6 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
                >
                  <Plus size={20} />
                  Adicionar Câmera
                </button>
              </div>

              {/* Cameras List */}
              <div className="space-y-4 sm:space-y-6">
                <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                  <Video size={20} className="text-emerald-500" />
                  Câmeras Cadastradas
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {cameras.map(cam => (
                    <div key={cam.id} className="bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between group hover:bg-white/[0.08] transition-all gap-4">
                      <div className="flex items-center gap-4 sm:gap-6">
                        <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center ${cam.status === 'recording' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-white/10 text-white/40'}`}>
                          <Camera size={24} className="sm:w-8 sm:h-8" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-base sm:text-lg font-bold truncate">{cam.name}</h3>
                          <p className="text-[10px] sm:text-xs text-white/40 font-mono mt-0.5 sm:mt-1 truncate">{cam.rtsp_url}</p>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 sm:mt-3">
                            <span className={`text-[8px] sm:text-[10px] font-mono px-2 py-0.5 rounded border ${cam.status === 'recording' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-white/5 border-white/10 text-white/40'}`}>
                              {cam.status.toUpperCase()}
                            </span>
                            <span className="text-[8px] sm:text-[10px] font-mono px-2 py-0.5 rounded border bg-white/5 border-white/10 text-white/40 uppercase">
                              {cam.type || 'RTSP'}
                            </span>
                            <span className="text-[8px] sm:text-[10px] font-mono text-white/20">ID: {cam.id}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 justify-end sm:justify-start">
                        <button 
                          onClick={() => {
                            setEditCam(cam);
                            setShowEditModal(true);
                          }}
                          className="flex-1 sm:flex-none p-2.5 sm:p-3 rounded-xl bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 transition-all flex justify-center"
                          title="Editar Câmera"
                        >
                          <Edit size={18} className="sm:w-5 sm:h-5" />
                        </button>
                        <button 
                          onClick={() => toggleRecording(cam.id)}
                          className={`flex-[2] sm:flex-none px-4 sm:px-6 py-2.5 rounded-xl font-bold text-[10px] sm:text-sm transition-all flex items-center justify-center gap-2 ${cam.status === 'recording' ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20'}`}
                        >
                          {cam.status === 'recording' ? <Square size={14} fill="currentColor" className="sm:w-4 sm:h-4" /> : <Play size={14} fill="currentColor" className="sm:w-4 sm:h-4" />}
                          <span className="whitespace-nowrap">{cam.status === 'recording' ? 'Parar' : 'Gravar'}</span>
                        </button>
                        <button 
                          onClick={() => deleteCamera(cam.id)}
                          className="flex-1 sm:flex-none p-2.5 sm:p-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 transition-all hover:text-white flex justify-center"
                        >
                          <Trash2 size={18} className="sm:w-5 sm:h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* User Management */}
              <div className="space-y-4 sm:space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-base sm:text-lg font-bold flex items-center gap-2">
                    <Users size={20} className="text-emerald-500" />
                    Usuários
                  </h3>
                  <button 
                    onClick={() => setShowAddUserModal(true)}
                    className="bg-white/5 border border-white/10 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-sm font-bold flex items-center gap-2 hover:bg-white/10 transition-all"
                  >
                    <Plus size={14} className="sm:w-4 sm:h-4" />
                    Novo Usuário
                  </button>
                </div>
                
                <div className="bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl overflow-hidden overflow-x-auto">
                  <table className="w-full text-left min-w-[500px] sm:min-w-0">
                    <thead>
                      <tr className="text-[8px] sm:text-[10px] font-mono uppercase tracking-widest text-white/20 border-b border-white/5">
                        <th className="px-4 sm:px-6 py-3 sm:py-4">E-mail</th>
                        <th className="px-4 sm:px-6 py-3 sm:py-4">Função</th>
                        <th className="px-4 sm:px-6 py-3 sm:py-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="px-4 sm:px-6 py-3 sm:py-4 text-xs sm:text-sm">{u.email}</td>
                          <td className="px-4 sm:px-6 py-3 sm:py-4">
                            <span className={`text-[8px] sm:text-[10px] font-mono px-2 py-0.5 rounded border ${u.role === 'admin' || u.role === 'superadmin' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-white/5 border-white/10 text-white/40'}`}>
                              {u.role.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 sm:px-6 py-3 sm:py-4 text-right">
                            <button 
                              onClick={() => deleteUser(u.id)}
                              disabled={u.email === user?.email || u.role === 'superadmin'}
                              className="p-2 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Storage Info */}
              <div className="bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white/10 rounded-xl sm:rounded-2xl flex items-center justify-center">
                      <HardDrive className="text-emerald-500" size={20} />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold">Armazenamento</h3>
                      <p className="text-xs sm:text-sm text-white/40">Gerenciamento automático de disco.</p>
                    </div>
                  </div>
                  
                  {user?.role === 'admin' || user?.role === 'superadmin' ? (
                    <div className="flex items-center gap-2 sm:gap-3 bg-white/5 p-2 rounded-xl sm:rounded-2xl border border-white/10">
                      <input 
                        type="number"
                        value={newLimit}
                        onChange={e => setNewLimit(e.target.value)}
                        className="w-16 sm:w-20 bg-transparent border-none text-right font-mono text-xs sm:text-sm focus:ring-0"
                        placeholder="GB"
                      />
                      <span className="text-[8px] sm:text-[10px] font-mono text-white/20 uppercase">GB</span>
                      <button 
                        onClick={updateStorageLimit}
                        className="bg-emerald-500 text-black px-3 sm:px-4 py-1.5 rounded-lg sm:rounded-xl text-[8px] sm:text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-400 transition-all"
                      >
                        Definir
                      </button>
                    </div>
                  ) : null}
                </div>

                {storageStatus ? (
                  <div className="space-y-4">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-white/40 uppercase">Uso do Disco: {storageStatus.usedGB} GB / {storageStatus.limitGB} GB</span>
                      <span className={`${storageStatus.percentUsed > 90 ? 'text-red-500' : storageStatus.percentUsed > 75 ? 'text-yellow-500' : 'text-emerald-500'} font-bold`}>
                        {storageStatus.percentUsed.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${storageStatus.percentUsed}%` }}
                        className={`h-full shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-500 ${
                          storageStatus.percentUsed > 90 ? 'bg-red-500 shadow-red-500/50' : 
                          storageStatus.percentUsed > 75 ? 'bg-yellow-500 shadow-yellow-500/50' : 
                          'bg-emerald-500 shadow-emerald-500/50'
                        }`}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-white/20">
                      <span>LIVRE: {storageStatus.freeGB} GB</span>
                      <span>TOTAL: {storageStatus.limitGB} GB</span>
                    </div>
                    <p className="text-[10px] text-white/20 font-mono italic">O sistema remove automaticamente as gravações mais antigas quando o limite é atingido.</p>
                  </div>
                ) : (
                  <div className="h-20 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Camera Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-[#111] border border-white/10 rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-10 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <h2 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">Adicionar Dispositivo</h2>
              <p className="text-white/40 text-xs sm:text-sm mb-6 sm:mb-8">Configure os detalhes da câmera (Suporte a Lente Dupla e VMS).</p>
              
              <form onSubmit={addCamera} className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Nome do Dispositivo</label>
                    <input 
                      required
                      type="text" 
                      placeholder="Ex: CASA"
                      value={newCam.name}
                      onChange={e => setNewCam({...newCam, name: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Tipo de Conexão</label>
                    <select 
                      value={newCam.type}
                      onChange={e => setNewCam({...newCam, type: e.target.value as any})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base appearance-none"
                    >
                      <option value="rtsp">RTSP (Direto)</option>
                      <option value="onvif">ONVIF</option>
                      <option value="vms">CloudID / XMeye (VMS)</option>
                    </select>
                  </div>
                </div>

                {newCam.type === 'vms' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">IP ou CloudID</label>
                        <input 
                          required
                          type="text" 
                          placeholder="Ex: 100.64.217.77 ou ID"
                          value={newCam.ip || newCam.cloud_id}
                          onChange={e => setNewCam({...newCam, ip: e.target.value, cloud_id: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Porta TCP</label>
                        <input 
                          required
                          type="number" 
                          value={newCam.port}
                          onChange={e => setNewCam({...newCam, port: parseInt(e.target.value)})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Usuário</label>
                        <input 
                          required
                          type="text" 
                          value={newCam.username}
                          onChange={e => setNewCam({...newCam, username: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Senha</label>
                        <input 
                          type="password" 
                          placeholder="Opcional"
                          value={newCam.password}
                          onChange={e => setNewCam({...newCam, password: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                      <input 
                        type="checkbox"
                        id="dualLens"
                        checked={newCam.isDualLens}
                        onChange={e => setNewCam({...newCam, isDualLens: e.target.checked})}
                        className="w-5 h-5 rounded border-white/10 bg-white/5 text-emerald-500 focus:ring-emerald-500"
                      />
                      <label htmlFor="dualLens" className="text-sm font-medium cursor-pointer">Câmera de Lente Dupla (Adiciona 2 canais automaticamente)</label>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">URL RTSP {newCam.type === 'onvif' ? '(ou IP ONVIF)' : ''}</label>
                    <input 
                      required
                      type="text" 
                      placeholder={newCam.type === 'rtsp' ? "rtsp://usuario:senha@ip:porta/stream" : "http://ip:porta/onvif/device_service"}
                      value={newCam.rtsp_url}
                      onChange={e => setNewCam({...newCam, rtsp_url: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                    />
                  </div>
                )}
                <div className="flex gap-3 sm:gap-4 pt-2 sm:pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-white/10 hover:bg-white/5 transition-all font-bold text-sm sm:text-base"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all font-bold shadow-lg shadow-emerald-500/20 text-sm sm:text-base"
                  >
                    Salvar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Camera Modal */}
      <AnimatePresence>
        {showEditModal && editCam && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowEditModal(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-[#111] border border-white/10 rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-10 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <h2 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">Editar Dispositivo</h2>
              <p className="text-white/40 text-xs sm:text-sm mb-6 sm:mb-8">Consulte ou atualize os detalhes de conexão.</p>
              
              <form onSubmit={updateCamera} className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Nome</label>
                    <input 
                      required
                      type="text" 
                      value={editCam.name}
                      onChange={e => setEditCam({...editCam, name: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Tipo de Conexão</label>
                    <select 
                      value={editCam.type}
                      onChange={e => setEditCam({...editCam, type: e.target.value as any})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base appearance-none"
                    >
                      <option value="rtsp">RTSP (Direto)</option>
                      <option value="onvif">ONVIF</option>
                      <option value="vms">CloudID / XMeye (VMS)</option>
                    </select>
                  </div>
                </div>

                {editCam.type === 'vms' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">IP ou CloudID</label>
                        <input 
                          required
                          type="text" 
                          value={editCam.ip || editCam.cloud_id}
                          onChange={e => setEditCam({...editCam, ip: e.target.value, cloud_id: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Porta TCP</label>
                        <input 
                          required
                          type="number" 
                          value={editCam.port}
                          onChange={e => setEditCam({...editCam, port: parseInt(e.target.value)})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base font-mono"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Usuário</label>
                        <input 
                          required
                          type="text" 
                          value={editCam.username}
                          onChange={e => setEditCam({...editCam, username: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Senha</label>
                        <input 
                          type="password" 
                          value={editCam.password}
                          onChange={e => setEditCam({...editCam, password: e.target.value})}
                          className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">URL RTSP / IP</label>
                    <input 
                      required
                      type="text" 
                      value={editCam.rtsp_url}
                      onChange={e => setEditCam({...editCam, rtsp_url: e.target.value})}
                      className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                    />
                  </div>
                )}
                <div className="flex gap-3 sm:gap-4 pt-2 sm:pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-white/10 hover:bg-white/5 transition-all font-bold text-sm sm:text-base"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all font-bold shadow-lg shadow-emerald-500/20 text-sm sm:text-base"
                  >
                    Salvar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddUserModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddUserModal(false)}
              className="absolute inset-0 bg-black/90 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-3xl sm:rounded-[2.5rem] p-6 sm:p-10 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
            >
              <h2 className="text-xl sm:text-2xl font-bold mb-1 sm:mb-2">Novo Usuário</h2>
              <p className="text-white/40 text-xs sm:text-sm mb-6 sm:mb-8">Defina as credenciais e o nível de acesso.</p>
              
              <form onSubmit={addUser} className="space-y-4 sm:space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">E-mail</label>
                  <input 
                    required
                    type="email" 
                    placeholder="usuario@exemplo.com"
                    value={newUser.email}
                    onChange={e => setNewUser({...newUser, email: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Senha</label>
                  <input 
                    required
                    type="password" 
                    placeholder="••••••••"
                    value={newUser.password}
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all text-sm sm:text-base"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] sm:text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Função</label>
                  <select 
                    value={newUser.role}
                    onChange={e => setNewUser({...newUser, role: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 focus:outline-none focus:border-emerald-500 transition-all appearance-none text-sm sm:text-base"
                  >
                    <option value="user" className="bg-[#111]">Usuário (Apenas Visualização)</option>
                    <option value="admin" className="bg-[#111]">Administrador (Acesso Total)</option>
                  </select>
                </div>

                {userError && (
                  <p className="text-red-500 text-[10px] sm:text-xs text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20">
                    {userError}
                  </p>
                )}

                <div className="flex gap-3 sm:gap-4 pt-2 sm:pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddUserModal(false)}
                    className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl border border-white/10 hover:bg-white/5 transition-all font-bold text-sm sm:text-base"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 sm:px-6 py-3 sm:py-4 rounded-xl sm:rounded-2xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all font-bold shadow-lg shadow-emerald-500/20 text-sm sm:text-base"
                  >
                    Criar Usuário
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom); }
      `}</style>

      {/* Mobile Nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-xl border-t border-white/5 p-2 flex gap-2 z-[60] pb-safe">
        <button onClick={() => setActiveTab('monitoring')} className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all ${activeTab === 'monitoring' ? 'bg-emerald-500/10 text-emerald-500' : 'text-white/40'}`}>
          <Monitor size={20} />
          <span className="text-[10px] mt-1 font-medium">Monitor</span>
        </button>
        <button onClick={() => setActiveTab('recordings')} className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all ${activeTab === 'recordings' ? 'bg-emerald-500/10 text-emerald-500' : 'text-white/40'}`}>
          <Clock size={20} />
          <span className="text-[10px] mt-1 font-medium">Gravações</span>
        </button>
        {isAdmin && (
          <button onClick={() => setActiveTab('settings')} className={`flex-1 flex flex-col items-center py-2 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-emerald-500/10 text-emerald-500' : 'text-white/40'}`}>
            <Settings size={20} />
            <span className="text-[10px] mt-1 font-medium">Ajustes</span>
          </button>
        )}
      </div>
    </div>
  );
}
