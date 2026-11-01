"use client";
/*
 * Jukebox — « Connecter une télé » (télécommande, régie) : scan du QR code
 * affiché par perf360.fr/tv avec l'appareil photo (BarcodeDetector du
 * navigateur, sinon jsQR), ou saisie du code télé affiché sous le QR. La télé
 * ouvre l'écran de la soirée, en affichage seul ou en mode son (elle joue la
 * musique ; le jeton régie lui est transmis).
 */
import { useEffect, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { getAdminToken } from "./storage";

const pairFrom = (text) => {
  const s = String(text || "").trim().toLowerCase();
  const m = s.match(/\/tv\/([a-z0-9]{8,16})/) || s.replace(/[\s-]/g, "").match(/^([a-z0-9]{8,16})$/);
  return m ? m[1] : null;
};

// beat : marque du lecteur « télé » qui joue le son (tvBeat) — en mode son,
// la fenêtre se ferme d'elle-même dès qu'une télé a (re)pris le son.
export const tvBeat = (pb) => (pb?.player?.kind === "tv" ? `${pb.player.id}:${pb.player.since}` : null);

export default function TvLink({ code, onClose, defaultSound = true, beat = null }) {
  const [sound, setSound] = useState(defaultSound);
  const [typed, setTyped] = useState("");
  const [camera, setCamera] = useState("off"); // off | on | denied | none
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { sound }
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState(null); // zoom optique de l'appareil photo : { min, max } ; null → zoom numérique
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const video = useRef(null);
  const stream = useRef(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const sent = useRef(false);
  const beatRef = useRef(beat);
  beatRef.current = beat;
  const [slow, setSlow] = useState(false); // la télé tarde : on rappelle d'appuyer sur OK

  // mode son : la télé a pris le son (nouveau lecteur « tv ») → fermeture
  useEffect(() => {
    if (done?.sound && beat && beat !== done.beat) onClose();
  }, [done, beat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!done?.sound) return;
    const t = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(t);
  }, [done]);

  const send = async (pair) => {
    if (sent.current) return;
    sent.current = true;
    setBusy(true);
    setError("");
    const withSound = soundRef.current;
    try {
      const res = await fetch("/api/jukebox/tv", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pair, code, ...(withSound ? { token: getAdminToken(code) } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Connexion impossible.");
      stop();
      setDone({ sound: withSound, beat: beatRef.current });
    } catch (e) {
      setError(e.message);
      sent.current = false;
    } finally { setBusy(false); }
  };

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera((c) => (c === "on" ? "off" : c));
  };

  const startCamera = async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) return setCamera("none");
    try {
      // pleine résolution : le QR code de la télé reste lisible de loin
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      const caps = stream.current.getVideoTracks()[0]?.getCapabilities?.() || {};
      setZoomRange(caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: Math.min(caps.zoom.max, 8) } : null);
      setZoom(1);
      setCamera("on");
    } catch (e) {
      setCamera("denied");
    }
  };

  // lecture des images de la caméra jusqu'à trouver un QR code perf360.fr/tv
  useEffect(() => {
    if (camera !== "on" || !video.current) return;
    const v = video.current;
    v.srcObject = stream.current;
    v.play().catch(() => {});
    let stopped = false;
    let detector = null;
    if ("BarcodeDetector" in window) {
      try { detector = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
    }
    const canvas = document.createElement("canvas");
    let jsQR = null;
    const scan = async () => {
      if (stopped) return;
      if (v.readyState >= 2) {
        try {
          let text = null;
          // zoom numérique : on ne lit que le centre de l'image, agrandi
          const z = optical.current ? 1 : zoomRef.current;
          const sw = v.videoWidth / z, sh = v.videoHeight / z;
          const sx = (v.videoWidth - sw) / 2, sy = (v.videoHeight - sh) / 2;
          if (detector && z === 1) text = (await detector.detect(v))[0]?.rawValue;
          if (!text) {
            const scale = Math.min(z, 1600 / sw);
            canvas.width = Math.round(sw * scale);
            canvas.height = Math.round(sh * scale);
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            if (detector) text = (await detector.detect(canvas))[0]?.rawValue;
            else {
              jsQR ||= (await import("jsqr")).default;
              text = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
            }
          }
          const pair = pairFrom(text);
          if (pair) {
            await send(pair);
            if (!sent.current && !stopped) setTimeout(scan, 1000); // envoi raté : on continue de scanner
            return;
          }
        } catch (e) { /* image illisible : on continue */ }
      }
      setTimeout(scan, 250);
    };
    scan();
    return () => { stopped = true; };
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  // zoom optique quand l'appareil le permet (Android), sinon numérique
  const optical = useRef(false);
  optical.current = !!zoomRange;
  useEffect(() => {
    if (camera !== "on" || !zoomRange) return;
    const track = stream.current?.getVideoTracks()[0];
    const value = Math.min(zoomRange.max, Math.max(zoomRange.min, zoom));
    track?.applyConstraints({ advanced: [{ zoom: value }] }).catch(() => {});
  }, [zoom, zoomRange, camera]);
  const zoomMax = zoomRange ? zoomRange.max : 4;
  // pincer pour zoomer (deux doigts sur l'image)
  const pinch = useRef(null);
  const fingers = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  const onTouchStart = (e) => { if (e.touches.length === 2) pinch.current = { d: fingers(e), z: zoomRef.current }; };
  const onTouchMove = (e) => {
    if (e.touches.length !== 2 || !pinch.current) return;
    const z = Math.min(zoomMax, Math.max(1, pinch.current.z * fingers(e) / pinch.current.d));
    setZoom(Math.round(z * 10) / 10);
  };
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinch.current = null; };

  const close = () => { stop(); onClose(); };
  const choice = (on, label, hint) => (
    <button type="button" onClick={() => setSound(on)}
      className={`flex-1 text-left rounded-2xl px-3 py-2 ring-2 ${sound === on ? "bg-fuchsia-600/30 ring-fuchsia-400" : "bg-white/5 ring-transparent"}`}>
      <span className="block font-bold text-sm">{label}</span>
      <span className="block text-xs text-white/50">{hint}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-3" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-gray-900 text-white rounded-3xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <p className="flex-1 font-bold text-lg">📺 Connecter une télé</p>
          <button onClick={close} className="text-white/50 hover:text-white" aria-label="Fermer"><X size={20} /></button>
        </div>
        {done ? (
          <div className="space-y-3">
            <p className="text-green-300 bg-green-500/10 rounded-2xl px-4 py-3 font-semibold">
              {done.sound ? "✓ Connexion… la télé ouvre la soirée." : "✓ La télé ouvre la soirée dans quelques secondes."}
            </p>
            {done.sound && (slow ? (
              <p className="text-sm text-white/70">Toujours rien ? Si la télé affiche « Lancer la musique », appuyez sur <b>OK</b> avec sa télécommande.</p>
            ) : (
              <p className="text-sm text-white/50">Cette fenêtre se fermera dès que la télé sera prête.</p>
            ))}
            <button onClick={close} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">Fermer</button>
          </div>
        ) : (
          <>
            <p className="text-sm text-white/60">Sur la télé, ouvrez <b className="text-white">perf360.fr/tv</b> dans son navigateur, puis scannez le QR code affiché.</p>
            <div className="flex gap-2">
              {choice(true, "🔊 Affichage + son", "La télé joue la musique")}
              {choice(false, "📺 Affichage seul", "Le son reste sur la régie")}
            </div>
            {camera === "on" ? (
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-square touch-none"
                onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
                <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover"
                  style={!zoomRange && zoom > 1 ? { transform: `scale(${zoom})` } : undefined} />
                <div className="absolute inset-[15%] border-4 border-white/70 rounded-2xl pointer-events-none" />
                {/* zoom bien visible, sur l'image : boutons + pincement */}
                <div className="absolute top-2 inset-x-2 flex items-center gap-1.5 rounded-full bg-black/60 backdrop-blur p-1">
                  <ZoomIn size={18} className="shrink-0 ml-1.5 text-white" />
                  {[1, 2, 3, 4].filter((z) => z <= zoomMax).map((z) => (
                    <button key={z} type="button" onClick={() => setZoom(z)}
                      className={`flex-1 rounded-full py-1.5 text-sm font-bold ${Math.round(zoom) === z ? "bg-fuchsia-600 text-white" : "text-white/85 hover:bg-white/15"}`}>×{z}</button>
                  ))}
                </div>
                <p className="absolute bottom-2 inset-x-0 text-center text-xs text-white/90 drop-shadow">
                  {busy ? "Connexion…" : <>Visez le QR code de la télé · <b>trop loin ? zoomez</b> (boutons ou 2 doigts){zoom > 1 && !Number.isInteger(zoom) ? ` · ×${zoom}` : ""}</>}
                </p>
              </div>
            ) : (
              <button onClick={startCamera} className="w-full font-bold bg-fuchsia-600 hover:bg-fuchsia-700 rounded-full py-3">📷 Scanner le QR code de la télé</button>
            )}
            {camera === "denied" && <p className="text-xs text-amber-300">Accès à l'appareil photo refusé : autorisez-le dans le navigateur, ou saisissez le code télé ci-dessous.</p>}
            {camera === "none" && <p className="text-xs text-amber-300">Pas d'appareil photo disponible ici : saisissez le code télé ci-dessous.</p>}
            <form onSubmit={(e) => { e.preventDefault(); const p = pairFrom(typed); if (p) send(p); else setError("Code télé incomplet."); }} className="flex gap-2">
              <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="Code télé (sous le QR)" autoComplete="off"
                className="flex-1 min-w-0 bg-gray-950 border border-white/15 rounded-full px-4 py-2 font-mono tracking-widest focus:border-fuchsia-500 outline-none" />
              <button disabled={busy || !typed.trim()} className="shrink-0 font-bold bg-white/10 hover:bg-white/20 disabled:opacity-40 rounded-full px-4">OK</button>
            </form>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
