"use client";
/*
 * Clic-Clac — mode borne (appareil dédié) : écran d'accueil plein écran, prise de
 * vue avec compte à rebours, puis photo + QR « Récupérer ma photo » pendant 30 s.
 * Accès : jeton de borne (#b=… dans le lien, ou généré depuis l'espace organisateur).
 */
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import Studio from "./Studio";
import { api, boothToken, adminToken, superToken, storage, formatDate } from "./client";

export default function Booth({ code }) {
  const [token, setToken] = useState(null);
  const [album, setAlbum] = useState(undefined);
  const [usage, setUsage] = useState(null);
  const [step, setStep] = useState("idle"); // idle | studio | done
  const [result, setResult] = useState(null);
  const [left, setLeft] = useState(30);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const m = window.location.hash.match(/b=([\w.-]+)/);
    if (m) { storage.set(`cc_booth_${code}`, m[1]); history.replaceState(null, "", window.location.pathname); }
    setToken(boothToken(code) || adminToken(code) || superToken() || "");
    setOrigin(window.location.origin);
  }, [code]);

  const load = useCallback(async () => {
    if (token === null) return;
    try {
      const d = await api(`/${code}`, { token });
      setAlbum(d.role ? d.album : null);
      setUsage(d.usage || null);
    } catch (e) { if (e.status === 404) setAlbum(null); }
  }, [code, token]);
  useEffect(() => { load(); }, [load]);

  // retour automatique à l'accueil après le résultat
  useEffect(() => {
    if (step !== "done") return undefined;
    setLeft(30);
    const t = setInterval(() => setLeft((n) => { if (n <= 1) { setStep("idle"); return 30; } return n - 1; }), 1000);
    return () => clearInterval(t);
  }, [step]);

  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.());

  if (album === undefined) return <Dark><p className="text-white/60">Chargement…</p></Dark>;
  if (album === null) {
    return (
      <Dark>
        <div className="text-center space-y-3 max-w-md">
          <p className="text-2xl font-black">Borne non autorisée</p>
          <p className="text-white/60">Ouvrez la borne depuis l'espace organisateur (onglet « Partager »), ou avec le lien borne.</p>
        </div>
      </Dark>
    );
  }

  if (step === "studio") {
    return <Studio album={album} code={code} booth token={token}
      onClose={() => setStep("idle")}
      onDone={(r) => { setResult(r); setStep("done"); load(); }} />;
  }

  if (step === "done" && result) {
    const url = `${origin}/clic-clac/${code}/p/${result.id}`;
    return (
      <Dark>
        <div className="w-full max-w-6xl grid md:grid-cols-[1fr_auto] gap-8 items-center">
          <img src={result.preview} alt="Votre photo" className="w-full max-h-[75vh] object-contain rounded-2xl shadow-2xl" />
          <div className="text-center space-y-4">
            <p className="text-3xl font-black">Récupérez votre photo !</p>
            <div className="inline-block bg-white p-4 rounded-3xl"><QRCodeSVG value={url} size={240} /></div>
            <p className="text-white/60">Scannez avec votre téléphone</p>
            <button onClick={() => setStep("idle")} className="bg-[#ff5a5f] text-white text-xl font-black px-8 py-4 rounded-full">📸 Nouvelle photo</button>
            <p className="text-white/40 text-sm">Retour automatique dans {left} s</p>
          </div>
        </div>
      </Dark>
    );
  }

  return (
    <Dark>
      <button onClick={() => setStep("studio")} className="flex flex-col items-center gap-8 text-center group">
        <img src="/icon-clicclac.svg" alt="" className="w-24 h-24 rounded-3xl shadow-2xl" />
        <div>
          <p className="text-5xl sm:text-7xl font-black">{album.name}</p>
          {album.eventDate && <p className="text-xl text-white/60 mt-2">{formatDate(album.eventDate)}</p>}
        </div>
        <span className="w-44 h-44 rounded-full bg-[#ff5a5f] border-[10px] border-white/30 flex items-center justify-center text-7xl shadow-2xl group-active:scale-95 transition-transform animate-pulse">📸</span>
        <p className="text-2xl font-bold text-white/90">Touchez pour prendre une photo</p>
      </button>
      <div className="fixed bottom-4 left-4 right-4 flex justify-between text-sm text-white/40">
        <span>{usage ? `${usage.photos} photo${usage.photos > 1 ? "s" : ""} dans l'album` : ""}</span>
        <button onClick={fullscreen} className="underline hover:text-white/70">Plein écran</button>
      </div>
    </Dark>
  );
}

function Dark({ children }) {
  return <div className="min-h-[100dvh] bg-[#16110f] text-white flex items-center justify-center p-6">{children}</div>;
}
