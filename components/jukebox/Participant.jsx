"use client";
/*
 * Jukebox — page invité (ouverte via QR code ou code à 6 chiffres) : prénom,
 * recherche (ou lien YouTube collé), ajout à la file, suivi de la file en
 * direct et retrait de ses propres titres. Sur l'appareil de la régie (jeton
 * présent), les ajouts ne sont pas limités.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play } from "lucide-react";
import { participantId, getName, setName, authHeaders, formatCode } from "./storage";
import { MAX_AUTHOR_LEN, MAX_DEDICATION_LEN, UNLIMITED_CAP, formatDuration, themeVars } from "@/lib/jukebox";
import { MAX_ANSWER_LEN } from "@/lib/jukeboxBlind";
import { Leaderboard } from "./Blind";

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
  const [dedication, setDedication] = useState("");
  const [picked, setPicked] = useState(null); // titre choisi, en attente de sa dédicace
  const [answer, setAnswer] = useState(""); // blind test
  const [verdict, setVerdict] = useState(null); // { ok, text }
  const [sending, setSending] = useState(false);
  const pid = useRef(null);

  const headers = () => ({ "Content-Type": "application/json", ...authHeaders(code) });

  const lastAct = useRef(0); // réponse partie avant une action : périmée
  const refresh = useCallback(async () => {
    const started = Date.now();
    try {
      const res = await fetch(`/api/jukebox/${code}?pid=${pid.current}`, { cache: "no-store", headers: headers() });
      if (res.status === 404) return setData(null);
      if (res.ok) {
        const d = await res.json();
        if (started > lastAct.current) setData(d);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    pid.current = participantId();
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
      const res = await fetch(`/api/jukebox/${code}/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store", headers: authHeaders(code) });
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
  useEffect(() => { setVerdict(null); }, [nowId]);

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
          <h1 className="text-xl font-bold text-gray-900 mb-2">Soirée introuvable</h1>
          <p className="text-gray-500 mb-6">Le code {formatCode(code)} ne correspond à aucune soirée.</p>
          <Link href="/jukebox" className="inline-block bg-[var(--jb-accent)] text-white font-bold px-6 py-3 rounded-full">Saisir un autre code</Link>
        </div>
      </Shell>
    );
  }

  const { session, now, queue, total, pending, admin } = data;
  const open = session.status === "open";
  const limit = session.maxPerParticipant || UNLIMITED_CAP;
  const full = !admin && pending >= limit;
  const inQueue = new Set([now?.videoId, ...queue.map((t) => t.videoId)]);

  const theme = session.theme;
  return (
    <Shell theme={theme}>
      <div className="bg-white rounded-3xl p-6 shadow-xl">
        {theme?.logo && <img src={`/api/jukebox/${code}/logo?v=${theme.logo}`} alt="" className="max-h-24 max-w-[70%] object-contain mx-auto mb-4" />}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Jukebox · {formatCode(code)}</p>
        <h1 className={`text-2xl font-extrabold text-gray-900 leading-tight ${theme?.message ? "mb-1" : "mb-5"}`}>{theme?.title || session.name}</h1>
        {theme?.message && <p className="text-gray-600 whitespace-pre-line mb-5">{theme.message}</p>}

        {!name && !admin ? (
          <form onSubmit={saveName} className="space-y-3">
            <p className="text-gray-600">Votre prénom, pour que l'on sache qui a mis ce titre :</p>
            <input autoFocus maxLength={MAX_AUTHOR_LEN} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Prénom" autoComplete="given-name" enterKeyHint="done"
              className="w-full text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-[var(--jb-accent)] outline-none" />
            <button disabled={!nameDraft.trim()}
              className="w-full bg-[var(--jb-accent)] hover:brightness-110 disabled:opacity-40 text-white font-bold py-3 rounded-full">
              C'est parti
            </button>
          </form>
        ) : data.blind?.on && !admin ? (
          <BlindGuest blind={data.blind} now={now} name={name} answer={answer} setAnswer={setAnswer}
            onSubmit={sendAnswer} sending={sending} verdict={verdict} />
        ) : !open && !admin ? (
          <p className="text-center bg-gray-100 text-gray-600 rounded-2xl py-4 font-medium">🔒 Les ajouts de titres sont bloqués pour le moment.</p>
        ) : full ? (
          <p className="text-center bg-amber-50 text-amber-800 rounded-2xl py-4 px-3 font-medium">
            ⏳ Vous avez {pending} titre{pending > 1 ? "s" : ""} en attente. Vous pourrez en proposer un autre dès qu'il{pending > 1 ? "s" : ""} passe{pending > 1 ? "nt" : ""}.
          </p>
        ) : (
          <>
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
                      <p className="text-xs text-gray-500 truncate">
                        {v.channel} · {formatDuration(v.duration)}
                        {admin && v.known ? <span title="Vidéo déjà en mémoire (aucune recherche YouTube à l'ajout)"> · ⚡ {v.known === 2 ? "validé" : "en mémoire"}</span> : null}
                      </p>
                    </div>
                    {inQueue.has(v.id) ? (
                      <span className="text-xs text-gray-400 shrink-0">Déjà dans la file</span>
                    ) : (
                      <button onClick={() => (session.dedications ? setPicked(v) : add(v))} disabled={!!adding}
                        className="shrink-0 bg-[var(--jb-accent2)] hover:brightness-110 disabled:opacity-40 text-white text-sm font-bold px-3.5 py-2 rounded-full">
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
        {now?.hidden ? (
          <p className="text-sm text-gray-500 mb-4">🤫 Titre mystère en cours…</p>
        ) : now ? (
          <div className="flex items-center gap-3 mb-4">
            {now.thumb && <img src={now.thumb} alt="" className="w-24 h-[54px] object-cover rounded-lg shrink-0" />}
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold text-[var(--jb-accent)] uppercase tracking-wider"><Play size={12} fill="currentColor" strokeWidth={0} />En ce moment</p>
              <p className="font-bold text-gray-900 leading-snug line-clamp-2">{now.title}</p>
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
                  {(t.mine || t.author) && <p className="text-xs text-gray-500">{t.mine ? "vous" : t.author}</p>}
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
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={() => !adding && setPicked(null)}>
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
        phone ? (
          done ? (
            <p className="text-center text-green-600 font-semibold">🎯 Artiste et titre trouvés ! Attendez la réponse…</p>
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
        )
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
