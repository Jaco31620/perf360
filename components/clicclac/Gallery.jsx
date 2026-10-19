"use client";
/*
 * Clic-Clac — galerie : grille de miniatures (légères), visionneuse plein écran
 * avec la version standard, téléchargement photo par photo, suppression de ses
 * propres photos (invité) ou de toutes (organisateur), validation (modération).
 */
import { useEffect, useState } from "react";

async function download(url, name) {
  try {
    const blob = await (await fetch(url)).blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) {
    window.open(url, "_blank");
  }
}

export default function Gallery({ photos, canDownload = true, onDelete, onApprove, admin = false, empty }) {
  const [open, setOpen] = useState(null); // index
  const current = open != null ? photos[open] : null;

  useEffect(() => {
    if (open == null) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => Math.min(photos.length - 1, i + 1));
      if (e.key === "ArrowLeft") setOpen((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, photos.length]);

  if (!photos.length) return <p className="text-center text-gray-400 py-16">{empty || "Aucune photo pour l'instant."}</p>;

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
        {photos.map((p, i) => (
          <button key={p.id} onClick={() => setOpen(i)} className="relative aspect-square overflow-hidden rounded-lg bg-gray-200 group">
            <img src={p.thumb} alt={p.caption || p.name || "Photo"} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            {p.status === "pending" && <span className="absolute top-1 left-1 bg-amber-400 text-amber-950 text-[10px] font-bold px-1.5 py-0.5 rounded">À valider</span>}
            {p.kind === "strip" && <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">🎞️</span>}
            {p.mine && <span className="absolute top-1 right-1 bg-white/90 text-gray-800 text-[10px] font-bold px-1.5 py-0.5 rounded">Moi</span>}
          </button>
        ))}
      </div>

      {current && (
        <div className="fixed inset-0 z-50 bg-black/95 text-white flex flex-col" onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between px-4 py-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <span className="text-white/70">{open + 1} / {photos.length}</span>
            <button onClick={() => setOpen(null)} className="text-white/80 hover:text-white text-lg">✕</button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center px-2 relative" onClick={(e) => e.stopPropagation()}>
            {open > 0 && <button onClick={() => setOpen(open - 1)} className="absolute left-2 z-10 bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 text-2xl">‹</button>}
            <img src={current.full} alt={current.caption || "Photo"} className="max-w-full max-h-full object-contain" />
            {open < photos.length - 1 && <button onClick={() => setOpen(open + 1)} className="absolute right-2 z-10 bg-white/10 hover:bg-white/20 rounded-full w-11 h-11 text-2xl">›</button>}
          </div>
          <div className="px-4 py-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            {(current.name || current.caption) && (
              <p className="text-center">
                {current.caption && <span className="font-semibold">{current.caption}</span>}
                {current.name && <span className="text-white/60">{current.caption ? " — " : ""}📸 {current.name}</span>}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {admin && current.status === "pending" && (
                <button onClick={() => onApprove?.(current)} className="bg-green-500 font-bold px-5 py-2.5 rounded-full">✓ Publier</button>
              )}
              {canDownload && (
                <button onClick={() => download(current.hd || current.full, `clic-clac-${current.id.slice(0, 8)}.jpg`)}
                  className="bg-white text-gray-900 font-bold px-5 py-2.5 rounded-full">⬇ Télécharger</button>
              )}
              {(admin || current.mine) && onDelete && (
                <button onClick={async () => {
                  if (!confirm("Supprimer définitivement cette photo ?")) return;
                  await onDelete(current);
                  setOpen(photos.length <= 1 ? null : Math.max(0, open - (open === photos.length - 1 ? 1 : 0)));
                }} className="bg-red-500/90 font-bold px-5 py-2.5 rounded-full">🗑 Supprimer</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
