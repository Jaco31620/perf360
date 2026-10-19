"use client";
/*
 * Clic-Clac — studio de prise de vue (invités et borne) :
 * caméra (avant/arrière) → compte à rebours → photo seule ou bande de 4 →
 * choix filtre / cadre / légende (selon les réglages de l'album) → envoi.
 * Repli si la caméra est indisponible : appareil photo du téléphone (input file).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FRAMES, FILTERS, MAX_CAPTION } from "@/lib/clicclac/settings";
import { applyFilter, applyFrame, composeStrip, exportForUpload, imageToCanvas, loadImage, scaled, makeCanvas } from "./imaging";
import { api } from "./client";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Options proposées selon le mode de l'album. */
function options(mode, enabled, imposed, all) {
  if (mode === "off") return { list: [], value: "none" };
  if (mode === "imposed") return { list: [], value: imposed };
  return { list: all.filter((x) => enabled.includes(x.id)), value: enabled[0] || "none" };
}

export default function Studio({ album, code, booth = false, token, guest, onDone, onClose }) {
  const s = album.settings;
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [facing, setFacing] = useState(booth ? "user" : "environment");
  const [camError, setCamError] = useState("");
  const [mode, setMode] = useState("photo"); // photo | strip
  const [count, setCount] = useState(0); // compte à rebours affiché
  const [flash, setFlash] = useState(false);
  const [shots, setShots] = useState(null); // canvases capturés
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const frameOpt = options(s.framesMode, s.frames.filter((f) => f !== "custom" || s.hasCustomFrame), s.imposedFrame, FRAMES);
  const filterOpt = options(s.filtersMode, s.filters, s.imposedFilter, FILTERS);
  const [frame, setFrame] = useState(frameOpt.value);
  const [filter, setFilter] = useState(filterOpt.value);
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState(null);
  const [customImg, setCustomImg] = useState(null);

  useEffect(() => {
    if (album.customFrameUrl) loadImage(album.customFrameUrl).then(setCustomImg).catch(() => {});
  }, [album.customFrameUrl]);

  /* ── caméra ── */
  const stop = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  useEffect(() => {
    if (shots) return undefined;
    let cancelled = false;
    (async () => {
      setCamError("");
      try {
        stop();
        const big = s.keepHd ? { width: { ideal: 3840 }, height: { ideal: 2160 } } : { width: { ideal: 1920 }, height: { ideal: 1440 } };
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, ...big }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
      } catch (e) {
        setCamError("Caméra indisponible ici : utilisez l'appareil photo du téléphone.");
      }
    })();
    return () => { cancelled = true; };
  }, [facing, shots, s.keepHd]);
  useEffect(() => () => stop(), []);

  const grab = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = makeCanvas(v.videoWidth, v.videoHeight);
    const ctx = c.getContext("2d");
    if (facing === "user") { ctx.translate(c.width, 0); ctx.scale(-1, 1); } // effet miroir, comme l'aperçu
    ctx.drawImage(v, 0, 0);
    return c;
  };

  const countdown = async (n) => {
    for (let i = n; i > 0; i--) { setCount(i); await sleep(900); }
    setCount(0);
    setFlash(true); setTimeout(() => setFlash(false), 220);
  };

  const shoot = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const taken = [];
      const n = mode === "strip" ? 4 : 1;
      for (let i = 0; i < n; i++) {
        await countdown(booth || mode === "strip" ? 3 : 0);
        const c = grab();
        if (!c) throw new Error("Caméra pas encore prête.");
        taken.push(c);
        if (i < n - 1) await sleep(500);
      }
      stop();
      setShots(taken);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fromFile = async (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      stop();
      setMode("photo");
      setShots([imageToCanvas(img, s.keepHd ? 3200 : 2000)]);
    } catch (e) {
      setError("Image illisible.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /* ── rendu final (filtre + cadre / bande) ── */
  const render = useCallback((maxSide) => {
    if (!shots) return null;
    const info = { title: album.name, date: album.eventDate, customImg };
    const filtered = shots.map((c) => applyFilter(scaled(c, maxSide), filter));
    return shots.length > 1 ? composeStrip(filtered, info) : applyFrame(filtered[0], frame, info);
  }, [shots, filter, frame, customImg, album.name, album.eventDate]);

  useEffect(() => {
    if (!shots) { setPreview(null); return; }
    const c = render(900);
    setPreview(c.toDataURL("image/jpeg", 0.8));
  }, [shots, render]);

  const retake = () => { setShots(null); setCaption(""); setError(""); };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const final = render(s.keepHd ? 3200 : 1700);
      const { full, thumb, hd } = await exportForUpload(final, { keepHd: s.keepHd });
      const form = new FormData();
      form.append("full", full, "photo.jpg");
      form.append("thumb", thumb, "thumb.jpg");
      if (hd) form.append("hd", hd, "hd.jpg");
      if (guest?.id) form.append("guestId", guest.id);
      if (guest?.name) form.append("guestName", guest.name);
      if (caption.trim()) form.append("caption", caption.trim());
      form.append("kind", shots.length > 1 ? "strip" : "photo");
      const res = await api(`/${code}/photos`, { method: "POST", token, form });
      onDone?.({ ...res, preview });
      retake();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const chip = (active) => `shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors ${active ? "bg-white text-gray-900 border-white" : "bg-white/10 text-white border-white/20 hover:bg-white/20"}`;

  return (
    <div className="fixed inset-0 z-40 bg-black text-white flex flex-col">
      {/* barre du haut */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        {onClose ? <button onClick={() => { stop(); onClose(); }} className="text-white/80 hover:text-white text-lg">✕ Fermer</button> : <span />}
        <span className="font-bold truncate px-3">{album.name}</span>
        {!shots && !camError
          ? <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} className="text-white/80 hover:text-white text-sm">🔄 Caméra</button>
          : <span />}
      </div>

      {!shots ? (
        <>
          <div className="relative flex-1 min-h-0 flex items-center justify-center bg-black">
            {camError ? (
              <div className="text-center px-6 space-y-4">
                <p className="text-white/80">{camError}</p>
                <button onClick={() => fileRef.current?.click()} className="bg-white text-gray-900 font-bold px-6 py-3 rounded-full">📷 Prendre une photo</button>
              </div>
            ) : (
              <video ref={videoRef} playsInline muted autoPlay
                className="max-w-full max-h-full object-contain" style={{ transform: facing === "user" ? "scaleX(-1)" : "none" }} />
            )}
            {count > 0 && <div className="absolute inset-0 flex items-center justify-center text-[30vmin] font-black drop-shadow-2xl">{count}</div>}
            {flash && <div className="absolute inset-0 bg-white" />}
          </div>
          <div className="shrink-0 px-4 py-5 flex flex-col items-center gap-4">
            {s.stripEnabled && !camError && (
              <div className="flex gap-2">
                <button onClick={() => setMode("photo")} className={chip(mode === "photo")}>📷 Photo</button>
                <button onClick={() => setMode("strip")} className={chip(mode === "strip")}>🎞️ Bande ×4</button>
              </div>
            )}
            {!camError && (
              <button onClick={shoot} disabled={busy} aria-label="Prendre la photo"
                className={`rounded-full bg-white border-[6px] border-white/40 disabled:opacity-50 active:scale-95 transition-transform ${booth ? "w-28 h-28" : "w-20 h-20"}`} />
            )}
            {!camError && !booth && (
              <button onClick={() => fileRef.current?.click()} className="text-white/60 text-xs underline">ou utiliser l'appareil photo du téléphone</button>
            )}
            {error && <p className="text-red-300 text-sm">{error}</p>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture={facing === "user" ? "user" : "environment"} className="hidden"
            onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ""; }} />
        </>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex items-center justify-center p-3">
            {preview && <img src={preview} alt="Aperçu" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />}
          </div>
          <div className="shrink-0 px-4 pb-5 space-y-3">
            {filterOpt.list.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {filterOpt.list.map((f) => <button key={f.id} onClick={() => setFilter(f.id)} className={chip(filter === f.id)}>{f.label}</button>)}
              </div>
            )}
            {shots.length === 1 && frameOpt.list.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {frameOpt.list.map((f) => <button key={f.id} onClick={() => setFrame(f.id)} className={chip(frame === f.id)}>{f.label}</button>)}
              </div>
            )}
            <input value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={MAX_CAPTION} placeholder="Légende (facultatif)"
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-white placeholder-white/40 outline-none focus:border-white/60" />
            {error && <p className="text-red-300 text-sm text-center">{error}</p>}
            <div className="flex gap-3">
              <button onClick={retake} disabled={busy} className="flex-1 bg-white/10 border border-white/20 font-bold py-3.5 rounded-full disabled:opacity-40">↺ Refaire</button>
              <button onClick={save} disabled={busy} className="flex-[2] bg-[#ff5a5f] font-bold py-3.5 rounded-full disabled:opacity-60">
                {busy ? "Envoi…" : "✓ Garder"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
