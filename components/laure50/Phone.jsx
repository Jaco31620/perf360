"use client";
/*
 * Page invités (téléphones) — n'émet aucun son : affiche les paroles,
 * synchronisées sur la régie. Horloge recalée sur le serveur (clock.js), état
 * de lecture interrogé chaque seconde, position recalculée à chaque image :
 *   position = pos + (heureServeur − at) / 1000 (si lecture) + shift
 */
import { useEffect, useRef, useState } from "react";
import Backdrop from "./Backdrop";
import { startClock } from "./clock";
import { loadLyrics, sungFraction, visibleLines } from "./lyrics";
import { TitleScreen, OutroScreen } from "./Screens";
import FullscreenButton from "./FullscreenButton";

const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function phoneId() {
  try {
    let id = localStorage.getItem("l50_id");
    if (!id) {
      id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 36);
      localStorage.setItem("l50_id", id);
    }
    return id;
  } catch (e) {
    return "anon-" + Math.random().toString(36).slice(2, 12);
  }
}

/* Mise en page des paroles pour une largeur d'écran donnée :
 * - une ligne trop longue (plus de `width` px à 32 px) est coupée en deux à
 *   l'espace le plus proche du milieu ; chaque morceau couvre une partie de la
 *   fraction chantée (proportionnelle à sa largeur) ;
 * - taille de police unique, la plus grande (≤ 40 px) pour que le morceau le
 *   plus long tienne dans `width` px.
 * Renvoie { fontSize, parts: [[{ text, from, to }], …] } (une entrée par item). */
function layoutLyrics(items, width) {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = `800 100px ${FONT}`;
  const w = (t) => ctx.measureText(t).width;
  const parts = items.map((it) => {
    const total = w(it.text);
    if ((total * 32) / 100 <= width) return [{ text: it.text, from: 0, to: 1 }];
    let best = null;
    for (let i = 1; i < it.text.length - 1; i++) {
      if (it.text[i] !== " ") continue;
      const left = w(it.text.slice(0, i));
      if (!best || Math.abs(left - total / 2) < Math.abs(best.left - total / 2)) best = { i, left };
    }
    if (!best) return [{ text: it.text, from: 0, to: 1 }];
    const cut = w(it.text.slice(0, best.i + 1)) / total;
    return [
      { text: it.text.slice(0, best.i), from: 0, to: cut },
      { text: it.text.slice(best.i + 1), from: cut, to: 1 },
    ];
  });
  const widest = Math.max(...parts.flat().map((p) => w(p.text)));
  return { fontSize: Math.min(40, Math.floor((100 * width) / widest)), parts };
}

export default function Phone() {
  return (
    <>
      <PhoneContent />
      <FullscreenButton />
    </>
  );
}

function PhoneContent() {
  const [lyrics, setLyrics] = useState(null);
  const [state, setState] = useState(null);
  const [pos, setPos] = useState(0);
  const [fit, setFit] = useState(null);
  const stateRef = useRef(null);
  const clockRef = useRef(null);

  // paroles + taille de police
  useEffect(() => {
    loadLyrics().then(setLyrics).catch(() => {});
  }, []);
  useEffect(() => {
    if (!lyrics) return;
    const update = () => setFit(layoutLyrics(lyrics.items, Math.min(360, window.innerWidth - 24)));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [lyrics]);

  // horloge + état (1 s) + position (chaque image)
  useEffect(() => {
    const clock = (clockRef.current = startClock());
    const id = phoneId();
    let n = 0, raf = 0, alive = true;

    const poll = async () => {
      try {
        const q = n++ % 3 === 0 ? `?id=${encodeURIComponent(id)}` : "";
        const res = await fetch(`/api/laure50/state${q}`, { cache: "no-store" });
        if (res.ok && alive) {
          const s = await res.json();
          stateRef.current = s;
          setState(s);
        }
      } catch (e) { /* réseau : on garde le dernier état */ }
    };
    poll();
    const timer = setInterval(poll, 1000);

    const frame = () => {
      const s = stateRef.current;
      if (s) {
        const p = (s.playing ? s.pos + (clock.now() - s.at) / 1000 : s.pos) + (s.shift || 0);
        setPos(p);
        window.__l50pos = p; // (diagnostic)
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      clock.stop();
    };
  }, []);

  // écran allumé pendant la chanson
  useEffect(() => {
    let lock = null;
    const request = async () => {
      try { lock = await navigator.wakeLock?.request("screen"); } catch (e) { /* ignoré */ }
    };
    request();
    const onVis = () => { if (document.visibilityState === "visible") request(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { lock?.release(); } catch (e) { /* ignoré */ }
    };
  }, []);

  if (!state || !state.rev || !lyrics || !fit) {
    return (
      <Backdrop>
        <div className="l50-center">
          <img className="l50-logo-big" src="/laure50/logo.png" alt="Laure 1976" />
          <p className="l50-wait">En attente du lancement…</p>
        </div>
      </Backdrop>
    );
  }

  if (pos < lyrics.titleUntil) return <Backdrop><TitleScreen pos={pos} /></Backdrop>;
  if (pos >= lyrics.outroFrom) return <Backdrop><OutroScreen /></Backdrop>;

  const lines = visibleLines(lyrics, pos);
  return (
    <Backdrop showLogo>
      <div className="l50-lyrics" style={{ fontSize: fit.fontSize }}>
        {lines.map((l) => {
          const f = sungFraction(l.curve, pos);
          return (
            <div key={l.i} className="l50-item">
              {fit.parts[l.i].map((part, j) => {
                const local = Math.min(1, Math.max(0, (f - part.from) / (part.to - part.from)));
                const p = Math.round(local * 1000) / 10;
                return (
                  <div key={j} className="l50-line"
                    style={{ backgroundImage: `linear-gradient(90deg, #f0943a ${p}%, #f4e7c7 ${p}%)` }}>
                    {part.text}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Backdrop>
  );
}
