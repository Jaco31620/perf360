"use client";
/*
 * Clic-Clac — application invité (/clic-clac/<code>) : prénom (une fois),
 * prise de photo (quota), galerie de l'album.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Studio from "./Studio";
import Gallery from "./Gallery";
import { api, guestId, storage, mergePhotos, formatDate } from "./client";
import { MAX_NAME } from "@/lib/clicclac/settings";

export default function GuestApp({ code }) {
  const [album, setAlbum] = useState(undefined);
  const [taken, setTaken] = useState(0);
  const [photos, setPhotos] = useState([]);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [studio, setStudio] = useState(false);
  const [toast, setToast] = useState("");
  const [gid, setGid] = useState("");

  useEffect(() => {
    setGid(guestId());
    setName(storage.get(`cc_name_${code}`) || storage.get("cc_name") || "");
  }, [code]);

  const load = useCallback(async () => {
    if (!gid) return;
    try {
      const d = await api(`/${code}?guest=${gid}`);
      setAlbum(d.album);
      setTaken(d.taken || 0);
      const g = await api(`/${code}/photos?guest=${gid}`);
      setPhotos((prev) => mergePhotos(prev, g.photos));
    } catch (e) {
      if (e.status === 404) setAlbum(null);
    }
  }, [code, gid]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);

  const saveName = (e) => {
    e.preventDefault();
    const n = draft.trim().slice(0, MAX_NAME);
    if (!n) return;
    storage.set(`cc_name_${code}`, n);
    storage.set("cc_name", n);
    setName(n);
  };

  if (album === undefined) return <Shell><p className="text-center text-white/80 pt-24">Chargement…</p></Shell>;
  if (album === null) {
    return (
      <Shell>
        <div className="bg-white rounded-3xl p-8 text-center shadow-xl mt-16">
          <p className="text-4xl mb-3">🤔</p>
          <h1 className="text-xl font-bold mb-2">Album introuvable</h1>
          <p className="text-gray-500 mb-5">Ce code ne correspond à aucun album, ou l'album a expiré.</p>
          <Link href="/clic-clac" className="inline-block bg-[#ff5a5f] text-white font-bold px-6 py-3 rounded-full">Saisir un autre code</Link>
        </div>
      </Shell>
    );
  }

  const s = album.settings;
  const left = s.guestQuota > 0 ? Math.max(0, s.guestQuota - taken) : Infinity;

  if (!name) {
    return (
      <Shell album={album}>
        <form onSubmit={saveName} className="bg-white rounded-3xl p-7 shadow-xl mt-10 space-y-4">
          <h1 className="text-2xl font-black text-gray-900">Bienvenue ! 👋</h1>
          <p className="text-gray-500">Votre prénom accompagnera vos photos dans l'album.</p>
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX_NAME} placeholder="Votre prénom"
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg focus:border-[#ff5a5f] outline-none" />
          <button disabled={!draft.trim()} className="w-full bg-[#ff5a5f] disabled:opacity-40 text-white text-lg font-bold py-3.5 rounded-full">C'est parti</button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell album={album}>
      <div className="bg-white rounded-3xl p-5 shadow-xl mt-6 text-center space-y-3">
        <p className="text-gray-500 text-sm">Bonjour <b className="text-gray-900">{name}</b> · <button onClick={() => { setName(""); setDraft(name); }} className="underline">changer</button></p>
        <button onClick={() => setStudio(true)} disabled={left === 0}
          className="w-full bg-[#ff5a5f] disabled:opacity-40 text-white text-xl font-black py-4 rounded-2xl shadow-lg active:scale-[.98] transition-transform">
          📸 Prendre une photo
        </button>
        <p className="text-xs text-gray-400">
          {left === Infinity ? `${taken} photo${taken > 1 ? "s" : ""} prise${taken > 1 ? "s" : ""}` : left === 0 ? "Vous avez utilisé toutes vos photos 🙂" : `${left} photo${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""}`}
          {s.moderation && " · les photos sont validées avant publication"}
        </p>
        {toast && <p className="text-green-600 font-semibold">{toast}</p>}
      </div>

      <div className="bg-white rounded-3xl p-3 shadow-xl mt-5">
        <h2 className="font-bold text-gray-900 px-2 pt-1 pb-3">🖼️ L'album <span className="text-gray-400 font-normal">({photos.length})</span></h2>
        <Gallery photos={photos} canDownload={s.guestDownload}
          onDelete={async (p) => { await api(`/${code}/photos/${p.id}?guest=${gid}`, { method: "DELETE" }); setPhotos((l) => l.filter((x) => x.id !== p.id)); load(); }} />
      </div>

      {studio && (
        <Studio album={album} code={code} guest={{ id: gid, name }}
          onClose={() => setStudio(false)}
          onDone={(r) => {
            setStudio(false);
            setToast(r.pending ? "✓ Photo envoyée — elle apparaîtra après validation." : "✓ Photo ajoutée à l'album !");
            setTimeout(() => setToast(""), 5000);
            load();
          }} />
      )}
    </Shell>
  );
}

function Shell({ album, children }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#ff5a5f] via-[#ff8a5b] to-[#fff8f3] bg-no-repeat [background-size:100%_420px] bg-[#fff8f3] px-4 pb-12">
      <div className="max-w-2xl mx-auto pt-6">
        <div className="flex items-center gap-3 text-white">
          <img src="/icon-clicclac.svg" alt="" className="w-10 h-10 rounded-xl shadow" />
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider opacity-80">Clic-Clac</p>
            {album && <h1 className="text-2xl font-black leading-tight truncate">{album.name}</h1>}
            {album?.eventDate && <p className="text-sm opacity-90">{formatDate(album.eventDate)}</p>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
