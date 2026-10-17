"use client";
/*
 * Bouton plein écran (téléphones). Android / ordinateurs : API Fullscreen.
 * iPhone (pas d'API Fullscreen hors vidéo) : astuce « Sur l'écran d'accueil »,
 * la page s'ouvre alors sans barre de navigateur (manifest + apple-web-app).
 */
import { useEffect, useState } from "react";

export default function FullscreenButton() {
  const [isFull, setIsFull] = useState(false);
  const [supported, setSupported] = useState(true);
  const [standalone, setStandalone] = useState(false);
  const [tip, setTip] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    setSupported(!!(el.requestFullscreen || el.webkitRequestFullscreen));
    setStandalone(window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);
    const onChange = () => setIsFull(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  if (standalone) return null; // déjà ouvert depuis l'écran d'accueil : plein écran

  const toggle = async () => {
    if (!supported) { setTip((t) => !t); return; }
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        const el = document.documentElement;
        await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: "hide" });
      }
    } catch (e) { setTip(true); }
  };

  return (
    <>
      <button className="l50-fs" onClick={toggle} aria-label={isFull ? "Quitter le plein écran" : "Plein écran"}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {isFull
            ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
            : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
        </svg>
      </button>
      {tip && (
        <div className="l50-fs-tip" onClick={() => setTip(false)}>
          Pour le plein écran sur iPhone : touchez <b>Partager</b> <span aria-hidden="true">⬆︎</span> puis
          <b> « Sur l’écran d’accueil »</b>, et ouvrez le karaoké depuis l’icône.
          <span className="l50-fs-close">OK</span>
        </div>
      )}
    </>
  );
}
