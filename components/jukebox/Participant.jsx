"use client";
/*
 * Jukebox — page invité (ouverte via QR code ou code à 6 chiffres) : prénom,
 * recherche (ou lien YouTube collé), ajout à la file, suivi de la file en
 * direct et retrait de ses propres titres. Sur l'appareil de la régie (jeton
 * présent), les ajouts ne sont pas limités.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { participantId, getName, setName, authHeaders, formatCode, getGuestMode, setGuestMode, hasRegieAccess, forgetParty, getAdminToken } from "./storage";
import { useLive } from "./useLive";
import { MAX_AUTHOR_LEN, MAX_DEDICATION_LEN, UNLIMITED_CAP, formatDuration, themeVars } from "@/lib/jukebox";
import { MAX_ANSWER_LEN, MAX_ATTEMPTS, DECADES, decadeLabel } from "@/lib/jukeboxBlind";
import { FrFlag } from "./FrFlag";
import { Leaderboard } from "./Blind";
import { useWakeLock } from "./useWakeLock";
import { backdropClose } from "@/lib/backdrop";

export default function Participant({ code }) {
  const [data, setData] = useState(undefined); // undefined = chargement, null = introuvable
  const [closed, setClosed] = useState(false); // soirée fermée (durée d'utilisation passée)
  const [name, setNameState] = useState("");
  const [prevName, setPrevName] = useState(""); // prénom en cours de changement (bouton Annuler)
  const [nameDraft, setNameDraft] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  // catalogue des titres vérifiés (option de la soirée) : filtres en cours, page suivante disponible
  const [browse, setBrowse] = useState(null); // null : recherche normale ; { decades: [], lang, sort, q }
  const [browseMore, setBrowseMore] = useState(false);
  const loadCatalog = async (f, append = false) => {
    setBrowse(f);
    setSearching(true);
    setError("");
    try {
      const qs = new URLSearchParams({ decade: f.decades.join(","), lang: f.lang, sort: f.sort, q: f.q, offset: append ? String(results?.length || 0) : "0" });
      const res = await fetch(`/api/jukebox/${code}/catalog?${qs}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Catalogue indisponible.");
      setResults((cur) => (append ? [...(cur || []), ...d.results] : d.results));
      setBrowseMore(!!d.more);
    } catch (err) {
      setError(err.message);
    } finally { setSearching(false); }
  };
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [dedication, setDedication] = useState("");
  const [picked, setPicked] = useState(null); // titre choisi, en attente de sa dédicace
  const [answer, setAnswer] = useState(""); // blind test
  const [verdict, setVerdict] = useState(null); // { ok, text }
  const [sending, setSending] = useState(false);
  const pid = useRef(null);
  useWakeLock(!!data?.blind?.on); // blind test : le téléphone reste allumé pour répondre

  // appareil de la régie : peut participer comme un invité (accès régie non envoyés)
  const [guestMode, setGuestModeState] = useState(false);
  const guestRef = useRef(false);
  useEffect(() => { guestRef.current = getGuestMode(code); setGuestModeState(guestRef.current); }, [code]);
  const access = () => (guestRef.current ? {} : authHeaders(code));
  const headers = () => ({ "Content-Type": "application/json", ...access() });

  const lastAct = useRef(0); // réponse partie avant une action : périmée
  const blindRef = useRef(null); // dernier état du blind test (fin de partie, cadence)
  const [final, setFinal] = useState(null); // classement final d'une partie qui vient de se terminer
  const refresh = useCallback(async () => {
    const started = Date.now();
    try {
      const res = await fetch(`/api/jukebox/${code}?pid=${pid.current}`, { cache: "no-store", headers: headers() });
      if (res.status === 404) { setClosed(!!(await res.json().catch(() => ({}))).closed); return setData(null); }
      if (res.ok) {
        const d = await res.json();
        if (started > lastAct.current) {
          // fin de partie : on garde le classement final à afficher
          if (blindRef.current?.on && !d.blind?.on && blindRef.current.mode === "phone" && blindRef.current.top?.length) setFinal(blindRef.current);
          blindRef.current = d.blind || null;
          setData(d);
        }
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    pid.current = participantId();
    setNameState(getName());
    refresh();
  }, [code, refresh]);
  // temps réel : relecture à chaque changement de la file ; filet de sécurité 15 s (4,5 s sans
  // temps réel) ; toutes les 1,5 s pendant un blind test (compte à rebours, « trop tard »)
  const blindOn = !!data?.blind?.on;
  useLive(code, refresh, { fast: blindOn ? 1500 : 4500, slow: blindOn ? 1500 : 15000, hiddenPause: true });

  const saveName = (e) => {
    e.preventDefault();
    const n = nameDraft.replace(/\s+/g, " ").trim().slice(0, MAX_AUTHOR_LEN);
    if (!n) return;
    setName(n);
    setNameState(n);
    setPrevName("");
  };

  const search = async (e) => {
    e.preventDefault();
    setBrowse(null); // recherche libre : on quitte le catalogue
    if (q.trim().length < 2 || searching) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${code}/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store", headers: access() });
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
        body: JSON.stringify({ participantId: pid.current, author: name, dedication, ...(v.deezerId ? { deezerId: v.deezerId } : { videoId: v.id }) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ajout impossible.");
      setFlash(v.title);
      setTimeout(() => setFlash(""), 2500);
      setResults(null);
      setBrowse(null);
      setDedication("");
      setPicked(null);
      setQ("");
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding("");
    }
  };

  const sendAnswer = async (e) => {
    e.preventDefault();
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/jukebox/${code}/answer`, {
        method: "POST", headers: headers(),
        body: JSON.stringify({ participantId: pid.current, author: name, answer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Réponse non enregistrée.");
      const found = [d.newArtist && "l'artiste", d.newTitle && "le titre"].filter(Boolean);
      setVerdict(found.length
        ? { ok: true, text: `🎯 Bravo, vous avez trouvé ${found.join(" et ")} ! +${d.gained} pts` }
        : { ok: false, text: `Raté… ${d.attemptsLeft > 0 ? `encore ${d.attemptsLeft} essai${d.attemptsLeft > 1 ? "s" : ""}` : "plus d'essai pour ce titre"}` });
      setAnswer("");
      refresh();
    } catch (err) {
      setVerdict({ ok: false, text: err.message });
    } finally {
      setSending(false);
    }
  };

  // nouveau titre : on efface le verdict du précédent
  const nowId = data?.now?.id;
  useEffect(() => { setVerdict(null); setAnswer(""); }, [nowId]); // et la réponse en cours de frappe

  const withdraw = async (t) => {
    if (!confirm(`Retirer « ${t.title} » de la file ?`)) return;
    lastAct.current = Date.now();
    setData((d) => ({ ...d, queue: d.queue.filter((x) => x.id !== t.id), total: Math.max(0, d.total - 1), pending: Math.max(0, d.pending - 1) })); // retiré tout de suite
    await fetch(`/api/jukebox/${code}`, {
      method: "DELETE", headers: headers(),
      body: JSON.stringify({ participantId: pid.current, id: t.id }),
    }).catch(() => {});
    lastAct.current = Date.now();
    refresh();
  };

  if (data === undefined) return <Shell><p className="text-center text-white/80">Chargement…</p></Shell>;
  if (data === null) {
    return (
      <Shell>
        <div className="bg-white rounded-3xl p-8 text-center shadow-xl">
          <p className="text-4xl mb-3">🤔</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">{closed ? "Soirée fermée" : "Soirée introuvable"}</h1>
          <p className="text-gray-500 mb-6">{closed ? "Cette soirée est terminée : on ne peut plus proposer de titres. Merci d'avoir participé !" : `Le code ${formatCode(code)} ne correspond à aucune soirée.`}</p>
          {closed && <Link href={`/jukebox/${code}/playlist`} className="block mb-3 bg-[var(--jb-accent)] text-white font-bold px-6 py-3 rounded-full">🎵 Revoir les titres de la soirée</Link>}
          <Link href="/jukebox" className={`inline-block font-bold px-6 py-3 rounded-full ${closed ? "text-gray-500 underline" : "bg-[var(--jb-accent)] text-white"}`}>Saisir un autre code</Link>
        </div>
      </Shell>
    );
  }

  const { session, now, queue, total, pending, admin } = data;
  const open = session.status === "open";
  const limit = session.maxPerParticipant || UNLIMITED_CAP;
  const full = !admin && pending >= limit;
  const songKey = (t) => `${String(t.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()}|${String(t.channel || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()}`;
  const inQueue = new Set([now?.videoId, ...queue.map((t) => t.videoId), ...[now, ...queue].filter(Boolean).map(songKey)]);
  const isQueued = (v) => inQueue.has(v.id) || inQueue.has(songKey(v)); // résultats Deezer : même titre + artiste
  const blocked = !open && !admin; // ajouts bloqués : on peut chercher, pas ajouter

  const theme = session.theme;
  return (
    <Shell theme={theme}>
      <div className="bg-white rounded-3xl p-6 shadow-xl">
        {theme?.logo && <img src={`/api/jukebox/${code}/logo?v=${theme.logo}`} alt="" className="max-h-24 max-w-[70%] object-contain mx-auto mb-4" />}
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Jukebox · {formatCode(code)}</p>
          {name && !admin && (
            <button onClick={() => { setPrevName(name); setNameDraft(name); setNameState(""); }} title="Changer de prénom"
              className="flex items-center gap-1 text-sm font-bold text-[var(--jb-accent)] bg-[var(--jb-soft)] rounded-full pl-2.5 pr-2 py-1 max-w-[55%]">
              <span aria-hidden>👤</span><span className="truncate">{name}</span><span aria-hidden className="opacity-70">✎</span>
            </button>
          )}
        </div>
        <h1 className={`text-2xl font-extrabold text-gray-900 leading-tight ${theme?.message ? "mb-1" : "mb-5"}`}>{theme?.title || session.name}</h1>
        {theme?.message && <p className="text-gray-600 whitespace-pre-line mb-5">{theme.message}</p>}

        {final && !data.blind?.on && (
          <div className="mb-5 rounded-2xl bg-[var(--jb-soft)] p-4 text-center space-y-2">
            <p className="text-xl font-black text-gray-900">🏁 Partie terminée !</p>
            {final.me?.points > 0
              ? <p className="text-gray-700">{name || "Vous"} : <b>{final.me.points} pts</b>{final.me.rank ? ` · ${final.me.rank}${final.me.rank === 1 ? "er" : "e"}` : ""} {final.me.rank === 1 ? "🏆" : ""}</p>
              : <p className="text-gray-600 text-sm">Merci d'avoir joué !</p>}
            <div className="text-left bg-white rounded-xl p-3"><Leaderboard top={final.top} light /></div>
            <button onClick={() => setFinal(null)} className="text-sm text-gray-500 underline">Fermer</button>
          </div>
        )}
        {!name && !admin ? (
          <form onSubmit={saveName} className="space-y-3">
            <p className="text-gray-600">Votre prénom, pour que l'on sache qui a mis ce titre :</p>
            <input autoFocus maxLength={MAX_AUTHOR_LEN} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Prénom" autoComplete="given-name" enterKeyHint="done"
              className="w-full text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-[var(--jb-accent)] outline-none" />
            <button disabled={!nameDraft.trim()}
              className="w-full bg-[var(--jb-accent)] hover:brightness-110 disabled:opacity-40 text-white font-bold py-3 rounded-full">
              {prevName ? "Enregistrer" : "C'est parti"}
            </button>
            {prevName && (
              <button type="button" onClick={() => { setNameState(prevName); setPrevName(""); }} className="w-full text-sm text-gray-500 underline">Annuler</button>
            )}
          </form>
        ) : data.blind?.on && !admin ? (
          <BlindGuest blind={data.blind} now={now} name={name} answer={answer} setAnswer={setAnswer}
            onSubmit={sendAnswer} sending={sending} verdict={verdict} />
        ) : (
          <>
            {blocked && <p className="text-center bg-gray-100 text-gray-600 rounded-2xl py-3 px-3 font-medium mb-3">🔒 Les ajouts de titres sont bloqués pour le moment. Vous pouvez déjà chercher votre prochain titre.</p>}
            {!blocked && full && (
              <p className="text-center bg-amber-50 text-amber-800 rounded-2xl py-3 px-3 font-medium mb-3">
                ⏳ Vous avez {pending} titre{pending > 1 ? "s" : ""} en attente. Vous pourrez en proposer un autre dès qu'il{pending > 1 ? "s" : ""} passe{pending > 1 ? "nt" : ""}.
              </p>
            )}
            {session.searchMode === "clip" && (
              <p className="text-sm font-semibold text-[var(--jb-accent)] bg-[var(--jb-soft)] rounded-xl px-3 py-2 mb-3">
                🎬 Soirée clips : les titres passent avec leur clip officiel.
              </p>
            )}
            {session.searchMode === "karaoke" && (
              <p className="text-sm font-semibold text-[var(--jb-accent)] bg-[var(--jb-soft)] rounded-xl px-3 py-2 mb-3">
                🎤 Soirée karaoké : la recherche propose en priorité les versions karaoké.
              </p>
            )}
            <form onSubmit={search} className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} enterKeyHint="search"
                placeholder="Artiste, titre… ou lien YouTube" autoComplete="off"
                className="flex-1 min-w-0 text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-[var(--jb-accent)] outline-none" />
              <button disabled={searching || q.trim().length < 2}
                className="shrink-0 bg-[var(--jb-accent)] hover:brightness-110 disabled:opacity-40 text-white font-bold px-5 rounded-2xl">
                {searching ? "…" : "🔍"}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-2 px-1">
              {admin ? "Régie : ajouts illimités." : `Bonjour ${name} · ${session.maxPerParticipant ? `${limit - pending} titre${limit - pending > 1 ? "s" : ""} possible${limit - pending > 1 ? "s" : ""}` : "titres illimités"}`}
            </p>
            {admin && hasRegieAccess(code) && (
              <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-600 space-y-1.5">
                <p>📱 Ce téléphone est connecté à la <b>régie</b> : pas de prénom ni de limite d'ajouts.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { setGuestMode(code, true); guestRef.current = true; setGuestModeState(true); refresh(); }}
                    className="font-bold text-white bg-[var(--jb-accent)] px-3 py-1.5 rounded-full">Participer comme invité</button>
                  {getAdminToken(code) && <button onClick={() => {
                    if (!confirm("Déconnecter ce téléphone de la régie ?\n\nPour la retrouver, il faudra le code régie. Les autres appareils ne sont pas touchés.")) return;
                    forgetParty(code); setGuestMode(code, false); guestRef.current = false; setGuestModeState(false); refresh();
                  }} className="font-bold text-gray-600 bg-white border border-gray-200 px-3 py-1.5 rounded-full">Se déconnecter de la régie</button>}
                </div>
              </div>
            )}
            {!admin && guestMode && hasRegieAccess(code) && (
              <button onClick={() => { setGuestMode(code, false); guestRef.current = false; setGuestModeState(false); refresh(); }}
                className="mt-1 text-xs text-gray-400 underline">↩ Revenir en mode régie sur ce téléphone</button>
            )}

            {session.catalog && !browse && (
              <button onClick={() => { setResults(null); loadCatalog({ decades: [], lang: "", sort: "plays", q: "" }); }}
                className="mt-3 w-full text-sm font-bold text-[var(--jb-accent)] bg-[var(--jb-soft)] rounded-2xl py-2.5">
                📚 Pas d'idée ? Parcourir le catalogue des titres vérifiés
              </button>
            )}
            {browse && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-gray-800">📚 Catalogue · titres vérifiés</p>
                  <button onClick={() => { setBrowse(null); setResults(null); }} className="text-sm text-gray-500 underline">Fermer</button>
                </div>
                {/* filtres : toutes les options visibles, l'option active en couleur */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <span className="w-14 shrink-0 pt-1.5 font-semibold text-gray-400">Années</span>
                    <div className="flex flex-wrap gap-1">
                      {/* plusieurs décennies possibles ; « Toutes » remet à zéro */}
                      {["", ...DECADES.map(String)].map((d) => {
                        const on = d ? browse.decades.includes(d) : !browse.decades.length;
                        const next = !d ? [] : on ? browse.decades.filter((x) => x !== d) : [...browse.decades, d];
                        return (
                          <button key={d || "all"} onClick={() => loadCatalog({ ...browse, decades: next })} aria-pressed={on}
                            className={`font-bold px-2.5 py-1 rounded-full ${on ? "bg-[var(--jb-accent)] text-white" : "bg-gray-100 text-gray-600"}`}>
                            {d ? `${on ? "✓ " : ""}${decadeLabel(Number(d))}` : "Toutes"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-semibold text-gray-400">Langue</span>
                    <Segmented value={browse.lang} onChange={(l) => loadCatalog({ ...browse, lang: l })}
                      options={[["", "Toutes"], ["fr", <><FrFlag /> Français</>], ["intl", "🌍 Intern."]]} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 font-semibold text-gray-400">Ordre</span>
                    <Segmented value={browse.sort} onChange={(o) => loadCatalog({ ...browse, sort: o })}
                      options={[["plays", "🔥 Populaires"], ["alpha", "A → Z"]]} />
                  </div>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); loadCatalog({ ...browse, q: e.currentTarget.elements.cq.value }); }} className="flex gap-1.5">
                  <input name="cq" defaultValue={browse.q} placeholder="Filtrer : artiste, titre…" autoComplete="off" enterKeyHint="search"
                    className="flex-1 min-w-0 text-sm border-2 border-gray-200 rounded-xl px-3 py-1.5 focus:border-[var(--jb-accent)] outline-none" />
                  <button className="text-sm font-bold bg-gray-100 px-3 rounded-xl">OK</button>
                </form>
              </div>
            )}
            {results && (
              <ul className="mt-4 divide-y divide-gray-100">
                {results.length === 0 && !error && (
                  browse ? (
                    <li className="py-4 text-center text-gray-500 text-sm">{searching ? "Chargement…" : (browse.decades.length || browse.lang || browse.q ? "Aucun titre vérifié avec ces filtres : essayez une autre année ou langue, ou la recherche ci-dessus." : `Aucun titre vérifié${session.searchMode === "karaoke" ? " en version karaoké" : ""} pour l'instant : utilisez la recherche ci-dessus.`)}</li>
                  ) : (
                  <li className="py-4 text-center text-gray-500 text-sm space-y-1">
                    <p className="font-semibold text-gray-700">Aucun résultat.</p>
                    <p>Essayez seulement l'artiste ou seulement le titre, vérifiez l'orthographe, ou collez un lien YouTube.</p>
                  </li>
                  )
                )}
                {results.map((v, k) => (
                  <Fragment key={v.id}>
                  {/* titres vérifiés (en tête) : intitulé, puis séparation avec les autres */}
                  {!admin && k === 0 && v.known === 2 && results.some((x) => x.known !== 2) && (
                    <li className="pt-1 pb-1.5 text-xs font-semibold text-green-700">✓ Versions vérifiées : la bonne vidéo, prête à passer</li>
                  )}
                  {!admin && k > 0 && v.known !== 2 && results[k - 1].known === 2 && (
                    <li className="pt-3 pb-1.5 text-xs font-semibold text-gray-400 border-t-2 border-gray-200">Autres versions</li>
                  )}
                  <li className="flex items-center gap-3 py-2.5">
                    {v.thumb && <img src={v.thumb} alt="" className="w-20 h-[45px] object-cover rounded-lg shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{v.title}</p>
                      <p className="text-xs text-gray-500 truncate">{v.channel} · {v.year ? `${v.year} · ` : ""}{formatDuration(v.duration)}</p>
                      {/* repères sur leur propre ligne : jamais coupés par un nom d'artiste trop long */}
                      {(v.known === 2 || (admin && v.known) || (v.playedAt && !isQueued(v))) && (
                        <p className="text-[11px] font-semibold flex flex-wrap gap-x-2">
                          {admin && v.known ? <span className="text-gray-500" title="Vidéo déjà en mémoire (aucune recherche YouTube à l'ajout)">⚡ {v.known === 2 ? "validé" : "en mémoire"}</span>
                            : v.known === 2 ? <span className="text-green-700" title="Version vérifiée : bonne vidéo, passe tout de suite">✓ vérifié</span> : null}
                          {v.playedAt && !isQueued(v) ? <span className="text-amber-700">🔁 déjà passé à {new Date(v.playedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span> : null}
                        </p>
                      )}
                    </div>
                    {isQueued(v) ? (
                      <span className="text-xs text-gray-400 shrink-0">Déjà dans la file</span>
                    ) : (
                      <button onClick={() => (session.dedications ? setPicked(v) : add(v))} disabled={!!adding || blocked || full}
                        title={blocked ? "Ajouts bloqués pour le moment" : full ? "Attendez qu'un de vos titres passe" : undefined}
                        className="shrink-0 bg-[var(--jb-accent2)] hover:brightness-110 disabled:opacity-40 text-white text-sm font-bold px-3.5 py-2 rounded-full">
                        {adding === v.id ? "…" : "+ Ajouter"}
                      </button>
                    )}
                  </li>
                  </Fragment>
                ))}
              </ul>
            )}
            {/* fin du catalogue : le dire, surtout quand il est petit (soirée karaoké : seules les versions karaoké vérifiées) */}
            {browse && !browseMore && !searching && results?.length > 0 && (
              <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2">
                {results.length} titre{results.length > 1 ? "s" : ""} vérifié{results.length > 1 ? "s" : ""}{session.searchMode !== "normal" ? ` en version ${session.searchMode === "karaoke" ? "karaoké" : "clip"}` : ""}{browse.decades.length || browse.lang || browse.q ? " avec ces filtres" : ""} pour l'instant.
                {" "}Pas trouvé votre bonheur ? Utilisez la recherche ci-dessus{session.searchMode === "karaoke" ? " : elle trouve aussi les autres versions karaoké" : ""}.
              </p>
            )}
            {browse && browseMore && results?.length > 0 && (
              <button onClick={() => loadCatalog(browse, true)} disabled={searching}
                className="mt-2 w-full text-sm font-bold text-gray-600 bg-gray-100 rounded-2xl py-2.5 disabled:opacity-50">{searching ? "…" : "Voir plus"}</button>
            )}
          </>
        )}

        {flash && <p className="mt-4 text-center text-green-600 font-semibold">✓ « {flash} » ajouté à la file !</p>}
        {error && <p className="mt-4 text-center text-red-600 text-sm">{error}</p>}
      </div>

      <div className="mt-5 bg-white/95 rounded-3xl p-6 shadow-xl">
        {now?.hidden ? (
          <p className="text-sm text-gray-500 mb-4">🤫 Titre mystère en cours…</p>
        ) : now ? (
          <div className="flex items-center gap-3 mb-4">
            {now.thumb && <img src={now.thumb} alt="" className="w-24 h-[54px] object-cover rounded-lg shrink-0" />}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--jb-accent)] uppercase tracking-wider"><Play size={12} fill="currentColor" strokeWidth={0} />En ce moment</p>
              <p className="font-bold text-gray-900 leading-snug line-clamp-2">{now.title}</p>
              {now.channel && <p className="text-sm text-gray-600 truncate">{now.channel}</p>}
              {now.mine || now.author ? (
                <p className="text-xs text-gray-500">proposé par {now.mine ? "vous" : now.author}</p>
              ) : now.revealIn ? (
                <p className="text-xs text-gray-500">🤫 Qui l'a choisi ? Réponse dans quelques instants…</p>
              ) : null}
              {now.dedication && <p className="text-sm text-[var(--jb-accent)] italic mt-0.5">💌 « {now.dedication} »</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500 mb-4">La musique n'a pas encore commencé.</p>
        )}
        {!session.guestQueue && !admin ? (
          <>
            <h2 className="font-bold text-gray-900 mb-1">Vos titres</h2>
            <p className="text-xs text-gray-400 mb-2">{total} titre{total > 1 ? "s" : ""} dans la file</p>
            {queue.length === 0 ? (
              <p className="text-sm text-gray-500">Vous n'avez aucun titre en attente.</p>
            ) : (
              <ul className="space-y-2">
                {queue.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 bg-[var(--jb-soft)]">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                      {t.channel && <p className="text-xs text-gray-500 truncate">{t.channel}</p>}
                      <p className="text-xs font-semibold text-[var(--jb-accent)]">
                        {t.ahead === 0 ? "🔜 C'est le prochain !" : `${t.ahead} titre${t.ahead > 1 ? "s" : ""} avant le vôtre`}
                      </p>
                    </div>
                    <button onClick={() => withdraw(t)} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Retirer">✕</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (<>
        <h2 className="font-bold text-gray-900 mb-2">À suivre {queue.length > 0 && <span className="text-gray-400 font-normal">({queue.length})</span>}</h2>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500">{data.blind?.on ? "Surprise… 🤫" : "La file est vide : proposez un titre !"}</p>
        ) : (
          <ol className="space-y-2">
            {queue.map((t, i) => (
              <li key={t.id} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${t.mine ? "bg-[var(--jb-soft)]" : ""}`}>
                <span className="w-5 text-right text-sm font-bold text-gray-400 shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                  <p className="text-xs text-gray-500 truncate">{[t.channel, (t.mine || t.author) && `par ${t.mine ? "vous" : t.author}`].filter(Boolean).join(" · ")}</p>
                  {t.dedication && <p className="text-xs text-[var(--jb-accent)] italic truncate">💌 « {t.dedication} »</p>}
                </div>
                {t.mine && <button onClick={() => withdraw(t)} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Retirer">✕</button>}
              </li>
            ))}
          </ol>
        )}
        </>)}
      </div>
      {picked && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" {...backdropClose(() => !adding && setPicked(null))}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); add(picked); }}
            className="w-full max-w-md bg-white rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              {picked.thumb && <img src={picked.thumb} alt="" className="w-20 h-[45px] object-cover rounded-lg shrink-0" />}
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm leading-snug line-clamp-2">{picked.title}</p>
                <p className="text-xs text-gray-500 truncate">{picked.channel} · {formatDuration(picked.duration)}</p>
              </div>
            </div>
            <div>
              <textarea autoFocus rows={2} value={dedication} onChange={(e) => setDedication(e.target.value)} maxLength={MAX_DEDICATION_LEN}
                placeholder="💌 Une dédicace ? (facultatif)"
                className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-[var(--jb-accent)] outline-none resize-none" />
              <p className="text-xs text-gray-400 text-right">{dedication.length}/{MAX_DEDICATION_LEN}</p>
            </div>
            {error && <p className="text-center text-red-600 text-sm">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setPicked(null)} disabled={!!adding}
                className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 rounded-full">Annuler</button>
              <button disabled={!!adding} className="flex-[2] bg-[var(--jb-accent2)] hover:brightness-110 disabled:opacity-40 text-white font-bold py-3 rounded-full">
                {adding ? "Ajout…" : "Ajouter à la file"}
              </button>
            </div>
          </form>
        </div>
      )}
      {!data.blind?.on && (
        <p className="mt-5 text-center"><Link href={`/jukebox/${code}/playlist`} className="text-sm font-semibold text-white/80 hover:text-white underline">🎵 Les titres déjà passés</Link></p>
      )}
    </Shell>
  );
}

/* Blind test, côté invité : saisie de la réponse (mode téléphone), points,
 * classement. */
function BlindGuest({ blind, now, name, answer, setAnswer, onSubmit, sending, verdict }) {
  const phone = blind.mode === "phone";
  const round = blind.me?.round;
  const done = round?.artist && round?.title;
  return (
    <div className="space-y-4">
      <p className="text-center font-bold text-[var(--jb-accent)] bg-[var(--jb-soft)] rounded-2xl py-3">🕵️ Blind test en cours !</p>
      {!now ? (
        <p className="text-center text-gray-500">Le prochain titre arrive…</p>
      ) : now.hidden ? (
        <>
        {blind.revealIn != null && <p className="text-center text-sm font-semibold text-gray-600">⏱️ Réponse dans <b className="tabular-nums text-gray-900">{blind.revealIn} s</b>{blind.playing === false ? " (en pause)" : ""}</p>}
        {phone ? (
          done ? (
            <p className="text-center text-green-600 font-semibold">🎯 Artiste et titre trouvés ! Attendez la réponse…</p>
          ) : (round?.attempts || 0) >= MAX_ATTEMPTS ? (
            <p className="text-center text-gray-500">Plus d'essai pour ce titre… Réponse bientôt sur l'écran !</p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-2">
              <p className="text-gray-600 text-sm">
                Artiste, titre… ou les deux ! {round?.artist ? "✓ Artiste trouvé, il reste le titre." : round?.title ? "✓ Titre trouvé, il reste l'artiste." : ""}
              </p>
              <div className="flex gap-2">
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={MAX_ANSWER_LEN} autoComplete="off" enterKeyHint="send"
                  placeholder="Votre réponse" className="flex-1 min-w-0 text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-[var(--jb-accent)] outline-none" />
                <button disabled={sending || !answer.trim()} className="shrink-0 bg-[var(--jb-accent)] hover:brightness-110 disabled:opacity-40 text-white font-bold px-5 rounded-2xl">
                  {sending ? "…" : "OK"}
                </button>
              </div>
            </form>
          )
        ) : (
          <p className="text-center text-gray-600">À vous de deviner ! La réponse arrive sur l'écran.</p>
        )}
        </>
      ) : (
        <p className="text-center text-gray-600">
          C'était <b>{now.title}</b>{now.channel ? <> — {now.channel}</> : null}
          {phone && round && (round.artist || round.title) ? <span className="block text-green-600 font-semibold mt-1">+{round.points} pts pour vous !</span> : null}
        </p>
      )}
      {verdict && <p className={`text-center text-sm font-semibold ${verdict.ok ? "text-green-600" : "text-gray-500"}`}>{verdict.text}</p>}
      {phone && (
        <div className="bg-gray-50 rounded-2xl p-4">
          <p className="text-sm text-gray-600 mb-2">
            {name} : <b className="text-gray-900">{blind.me?.points || 0} pts</b>{blind.me?.rank ? ` · ${blind.me.rank}${blind.me.rank === 1 ? "er" : "e"}` : ""}
          </p>
          <Leaderboard top={blind.top} light />
        </div>
      )}
    </div>
  );
}

function Shell({ theme, children }) {
  return (
    <div className="min-h-screen px-4 py-8" style={{ ...themeVars(theme), background: "var(--jb-guest-bg)" }}>
      <div className="max-w-md mx-auto">{children}</div>
    </div>
  );
}

/* Choix exclusif en boutons côte à côte (filtres du catalogue invités). */
function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-full bg-gray-100 p-0.5">
      {options.map(([v, label]) => (
        <button key={v || "all"} onClick={() => v !== value && onChange(v)}
          className={`font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${v === value ? "bg-[var(--jb-accent)] text-white shadow-sm" : "text-gray-600"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
