import React, { useState, useEffect } from 'react';
import { Camera, Play, Square, Trash2, Plus, Database, HardDrive, Clock, ChevronRight, Video, LogOut, User, Lock } from 'lucide-react';
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

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('unity_dvr_token'));
  const [user, setUser] = useState<UserData | null>(JSON.parse(localStorage.getItem('unity_dvr_user') || 'null'));
  const [cameras, setCameras] = useState<CameraData[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<CameraData | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCam, setNewCam] = useState({ name: '', rtsp_url: '' });
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  
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
      const interval = setInterval(fetchCameras, 5000);
      return () => clearInterval(interval);
    }
  }, [token]);

  useEffect(() => {
    if (selectedCamera && token) {
      fetchRecordings(selectedCamera.id);
    }
  }, [selectedCamera, token]);

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

  if (!token) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#111] border border-white/10 rounded-[2rem] p-10 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20 mb-6">
              <Video className="text-black w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Unity DVR</h1>
            <p className="text-sm text-white/40 font-mono uppercase tracking-widest mt-2">Acesso Restrito</p>
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
              Entrar no Sistema
            </button>
          </form>

          <p className="text-center text-white/20 text-xs mt-10 font-mono">
            &copy; 2026 Unity Automações
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
          <div className="flex items-center gap-6">
            <div className="hidden md:flex items-center gap-2 text-xs text-white/40 font-mono">
              <HardDrive size={14} />
              <span>DISK: 100GB LIMIT</span>
            </div>
            <div className="h-8 w-px bg-white/10 hidden md:block" />
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-semibold">{user?.email}</p>
                <p className="text-[10px] text-emerald-500 font-mono uppercase tracking-widest">{user?.role}</p>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 rounded-xl bg-white/5 border border-white/10 hover:text-red-500 hover:border-red-500/30 transition-all"
                title="Sair"
              >
                <LogOut size={20} />
              </button>
              <button 
                onClick={() => setShowAddModal(true)}
                className="bg-white text-black px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-400 transition-colors shadow-lg shadow-white/5"
              >
                <Plus size={18} />
                <span className="hidden sm:inline">Nova Câmera</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-8">
        {/* Sidebar: Camera List */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-mono uppercase tracking-widest text-white/40">Câmeras Ativas</h2>
            <span className="text-[10px] bg-white/5 px-2 py-1 rounded border border-white/10">{cameras.length}</span>
          </div>
          
          <div className="space-y-3">
            {cameras.map((cam) => (
              <motion.div 
                layout
                key={cam.id}
                onClick={() => setSelectedCamera(cam)}
                className={`group p-4 rounded-2xl border transition-all cursor-pointer ${
                  selectedCamera?.id === cam.id 
                    ? 'bg-emerald-500/10 border-emerald-500/50' 
                    : 'bg-white/5 border-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      cam.status === 'recording' ? 'bg-emerald-500/20 text-emerald-500 animate-pulse' : 'bg-white/10 text-white/40'
                    }`}>
                      <Camera size={24} />
                    </div>
                    <div>
                      <h3 className="font-semibold">{cam.name}</h3>
                      <p className="text-xs text-white/40 truncate max-w-[150px] font-mono">{cam.rtsp_url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => { e.stopPropagation(); toggleRecording(cam.id); }}
                      className={`p-2 rounded-lg ${cam.status === 'recording' ? 'text-red-500 hover:bg-red-500/10' : 'text-emerald-500 hover:bg-emerald-500/10'}`}
                    >
                      {cam.status === 'recording' ? <Square size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteCamera(cam.id); }}
                      className="p-2 rounded-lg text-white/20 hover:text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
            {cameras.length === 0 && (
              <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                <p className="text-white/20 text-sm">Nenhuma câmera cadastrada</p>
              </div>
            )}
          </div>
        </div>

        {/* Main Content: Recordings & Player */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {selectedCamera ? (
            <>
              <div className="bg-white/5 border border-white/5 rounded-3xl overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                  <div>
                    <h2 className="text-xl font-bold">{selectedCamera.name}</h2>
                    <p className="text-xs text-white/40 font-mono mt-1">Gravações Segmentadas (5min)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${selectedCamera.status === 'recording' ? 'bg-emerald-500 animate-pulse' : 'bg-white/20'}`} />
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                      {selectedCamera.status === 'recording' ? 'Gravando Agora' : 'Em Espera'}
                    </span>
                  </div>
                </div>

                {playingVideo && (
                  <div className="aspect-video bg-black relative group">
                    <video 
                      src={playingVideo} 
                      controls 
                      autoPlay 
                      className="w-full h-full"
                    />
                    <button 
                      onClick={() => setPlayingVideo(null)}
                      className="absolute top-4 right-4 bg-black/60 backdrop-blur-md p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Square size={20} />
                    </button>
                  </div>
                )}

                <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[10px] font-mono uppercase tracking-widest text-white/20 border-b border-white/5">
                        <th className="px-6 py-4 font-medium">Arquivo</th>
                        <th className="px-6 py-4 font-medium">Data/Hora</th>
                        <th className="px-6 py-4 font-medium">Tamanho</th>
                        <th className="px-6 py-4 font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recordings.map((rec, i) => (
                        <tr key={i} className="group hover:bg-white/[0.02] border-b border-white/5 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/40">
                                <Video size={14} />
                              </div>
                              <span className="text-sm font-medium">{rec.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs text-white/40 font-mono">
                            {dayjs(rec.time).format('DD/MM/YYYY HH:mm:ss')}
                          </td>
                          <td className="px-6 py-4 text-xs text-white/40 font-mono">
                            {(rec.size / 1024 / 1024).toFixed(2)} MB
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => setPlayingVideo(rec.url)}
                              className="text-emerald-500 hover:bg-emerald-500/10 p-2 rounded-lg transition-colors"
                            >
                              <Play size={16} fill="currentColor" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {recordings.length === 0 && (
                    <div className="py-20 text-center">
                      <Clock className="mx-auto text-white/10 mb-4" size={48} />
                      <p className="text-white/20 text-sm">Nenhuma gravação encontrada para esta câmera</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center py-40 border-2 border-dashed border-white/5 rounded-[40px] bg-white/[0.01]">
              <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mb-6">
                <Camera size={40} className="text-white/10" />
              </div>
              <h2 className="text-xl font-bold text-white/40">Selecione uma câmera</h2>
              <p className="text-sm text-white/20 mt-2">Para visualizar o status e as gravações</p>
            </div>
          )}
        </div>
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
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-3xl p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-6">Nova Câmera</h2>
              <form onSubmit={addCamera} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40">Nome da Câmera</label>
                  <input 
                    required
                    type="text" 
                    placeholder="Ex: Corredor Principal"
                    value={newCam.name}
                    onChange={e => setNewCam({...newCam, name: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-mono uppercase tracking-widest text-white/40">URL RTSP</label>
                  <input 
                    required
                    type="text" 
                    placeholder="rtsp://usuario:senha@ip:porta/stream"
                    value={newCam.rtsp_url}
                    onChange={e => setNewCam({...newCam, rtsp_url: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl border border-white/10 hover:bg-white/5 transition-colors font-semibold"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 transition-colors font-bold"
                  >
                    Salvar Câmera
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
