"use client";
/*
 * Clic-Clac — écran live (TV / vidéoprojecteur).
 * Affichages : photo seule (fondu, zoom lent, glissement), mosaïque, mur de
 * polaroïds. Réglages (mémorisés sur l'appareil) : vitesse, ordre (récentes,
 * chronologique, aléatoire), nouvelles photos en priorité + bandeau, légendes,
 * QR code. Plein écran (bouton ou F), pause (espace), ← → photo précédente/suivante.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, mergePhotos, storage } from "./client";

const DEFAULTS = { speed: 6, order: "recent", layout: "single", transition: "kenburns", newFirst: true, captions: true, qr: true };
const SPEEDS = [3, 5, 8, 12, 20];
const ORDERS = [["recent", "Récentes en boucle"], ["chrono", "Chronologique"], ["random", "Aléatoire"]];
const LAYOUTS = [["single", "Photo seule"], ["mosaic", "Mosaïque"], ["wall", "Mur de polaroïds"]];
const TRANSITIONS = [["fade", "Fondu"], ["kenburns", "Zoom lent"], ["slide", "Glissement"]];
const MOSAIC = 12;

export default function Live({ code }) {
  const [album, setAlbum] = useState(undefined);
  const [count, setCount] = useState(0);
  const [cfg, setCfg] = useState(DEFAULTS);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]); // photos déjà montrées (mosaïque / mur)
  const [banner, setBanner] = useState(null);
  const [paused, setPaused] = useState(false);
  const [ui, setUi] = useState(true);
  const [panel, setPanel] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [origin, setOrigin] = useState("");
  const [kick, setKick] = useState(0); // relance immédiate du diaporama (nouvelle photo)
  const [screen, setScreen] = useState({ w: 1280, h: 720 });
  const [qrBox, setQrBox] = useState({ w: 0, h: 0 });
  const [ratios, setRatios] = useState({}); // proportions des photos (id → largeur/hauteur)
  const qrRef = useRef(null);
  const listRef = useRef([]);
  const queue = useRef([]);
  const known = useRef(new Set());
  const seq = useRef({ i: 0, bag: [] });
  const shownRef = useRef([]);
  const hideT = useRef(null);
  const cfgRef = useRef(cfg);
  const currentRef = useRef(null);
  cfgRef.current = cfg;

  // dimensions de l'écran et de la pastille QR (pour ne jamais la recouvrir)
  useEffect(() => {
    const measure = () => {
      setScreen({ w: window.innerWidth, h: window.innerHeight });
      const r = qrRef.current?.getBoundingClientRect();
      setQrBox(r ? { w: Math.round(r.width), h: Math.round(r.height) } : { w: 0, h: 0 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (qrRef.current) ro.observe(qrRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [cfg.qr, album]);

  // réglages mémorisés
  useEffect(() => {
    setOrigin(window.location.origin);
    try { setCfg({ ...DEFAULTS, ...JSON.parse(storage.get(`cc_live_${code}`) || "{}") }); } catch (e) { /* défauts */ }
  }, [code]);
  const set = (patch) => setCfg((c) => { const n = { ...c, ...patch }; storage.set(`cc_live_${code}`, JSON.stringify(n)); return n; });

  // données
  const load = useCallback(async () => {
    try {
      const d = await api(`/${code}`);
      setAlbum(d.album);
      const g = await api(`/${code}/photos`);
      const first = known.current.size === 0;
      const next = mergePhotos(listRef.current, g.photos);
      let fresh = false;
      for (const p of [...next].reverse()) if (!known.current.has(p.id)) { if (!first) { queue.current.push(p.id); fresh = true; } known.current.add(p.id); }
      listRef.current = next;
      setCount(next.length);
      if (fresh && cfgRef.current.newFirst) setKick((k) => k + 1); // affichée tout de suite
    } catch (e) { if (e.status === 404) setAlbum(null); }
  }, [code]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  // choix de la photo suivante
  // fonctions stables (lisent réglages et photo courante via des refs) :
  // le minuteur du diaporama n'est pas relancé à chaque photo
  const pick = useCallback((dir = 1) => {
    const cfg = cfgRef.current;
    const list = listRef.current;
    if (!list.length) return null;
    if (dir > 0 && cfg.newFirst) {
      while (queue.current.length) {
        const p = list.find((x) => x.id === queue.current.shift());
        if (p) return { p, fresh: true };
      }
    }
    if (dir < 0 && shownRef.current.length > 1) {
      shownRef.current.pop();
      return { p: shownRef.current[shownRef.current.length - 1], back: true };
    }
    const s = seq.current;
    if (cfg.order === "random") {
      if (!s.bag.length) s.bag = list.map((x) => x.id).sort(() => Math.random() - 0.5);
      let id = s.bag.pop();
      if (id === currentRef.current?.id && s.bag.length) id = s.bag.pop();
      return { p: list.find((x) => x.id === id) || list[0] };
    }
    const ordered = cfg.order === "chrono" ? [...list].reverse() : list.slice(0, 40);
    const p = ordered[s.i % ordered.length];
    s.i++;
    return { p };
  }, []);

  const advance = useCallback((dir = 1) => {
    const r = pick(dir);
    if (!r) { currentRef.current = null; setCurrent(null); return; }
    if (!r.back) shownRef.current = [...shownRef.current.slice(-30), r.p];
    currentRef.current = r.p;
    setCurrent(r.p);
    setHistory((h) => [r.p, ...h.filter((x) => x.id !== r.p.id)].slice(0, MOSAIC));
    if (r.fresh) { setBanner(r.p); setTimeout(() => setBanner((b) => (b?.id === r.p.id ? null : b)), 4500); }
  }, [pick]);

  useEffect(() => { seq.current = { i: 0, bag: [] }; }, [cfg.order]);
  useEffect(() => {
    if (paused) return undefined;
    advance();
    const t = setInterval(() => advance(), cfg.speed * 1000);
    return () => clearInterval(t);
  }, [paused, cfg.speed, advance, count === 0, kick]); // eslint-disable-line react-hooks/exhaustive-deps

  // plein écran, clavier, barre auto-masquée
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.());
  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement);
    const onKey = (e) => {
      if (e.target.tagName === "SELECT") return;
      if (e.key === "f" || e.key === "F") fullscreen();
      else if (e.code === "Space") { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === "ArrowRight") advance(1);
      else if (e.key === "ArrowLeft") advance(-1);
    };
    const wake = () => { setUi(true); clearTimeout(hideT.current); hideT.current = setTimeout(() => setUi(false), 3500); };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousemove", wake);
    wake();
    return () => { document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("keydown", onKey); window.removeEventListener("mousemove", wake); };
  }, [advance]);

  if (album === null) return <div className="min-h-screen bg-black text-white flex items-center justify-center text-2xl">Album introuvable.</div>;
  const joinUrl = `${origin}/clic-clac/${code}`;
  const dur = `${cfg.speed}s`;

  return (
    <div className={`h-[100dvh] bg-[#0d0a09] text-white overflow-hidden relative select-none ${ui || panel ? "" : "cursor-none"}`}>
      {!current ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <img src="/icon-clicclac.svg" alt="" className="w-24 h-24 rounded-3xl" />
          <p className="text-4xl font-black">{album?.name}</p>
          <p className="text-2xl text-white/60">Les premières photos arrivent bientôt…</p>
        </div>
      ) : cfg.layout === "mosaic" ? (
        <Mosaic photos={history} current={current} captions={cfg.captions} qr={cfg.qr} />
      ) : cfg.layout === "wall" ? (
        <Wall photos={history} captions={cfg.captions} qr={cfg.qr} />
      ) : (
        <div key={current.id} className="absolute inset-0" style={{ animation: `${cfg.transition === "slide" ? "ccslide" : "ccfade"} .9s ease-out` }}>
          <img src={current.full} alt="" className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-40 scale-110" />
          {(() => {
            const box = photoBox(screen, cfg.qr ? qrBox : null, ratios[current.id] || 4 / 3, cfg.captions && (current.caption || current.name));
            return (
              <div className="absolute flex items-center justify-center" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
                <img src={current.full} alt={current.caption || ""} className="max-w-full max-h-full object-contain"
                  onLoad={(e) => { const r = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight; setRatios((m) => (m[current.id] === r ? m : { ...m, [current.id]: r })); }}
                  style={cfg.transition === "kenburns" ? { animation: `cczoom ${dur} linear forwards` } : undefined} />
              </div>
            );
          })()}
          {cfg.captions && (current.caption || current.name) && (
            <div className="absolute bottom-6 left-8 text-2xl drop-shadow-lg truncate" style={{ right: cfg.qr && qrBox.w ? qrBox.w + 56 : 32 }}>
              {current.caption && <span className="font-bold">{current.caption}</span>}
              {current.name && <span className="text-white/75">{current.caption ? " — " : ""}📸 {current.name}</span>}
            </div>
          )}
        </div>
      )}

      {banner && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-[#ff5a5f] text-white text-2xl font-black px-8 py-3 rounded-full shadow-2xl" style={{ animation: "ccdrop .5s ease-out" }}>
          📸 Nouvelle photo{banner.name ? ` de ${banner.name}` : ""} !
        </div>
      )}

      {cfg.qr && (
        <div ref={qrRef} className="absolute bottom-6 right-6 bg-white text-gray-900 rounded-3xl p-4 flex items-center gap-4 shadow-2xl">
          <div className="text-right">
            <p className="text-xs font-bold uppercase text-[#ff5a5f]">Clic-Clac</p>
            <p className="font-black leading-tight max-w-[180px] truncate">{album?.name}</p>
            <p className="text-sm text-gray-500">code <b className="tracking-widest text-gray-900">{code}</b></p>
            <p className="text-xs text-gray-400">{count} photo{count > 1 ? "s" : ""}</p>
          </div>
          {origin && <QRCodeSVG value={joinUrl} size={Math.round(Math.min(140, Math.max(80, screen.h * 0.15)))} />}
        </div>
      )}

      {/* commandes (apparaissent au mouvement de la souris) */}
      <div className={`absolute top-4 right-4 flex gap-2 transition-opacity ${ui || panel ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {paused && <span className="bg-black/60 px-3 py-2 rounded-full text-sm">⏸ En pause</span>}
        <button onClick={() => setPanel((v) => !v)} className="bg-black/60 hover:bg-black/80 px-4 py-2 rounded-full text-sm font-semibold">⚙️ Réglages</button>
        <button onClick={fullscreen} className="bg-black/60 hover:bg-black/80 px-4 py-2 rounded-full text-sm font-semibold">{isFull ? "Quitter le plein écran" : "⛶ Plein écran"}</button>
      </div>

      {panel && (
        <div className="absolute top-16 right-4 w-80 bg-white text-gray-900 rounded-2xl shadow-2xl p-5 space-y-4 text-sm">
          <Field label="Affichage"><Seg options={LAYOUTS} value={cfg.layout} onChange={(v) => set({ layout: v })} /></Field>
          {cfg.layout === "single" && <Field label="Transition"><Seg options={TRANSITIONS} value={cfg.transition} onChange={(v) => set({ transition: v })} /></Field>}
          <Field label={`Vitesse : ${cfg.speed} s par photo`}>
            <input type="range" min={0} max={SPEEDS.length - 1} step={1} value={Math.max(0, SPEEDS.indexOf(cfg.speed))}
              onChange={(e) => set({ speed: SPEEDS[+e.target.value] })} className="w-full accent-[#ff5a5f]" />
            <div className="flex justify-between text-xs text-gray-400"><span>rapide</span><span>lent</span></div>
          </Field>
          <Field label="Ordre"><Seg options={ORDERS} value={cfg.order} onChange={(v) => set({ order: v })} /></Field>
          <div className="space-y-1.5">
            {[["newFirst", "Nouvelles photos en priorité (avec bandeau)"], ["captions", "Afficher prénom et légende"], ["qr", "Afficher le QR code"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cfg[k]} onChange={(e) => set({ [k]: e.target.checked })} className="w-4 h-4 accent-[#ff5a5f]" />{l}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400">Espace : pause · ← → : photo précédente / suivante · F : plein écran. Réglages mémorisés sur cet appareil.</p>
          <button onClick={() => setPanel(false)} className="w-full bg-gray-900 text-white font-bold py-2 rounded-full">Fermer</button>
        </div>
      )}

      <style>{`
        @keyframes ccfade{from{opacity:0}to{opacity:1}}
        @keyframes ccslide{from{opacity:0;transform:translateX(6%)}to{opacity:1;transform:none}}
        @keyframes cczoom{from{transform:scale(1)}to{transform:scale(1.04)}}
        @keyframes ccdrop{from{opacity:0;transform:translate(-50%,-30px)}to{opacity:1;transform:translate(-50%,0)}}
        @keyframes ccpop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
        @keyframes ccfall{from{opacity:0;transform:var(--r) translateY(-60px) scale(1.15)}to{opacity:1;transform:var(--r)}}
      `}</style>
    </div>
  );
}

/* Zone d'affichage de la photo seule : on essaie (a) une bande libre en bas pour
 * la pastille QR, (b) une colonne libre à droite, et on garde celle qui affiche
 * la photo (proportions ratio) le plus grand. */
function photoBox(screen, qr, ratio, caption) {
  const m = 24, gap = 16, capH = caption ? 56 : 0;
  const fit = (w, h) => Math.min(w, h * ratio) * Math.min(h, w / ratio);
  if (!qr || !qr.w) {
    return { x: m, y: m, w: screen.w - 2 * m, h: screen.h - 2 * m - capH };
  }
  const a = { x: m, y: m, w: screen.w - 2 * m, h: screen.h - m - (qr.h + m + gap) }; // bande en bas
  const b = { x: m, y: m, w: screen.w - m - (qr.w + m + gap), h: screen.h - 2 * m - capH }; // colonne à droite
  return fit(a.w, a.h) >= fit(b.w, b.h) ? a : b;
}

function Field({ label, children }) {
  return <div className="space-y-1.5"><p className="font-semibold text-gray-600">{label}</p>{children}</div>;
}
function Seg({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-full font-semibold ${value === v ? "bg-[#ff5a5f] text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>
      ))}
    </div>
  );
}

/* Mosaïque : grille des dernières photos montrées ; la plus récente en grand. */
function Mosaic({ photos, current, captions, qr }) {
  // la grande occupe 4 cases ; avec le QR, la dernière case (en bas à droite) reste libre pour la pastille
  const rest = photos.filter((p) => p.id !== current.id).slice(0, MOSAIC - 4 - (qr ? 1 : 0));
  return (
    <div className="absolute inset-0 p-4 pb-4 grid grid-cols-4 grid-rows-3 gap-3">
      <div key={current.id} className="col-span-2 row-span-2 relative rounded-2xl overflow-hidden bg-black" style={{ animation: "ccpop .7s ease-out" }}>
        <img src={current.full} alt="" className="w-full h-full object-cover" />
        {captions && current.name && <span className="absolute bottom-3 left-4 text-xl font-bold drop-shadow-lg">📸 {current.name}</span>}
      </div>
      {rest.map((p) => (
        <div key={p.id} className="relative rounded-xl overflow-hidden bg-black" style={{ animation: "ccfade .6s ease-out" }}>
          <img src={p.thumb} alt="" className="w-full h-full object-cover" />
        </div>
      ))}
    </div>
  );
}

/* Mur de polaroïds : chaque photo « tombe » sur le tas, légèrement inclinée. */
function Wall({ photos, captions, qr }) {
  const cards = photos.slice(0, 7).reverse();
  const place = (id) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    // zone de dépôt : cartes entièrement visibles, à gauche de la pastille QR si elle est affichée
    const xMax = qr ? 46 : 62, yMax = 30;
    return { x: 4 + (h % (xMax - 4)), y: 7 + ((h >> 8) % (yMax - 7)), r: ((h >> 16) % 16) - 8 };
  };
  return (
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#3a2a22,#120d0b)]">
      {cards.map((p, i) => {
        const { x, y, r } = place(p.id);
        const top = i === cards.length - 1;
        return (
          <div key={p.id} className="absolute bg-[#fbfaf5] p-3 pb-12 shadow-2xl"
            style={{ left: `${x}%`, top: `${y}%`, width: top ? "min(30vw, 62vh)" : "min(22vw, 46vh)", "--r": `rotate(${r}deg)`, transform: `rotate(${r}deg)`, zIndex: i, animation: top ? "ccfall .8s ease-out" : undefined }}>
            <img src={top ? p.full : p.thumb} alt="" className="w-full aspect-[4/3] object-cover" />
            {captions && (p.name || p.caption) && (
              <p className="absolute bottom-2 left-0 right-0 text-center text-gray-800 truncate px-3" style={{ fontFamily: '"Segoe Print","Bradley Hand","Comic Sans MS",cursive', fontSize: top ? "1.6vw" : "1.2vw" }}>
                {p.caption || p.name}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
