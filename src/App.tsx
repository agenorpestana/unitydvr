import React, { useState, useEffect } from 'react';
import { Camera, Play, Square, Trash2, Plus, Database, HardDrive, Clock, ChevronRight, Video, LogOut, User, Lock, LayoutGrid, Monitor, Settings, Search, Filter, AlertCircle, Maximize2, Users, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import dayjs from 'dayjs';

interface CameraData {
  id: number;
  name: string;
  rtsp_url: string;
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
        // Video started
      }
    });

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
  const [newCam, setNewCam] = useState({ name: '', rtsp_url: '' });
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  
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
    } catch (err) {
      console.error('Failed to fetch recordings', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchCameras();
      fetchUsers();
      const interval = setInterval(fetchCameras, 5000);
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
    await fetchWithAuth('/api/cameras', {
      method: 'POST',
      body: JSON.stringify(newCam),
    });
    setNewCam({ name: '', rtsp_url: '' });
    setShowAddModal(false);
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
          className="w-full max-w-md bg-[#111] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 bg-emerald-500 rounded-[2rem] flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-6">
              <Video className="text-black w-12 h-12" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Unity DVR</h1>
            <p className="text-sm text-white/40 font-mono uppercase tracking-widest mt-2">Segurança Inteligente</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">E-mail</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                <input 
                  required
                  type="email" 
                  placeholder="admin@exemplo.com"
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:border-emerald-500 transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Senha</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
                <input 
                  required
                  type="password" 
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl pl-12 pr-4 py-4 focus:outline-none focus:border-emerald-500 transition-all"
                />
              </div>
            </div>

            {loginError && (
              <motion.p 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-red-500 text-sm text-center bg-red-500/10 py-3 rounded-xl border border-red-500/20"
              >
                {loginError}
              </motion.p>
            )}

            <button 
              type="submit"
              className="w-full bg-emerald-500 text-black py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
            >
              Acessar Painel
            </button>
          </form>

          <p className="text-center text-white/20 text-[10px] mt-10 font-mono uppercase tracking-tighter">
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
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Video className="text-black w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Unity DVR</h1>
              <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">Surveillance System</p>
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
        
        {/* Mobile Nav */}
        <div className="md:hidden flex border-t border-white/5 p-2 gap-2 overflow-x-auto">
          <button onClick={() => setActiveTab('monitoring')} className={`flex-1 flex flex-col items-center py-2 rounded-xl ${activeTab === 'monitoring' ? 'bg-emerald-500/10 text-emerald-500' : 'text-white/40'}`}>
            <Monitor size={20} />
            <span className="text-[10px] mt-1">Monitor</span>
          </button>
          <button onClick={() => setActiveTab('recordings')} className={`flex-1 flex flex-col items-center py-2 rounded-xl ${activeTab === 'recordings' ? 'bg-emerald-500/10 text-emerald-500' : 'text-white/40'}`}>
            <Clock size={20} />
            <span className="text-[10px] mt-1">Gravações</span>
          </button>
          {isAdmin && (
            <button onClick={() => setActiveTab('settings')} className={`flex-1 flex flex-col items-center py-2 rounded-xl ${activeTab === 'settings' ? 'bg-emerald-500/10 text-emerald-500' : 'text-white/40'}`}>
              <Settings size={20} />
              <span className="text-[10px] mt-1">Ajustes</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
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
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight">Monitoramento em Tempo Real</h2>
                <div className="flex items-center gap-2 text-xs font-mono text-white/40">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  SISTEMA ONLINE
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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
                <h2 className="text-xl font-bold mb-4">Selecionar Câmera</h2>
                <div className="space-y-2">
                  {cameras.map(cam => (
                    <button 
                      key={cam.id}
                      onClick={() => setSelectedCamera(cam)}
                      className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center justify-between ${selectedCamera?.id === cam.id ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-white/5 border-white/5 hover:border-white/20'}`}
                    >
                      <div className="flex items-center gap-3">
                        <Camera size={18} className={selectedCamera?.id === cam.id ? 'text-emerald-500' : 'text-white/40'} />
                        <span className="font-medium">{cam.name}</span>
                      </div>
                      <ChevronRight size={16} className="text-white/20" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-12 lg:col-span-8 space-y-6">
                {selectedCamera ? (
                  <div className="bg-white/5 border border-white/5 rounded-[2.5rem] overflow-hidden">
                    <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                      <div>
                        <h2 className="text-2xl font-bold">{selectedCamera.name}</h2>
                        <p className="text-xs text-white/40 font-mono mt-1">Histórico de Gravações</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-[10px] font-mono text-white/40 uppercase">Total de Arquivos</p>
                          <p className="text-sm font-bold">{recordings.length}</p>
                        </div>
                      </div>
                    </div>

                    {playingVideo && (
                      <div className="aspect-video bg-black relative group">
                        <video src={playingVideo} controls autoPlay className="w-full h-full" />
                        <button onClick={() => setPlayingVideo(null)} className="absolute top-6 right-6 bg-black/60 backdrop-blur-md p-3 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                          <Square size={20} />
                        </button>
                      </div>
                    )}

                    <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="text-[10px] font-mono uppercase tracking-widest text-white/20 border-b border-white/5">
                            <th className="px-8 py-4 font-medium">Arquivo</th>
                            <th className="px-8 py-4 font-medium">Data/Hora</th>
                            <th className="px-8 py-4 font-medium">Tamanho</th>
                            <th className="px-8 py-4 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {recordings.map((rec, i) => (
                            <tr key={i} className="group hover:bg-white/[0.02] border-b border-white/5 transition-colors">
                              <td className="px-8 py-5">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white/40">
                                    <Video size={18} />
                                  </div>
                                  <span className="text-sm font-medium">{rec.name}</span>
                                </div>
                              </td>
                              <td className="px-8 py-5 text-xs text-white/40 font-mono">
                                {dayjs(rec.time).format('DD/MM/YYYY HH:mm:ss')}
                              </td>
                              <td className="px-8 py-5 text-xs text-white/40 font-mono">
                                {(rec.size / 1024 / 1024).toFixed(2)} MB
                              </td>
                              <td className="px-8 py-5 text-right">
                                <button 
                                  onClick={() => setPlayingVideo(rec.url)}
                                  className="bg-emerald-500 text-black p-2.5 rounded-xl hover:bg-emerald-400 transition-colors shadow-lg shadow-emerald-500/10"
                                >
                                  <Play size={16} fill="currentColor" />
                                </button>
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
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Configurações do Sistema</h2>
                  <p className="text-white/40 mt-1">Gerencie suas câmeras e parâmetros de armazenamento.</p>
                </div>
                <button 
                  onClick={() => setShowAddModal(true)}
                  className="bg-emerald-500 text-black px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
                >
                  <Plus size={20} />
                  Adicionar Câmera
                </button>
              </div>

              {/* Cameras List */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Video size={20} className="text-emerald-500" />
                  Câmeras Cadastradas
                </h3>
                <div className="grid grid-cols-1 gap-4">
                  {cameras.map(cam => (
                    <div key={cam.id} className="bg-white/5 border border-white/10 rounded-3xl p-6 flex items-center justify-between group hover:bg-white/[0.08] transition-all">
                      <div className="flex items-center gap-6">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${cam.status === 'recording' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-white/10 text-white/40'}`}>
                          <Camera size={32} />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold">{cam.name}</h3>
                          <p className="text-xs text-white/40 font-mono mt-1">{cam.rtsp_url}</p>
                          <div className="flex items-center gap-4 mt-3">
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${cam.status === 'recording' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-white/5 border-white/10 text-white/40'}`}>
                              {cam.status.toUpperCase()}
                            </span>
                            <span className="text-[10px] font-mono text-white/20">ID: {cam.id}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => toggleRecording(cam.id)}
                          className={`px-6 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${cam.status === 'recording' ? 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20'}`}
                        >
                          {cam.status === 'recording' ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                          {cam.status === 'recording' ? 'Parar Gravação' : 'Iniciar Gravação'}
                        </button>
                        <button 
                          onClick={() => deleteCamera(cam.id)}
                          className="p-3 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 transition-all hover:text-white"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* User Management */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Users size={20} className="text-emerald-500" />
                    Gerenciamento de Usuários
                  </h3>
                  <button 
                    onClick={() => setShowAddUserModal(true)}
                    className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-white/10 transition-all"
                  >
                    <Plus size={16} />
                    Novo Usuário
                  </button>
                </div>
                
                <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] font-mono uppercase tracking-widest text-white/20 border-b border-white/5">
                        <th className="px-6 py-4">E-mail</th>
                        <th className="px-6 py-4">Função</th>
                        <th className="px-6 py-4 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="px-6 py-4 text-sm">{u.email}</td>
                          <td className="px-6 py-4">
                            <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${u.role === 'admin' || u.role === 'superadmin' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-white/5 border-white/10 text-white/40'}`}>
                              {u.role.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => deleteUser(u.id)}
                              disabled={u.email === user?.email || u.role === 'superadmin'}
                              className="p-2 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Storage Info */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center">
                    <HardDrive className="text-white/40" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">Armazenamento</h3>
                    <p className="text-sm text-white/40">Gerenciamento automático de disco.</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-white/40 uppercase">Limite de Disco</span>
                    <span className="text-emerald-500 font-bold">100 GB</span>
                  </div>
                  <div className="h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div className="h-full bg-emerald-500 w-[15%] shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                  </div>
                  <p className="text-[10px] text-white/20 font-mono italic">O sistema remove automaticamente as gravações mais antigas quando o limite é atingido.</p>
                </div>
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
              className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-2">Nova Câmera</h2>
              <p className="text-white/40 text-sm mb-8">Configure os detalhes do stream RTSP.</p>
              
              <form onSubmit={addCamera} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Nome da Câmera</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Ex: Recepção / Estacionamento"
                    value={newCam.name}
                    onChange={e => setNewCam({...newCam, name: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-emerald-500 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">URL RTSP</label>
                  <input 
                    required
                    type="text" 
                    placeholder="rtsp://usuario:senha@ip:porta/stream"
                    value={newCam.rtsp_url}
                    onChange={e => setNewCam({...newCam, rtsp_url: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-emerald-500 transition-all"
                  />
                </div>
                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-6 py-4 rounded-2xl border border-white/10 hover:bg-white/5 transition-all font-bold"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-4 rounded-2xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all font-bold shadow-lg shadow-emerald-500/20"
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
              className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-[2.5rem] p-10 shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-2">Novo Usuário</h2>
              <p className="text-white/40 text-sm mb-8">Defina as credenciais e o nível de acesso.</p>
              
              <form onSubmit={addUser} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">E-mail</label>
                  <input 
                    required
                    type="email" 
                    placeholder="usuario@exemplo.com"
                    value={newUser.email}
                    onChange={e => setNewUser({...newUser, email: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-emerald-500 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Senha</label>
                  <input 
                    required
                    type="password" 
                    placeholder="••••••••"
                    value={newUser.password}
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-emerald-500 transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40 ml-1">Função</label>
                  <select 
                    value={newUser.role}
                    onChange={e => setNewUser({...newUser, role: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 focus:outline-none focus:border-emerald-500 transition-all appearance-none"
                  >
                    <option value="user" className="bg-[#111]">Usuário (Apenas Visualização)</option>
                    <option value="admin" className="bg-[#111]">Administrador (Acesso Total)</option>
                  </select>
                </div>

                {userError && (
                  <p className="text-red-500 text-xs text-center bg-red-500/10 py-2 rounded-lg border border-red-500/20">
                    {userError}
                  </p>
                )}

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddUserModal(false)}
                    className="flex-1 px-6 py-4 rounded-2xl border border-white/10 hover:bg-white/5 transition-all font-bold"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-4 rounded-2xl bg-emerald-500 text-black hover:bg-emerald-400 transition-all font-bold shadow-lg shadow-emerald-500/20"
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
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}</style>
    </div>
  );
}
