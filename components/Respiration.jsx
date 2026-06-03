"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";

const PHASE_LABELS = ["Inspirez", "Retenez", "Expirez", "Retenez"];

const PRESETS = [
  { name: "Cohérence cardiaque", durations: [5, 0, 5, 0], desc: "Inspire 5s, expire 5s" },
  { name: "Respiration 4-7-8", durations: [4, 7, 8, 0], desc: "Endormissement, anxiété" },
  { name: "Box breathing", durations: [4, 4, 4, 4], desc: "Concentration, calme" },
  { name: "Respiration profonde", durations: [4, 2, 6, 2], desc: "Détente, expire allongée" },
];

function nextPhaseIdx(durations, current) {
  for (let i = 1; i <= 4; i++) {
    const idx = (current + i) % 4;
    if (durations[idx] > 0) return idx;
  }
  return current;
}

async function loadPrograms(userId) {
  if (!userId) return [];
  const { data, error } = await supabase.from("respiration_programs").select("data").eq("user_id", userId).maybeSingle();
  if (error) console.error("Load error:", error);
  return data?.data || [];
}

async function savePrograms(userId, programs) {
  if (!userId) return;
  const { error } = await supabase.from("respiration_programs").upsert({ user_id: userId, data: programs }, { onConflict: "user_id" });
  if (error) console.error("Save error:", error);
}

function useBreathingAudio(enabled, paused) {
  const nodesRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") ctx.resume();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc1 = ctx.createOscillator();
    osc1.type = "sine"; osc1.frequency.value = 174; osc1.connect(gain);
    const osc2 = ctx.createOscillator();
    osc2.type = "sine"; osc2.frequency.value = 175; osc2.connect(gain);
    osc1.start(); osc2.start();
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 2);
    nodesRef.current = { ctx, gain, osc1, osc2 };
    return () => {
      try {
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
        setTimeout(() => { osc1.stop(); osc2.stop(); ctx.close(); }, 1200);
      } catch (e) {}
      nodesRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const nodes = nodesRef.current;
    if (!nodes) return;
    try {
      if (paused) nodes.ctx.suspend();
      else nodes.ctx.resume();
    } catch (e) {}
  }, [paused]);
}

