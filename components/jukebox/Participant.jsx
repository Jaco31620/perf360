"use client";
/*
 * Jukebox — page invité (ouverte via QR code ou code à 6 chiffres) : prénom,
 * recherche (ou lien YouTube collé), ajout à la file, suivi de la file en
 * direct et retrait de ses propres titres. Sur l'appareil de la régie (jeton
 * présent), les ajouts ne sont pas limités.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { participantId, getName, setName, getAdminToken, formatCode } from "./storage";
import { MAX_AUTHOR_LEN, UNLIMITED_CAP, formatDuration } from "@/lib/jukebox";

export default function Participant({ code }) {
  const [data, setData] = useState(undefined); // undefined = chargement, null = introuvable
  const [name, setNameState] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const pid = useRef(null);
  const token = useRef(null);

  const headers = () => ({ "Content-Type": "application/json", ...(token.current ? { "x-jukebox-admin": token.current } : {}) });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jukebox/${code}?pid=${pid.current}`, { cache: "no-store", headers: headers() });
      if (res.status === 404) return setData(null);
      if (res.ok) setData(await res.json());
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    pid.current = participantId();
    token.current = getAdminToken(code);
    setNameState(getName());
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 4000);
    return () => clearInterval(id);
  }, [code, refresh]);

  const saveName = (e) => {
    e.preventDefault();
    const n = nameDraft.replace(/\s+/g, " ").trim().slice(0, MAX_AUTHOR_LEN);
    if (!n) return;
    setName(n);
    setNameState(n);
  };

  const search = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2 || searching) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${code}/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const d = await res.json();
      setResults(d.results || []);
      if (d.error) setError(d.error);
    } catch (err) {
      setError("Recherche impossible.");
    } finally {
      setSearching(false);
    }
  };

  const add = async (v) => {
    setAdding(v.id);
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${code}`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ participantId: pid.current, author: name, videoId: v.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ajout impossible.");
      setFlash(v.title);
      setTimeout(() => setFlash(""), 2500);
      setResults(null);
      setQ("");
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding("");
    }
  };

  const withdraw = async (t) => {
    if (!confirm(`Retirer « ${t.title} » de la file ?`)) return;
    await fetch(`/api/jukebox/${code}`, {
      method: "DELETE", headers: headers(),
      body: JSON.stringify({ participantId: pid.current, id: t.id }),
    }).catch(() => {});
    refresh();
  };

  if (data === undefined) return <Shell><p className="text-center text-white/80">Chargement…</p></Shell>;
  if (data === null) {
    return (
      <Shell>
        <div className="bg-white rounded-3xl p-8 text-center shadow-xl">
          <p className="text-4xl mb-3">🤔</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Soirée introuvable</h1>
          <p className="text-gray-500 mb-6">Le code {formatCode(code)} ne correspond à aucune soirée.</p>
          <Link href="/jukebox" className="inline-block bg-fuchsia-600 text-white font-bold px-6 py-3 rounded-full">Saisir un autre code</Link>
        </div>
      </Shell>
    );
  }

  const { session, now, queue, pending, admin } = data;
  const open = session.status === "open";
  const limit = session.maxPerParticipant || UNLIMITED_CAP;
  const full = !admin && pending >= limit;
  const inQueue = new Set([now?.videoId, ...queue.map((t) => t.videoId)]);

  return (
    <Shell>
      <div className="bg-white rounded-3xl p-6 shadow-xl">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Jukebox · {formatCode(code)}</p>
        <h1 className="text-2xl font-extrabold text-gray-900 leading-tight mb-5">{session.name}</h1>

        {!name && !admin ? (
          <form onSubmit={saveName} className="space-y-3">
            <p className="text-gray-600">Votre prénom, pour que l'on sache qui a mis ce titre :</p>
            <input autoFocus maxLength={MAX_AUTHOR_LEN} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Prénom" autoComplete="given-name" enterKeyHint="done"
              className="w-full text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-fuchsia-500 outline-none" />
            <button disabled={!nameDraft.trim()}
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white font-bold py-3 rounded-full">
              C'est parti
            </button>
          </form>
        ) : !open && !admin ? (
          <p className="text-center bg-gray-100 text-gray-600 rounded-2xl py-4 font-medium">🔒 Les ajouts de titres sont bloqués pour le moment.</p>
        ) : full ? (
          <p className="text-center bg-amber-50 text-amber-800 rounded-2xl py-4 px-3 font-medium">
            ⏳ Vous avez {pending} titre{pending > 1 ? "s" : ""} en attente. Vous pourrez en proposer un autre dès qu'il{pending > 1 ? "s" : ""} passe{pending > 1 ? "nt" : ""}.
          </p>
        ) : (
          <>
            <form onSubmit={search} className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} enterKeyHint="search"
                placeholder="Artiste, titre… ou lien YouTube" autoComplete="off"
                className="flex-1 min-w-0 text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-fuchsia-500 outline-none" />
              <button disabled={searching || q.trim().length < 2}
                className="shrink-0 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white font-bold px-5 rounded-2xl">
                {searching ? "…" : "🔍"}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-2 px-1">
              {admin ? "Régie : ajouts illimités." : `Bonjour ${name} · ${session.maxPerParticipant ? `${limit - pending} titre${limit - pending > 1 ? "s" : ""} possible${limit - pending > 1 ? "s" : ""}` : "titres illimités"}`}
              {!admin && <button onClick={() => { setNameState(""); setNameDraft(name); }} className="ml-2 underline">changer de prénom</button>}
            </p>

            {results && (
              <ul className="mt-4 divide-y divide-gray-100">
                {results.length === 0 && !error && <li className="py-4 text-center text-gray-500">Aucun résultat.</li>}
                {results.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2.5">
                    {v.thumb && <img src={v.thumb} alt="" className="w-20 h-[45px] object-cover rounded-lg shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{v.title}</p>
                      <p className="text-xs text-gray-500 truncate">{v.channel} · {formatDuration(v.duration)}</p>
                    </div>
                    {inQueue.has(v.id) ? (
                      <span className="text-xs text-gray-400 shrink-0">Déjà dans la file</span>
                    ) : (
                      <button onClick={() => add(v)} disabled={!!adding}
                        className="shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold px-3.5 py-2 rounded-full">
                        {adding === v.id ? "…" : "+ Ajouter"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {flash && <p className="mt-4 text-center text-green-600 font-semibold">✓ « {flash} » ajouté à la file !</p>}
        {error && <p className="mt-4 text-center text-red-600 text-sm">{error}</p>}
      </div>

      <div className="mt-5 bg-white/95 rounded-3xl p-6 shadow-xl">
        {now ? (
          <div className="flex items-center gap-3 mb-4">
            {now.thumb && <img src={now.thumb} alt="" className="w-24 h-[54px] object-cover rounded-lg shrink-0" />}
            <div className="min-w-0">
              <p className="text-xs font-bold text-fuchsia-600 uppercase tracking-wider">▶ En ce moment</p>
              <p className="font-bold text-gray-900 leading-snug line-clamp-2">{now.title}</p>
              <p className="text-xs text-gray-500">proposé par {now.mine ? "vous" : now.author}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 mb-4">La musique n'a pas encore commencé.</p>
        )}
        <h2 className="font-bold text-gray-900 mb-2">À suivre {queue.length > 0 && <span className="text-gray-400 font-normal">({queue.length})</span>}</h2>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500">La file est vide : proposez un titre !</p>
        ) : (
          <ol className="space-y-2">
            {queue.map((t, i) => (
              <li key={t.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${t.mine ? "bg-fuchsia-50" : ""}`}>
                <span className="w-5 text-right text-sm font-bold text-gray-400 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                  <p className="text-xs text-gray-500">{t.mine ? "vous" : t.author}</p>
                </div>
                {t.mine && <button onClick={() => withdraw(t)} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Retirer">✕</button>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900 px-4 py-8">
      <div className="max-w-md mx-auto">{children}</div>
    </div>
  );
}
