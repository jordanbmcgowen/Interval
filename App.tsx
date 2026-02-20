
import React, { useState, useEffect, useRef } from 'react';
import { TimerStatus, TimerSettings, TimerState, ThemeName } from './types';
import { audioService } from './services/audioService';

const DEFAULT_SETTINGS: TimerSettings = {
  intervalLength: 60,
  totalDuration: 20,
  enableAICoach: false,
  enableVibration: true,
  theme: 'zen',
};

const THEME_KEYS: ThemeName[] = ['zen', 'ocean', 'forest', 'sunset'];

const THEMES: Record<ThemeName, { 
  name: string, 
  primary: string, 
  secondary: string, 
  gradient: string, 
  text: string, 
  ring: string,
  accent: string 
}> = {
  zen: {
    name: 'Emerald',
    primary: 'text-emerald-500',
    secondary: 'text-cyan-400',
    gradient: 'from-emerald-300 via-cyan-400 to-blue-500',
    text: 'text-emerald-400',
    ring: 'text-emerald-500',
    accent: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/40'
  },
  ocean: {
    name: 'Ocean',
    primary: 'text-blue-500',
    secondary: 'text-indigo-400',
    gradient: 'from-blue-400 via-indigo-400 to-purple-500',
    text: 'text-blue-400',
    ring: 'text-blue-500',
    accent: 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/40'
  },
  forest: {
    name: 'Forest',
    primary: 'text-lime-500',
    secondary: 'text-emerald-400',
    gradient: 'from-lime-300 via-emerald-400 to-teal-500',
    text: 'text-lime-400',
    ring: 'text-lime-500',
    accent: 'bg-lime-600 hover:bg-lime-500 shadow-lime-900/40'
  },
  sunset: {
    name: 'Sunset',
    primary: 'text-orange-500',
    secondary: 'text-rose-400',
    gradient: 'from-orange-400 via-rose-400 to-red-500',
    text: 'text-orange-400',
    ring: 'text-orange-500',
    accent: 'bg-orange-600 hover:bg-orange-500 shadow-orange-900/40'
  }
};

const WORKER_CODE = `
let timerId = null;
let state = {
  currentIntervalTime: 0,
  totalTimeRemaining: 0,
  intervalsCompleted: 0,
  intervalLength: 60,
  totalDuration: 20
};

self.onmessage = (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'CONFIGURE':
      state.intervalLength = payload.intervalLength;
      state.totalDuration = payload.totalDuration;
      break;

    case 'INIT_STATE':
       state.currentIntervalTime = payload.intervalLength;
       state.totalTimeRemaining = payload.totalDuration * 60;
       state.intervalsCompleted = 0;
       break;

    case 'START':
      if (!timerId) {
        timerId = setInterval(tick, 1000);
      }
      break;

    case 'PAUSE':
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      break;

    case 'RESET':
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      state.currentIntervalTime = state.intervalLength;
      state.totalTimeRemaining = state.totalDuration * 60;
      state.intervalsCompleted = 0;
      self.postMessage({ type: 'TICK', state });
      break;
  }
};

function tick() {
  state.totalTimeRemaining--;

  if (state.totalTimeRemaining <= 0) {
    state.currentIntervalTime = 0;
    state.totalTimeRemaining = 0;
    clearInterval(timerId);
    timerId = null;
    self.postMessage({ type: 'COMPLETED', state });
    return;
  }

  if (state.currentIntervalTime > 0 && state.currentIntervalTime <= 3) {
    self.postMessage({ type: 'COUNTDOWN', state });
  }

  state.currentIntervalTime--;

  if (state.currentIntervalTime < 0) {
    state.currentIntervalTime = state.intervalLength - 1;
    state.intervalsCompleted++;
    self.postMessage({ type: 'INTERVAL_END', state });
  } else {
    self.postMessage({ type: 'TICK', state });
  }
}
`;

