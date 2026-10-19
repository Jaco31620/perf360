"use client";
/* Clic-Clac — « Récupérer ma photo » (QR de la borne) : une photo, téléchargeable. */
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "./client";

export default function PhotoPage({ code, id }) {
  const [d, setD] = useState(undefined);
  useEffect(() => { api(`/${code}/photos/${id}`).then(setD).catch(() => setD(null)); }, [code, id]);

  const save = async () => {
    try {
      const blob = await (await fetch(d.photo.full)).blob();
      const file = new File([blob], `clic-clac-${id.slice(0, 8)}.jpg`, { type: "image/jpeg" });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: d.album.name }); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { /* partage annulé */ }
  };

  return (
    <div className="min-h-[100dvh] bg-[#16110f] text-white flex flex-col items-center justify-center p-4 gap-5">
      {d === undefined && <p className="text-white/60">Chargement…</p>}
      {d === null && <p className="text-white/80 text-center">Cette photo n'est pas (ou plus) disponible.</p>}
      {d && (
        <>
          <p className="text-sm font-bold uppercase tracking-wider text-[#ff8a8d]">📸 {d.album.name}</p>
          <img src={d.photo.full} alt="Votre photo" className="max-w-full max-h-[70dvh] object-contain rounded-2xl shadow-2xl" />
          {d.photo.caption && <p className="font-semibold">{d.photo.caption}</p>}
          {d.album.guestDownload && <button onClick={save} className="bg-[#ff5a5f] font-black text-lg px-8 py-3.5 rounded-full">⬇ Enregistrer ma photo</button>}
        </>
      )}
      <Link href={`/clic-clac/${code}`} className="text-white/60 underline">Voir tout l'album</Link>
    </div>
  );
}
