"use client";
/*
 * Régie (ordinateur branché sur l'enceinte et la TV) : joue la vidéo karaoké
 * et publie l'état de lecture pour les téléphones — toutes les secondes
 * pendant la lecture et immédiatement sur lecture, pause, saut, fin.
 * `at` est l'heure (horloge serveur) au moment exact où la position est lue.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { startClock } from "./clock";
import QrWelcome from "./QrWelcome";

const SHIFT_MIN = -0.6, SHIFT_MAX = 0.6, SHIFT_STEP = 0.05;

function readLS(k, d) {
  try { return localStorage.getItem(k) ?? d; } catch (e) { return d; }
}
function writeLS(k, v) {
  try { localStorage.setItem(k, v); } catch (e) { /* ignoré */ }
}

export default function Regie() {
  const [key, setKey] = useState(null);
  const [draftKey, setDraftKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [shift, setShift] = useState(0);
  const [phones, setPhones] = useState(0);
  const [pub, setPub] = useState({ ok: null, text: "Rien publié" });
  const [barVisible, setBarVisible] = useState(true);
  const [time, setTime] = useState(0);
  const [welcome, setWelcome] = useState(true); // pré-accueil QR (avant lancement)
  const videoRef = useRef(null);
  const clockRef = useRef(null);
  const shiftRef = useRef(0);
  const keyRef = useRef(null);
  const hideTimer = useRef(null);

  useEffect(() => {
    const k = readLS("l50_key", "");
    if (k) setKey(k);
    const s = parseFloat(readLS("l50_shift", "0"));
    if (Number.isFinite(s)) { setShift(s); shiftRef.current = s; }
    clockRef.current = startClock();
    return () => clockRef.current?.stop();
  }, []);
  useEffect(() => { keyRef.current = key; }, [key]);

  const publish = useCallback(async () => {
    const v = videoRef.current, clock = clockRef.current;
    if (!v || !keyRef.current || !clock) return;
    const body = {
      key: keyRef.current,
      playing: !v.paused && !v.ended,
      pos: v.currentTime,
      at: clock.now(),
      shift: shiftRef.current,
    };
    try {
      const res = await fetch("/api/laure50/state", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 403) {
        writeLS("l50_key", "");
        setKey(null);
        setKeyError("Clé régie incorrecte.");
        return;
      }
      if (!res.ok) throw new Error(d.error || `Erreur ${res.status}`);
      setPub({ ok: true, text: `Publié ${new Date().toLocaleTimeString("fr-FR")} · rév. ${d.rev}` });
    } catch (e) {
      setPub({ ok: false, text: `Échec : ${e.message}` });
    }
  }, []);

  // publication périodique pendant la lecture + nombre de téléphones
  useEffect(() => {
    if (!key) return;
    const t1 = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) publish();
    }, 1000);
    const t2 = setInterval(async () => {
      try {
        const res = await fetch("/api/laure50/state?phones=1", { cache: "no-store" });
        if (res.ok) setPhones((await res.json()).phones ?? 0);
      } catch (e) { /* ignoré */ }
    }, 2000);
    publish(); // état initial (rev > 0 → les téléphones quittent l'attente)
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [key, publish]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) v.play().catch(() => {}); else v.pause();
  }, []);
  const toStart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    setWelcome(true);
  }, []);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  }, []);
  const testPhones = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 40;
    v.play().catch(() => {});
  }, []);
  const changeShift = useCallback((val) => {
    const s = Math.round(Math.max(SHIFT_MIN, Math.min(SHIFT_MAX, val)) * 100) / 100;
    setShift(s);
    shiftRef.current = s;
    writeLS("l50_shift", String(s));
    publish();
  }, [publish]);

  // barre de contrôle masquée après 3,5 s sans mouvement
  const wake = useCallback(() => {
    setBarVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setBarVisible(false), 3500);
  }, []);
  useEffect(() => {
    wake();
    window.addEventListener("mousemove", wake);
    return () => { window.removeEventListener("mousemove", wake); clearTimeout(hideTimer.current); };
  }, [wake]);

  // raccourcis clavier
  useEffect(() => {
    const onKey = (e) => {
      if (!key || e.target.tagName === "INPUT") return;
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      else if (e.key === "Home") { e.preventDefault(); toStart(); }
      else if (e.key === "f" || e.key === "F") fullscreen();
      else if (e.key === "q" || e.key === "Q") setWelcome((w) => !w);
      else if (e.key === "ArrowLeft") changeShift(shiftRef.current - SHIFT_STEP);
      else if (e.key === "ArrowRight") changeShift(shiftRef.current + SHIFT_STEP);
      else return;
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [key, togglePlay, toStart, fullscreen, changeShift, wake]);

  if (!key) {
    return (
      <div className="l50-regie-login">
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!draftKey.trim()) return;
          writeLS("l50_key", draftKey.trim());
          setKeyError("");
          setKey(draftKey.trim());
        }}>
          <img src="/laure50/logo.png" alt="Laure 1976" />
          <h1>Régie karaoké</h1>
          <input type="password" autoFocus value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder="Clé régie" />
          {keyError && <p className="l50-error">{keyError}</p>}
          <button>Entrer</button>
        </form>
      </div>
    );
  }

  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  return (
    <div className={`l50-regie ${barVisible ? "" : "l50-nocursor"}`}>
      <video
        ref={videoRef} src="/laure50/karaoke.mp4" playsInline preload="auto"
        onPlay={() => { setPlaying(true); setWelcome(false); publish(); }}
        onPause={() => { setPlaying(false); publish(); }}
        onSeeked={publish} onEnded={() => { setPlaying(false); publish(); }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onClick={togglePlay}
      />
      {welcome && <div className="l50-welcome-layer"><QrWelcome phones={phones} big /></div>}
      <div className={`l50-bar ${barVisible ? "" : "hidden"}`}>
        <button onClick={togglePlay}>{playing ? "⏸ Pause" : "▶ Lecture"}</button>
        <button onClick={toStart}>⏮ Début</button>
        <button onClick={fullscreen}>⛶ Plein écran</button>
        <button onClick={testPhones}>📱 Test téléphones</button>
        <button onClick={() => setWelcome((w) => !w)} className={welcome ? "on" : ""}>🔳 Accueil QR</button>
        <span className="l50-time">{fmt(time)}</span>
        <label className="l50-shift">
          Décalage téléphones
          <input type="range" min={SHIFT_MIN} max={SHIFT_MAX} step={SHIFT_STEP} value={shift}
            onChange={(e) => changeShift(parseFloat(e.target.value))} />
          <b>{shift > 0 ? "+" : ""}{shift.toFixed(2)} s</b>
        </label>
        <span className="l50-phones">📱 {phones} téléphone{phones > 1 ? "s" : ""}</span>
        <span className={`l50-pub ${pub.ok === false ? "err" : ""}`}>{pub.text}</span>
      </div>
    </div>
  );
}