const App: React.FC = () => {
  const [settings, setSettings] = useState<TimerSettings>(DEFAULT_SETTINGS);
  const [state, setState] = useState<TimerState>({
    currentIntervalTime: DEFAULT_SETTINGS.intervalLength,
    totalTimeRemaining: DEFAULT_SETTINGS.totalDuration * 60,
    intervalsCompleted: 0,
    status: TimerStatus.IDLE,
  });

  const currentTheme = THEMES[THEME_KEYS[state.intervalsCompleted % THEME_KEYS.length]];
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const statusRef = useRef<TimerStatus>(TimerStatus.IDLE);

  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  useEffect(() => {
    const recoverAudio = () => {
      if (statusRef.current === TimerStatus.RUNNING) {
        audioService.recoverForActiveSession();
      } else {
        audioService.unlock();
      }
    };

    const unlockAudio = () => {
      audioService.unlock();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        recoverAudio();
      }
    };

    document.addEventListener('touchstart', recoverAudio, { passive: true });
    document.addEventListener('pointerdown', recoverAudio, { passive: true });
    window.addEventListener('focus', recoverAudio);
    window.addEventListener('pageshow', recoverAudio);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const healthCheckId = window.setInterval(() => {
      if (statusRef.current === TimerStatus.RUNNING) {
        audioService.recoverForActiveSession();
      }
    }, 15000);

    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('pointerdown', unlockAudio, { passive: true });

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    workerRef.current = worker;

    worker.onmessage = (e) => {
      const { type, state: workerState } = e.data;
      
      setState(prev => ({
        ...prev,
        currentIntervalTime: workerState.currentIntervalTime,
        totalTimeRemaining: workerState.totalTimeRemaining,
        intervalsCompleted: workerState.intervalsCompleted,
        status: type === 'COMPLETED' ? TimerStatus.COMPLETED : prev.status
      }));

      if (type === 'COUNTDOWN') {
        audioService.playTick();
      } else if (type === 'INTERVAL_END' || type === 'COMPLETED') {
        triggerAlertRef.current?.();
      }
      
      if (type === 'COMPLETED') {
        releaseWakeLock();
        audioService.disableBackgroundMode();
      }
    };

    worker.postMessage({ 
      type: 'CONFIGURE', 
      payload: { 
        intervalLength: DEFAULT_SETTINGS.intervalLength, 
        totalDuration: DEFAULT_SETTINGS.totalDuration 
      } 
    });

    return () => {
      document.removeEventListener('touchstart', recoverAudio);
      document.removeEventListener('pointerdown', recoverAudio);
      window.removeEventListener('focus', recoverAudio);
      window.removeEventListener('pageshow', recoverAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(healthCheckId);
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('pointerdown', unlockAudio);
      worker.terminate();
      releaseWakeLock();
      audioService.disableBackgroundMode();
    };
  }, []);

  useEffect(() => {
    if (state.status === TimerStatus.IDLE) {
      setState(prev => ({
        ...prev,
        currentIntervalTime: settings.intervalLength,
        totalTimeRemaining: settings.totalDuration * 60,
        intervalsCompleted: 0
      }));
      workerRef.current?.postMessage({ 
        type: 'INIT_STATE', 
        payload: { 
          intervalLength: settings.intervalLength, 
          totalDuration: settings.totalDuration 
        } 
      });
    }
    
    workerRef.current?.postMessage({ 
      type: 'CONFIGURE', 
      payload: { 
        intervalLength: settings.intervalLength, 
        totalDuration: settings.totalDuration 
      } 
    });
  }, [settings.intervalLength, settings.totalDuration, state.status]);

  const triggerAlertRef = useRef<() => void>();
  triggerAlertRef.current = async () => {
    audioService.playDing();

    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Interval alert', {
        body: 'Interval transition reached.',
        silent: false,
      });
    }

    if (settings.enableVibration && 'vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
  };

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('Wake Lock failed:', err);
      }
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  };

  const handleStart = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    await audioService.recoverForActiveSession();
    await requestWakeLock();
    triggerAlertRef.current?.();
    setState(prev => ({ ...prev, status: TimerStatus.RUNNING }));
    workerRef.current?.postMessage({ type: 'START' });
  };

  const handlePause = () => {
    setState(prev => ({ ...prev, status: TimerStatus.PAUSED }));
    workerRef.current?.postMessage({ type: 'PAUSE' });
    releaseWakeLock();
    audioService.disableBackgroundMode();
  };

  const handleReset = () => {
    setState({
      currentIntervalTime: settings.intervalLength,
      totalTimeRemaining: settings.totalDuration * 60,
      intervalsCompleted: 0,
      status: TimerStatus.IDLE,
    });
    workerRef.current?.postMessage({ type: 'RESET' });
    releaseWakeLock();
    audioService.disableBackgroundMode();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const totalProgress = 1 - (state.totalTimeRemaining / (settings.totalDuration * 60));
  const intervalProgress = (settings.intervalLength - state.currentIntervalTime) / settings.intervalLength;

  return (
    <div className="fixed inset-0 h-[100dvh] w-screen flex flex-col items-center justify-center bg-slate-950 p-2 sm:p-4 font-sans text-slate-200 overflow-hidden transition-colors duration-1000">
      
      <div className="w-full h-full max-h-full max-w-[480px] sm:max-w-xl landscape:max-w-4xl landscape:w-full flex flex-col bg-slate-900/40 backdrop-blur-xl rounded-[2rem] sm:rounded-[3rem] p-4 sm:p-8 border border-white/5 shadow-2xl relative overflow-hidden transition-all duration-700">
        
        {/* Background Glows */}
        <div className={`absolute -top-24 -left-24 w-64 h-64 landscape:w-96 landscape:h-96 blur-[100px] rounded-full pointer-events-none opacity-20 transition-all duration-1000 ${currentTheme.ring.replace('text', 'bg')}`} />
        <div className={`absolute -bottom-24 -right-24 w-64 h-64 landscape:w-96 landscape:h-96 blur-[100px] rounded-full pointer-events-none opacity-20 transition-all duration-1000 ${currentTheme.secondary.replace('text', 'bg')}`} />

        {/* Branding - Hidden in short landscapes */}
        <div className="text-center mb-2 sm:mb-4 landscape:hidden">
          <h1 className={`text-xl sm:text-3xl font-black tracking-[0.2em] uppercase bg-gradient-to-br ${currentTheme.gradient} bg-clip-text text-transparent transition-all duration-1000`}>
            Interval
          </h1>
        </div>

        <div className="flex-1 min-h-0 flex flex-col landscape:flex-row items-center justify-center landscape:gap-10 sm:landscape:gap-12 relative z-10 w-full overflow-hidden">
          
          {/* LEFT: Timer Section */}
          <div className="flex flex-col items-center justify-center flex-shrink min-h-0 landscape:flex-[1.2]">
            <div className="relative flex items-center justify-center w-full max-w-[min(60vw,50vh)] landscape:max-w-[45vh]">
              <svg className="w-full h-auto aspect-square -rotate-90 overflow-visible transition-all duration-500">
                <circle cx="50%" cy="50%" r="46%" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-800" />
                <circle
                  cx="50%"
                  cy="50%"
                  r="46%"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray="100"
                  strokeDashoffset={100 - (intervalProgress * 100)}
                  pathLength="100"
                  strokeLinecap="round"
                  className={`transition-all duration-1000 ease-linear shadow-lg ${currentTheme.ring}`}
                  style={{ filter: `drop-shadow(0 0 15px rgba(0,0,0,0.6))` }}
                />
              </svg>

              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-[12vh] landscape:text-[15vh] font-mono font-black tabular-nums text-white drop-shadow-sm leading-none tracking-tighter">
                  {formatTime(state.currentIntervalTime)}
                </span>
                <p className="text-[1.5vh] font-black tracking-widest text-slate-500 uppercase mt-[1vh]">
                  Remaining
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT: Controls & Settings Section */}
          <div className="flex flex-col w-full landscape:flex-1 landscape:h-full justify-center mt-4 landscape:mt-0 flex-shrink-0 min-w-0">
            
            {/* Landscape Branding Replacement */}
            <div className="hidden landscape:block mb-[2vh] text-center">
               <h1 className={`text-[3vh] font-black tracking-[0.2em] uppercase bg-gradient-to-br ${currentTheme.gradient} bg-clip-text text-transparent transition-all duration-1000`}>
                Interval
              </h1>
            </div>

            {/* Stats - using vh for vertical density */}
            <div className="grid grid-cols-2 gap-[1.5vh] mb-[2vh]">
              <div className="bg-slate-950/40 p-[2vh] rounded-xl border border-white/5 text-center backdrop-blur-md flex flex-col justify-center">
                <p className="text-[1.2vh] font-black text-slate-500 uppercase tracking-widest mb-[0.5vh]">Set</p>
                <p className={`text-[3vh] font-mono font-bold transition-colors duration-1000 ${currentTheme.secondary}`}>#{state.intervalsCompleted + 1}</p>
              </div>
              <div className="bg-slate-950/40 p-[2vh] rounded-xl border border-white/5 text-center backdrop-blur-md flex flex-col justify-center">
                <p className="text-[1.2vh] font-black text-slate-500 uppercase tracking-widest mb-[0.5vh]">Total Left</p>
                <p className="text-[3vh] font-mono font-bold text-slate-200">{formatTime(state.totalTimeRemaining)}</p>
              </div>
            </div>

            <div className="flex-shrink-0 min-h-0">
              {state.status === TimerStatus.IDLE ? (
                <div className="space-y-[1.5vh] mb-[2vh]">
                  {/* Interval Setting */}
                  <div className="px-1">
                    <div className="flex items-center justify-between mb-[0.5vh]">
                      <span className="text-[1.5vh] font-black text-slate-400 uppercase tracking-wider">Interval (s)</span>
                      <input 
                        type="number"
                        value={settings.intervalLength}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setSettings(s => ({ ...s, intervalLength: Math.max(0, val) }));
                        }}
                        className={`w-[10vh] text-right bg-transparent border-b border-transparent focus:border-current outline-none text-[2.5vh] font-mono font-black transition-all duration-1000 ${currentTheme.text}`}
                        min="1"
                      />
                    </div>
                    <input 
                      type="range" min="5" max="300" step="5"
                      value={Math.min(300, settings.intervalLength)}
                      onChange={(e) => setSettings(s => ({ ...s, intervalLength: parseInt(e.target.value) }))}
                      className={`w-full h-[0.8vh] bg-slate-800 rounded-full appearance-none cursor-pointer accent-current ${currentTheme.primary}`}
                    />
                  </div>
                  {/* Session Setting */}
                  <div className="px-1">
                    <div className="flex items-center justify-between mb-[0.5vh]">
                      <span className="text-[1.5vh] font-black text-slate-400 uppercase tracking-wider">Session (m)</span>
                      <input 
                        type="number"
                        value={settings.totalDuration}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setSettings(s => ({ ...s, totalDuration: Math.max(0, val) }));
                        }}
                        className={`w-[10vh] text-right bg-transparent border-b border-transparent focus:border-current outline-none text-[2.5vh] font-mono font-black transition-all duration-1000 ${currentTheme.secondary}`}
                        min="1"
                      />
                    </div>
                    <input 
                      type="range" min="1" max="60" step="1"
                      value={Math.min(60, settings.totalDuration)}
                      onChange={(e) => setSettings(s => ({ ...s, totalDuration: parseInt(e.target.value) }))}
                      className={`w-full h-[0.8vh] bg-slate-800 rounded-full appearance-none cursor-pointer accent-current ${currentTheme.secondary}`}
                    />
                  </div>
                </div>
              ) : (
                <div className="px-1 mb-[3vh]">
                  <div className="flex justify-between text-[1.2vh] font-black text-slate-500 uppercase tracking-widest mb-[1vh]">
                    <span>Progress</span>
                    <span className="text-slate-400">{Math.round(totalProgress * 100)}%</span>
                  </div>
                  <div className="w-full h-[0.8vh] bg-slate-800 rounded-full overflow-hidden border border-white/5">
                    <div 
                      className={`h-full bg-gradient-to-r transition-all duration-1000 ${currentTheme.gradient}`}
                      style={{ width: `${totalProgress * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons - dynamic height */}
            <div className="flex gap-[1.5vh]">
              {state.status === TimerStatus.RUNNING ? (
                <button 
                  onClick={handlePause}
                  className="flex-1 py-[2vh] bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all rounded-xl text-[1.5vh] font-black uppercase tracking-widest text-white shadow-lg border border-white/5"
                >
                  Pause
                </button>
              ) : (
                <button 
                  onClick={handleStart}
                  disabled={state.status === TimerStatus.COMPLETED}
                  className={`flex-1 py-[2vh] text-white text-[1.5vh] font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shadow-xl disabled:opacity-20 ${currentTheme.accent}`}
                >
                  {state.status === TimerStatus.PAUSED ? 'Resume' : state.status === TimerStatus.COMPLETED ? 'End' : 'Start'}
                </button>
              )}
              <button 
                onClick={handleReset}
                className="px-[3vh] py-[2vh] bg-slate-900 border border-white/5 hover:bg-slate-800 active:scale-95 transition-all rounded-xl text-[1.5vh] font-black uppercase tracking-widest text-slate-500 hover:text-white"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer className="flex-shrink-0 mt-[1.5vh] text-center px-4 transition-opacity duration-1000 opacity-30">
        <p className="text-[1vh] font-bold text-slate-700 uppercase tracking-[0.3em]">
          {currentTheme.name} Palette
        </p>
      </footer>
    </div>
  );
};

export default App;
