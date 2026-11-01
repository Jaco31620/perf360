"use client";
/* Les titres joués pendant la soirée, à retrouver ensuite (YouTube, Deezer, Spotify). */
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { formatCode } from "@/components/jukebox/storage";

export default function PlaylistPage({ params }) {
  const { code } = use(params);
  const [d, setD] = useState(undefined);
  useEffect(() => {
    fetch(`/api/jukebox/${code}/playlist`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, [code]);
  const q = (t) => encodeURIComponent(`${t.artist || ""} ${t.title || ""}`.trim());
  return (
    <div className="min-h-screen bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900 px-4 py-8">
      <div className="max-w-xl mx-auto space-y-5">
        <Link href={`/jukebox/${code}`} className="text-white/80 text-sm font-bold">← Soirée {formatCode(code)}</Link>
        <div className="bg-white rounded-3xl p-6 shadow-xl">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Jukebox · les titres de la soirée</p>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-4">{d?.name || "…"}</h1>
          {d === undefined && <p className="text-gray-400">Chargement…</p>}
          {d === null && <p className="text-gray-500">Cette soirée n'existe pas (ou plus).</p>}
          {d && d.tracks.length === 0 && <p className="text-gray-500">Aucun titre joué pour l'instant.</p>}
          {d && d.tracks.length > 0 && (
            <ol className="divide-y divide-gray-100">
              {d.tracks.map((t, i) => (
                <li key={i} className="py-2.5 flex items-center gap-3">
                  <span className="w-6 text-right text-xs text-gray-400 tabular-nums shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-gray-900 text-sm truncate">{t.title}</span>
                    <span className="block text-xs text-gray-500 truncate">{t.artist}</span>
                  </span>
                  <span className="flex gap-1.5 shrink-0 text-xs font-bold">
                    <a href={`https://www.youtube.com/watch?v=${t.videoId}`} target="_blank" rel="noreferrer" className="bg-red-50 text-red-700 px-2 py-1 rounded-full">YouTube</a>
                    <a href={`https://www.deezer.com/search/${q(t)}`} target="_blank" rel="noreferrer" className="bg-purple-50 text-purple-700 px-2 py-1 rounded-full">Deezer</a>
                    <a href={`https://open.spotify.com/search/${q(t)}`} target="_blank" rel="noreferrer" className="bg-green-50 text-green-700 px-2 py-1 rounded-full">Spotify</a>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
