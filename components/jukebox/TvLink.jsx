"use client";
/*
 * Jukebox — « Connecter une télé » (télécommande, régie) : scan du QR code
 * affiché par perf360.fr/tv avec l'appareil photo (BarcodeDetector du
 * navigateur, sinon jsQR), ou saisie du code télé affiché sous le QR. La télé
 * ouvre l'écran de la soirée, en affichage seul ou en mode son (elle joue la
 * musique ; le jeton régie lui est transmis).
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getAdminToken } from "./storage";

const pairFrom = (text) => {
  const s = String(text || "").trim().toLowerCase();
  const m = s.match(/\/tv\/([a-z0-9]{8,16})/) || s.replace(/[\s-]/g, "").match(/^([a-z0-9]{8,16})$/);
  return m ? m[1] : null;
};

export default function TvLink({ code, onClose, defaultSound = true }) {
  const [sound, setSound] = useState(defaultSound);
  const [typed, setTyped] = useState("");
  const [camera, setCamera] = useState("off"); // off | on | denied | none
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { sound }
  const video = useRef(null);
  const stream = useRef(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const sent = useRef(false);

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
      setDone({ sound: withSound });
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
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
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
          if (detector) text = (await detector.detect(v))[0]?.rawValue;
          else {
            jsQR ||= (await import("jsqr")).default;
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(v, 0, 0);
            text = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
          }
          const pair = pairFrom(text);
          if (pair) return send(pair);
        } catch (e) { /* image illisible : on continue */ }
      }
      setTimeout(scan, 250);
    };
    scan();
    return () => { stopped = true; };
  }, [camera]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

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
            <p className="text-green-300 bg-green-500/10 rounded-2xl px-4 py-3 font-semibold">✓ La télé ouvre la soirée dans quelques secondes.</p>
            {done.sound && (
              <>
                <p className="text-sm text-white/70">Appuyez sur <b>OK</b> avec la télécommande de la télé pour lancer la musique.</p>
                <p className="text-xs text-amber-300">⚠️ La télé joue la musique : ne la lancez pas aussi sur la page régie d'un ordinateur.</p>
              </>
            )}
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
              <div className="relative rounded-2xl overflow-hidden bg-black aspect-square">
                <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-[15%] border-4 border-white/70 rounded-2xl pointer-events-none" />
                <p className="absolute bottom-2 inset-x-0 text-center text-xs text-white/80">{busy ? "Connexion…" : "Visez le QR code de la télé"}</p>
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
