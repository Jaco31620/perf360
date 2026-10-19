"use client";
/*
 * Clic-Clac — écran live (TV / vidéoprojecteur) : diaporama des photos publiées.
 * Les nouvelles photos passent en priorité, puis le diaporama tourne sur les
 * dernières. QR code + code pour rejoindre en permanence.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, mergePhotos } from "./client";

const SLIDE_MS = 6000;

export default function Live({ code }) {
  const [album, setAlbum] = useState(undefined);
  const [photos, setPhotos] = useState([]);
  const [current, setCurrent] = useState(null);
  const [origin, setOrigin] = useState("");
  const queue = useRef([]); // nouvelles photos à montrer en priorité
  const known = useRef(new Set());
  const cursor = useRef(0);
  const listRef = useRef([]);

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    try {
      const d = await api(`/${code}`);
      setAlbum(d.album);
      const g = await api(`/${code}/photos`);
      const first = known.current.size === 0;
      const next = mergePhotos(listRef.current, g.photos);
      for (const p of next) if (!known.current.has(p.id)) { if (!first) queue.current.push(p.id); known.current.add(p.id); }
      listRef.current = next;
      setPhotos(next);
    } catch (e) { if (e.status === 404) setAlbum(null); }
  }, [code]);

  useEffect(() => {
    load();
    const t = setInterval(load, 7000);
    return () => clearInterval(t);
  }, [load]);

  // diaporama
  useEffect(() => {
    const tick = () => {
      const list = listRef.current;
      if (!list.length) { setCurrent(null); return; }
      let p = null;
      while (queue.current.length && !p) { const id = queue.current.shift(); p = list.find((x) => x.id === id) || null; }
      if (!p) { const recent = list.slice(0, 40); p = recent[cursor.current++ % recent.length]; }
      setCurrent(p);
    };
    tick();
    const t = setInterval(tick, SLIDE_MS);
    return () => clearInterval(t);
  }, []);

  if (album === null) return <div className="min-h-screen bg-black text-white flex items-center justify-center text-2xl">Album introuvable.</div>;
  const joinUrl = `${origin}/clic-clac/${code}`;

  return (
    <div className="h-[100dvh] bg-black text-white overflow-hidden relative" onDoubleClick={() => (document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.())}>
      {current ? (
        <div key={current.id} className="absolute inset-0 animate-[ccfade_.8s_ease-out]">
          <img src={current.full} alt="" className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-40 scale-110" />
          <img src={current.full} alt={current.caption || ""} className="absolute inset-0 w-full h-full object-contain p-6 pb-28" />
          {(current.caption || current.name) && (
            <div className="absolute bottom-6 left-8 right-[340px] text-2xl">
              {current.caption && <span className="font-bold">{current.caption}</span>}
              {current.name && <span className="text-white/70">{current.caption ? " — " : ""}📸 {current.name}</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <img src="/icon-clicclac.svg" alt="" className="w-24 h-24 rounded-3xl" />
          <p className="text-4xl font-black">{album?.name}</p>
          <p className="text-2xl text-white/60">Les premières photos arrivent bientôt…</p>
        </div>
      )}
      <div className="absolute bottom-6 right-6 bg-white text-gray-900 rounded-3xl p-4 flex items-center gap-4 shadow-2xl">
        <div className="text-right">
          <p className="text-xs font-bold uppercase text-[#ff5a5f]">Clic-Clac</p>
          <p className="font-black leading-tight max-w-[180px] truncate">{album?.name}</p>
          <p className="text-sm text-gray-500">code <b className="tracking-widest text-gray-900">{code}</b></p>
          <p className="text-xs text-gray-400">{photos.length} photo{photos.length > 1 ? "s" : ""}</p>
        </div>
        {origin && <QRCodeSVG value={joinUrl} size={120} />}
      </div>
      <style>{`@keyframes ccfade{from{opacity:0;transform:scale(1.02)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