function useWakeLock() {
  useEffect(() => {
    let wakeLock = null;
    let released = false;
    const request = async () => {
      try {
        if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
      } catch (e) {}
    };
    const handleVisibility = () => {
      if (!released && document.visibilityState === "visible") request();
    };
    request();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} }
    };
  }, []);
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function ActiveSession({ durations, totalSeconds, targetCycles, primaryMode, withSound, visualMode, onStop }) {
  const initialPhase = durations[0] > 0 ? 0 : nextPhaseIdx(durations, 0);
  const [phase, setPhase] = useState(initialPhase);
  const [phaseTime, setPhaseTime] = useState(durations[initialPhase]);
  const [elapsed, setElapsed] = useState(0);
  const [cycles, setCycles] = useState(0);
  const [started, setStarted] = useState(false);
  const [paused, setPaused] = useState(false);

  const dotRef = useRef(null);
  const haloRef = useRef(null);
  const sphereRef = useRef(null);
  const sphereHaloRef = useRef(null);
  const phaseStartRef = useRef(Date.now());
  const pauseStartRef = useRef(null);

  const frozen = !started || paused;

  useBreathingAudio(withSound && started, paused);
  useWakeLock();

  useEffect(() => {
    if (frozen) return;
    const interval = setInterval(() => {
      setPhaseTime(prev => {
        if (prev <= 1) {
          setPhase(currentPhase => {
            const next = nextPhaseIdx(durations, currentPhase);
            if (next <= currentPhase) setCycles(c => c + 1);
            setPhaseTime(durations[next]);
            phaseStartRef.current = Date.now();
            return next;
          });
          return 0;
        }
        return prev - 1;
      });
      setElapsed(e => e + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [durations, frozen]);

  useEffect(() => {
    if (!started) return;
    if (primaryMode === "time" && elapsed >= totalSeconds) onStop("complete");
    if (primaryMode === "cycles" && cycles >= targetCycles) onStop("complete");
  }, [elapsed, cycles, totalSeconds, targetCycles, primaryMode, started, onStop]);

  const handlePlay = () => {
    phaseStartRef.current = Date.now();
    setStarted(true);
    setPaused(false);
  };

  const togglePause = () => {
    setPaused(p => {
      if (p) {
        if (pauseStartRef.current) {
          phaseStartRef.current += (Date.now() - pauseStartRef.current);
          pauseStartRef.current = null;
        }
        return false;
      } else {
        pauseStartRef.current = Date.now();
        return true;
      }
    });
  };

  const MIN_SCALE = 0.42, MAX_SCALE = 1;
  const W = 600, H = 240, pad = 30;
  const total = durations.reduce((a, b) => a + b, 0);
  const baseY = H - pad, topY = pad;
  const usableW = W - 2 * pad;
  const x0 = pad;
  const x1 = pad + (durations[0] / total) * usableW;
  const x2 = pad + ((durations[0] + durations[1]) / total) * usableW;
  const x3 = pad + ((durations[0] + durations[1] + durations[2]) / total) * usableW;
  const x4 = pad + usableW;
  const pathD = `M ${x0} ${baseY} L ${x1} ${topY} L ${x2} ${topY} L ${x3} ${baseY} L ${x4} ${baseY}`;

  useEffect(() => {
    if (frozen) return;
    const psX = [x0, x1, x2, x3];
    const psY = [baseY, topY, topY, baseY];
    const peX = [x1, x2, x3, x4];
    const peY = [topY, topY, baseY, baseY];
    let rafId;
    const animate = () => {
      const phaseDurMs = durations[phase] * 1000;
      const phaseElapsedMs = Date.now() - phaseStartRef.current;
      const progress = phaseDurMs > 0 ? Math.min(phaseElapsedMs / phaseDurMs, 1) : 1;
      let scale;
      if (phase === 0) scale = MIN_SCALE + progress * (MAX_SCALE - MIN_SCALE);
      else if (phase === 1) scale = MAX_SCALE;
      else if (phase === 2) scale = MAX_SCALE - progress * (MAX_SCALE - MIN_SCALE);
      else scale = MIN_SCALE;
      if (sphereRef.current) sphereRef.current.style.transform = `scale(${scale})`;
      if (sphereHaloRef.current) sphereHaloRef.current.style.transform = `scale(${scale * 1.3})`;
      const cx = psX[phase] + progress * (peX[phase] - psX[phase]);
      const cy = psY[phase] + progress * (peY[phase] - psY[phase]);
      if (dotRef.current) { dotRef.current.setAttribute("cx", cx); dotRef.current.setAttribute("cy", cy); }
      if (haloRef.current) { haloRef.current.setAttribute("cx", cx); haloRef.current.setAttribute("cy", cy); }
      rafId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(rafId);
  }, [phase, durations, frozen, x0, x1, x2, x3, x4, topY, baseY]);

  const iconBtn = "w-16 h-16 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/20 transition-all";
  const PlayIcon = () => (<svg width="26" height="26" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>);
  const PauseIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="white"><rect x="6" y="5" width="4" height="14" rx="1.5" /><rect x="14" y="5" width="4" height="14" rx="1.5" /></svg>);
  const StopIcon = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-indigo-950 to-purple-950 flex flex-col items-center justify-center z-50">
      <div className="absolute top-6 left-0 right-0 flex justify-center gap-10 text-white tabular-nums">
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">Temps</div>
          <div className="text-lg font-light">{formatTime(elapsed)} <span className="text-white/40">/ {formatTime(totalSeconds)}</span></div>
        </div>
        <div className="text-center">
          <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">Cycles</div>
          <div className="text-lg font-light">{cycles} <span className="text-white/40">/ {targetCycles}</span></div>
        </div>
      </div>

      <div style={{ opacity: frozen ? 0.4 : 1, transition: "opacity 0.3s" }}>
        {visualMode === "sphere" ? (
          <div className="relative flex items-center justify-center" style={{ width: 320, height: 320 }}>
            <div ref={sphereHaloRef} className="absolute rounded-full bg-gradient-to-br from-indigo-400/30 to-purple-500/30 blur-2xl"
              style={{ width: "100%", height: "100%", transform: `scale(${MIN_SCALE * 1.3})` }} />
            <div ref={sphereRef} className="rounded-full bg-gradient-to-br from-indigo-400 via-purple-500 to-pink-500"
              style={{ width: "100%", height: "100%", transform: `scale(${MIN_SCALE})`, boxShadow: "0 0 80px rgba(139, 92, 246, 0.5)" }} />
            <div className="absolute text-center text-white pointer-events-none" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}>
              <div className="text-[11px] uppercase tracking-[0.35em] text-white/70 font-light mb-3">{started ? PHASE_LABELS[phase] : "Prêt ?"}</div>
              <div className="text-7xl font-extralight tabular-nums leading-none">{phaseTime}</div>
            </div>
          </div>
        ) : (
          <div className="w-full max-w-2xl px-6 flex flex-col items-center">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ filter: "drop-shadow(0 0 20px rgba(139, 92, 246, 0.3))" }}>
              <path d={pathD} stroke="rgba(255,255,255,0.15)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4" />
              <path d={pathD} stroke="url(#gradient)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#818cf8" />
                  <stop offset="50%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#f472b6" />
                </linearGradient>
              </defs>
              <circle ref={haloRef} cx={x0} cy={baseY} r="18" fill="white" opacity="0.25" />
              <circle ref={dotRef} cx={x0} cy={baseY} r="9" fill="white" />
            </svg>
            <div className="mt-12 text-center text-white">
              <div className="text-[11px] uppercase tracking-[0.35em] text-white/70 font-light mb-3">{started ? PHASE_LABELS[phase] : "Prêt ?"}</div>
              <div className="text-7xl font-extralight tabular-nums leading-none">{phaseTime}</div>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-12 left-0 right-0 flex justify-center items-center gap-5">
        {!started ? (
          <button onClick={handlePlay} className={`${iconBtn} w-20 h-20 bg-white/20 hover:bg-white/30`} aria-label="Démarrer">
            <PlayIcon />
          </button>
        ) : (
          <>
            <button onClick={togglePause} className={`${iconBtn} bg-white/15 hover:bg-white/25`} aria-label={paused ? "Reprendre" : "Pause"}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button onClick={() => onStop("manual")} className={`${iconBtn} bg-white/10 hover:bg-red-500/40`} aria-label="Arrêter">
              <StopIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Slider({ label, value, onChange, max = 60 }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="text-slate-700 font-medium">{label}</span>
        <span className="text-indigo-600 font-bold tabular-nums">{value}s</span>
      </div>
      <input type="range" min={0} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500" />
    </div>
  );
}

export default function Respiration() {
  const { user, userId, signOut, loading: authLoading } = useAuth();
  const [durations, setDurations] = useState([5, 0, 5, 0]);
  const [endMode, setEndMode] = useState("time");
  const [endValue, setEndValue] = useState(5);
  const [withSound, setWithSound] = useState(true);
  const [visualMode, setVisualMode] = useState("courbe");
  const [running, setRunning] = useState(false);
  const [endScreen, setEndScreen] = useState(null);

  const [savedPrograms, setSavedPrograms] = useState([]);
  const [showPrograms, setShowPrograms] = useState(false);
  const [newName, setNewName] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (user && userId) loadPrograms(userId).then(setSavedPrograms);
    else setSavedPrograms([]);
  }, [user, userId]);

  const cycleDuration = durations.reduce((a, b) => a + b, 0);
  const validProgram = cycleDuration > 0 && (durations[0] > 0 || durations[2] > 0);

  const saveCurrentProgram = async () => {
    if (!newName.trim()) return setSaveErr("Donne un nom au programme.");
    if (!validProgram) return setSaveErr("Le cycle doit avoir une inspiration ou expiration.");
    const program = { id: Date.now(), name: newName.trim(), durations: [...durations] };
    const updated = [program, ...savedPrograms];
    setSavedPrograms(updated);
    await savePrograms(userId, updated);
    setNewName("");
    setSaveErr("");
  };

  const loadProgram = (program) => {
    setDurations([...program.durations]);
    setShowPrograms(false);
  };

  const deleteProgram = async (id) => {
    const updated = savedPrograms.filter(p => p.id !== id);
    setSavedPrograms(updated);
    await savePrograms(userId, updated);
    setConfirmDelete(null);
  };

  const start = () => {
    if (!validProgram) return;
    setEndScreen(null);
    setRunning(true);
  };

  const stop = (reason) => {
    setRunning(false);
    setEndScreen(reason);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Chargement…</div>
      </div>
    );
  }

  if (running) {
    const sessionTotalSeconds = endMode === "time" ? endValue * 60 : endValue * cycleDuration;
    const sessionTargetCycles = endMode === "cycles" ? endValue : Math.max(1, Math.round((endValue * 60) / cycleDuration));
    return (
      <ActiveSession
        durations={durations}
        totalSeconds={sessionTotalSeconds}
        targetCycles={sessionTargetCycles}
        primaryMode={endMode}
        withSound={withSound}
        visualMode={visualMode}
        onStop={stop}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-4">
      <div className="max-w-2xl mx-auto py-8 space-y-6">
        <div className="flex justify-between items-center text-xs">
          <Link href="/" className="text-slate-400 hover:underline">← perf360.fr</Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-slate-500">{user.email}</span>
                <button onClick={signOut} className="text-indigo-500 hover:underline">Déconnexion</button>
              </>
            ) : (
              <Link href="/connexion?next=/respiration" className="text-indigo-500 hover:underline font-medium">Se connecter</Link>
            )}
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-800">🫁 Respiration</h1>
          <p className="text-slate-500 text-sm mt-1">Guidez votre souffle, apaisez votre esprit</p>
        </div>

        {endScreen === "complete" && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
            <div className="text-3xl mb-2">✨</div>
            <p className="font-semibold text-green-800">Séance terminée. Bravo !</p>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-semibold text-slate-700">Programmes pré-enregistrés</h2>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map(p => (
              <button key={p.name} onClick={() => setDurations(p.durations)}
                className={`text-left border rounded-xl p-3 transition-all hover:border-indigo-300 ${
                  JSON.stringify(durations) === JSON.stringify(p.durations) ? "border-indigo-500 bg-indigo-50" : "border-slate-200"
                }`}>
                <div className="font-semibold text-sm text-slate-800">{p.name}</div>
                <div className="text-xs text-slate-500 mt-1">{p.desc}</div>
                <div className="text-xs text-indigo-600 mt-2 font-medium tabular-nums">{p.durations.join(" — ")}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <button onClick={() => setShowPrograms(!showPrograms)} className="w-full flex justify-between items-center">
            <h2 className="font-semibold text-slate-700">Mes programmes {user && savedPrograms.length > 0 && <span className="text-indigo-500">({savedPrograms.length})</span>}</h2>
            <span className="text-slate-400 text-sm">{showPrograms ? "▲" : "▼"}</span>
          </button>
          {showPrograms && (
            <div className="space-y-4 pt-2">
              {!user ? (
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-sm text-slate-600 space-y-2">
                  <p className="font-semibold text-slate-800">💡 Connectez-vous pour enregistrer vos programmes</p>
                  <p>Vous pourrez sauvegarder vos cycles personnalisés et les retrouver depuis n'importe quel appareil. Connexion par lien email, sans mot de passe.</p>
                  <Link href="/connexion?next=/respiration" className="inline-block bg-indigo-500 hover:bg-indigo-600 text-white font-semibold px-4 py-2 rounded-lg transition-colors mt-1">
                    Se connecter
                  </Link>
                </div>
              ) : savedPrograms.length === 0 ? (
                <p className="text-sm text-slate-400">Aucun programme enregistré pour l'instant.</p>
              ) : (
                <div className="space-y-2">
                  {savedPrograms.map(p => (
                    <div key={p.id} className="flex items-center justify-between border border-slate-200 rounded-xl px-3 py-2">
                      <div>
                        <div className="text-sm font-medium text-slate-800">{p.name}</div>
                        <div className="text-xs text-indigo-600 tabular-nums">{p.durations.join(" — ")}</div>
                      </div>
                      {confirmDelete === p.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Supprimer ?</span>
                          <button onClick={() => deleteProgram(p.id)} className="text-xs text-white bg-red-500 hover:bg-red-600 px-2 py-1 rounded-md font-medium">Oui</button>
                          <button onClick={() => setConfirmDelete(null)} className="text-xs text-slate-500 border px-2 py-1 rounded-md">Non</button>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          <button onClick={() => loadProgram(p)} className="text-xs text-indigo-500 hover:underline font-medium">Charger</button>
                          <button onClick={() => setConfirmDelete(p.id)} className="text-xs text-slate-400 hover:text-red-400">Supprimer</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {user && (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <p className="text-xs text-slate-500">Enregistrer le cycle courant ({durations.join(" — ")}) :</p>
                  <div className="flex gap-2">
                    <input value={newName} onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveCurrentProgram()}
                      placeholder="Nom du programme"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    <button onClick={saveCurrentProgram} className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                      Enregistrer
                    </button>
                  </div>
                  {saveErr && <p className="text-red-500 text-xs">{saveErr}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-4">
          <h2 className="font-semibold text-slate-700">Cycle personnalisé</h2>
          <Slider label="Inspiration" value={durations[0]} onChange={v => setDurations([v, durations[1], durations[2], durations[3]])} />
          <Slider label="Pause après inspiration" value={durations[1]} onChange={v => setDurations([durations[0], v, durations[2], durations[3]])} />
          <Slider label="Expiration" value={durations[2]} onChange={v => setDurations([durations[0], durations[1], v, durations[3]])} />
          <Slider label="Pause après expiration" value={durations[3]} onChange={v => setDurations([durations[0], durations[1], durations[2], v])} />
          <div className="text-xs text-slate-400 text-center pt-2">Cycle total : {cycleDuration}s</div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-semibold text-slate-700">Durée de la séance</h2>
          <div className="flex gap-2">
            <button onClick={() => setEndMode("time")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${endMode === "time" ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600"}`}>Temps</button>
            <button onClick={() => setEndMode("cycles")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${endMode === "cycles" ? "bg-indigo-500 text-white" : "bg-slate-100 text-slate-600"}`}>Cycles</button>
          </div>
          <div className="flex items-center gap-3">
            <input type="number" min={1} value={endValue} onChange={e => setEndValue(Number(e.target.value))}
              className="w-24 border rounded-lg px-3 py-2 text-center font-bold text-indigo-600" />
            <span className="text-sm text-slate-500">{endMode === "time" ? "minutes" : "cycles"}</span>
            {cycleDuration > 0 && endValue > 0 && (
              <span className="text-xs text-slate-400 italic ml-auto">
                {endMode === "time"
                  ? `≈ ${Math.round((endValue * 60) / cycleDuration)} cycles`
                  : (() => {
                      const totalSec = endValue * cycleDuration;
                      const m = Math.floor(totalSec / 60);
                      const s = totalSec % 60;
                      return `≈ ${m > 0 ? `${m} min ` : ""}${s > 0 ? `${s} s` : ""}`.trim();
                    })()}
              </span>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 space-y-3">
          <h2 className="font-semibold text-slate-700">Visualisation</h2>
          <div className="flex gap-2">
            <button onClick={() => setVisualMode("courbe")}
              className={`flex-1 py-3 rounded-lg text-sm font-medium border-2 ${visualMode === "courbe" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>
              <div className="text-xl">〰️</div><div className="text-xs mt-1">Courbe</div>
            </button>
            <button onClick={() => setVisualMode("sphere")}
              className={`flex-1 py-3 rounded-lg text-sm font-medium border-2 ${visualMode === "sphere" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500"}`}>
              <div className="text-xl">🔮</div><div className="text-xs mt-1">Sphère</div>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow p-5 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-slate-700">Son d'accompagnement</h2>
            <p className="text-xs text-slate-400">Drone doux pour guider la respiration</p>
          </div>
          <button onClick={() => setWithSound(!withSound)}
            className={`relative w-12 h-6 rounded-full transition-colors ${withSound ? "bg-indigo-500" : "bg-slate-300"}`}>
            <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${withSound ? "translate-x-6" : "translate-x-0.5"}`} />
          </button>
        </div>

        <button onClick={start} disabled={!validProgram}
          className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:opacity-90 disabled:opacity-40 text-white py-4 rounded-2xl font-semibold text-lg shadow-lg">
          ▶ Démarrer la séance
        </button>
      </div>
    </div>
  );
}
