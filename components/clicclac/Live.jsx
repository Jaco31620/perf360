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
import { api, syncPhotos, storage } from "./client";

const DEFAULTS = { speed: 6, order: "recent", layout: "single", transition: "kenburns", newFirst: true, captions: true, qr: true };
const SPEEDS = [3, 5, 8, 12, 20];
const ORDERS = [["recent", "Récentes en boucle"], ["chrono", "Chronologique"], ["random", "Aléatoire"]];
const LAYOUTS = [["single", "Photo seule"], ["mosaic", "Mosaïque"], ["wall", "Pêle-mêle polaroïds"], ["collage", "Pêle-mêle photos"]];
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
      const first = known.current.size === 0;
      const next = await syncPhotos(code, listRef.current);
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
        <Wall photos={history} current={current} captions={cfg.captions} qr={cfg.qr} screen={screen} qrBox={qrBox} polaroid />
      ) : cfg.layout === "collage" ? (
        <Wall photos={history} current={current} captions={cfg.captions} qr={cfg.qr} screen={screen} qrBox={qrBox} polaroid={false} />
      ) : (
        <div key={current.id} className="absolute inset-0" style={{ animation: `${cfg.transition === "slide" ? "ccslide" : "ccfade"} .9s ease-out` }}>
          <img src={current.full} alt="" className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-40 scale-110" />
          {(() => {
            const ratio = ratios[current.id] || 4 / 3;
            const r = photoRect(screen, photoBox(screen, cfg.qr ? qrBox : null, ratio, cfg.captions && (current.caption || current.name)), ratio);
            return (
              <div className="absolute" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                <img src={current.full} alt={current.caption || ""} className="w-full h-full object-contain"
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

/* Taille maximale de la photo dans la zone libre, puis position CENTRÉE sur
 * l'écran — décalée seulement si nécessaire pour rester dans la zone libre. */
function photoRect(screen, box, ratio) {
  const w = Math.min(box.w, box.h * ratio), h = w / ratio;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  return {
    w, h,
    x: clamp((screen.w - w) / 2, box.x, box.x + box.w - w),
    y: clamp((screen.h - h) / 2, box.y, box.y + box.h - h),
  };
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
        <img src={current.thumb} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-50 scale-110" />
        <img src={current.full} alt="" className="relative w-full h-full object-contain" />
        {captions && current.name && <span className="absolute bottom-3 left-4 text-xl font-bold drop-shadow-lg">📸 {current.name}</span>}
      </div>
      {rest.map((p) => (
        <div key={p.id} className="relative rounded-xl overflow-hidden bg-black" style={{ animation: "ccfade .6s ease-out" }}>
          <img src={p.thumb} alt="" className="absolute inset-0 w-full h-full object-cover blur-xl opacity-50 scale-110" />
          <img src={p.thumb} alt="" className="relative w-full h-full object-contain" />
        </div>
      ))}
    </div>
  );
}

/* Pêle-mêle (polaroïds ou photos seules) : l'écran est découpé en emplacements
 * (4×3 écran large, 3×3, 2×4 en portrait ; case de la pastille QR exclue) ;
 * chaque photo en occupe un, avec un léger désordre (position, inclinaison).
 * La photo du moment s'affiche EN GRAND au centre, puis rétrécit et glisse à sa
 * place quand la suivante arrive (transition CSS sur transform).
 * Cartes toujours dans l'écran, jamais sur la pastille QR. */
function Wall({ photos, current, captions, qr, screen, qrBox, polaroid = true }) {
  const W = screen.w, H = screen.h, m = 20;
  const cols = W / H > 1.5 ? 4 : W / H > 0.9 ? 3 : 2, rows = W / H > 0.9 ? 3 : 4;
  const sw = (W - 2 * m) / cols, sh = (H - 2 * m) / rows;
  const slots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (qr && r === rows - 1 && c === cols - 1) continue;
    slots.push({ cx: m + (c + 0.5) * sw, cy: m + (r + 0.5) * sh });
  }
  const hash = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };
  const shown = photos.slice(0, slots.length);
  const used = new Set();
  const placed = shown.map((p) => {
    let k = hash(p.id) % slots.length;
    while (used.has(k)) k = (k + 1) % slots.length;
    used.add(k);
    return { p, slot: slots[k] };
  }).reverse(); // la plus récente dessinée en dernier
  const qrRect = qr && qrBox.w ? { x: W - 24 - qrBox.w, y: H - 24 - qrBox.h } : null;
  // décale un rectangle (centre cx, cy ; taille w×h) hors de la pastille QR
  const avoidQr = (cx, cy, w, h) => {
    if (qrRect && cx + w / 2 > qrRect.x - 12 && cy + h / 2 > qrRect.y - 12) {
      const up = cy + h / 2 - (qrRect.y - 12), left = cx + w / 2 - (qrRect.x - 12);
      if (up <= left) cy -= up; else cx -= left;
    }
    return [cx, cy];
  };
  const pad = polaroid ? { side: 24, extra: 64 } : { side: 0, extra: 0 };

  return (
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,#3a2a22,#120d0b)]">
      {placed.map(({ p, slot }, i) => {
        const hero = current && p.id === current.id;
        const h = hash(p.id);
        // place « au repos » dans le tas
        const cardW = Math.min(sw * 1.28, W * 0.45), cardH = Math.min(sh * 1.28, H * 0.62);
        let cx = slot.cx + ((((h >> 4) % 100) / 100) - 0.5) * sw * 0.25;
        let cy = slot.cy + ((((h >> 12) % 100) / 100) - 0.5) * sh * 0.25;
        const r = (h % 14) - 7;
        // marge supplémentaire due à l'inclinaison (coins qui dépassent)
        const tilt = Math.abs(Math.sin((r * Math.PI) / 180)) * Math.max(cardW, cardH) / 2;
        cx = Math.max(m + tilt + cardW / 2, Math.min(W - m - tilt - cardW / 2, cx));
        cy = Math.max(m + tilt + cardH / 2, Math.min(H - m - tilt - cardH / 2, cy));
        [cx, cy] = avoidQr(cx, cy, cardW + 2 * tilt, cardH + 2 * tilt);
        // en vedette : agrandie au centre de l'écran (hors QR), redressée
        let t = `rotate(${r}deg)`;
        if (hero) {
          const sc = Math.min((W * 0.66) / cardW, (H * 0.8) / cardH);
          let [hx, hy] = [W / 2, H / 2];
          hx = Math.max(m + (cardW * sc) / 2, Math.min(W - m - (cardW * sc) / 2, hx));
          hy = Math.max(m + (cardH * sc) / 2, Math.min(H - m - (cardH * sc) / 2, hy));
          [hx, hy] = avoidQr(hx, hy, cardW * sc, cardH * sc);
          t = `translate(${hx - cx}px, ${hy - cy}px) rotate(${r / 4}deg) scale(${sc})`;
        }
        return (
          <div key={p.id} className="absolute flex items-center justify-center"
            style={{
              left: cx - cardW / 2, top: cy - cardH / 2, width: cardW, height: cardH,
              zIndex: hero ? 100 : i, transform: t,
              transition: "transform 1.1s cubic-bezier(.22,.8,.25,1)",
            }}>
            {/* l'apparition (pop) est sur l'élément intérieur : elle ne gêne pas le déplacement */}
            <div className={`relative ${polaroid ? "bg-[#fbfaf5] p-3 pb-12" : ""} shadow-[0_18px_40px_rgba(0,0,0,.55)]`}
              style={{ animation: hero ? "ccpop .7s ease-out" : undefined }}>
              {/* photo entière, aux proportions d'origine (orientation, cadre) */}
              <img src={p.full} alt="" className="block w-auto h-auto"
                style={{ maxWidth: cardW - pad.side, maxHeight: cardH - pad.extra }} />
              {captions && polaroid && (p.name || p.caption) && (
                <p className="absolute bottom-2 left-0 right-0 text-center text-gray-800 truncate px-3"
                  style={{ fontFamily: '"Segoe Print","Bradley Hand","Comic Sans MS",cursive', fontSize: Math.max(13, sh * 0.06) }}>
                  {p.caption || p.name}
                </p>
              )}
              {captions && !polaroid && p.name && (
                <span className="absolute bottom-2 left-2 bg-black/60 text-white rounded-full px-2.5 py-0.5" style={{ fontSize: Math.max(11, sh * 0.045) }}>📸 {p.name}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
