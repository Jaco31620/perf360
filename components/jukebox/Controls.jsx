"use client";
/*
 * Jukebox — commandes partagées par la régie et la télécommande : réglages
 * de la soirée, gestion de la file et boutons de lecture (lecture/pause,
 * titre suivant, volume). `act(action, extra)` envoie une action à
 * /api/jukebox/<code>/admin.
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipForward, ChevronsUp, GripVertical, Search, X, Volume1, Volume2, VolumeX, RefreshCw, ExternalLink, Check } from "lucide-react";
import { authHeaders, participantId } from "./storage";
import { MAX_CHOICES, SEARCH_MODES, FADE_CHOICES, AUTHOR_REVEAL_CHOICES, THEMES, MAX_THEME_TITLE_LEN, MAX_THEME_MESSAGE_LEN, MAX_LOGO_BYTES, maxLabel, formatDuration } from "@/lib/jukebox";

/* Réglages de la soirée, rangés par thème (invités, lecture, affichage). */
export function Settings({ session, act }) {
  return (
    <>
      <Group title="📱 Invités" first />
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">Titres en attente par invité</span>
        <select value={session.maxPerParticipant} onChange={(e) => act("max", { max: Number(e.target.value) })}
          className="bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold">
          {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
        </select>
      </label>
      <div className="space-y-1.5">
        <span className="text-white/70">🔎 Versions proposées</span>
        <div className="flex bg-white/10 rounded-full p-0.5">
          {SEARCH_MODES.map((m) => (
            <button key={m.id} onClick={() => m.id !== session.searchMode && act("searchMode", { mode: m.id })}
              className={`flex-1 px-2 py-1 rounded-full font-bold ${m.id === session.searchMode ? "bg-fuchsia-600" : "text-white/60 hover:text-white"}`}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Toggle label="💌 Dédicaces" on={session.dedications} onClick={() => act("options", { dedications: !session.dedications })}
        hint={session.dedications ? "Les invités peuvent ajouter un petit mot à leur titre." : null} />
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">👤 Nom de l'invité</span>
        <select value={session.authorReveal} onChange={(e) => act("options", { authorReveal: Number(e.target.value) })}
          className="bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold max-w-[55%]">
          {AUTHOR_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>

      <Group title="🎚️ Lecture" />
      <label className="flex items-center justify-between gap-3">
        <span className="text-white/70">Fondu enchaîné</span>
        <select value={session.fade} onChange={(e) => act("options", { fade: Number(e.target.value) })}
          className="bg-gray-900 border border-white/20 rounded-lg px-2 py-1 font-semibold">
          {FADE_CHOICES.map((n) => <option key={n} value={n}>{n ? `${n} s` : "Non"}</option>)}
        </select>
      </label>
      <Toggle label="⚖️ File équitable" on={session.fairQueue} onClick={() => act("options", { fairQueue: !session.fairQueue })}
        hint={session.fairQueue ? "Les nouveaux titres alternent entre les invités." : "Les titres passent dans l'ordre d'arrivée."} />

      <Group title="📺 Affichage" />
      <Toggle label="File à suivre sur l'écran" on={session.screenQueue} onClick={() => act("options", { screenQueue: !session.screenQueue })} />
      <Toggle label="Invités : voir toute la file" on={session.guestQueue} onClick={() => act("options", { guestQueue: !session.guestQueue })}
        hint={session.guestQueue ? null : "Ils ne voient que leurs titres et le nombre de titres avant eux."} />
      {session.theme && <ThemeSettings code={session.code} theme={session.theme} act={act} />}
    </>
  );
}

function Group({ title, first }) {
  return <p className={`text-xs font-bold uppercase tracking-wider text-white/40 ${first ? "" : "pt-3 border-t border-white/10"}`}>{title}</p>;
}

/* Image choisie → data URL réduite (512 px max, WebP) pour le logo du thème. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let url = c.toDataURL("image/webp", 0.85);
      if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png"); // navigateur sans WebP
      resolve(url);
    };
    img.onerror = () => reject(new Error("Image illisible."));
    img.src = URL.createObjectURL(file);
  });
}

/* Thème de la soirée (si le super-admin l'a activé) : ambiance, titre,
 * message d'accueil, logo. */
export function ThemeSettings({ code, theme, act }) {
  const [title, setTitle] = useState(theme.title);
  const [message, setMessage] = useState(theme.message);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(theme.title); setMessage(theme.message); }, [theme.title, theme.message]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await shrinkImage(file);
      if (dataUrl.length * 0.75 > MAX_LOGO_BYTES) throw new Error("Image trop lourde, même réduite.");
      await act("logo", { dataUrl });
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };
  const field = "w-full bg-gray-900 border border-white/20 rounded-lg px-2.5 py-1.5";

  return (
    <div className="space-y-2.5 pt-3 border-t border-white/10">
      <p className="text-xs font-bold uppercase tracking-wider text-white/40">🎨 Thème de la soirée</p>
      <div className="grid grid-cols-3 gap-1.5">
        {THEMES.map((t) => (
          <button key={t.id} onClick={() => t.id !== theme.palette && act("theme", { palette: t.id })}
            className={`rounded-lg py-2 text-xs font-bold text-white ring-2 ${t.id === theme.palette ? "ring-white" : "ring-transparent opacity-70 hover:opacity-100"}`}
            style={{ background: t.guestBg }}>
            {t.label}
          </button>
        ))}
      </div>
      <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== theme.title && act("theme", { title })}
        maxLength={MAX_THEME_TITLE_LEN} placeholder="Titre affiché (sinon le nom de la soirée)" className={field} />
      <textarea value={message} onChange={(e) => setMessage(e.target.value)} onBlur={() => message !== theme.message && act("theme", { message })}
        maxLength={MAX_THEME_MESSAGE_LEN} rows={2} placeholder="Message d'accueil (écran et invités)" className={`${field} resize-none`} />
      <div className="flex items-center gap-3">
        {theme.logo && <img src={`/api/jukebox/${code}/logo?v=${theme.logo}`} alt="Logo" className="h-10 max-w-[96px] object-contain rounded bg-white/10" />}
        <label className={`font-bold bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 cursor-pointer ${busy ? "opacity-40 pointer-events-none" : ""}`}>
          {busy ? "Envoi…" : theme.logo ? "Changer le logo" : "Ajouter un logo"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="hidden" />
        </label>
        {theme.logo && <button onClick={() => confirm("Retirer le logo ?") && act("logo", { dataUrl: null })} className="text-white/50 hover:text-red-400">Retirer</button>}
      </div>
    </div>
  );
}

/* Ajouts des invités ouverts / bloqués : interrupteur en tête de la régie et
 * de la télécommande. */
export function GuestsSwitch({ open, act, className = "" }) {
  return (
    <button onClick={() => act(open ? "close" : "open")} role="switch" aria-checked={open}
      title={open ? "Cliquer pour bloquer les ajouts des invités" : "Cliquer pour autoriser les ajouts des invités"}
      className={`inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full transition ${open ? "bg-green-500/20 text-green-300 hover:bg-green-500/30" : "bg-red-500/20 text-red-300 hover:bg-red-500/30"} ${className}`}>
      <span className={`relative w-7 h-4 rounded-full ${open ? "bg-green-500" : "bg-white/25"}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${open ? "left-3.5" : "left-0.5"}`} />
      </span>
      {open ? "Ajouts des invités ouverts" : "Ajouts des invités bloqués"}
    </button>
  );
}

/* Ajout d'un titre par la régie / la télécommande, sans quitter la page
 * (mêmes recherche et ajout que les invités, sans limite). */
export function AddTrack({ code, queue, now, onAdded }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(""); // "search" | id du titre en cours d'ajout
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const inQueue = new Set([now?.videoId, ...queue.map((t) => t.videoId)]);

  const search = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2 || busy) return;
    setBusy("search");
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${code}/search?q=${encodeURIComponent(q.trim())}`, { cache: "no-store", headers: authHeaders(code) });
      const d = await res.json();
      setResults(d.results || []);
      if (d.error) setError(d.error);
    } catch (err) { setError("Recherche impossible."); } finally { setBusy(""); }
  };
  const add = async (v) => {
    setBusy(v.id);
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${code}`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(code) },
        body: JSON.stringify({ participantId: participantId(), author: "", ...(v.deezerId ? { deezerId: v.deezerId } : { videoId: v.id }) }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Ajout impossible.");
      setFlash(v.title);
      setTimeout(() => setFlash(""), 2500);
      setResults(null);
      setQ("");
      onAdded?.();
    } catch (err) { setError(err.message); } finally { setBusy(""); }
  };

  return (
    <div className="bg-white/5 rounded-2xl p-3 space-y-2">
      <form onSubmit={search} className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ajouter un titre : artiste, titre ou lien YouTube" enterKeyHint="search"
            className="w-full bg-gray-900 border border-white/15 rounded-full pl-9 pr-3 py-2 text-sm focus:border-fuchsia-500 outline-none" />
        </div>
        <button disabled={busy === "search" || q.trim().length < 2} className="shrink-0 font-bold text-sm bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 rounded-full px-4">
          {busy === "search" ? "…" : "Chercher"}
        </button>
      </form>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {flash && <p className="text-xs text-green-400 font-semibold">✓ « {flash} » ajouté à la file</p>}
      {results && (
        <div>
          <div className="flex justify-between items-center text-xs text-white/40 mb-1">
            <span>{results.length ? `${results.length} résultat${results.length > 1 ? "s" : ""} · ⚡ = déjà en mémoire` : "Aucun résultat."}</span>
            <button onClick={() => setResults(null)} className="hover:text-white">Fermer ✕</button>
          </div>
          <ul className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {results.map((v) => (
              <li key={v.id} className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-white/5">
                {v.thumb && <img src={v.thumb} alt="" className="w-10 h-10 object-cover rounded shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{v.title}</p>
                  <p className="text-xs text-white/50 truncate">
                    {v.channel} · {formatDuration(v.duration)}{v.known ? ` · ⚡ ${v.known === 2 ? "validé" : "en mémoire"}` : ""}
                  </p>
                </div>
                {inQueue.has(v.id) ? (
                  <span className="text-xs text-white/40 shrink-0">Dans la file</span>
                ) : (
                  <button onClick={() => add(v)} disabled={!!busy && busy !== "search"}
                    className="shrink-0 text-xs font-bold bg-white/10 hover:bg-fuchsia-600 disabled:opacity-40 rounded-full px-3 py-1.5">
                    {busy === v.id ? "…" : "+ Ajouter"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* File d'attente : glisser-déposer (poignée ⠿, souris ou doigt), en tête,
 * jouer maintenant, retirer ; clic sur le titre : « Mauvaise vidéo ? ». */
export function QueueList({ queue, act, playNow, onFixVideo }) {
  const [drag, setDrag] = useState(null); // { id, from, over }
  const dragRef = useRef(null);
  dragRef.current = drag;
  const startDrag = (e, t, i) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: t.id, from: i, over: i });
  };
  const moveDrag = (e) => {
    if (!dragRef.current) return;
    const li = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-qi]");
    if (li) setDrag((d) => d && { ...d, over: Number(li.dataset.qi) });
  };
  const endDrag = () => {
    const d = dragRef.current;
    setDrag(null);
    if (d && d.over !== d.from) act("move", { id: d.id, to: d.over });
  };
  // aperçu pendant le glisser : le titre déplacé à sa future place
  const shown = (() => {
    if (!drag || drag.over === drag.from) return queue;
    const q = [...queue];
    q.splice(drag.over, 0, q.splice(drag.from, 1)[0]);
    return q;
  })();

  return (
    <div className="bg-white/5 rounded-2xl p-4">
      <h2 className="font-bold mb-3">À suivre <span className="text-white/40 font-normal">({queue.length})</span></h2>
      {queue.length === 0 ? (
        <p className="text-sm text-white/50">La file est vide.</p>
      ) : (
        <ol className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
          {shown.map((t, i) => (
            <li key={t.id} data-qi={i}
              className={`flex items-center gap-2 rounded-xl p-2 transition-colors ${drag?.id === t.id ? "bg-fuchsia-600/30 ring-1 ring-fuchsia-400" : "bg-white/5"}`}>
              {queue.length > 1 && (
                <button onPointerDown={(e) => startDrag(e, t, queue.indexOf(t))} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}
                  aria-label="Déplacer (glisser)" title="Glisser pour déplacer"
                  className="shrink-0 -ml-1 p-1 text-white/30 hover:text-white cursor-grab active:cursor-grabbing touch-none">
                  <GripVertical size={16} />
                </button>
              )}
              {t.thumb && <img src={t.thumb} alt="" className="w-14 h-8 object-cover rounded shrink-0" />}
              <div className="flex-1 min-w-0">
                {onFixVideo ? (
                  <button onClick={() => onFixVideo(t)} title="Mauvaise vidéo ? Cliquer pour en choisir une autre"
                    className="group block max-w-full text-left text-sm font-semibold truncate hover:text-fuchsia-300">
                    {t.title} <RefreshCw size={11} className="inline opacity-0 group-hover:opacity-60" />
                  </button>
                ) : <p className="text-sm font-semibold truncate">{t.title}</p>}
                <p className="text-xs text-white/50 truncate">{[t.channel, t.author, formatDuration(t.duration)].filter(Boolean).join(" · ")}</p>
                {t.dedication && (
                  <p className="text-xs text-fuchsia-300 italic flex items-start gap-1">
                    <span className="min-w-0 break-words">💌 « {t.dedication} »</span>
                    <button onClick={() => confirm("Effacer cette dédicace ?") && act("clearDedication", { id: t.id })}
                      className="not-italic text-white/40 hover:text-red-400 shrink-0" aria-label="Effacer la dédicace">✕</button>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 text-white/50">
                <IconBtn label="Jouer maintenant" onClick={() => playNow(t)}><Play size={15} fill="currentColor" /></IconBtn>
                <IconBtn label="En tête de file" disabled={i === 0} onClick={() => act("move", { id: t.id, dir: "top" })}><ChevronsUp size={17} /></IconBtn>
                <IconBtn label="Retirer" danger onClick={() => confirm(`Retirer « ${t.title} » ?`) && act("remove", { id: t.id })}><X size={16} /></IconBtn>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Toggle({ label, on, onClick, hint }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-white/70">{label}</span>
        <button onClick={onClick} role="switch" aria-checked={on}
          className={`font-bold px-3 py-1.5 rounded-full shrink-0 ${on ? "bg-fuchsia-600 hover:bg-fuchsia-700" : "bg-white/10 hover:bg-white/20"}`}>
          {on ? "Oui" : "Non"}
        </button>
      </div>
      {hint && <p className="text-xs text-white/40 mt-1">{hint}</p>}
    </div>
  );
}

export function IconBtn({ label, onClick, disabled, danger, children }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`inline-flex items-center justify-center w-9 h-9 lg:w-7 lg:h-7 rounded-lg disabled:opacity-20 ${danger ? "hover:text-red-400" : "hover:text-white"} hover:bg-white/10`}>
      {children}
    </button>
  );
}


/* ---------- Boutons de lecture ---------- */

/* Lecture / pause : rond en dégradé, icône pleine. size : "md" | "lg". */
export function PlayPauseButton({ playing, onClick, disabled, size = "md" }) {
  const big = size === "lg";
  return (
    <button onClick={onClick} disabled={disabled} aria-label={playing ? "Pause" : "Lecture"}
      className={`inline-flex items-center justify-center rounded-full text-white bg-gradient-to-br from-fuchsia-500 to-indigo-600
        shadow-lg shadow-fuchsia-600/40 ring-1 ring-white/20 transition-transform hover:scale-105 active:scale-95
        disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 ${big ? "w-20 h-20" : "w-14 h-14"}`}>
      {playing
        ? <Pause size={big ? 34 : 24} fill="currentColor" strokeWidth={0} />
        : <Play size={big ? 34 : 24} fill="currentColor" strokeWidth={0} className={big ? "ml-1.5" : "ml-1"} />}
    </button>
  );
}

/* Titre suivant : rond translucide. */
export function SkipButton({ onClick, disabled, size = "md" }) {
  const big = size === "lg";
  return (
    <button onClick={onClick} disabled={disabled} aria-label="Titre suivant" title="Titre suivant"
      className={`inline-flex items-center justify-center rounded-full text-white bg-white/10 ring-1 ring-white/15 backdrop-blur
        transition hover:bg-white/20 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 ${big ? "w-14 h-14" : "w-11 h-11"}`}>
      <SkipForward size={big ? 24 : 19} fill="currentColor" strokeWidth={1.5} />
    </button>
  );
}

/* Volume : icône selon le niveau + curseur rempli en dégradé. */
export function VolumeSlider({ value, onChange, className = "" }) {
  const Icon = value === 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <label className={`flex items-center gap-2.5 text-white/70 ${className}`}>
      <button type="button" onClick={() => onChange(value === 0 ? 70 : 0)} aria-label={value === 0 ? "Remettre le son" : "Couper le son"}
        className="shrink-0 hover:text-white"><Icon size={20} /></button>
      <input type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Volume"
        style={{ background: `linear-gradient(to right, #d946ef 0%, #6366f1 ${value}%, rgba(255,255,255,.15) ${value}%)` }}
        className="flex-1 min-w-0 h-1.5 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
          [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0" />
    </label>
  );
}

/* ---------- « Mauvaise vidéo ? » ----------
 * Fenêtre de la régie / télécommande : autres vidéos YouTube possibles pour
 * un titre (servies par le cache) ou lien collé. Le choix remplace la vidéo
 * du titre et corrige la mémoire des titres pour les prochaines soirées. */
export function FixVideoButton({ onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white underline">
      <RefreshCw size={12} /> Mauvaise vidéo ?
    </button>
  );
}

/* Titre de la file (régie / télécommande). */
export function VideoPicker({ code, track, onClose, onDone, mute }) {
  const post = async (body) => {
    const res = await fetch(`/api/jukebox/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(code) },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  };
  return (
    <VideoChooser title={track.title} subtitle={track.channel} initial={track.videoId} onClose={onClose} onDone={onDone} mute={mute}
      load={() => post({ action: "videos", id: track.id })}
      choose={(videoId) => post({ action: "replaceVideo", id: track.id, videoId })} />
  );
}

/* Aperçu d'une vidéo YouTube dans la page (lecteur intégré). mute : sans son
 * (régie : le son partirait sur la sono de la soirée). */
export function VideoPreview({ videoId, onClose, mute, start }) {
  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <iframe key={videoId} src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&cc_load_policy=0&iv_load_policy=3${mute ? "&mute=1" : ""}${start ? `&start=${start}` : ""}`} title="Aperçu"
        allow="autoplay; encrypted-media; fullscreen" allowFullScreen className="absolute inset-0 w-full h-full" />
      {onClose && (
        <button onClick={onClose} aria-label="Fermer l'aperçu"
          className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 text-white rounded-full p-1.5"><X size={16} /></button>
      )}
    </div>
  );
}

/* Miniature cliquable : lance l'aperçu. */
export function PreviewThumb({ videoId, src, active, onClick, className = "w-24" }) {
  return (
    <button type="button" onClick={onClick} title="Aperçu" className={`relative shrink-0 group ${className}`}>
      <img src={src || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="" className="w-full aspect-video object-cover rounded-lg" />
      <span className={`absolute inset-0 flex items-center justify-center rounded-lg transition ${active ? "bg-black/50" : "bg-black/0 group-hover:bg-black/40"}`}>
        <span className={`rounded-full bg-white/90 text-gray-900 p-1.5 transition ${active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          <Play size={14} fill="currentColor" strokeWidth={0} />
        </span>
      </span>
    </button>
  );
}

/* Fenêtre générique : load() → { current, candidates } ; choose(videoId). */
export function VideoChooser({ title, subtitle, initial, load, choose: save, onClose, onDone, mute }) {
  const [list, setList] = useState(null);
  const [current, setCurrent] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState(null); // vidéo en aperçu

  useEffect(() => {
    load()
      .then((d) => { setList(d.candidates || []); setCurrent(d.current); })
      .catch((e) => { setList([]); setError(e.message); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (videoId) => {
    setBusy(videoId);
    setError("");
    try {
      await save(videoId);
      onDone?.();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy("");
    }
  };

  const linkId = (() => {
    const m = link.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
    return m ? m[1] : null;
  })();

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center p-3" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-gray-900 text-white rounded-3xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-400">Mauvaise vidéo ?</p>
            <p className="font-bold leading-snug">{title}</p>
            <p className="text-xs text-white/50">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Fermer"><X size={20} /></button>
        </div>
        <p className="text-xs text-white/50">Choisissez la bonne version : elle remplace la vidéo de ce titre et sera retenue pour les prochaines soirées. Cliquez une miniature pour l'écouter.</p>
        {mute && <p className="text-xs text-amber-300">🔇 Aperçu sans son, pour ne pas couper la musique de la soirée.</p>}
        {preview && <VideoPreview videoId={preview} onClose={() => setPreview(null)} mute={mute} />}

        {list === null ? (
          <p className="text-white/60 text-sm py-4 text-center">Recherche des autres versions…</p>
        ) : (
          <ul className="space-y-2">
            {list.map((v) => (
              <li key={v.id} className={`flex items-center gap-3 rounded-xl p-2 ${v.id === current ? "bg-fuchsia-600/20 ring-1 ring-fuchsia-500/50" : "bg-white/5"}`}>
                <PreviewThumb videoId={v.id} src={v.thumb} active={preview === v.id} onClick={() => setPreview(preview === v.id ? null : v.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-snug line-clamp-2">{v.title}</p>
                  <p className="text-xs text-white/50 truncate">{v.channel} · {formatDuration(v.duration)}</p>
                  <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white"><ExternalLink size={11} /> voir sur YouTube</a>
                </div>
                {v.id === current ? (
                  <span className="inline-flex items-center gap-1 text-xs text-fuchsia-300 shrink-0"><Check size={14} /> actuelle</span>
                ) : (
                  <button onClick={() => choose(v.id)} disabled={!!busy}
                    className="shrink-0 bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-sm font-bold px-3 py-1.5 rounded-full">
                    {busy === v.id ? "…" : "Choisir"}
                  </button>
                )}
              </li>
            ))}
            {list.length === 0 && !error && <li className="text-sm text-white/50 text-center py-3">Aucune autre version trouvée.</li>}
          </ul>
        )}

        <div className="flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="… ou collez un lien YouTube"
            className="flex-1 min-w-0 bg-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-fuchsia-500" />
          <button onClick={() => linkId && setPreview(linkId)} disabled={!linkId}
            className="shrink-0 bg-white/10 hover:bg-white/20 disabled:opacity-30 text-sm font-bold px-3 rounded-xl">Écouter</button>
          <button onClick={() => linkId && choose(linkId)} disabled={!linkId || !!busy}
            className="shrink-0 bg-white/15 hover:bg-white/25 disabled:opacity-30 text-sm font-bold px-3 rounded-xl">
            {busy && busy === linkId ? "…" : "Utiliser"}
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
