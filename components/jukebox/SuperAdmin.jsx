"use client";
/*
 * Jukebox — super-admin (/jukebox/admin), mot de passe de Clic-Clac :
 * toutes les soirées (activité, suppression prévue), accès à leur régie,
 * nouveau lien régie, suppression ; codes d'activation individuels des
 * organisateurs (onglet Codes) ; réglages de conservation et de création ;
 * recherches YouTube du jour ; mémoire des titres (recherche, oubli) et
 * son pré-remplissage (titres cherchés par le cron de 6 h).
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { getSuperToken, setSuperToken, setAdminToken, rememberParty, formatCode } from "./storage";
import { VideoChooser, VideoPreview, PreviewThumb } from "./Controls";
import { inviteText, fmtRegieCode } from "./Access";
import { MAX_NAME_LEN, MAX_CHOICES, SEARCH_MODES, FADE_CHOICES, AUTHOR_REVEAL_CHOICES, FEATURES, THEMES, SOIREE_DEFAULTS, maxLabel, formatDuration } from "@/lib/jukebox";
import { BLIND_MODES, BLIND_REVEAL_CHOICES, BLIND_AFTER_CHOICES, BLIND_LANGS, DECADES, decadeLabel } from "@/lib/jukeboxBlind";

const RETENTION_CHOICES = [1, 2, 3, 7, 14, 30];
const CREATION_MODES = [
  { id: "open", label: "Tout le monde", hint: "Toute personne qui connaît l'adresse /jukebox peut créer une soirée." },
  { id: "code", label: "Avec un code", hint: "Chaque organisateur saisit son propre code d'activation (onglet 🎟️ Codes)." },
  { id: "super", label: "Super-admin seul", hint: "Vous créez les soirées ici et transmettez le lien régie." },
];
const SEARCH_QUOTA = 100; // ~10 000 unités / jour, 100 par recherche
const QUOTA_NOTE = "Remise à zéro chaque jour à minuit heure du Pacifique (8 h ou 9 h à Paris selon la saison). Les recherches déjà faites et les liens collés ne comptent pas. Avec Deezer, seul l'ajout d'un titre jamais choisi compte.";

const fmtDate = (ms) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function fmtIn(ms) {
  const d = ms - Date.now();
  if (d <= 0) return "à la prochaine purge";
  const h = Math.round(d / 3600e3);
  return h < 48 ? `dans ${h} h` : `dans ${Math.round(h / 24)} j`;
}

export default function SuperAdmin() {
  const [token, setToken] = useState(undefined);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [origin, setOrigin] = useState("");
  const [link, setLink] = useState(null); // { name, code, regieCode } invitation à transmettre à l'organisateur
  const [filter, setFilter] = useState("");
  const [actFilter, setActFilter] = useState(""); // recherche de l'onglet Codes
  const [focus, setFocus] = useState(null); // { on: "memory" | "queue", at } : tuile cliquée
  const goTo = (on) => { chooseTab(on); setFocus({ on, at: Date.now() }); };
  const [tab, setTab] = useState("soirees"); // onglet retenu par appareil
  useEffect(() => { try { const t = localStorage.getItem("jukebox:superTab"); if (["soirees", "codes", "reglages", "memory", "queue"].includes(t)) setTab(t); } catch (e) { /* ignoré */ } }, []);
  const chooseTab = (t) => { setTab(t); try { localStorage.setItem("jukebox:superTab", t); } catch (e) { /* ignoré */ } };
  const matches = (s) => {
    const q = filter.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.code.includes(q.replace(/\s/g, "")) || (s.organizer || "").toLowerCase().includes(q);
  };

  useEffect(() => { setToken(getSuperToken()); setOrigin(window.location.origin); }, []);

  const call = useCallback(async (method, body) => {
    const res = await fetch("/api/jukebox/super", {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", "x-jukebox-super": token || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { setSuperToken(null); setToken(null); throw new Error("Session expirée."); }
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await call("GET")); } catch (e) { /* géré par call */ }
  }, [token, call]);
  useEffect(() => { load(); }, [load]);

  const login = async (e) => {
    e.preventDefault();
    setErr("");
    const res = await fetch("/api/jukebox/super/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Connexion impossible.");
    setSuperToken(d.token);
    setToken(d.token);
    setPw("");
  };

  // Réglages affichés dès le clic ; actions envoyées une par une, dans l'ordre.
  const queue = useRef(Promise.resolve());
  const action = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return null;
    setData((d) => applyLocally(d, body));
    const run = queue.current.then(() => call("POST", body));
    queue.current = run.catch(() => {});
    try { const d = await run; await load(); return d; } catch (e) { alert(e.message); load(); return null; }
  };

  if (token === undefined) return null;
  if (!token) {
    return (
      <Page>
        <form onSubmit={login} className="max-w-sm mx-auto bg-white rounded-3xl shadow-xl p-7 mt-10 space-y-4">
          <h1 className="text-xl font-black">Super-admin Jukebox</h1>
          <p className="text-sm text-gray-500">Même mot de passe que le super-admin Clic-Clac.</p>
          <PasswordInput autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe"
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-fuchsia-500 outline-none" />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button className="w-full bg-gray-900 text-white font-bold py-3 rounded-full">Se connecter</button>
        </form>
      </Page>
    );
  }

  const cfg = data?.config;
  const nSessions = data?.sessions.length ?? 0;
  const tabs = [
    { id: "soirees", label: `🎉 Soirées${nSessions ? ` (${nSessions})` : ""}` },
    { id: "codes", label: `🎟️ Codes${data?.activations?.length ? ` (${data.activations.length})` : ""}` },
    { id: "reglages", label: "⚙️ Réglages" },
  ];
  const quotaPct = data ? Math.min(100, (data.searches / SEARCH_QUOTA) * 100) : 0;

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600">Super-admin</p>
          <h1 className="text-3xl font-black text-gray-900">Jukebox</h1>
        </div>
        <button onClick={() => { setSuperToken(null); setToken(null); }} className="text-sm text-gray-400 underline">Se déconnecter</button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Recherches YouTube aujourd'hui" value={`${data.searches} / ~${SEARCH_QUOTA}`} title={QUOTA_NOTE}>
            <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
              <div className={`h-full ${quotaPct >= 80 ? "bg-red-500" : "bg-fuchsia-500"}`} style={{ width: `${quotaPct}%` }} />
            </div>
          </Stat>
          <Stat label="🎵 Titres en mémoire" value={data.songs} active={tab === "memory"} onClick={() => goTo("memory")} />
          <Stat label="🌅 En attente de pré-remplissage" value={data.prefill?.pending ?? 0} active={tab === "queue"} onClick={() => goTo("queue")} />
        </div>
      )}

      <div className="flex bg-white border border-purple-100 rounded-full p-1 mb-4 w-full sm:w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => chooseTab(t.id)}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-full font-bold text-sm whitespace-nowrap ${tab === t.id ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "soirees" && (
        <>
          <CreateForm token={token} defaults={cfg?.defaultFeatures} defaultOptions={cfg?.defaultOptions} onCreated={(code, adminToken, name, regieCode) => {
            setAdminToken(code, adminToken);
            rememberParty(code, name);
            setLink({ name, code, regieCode });
            load();
          }} />
          {link && <InviteBox {...link} origin={origin} onClose={() => setLink(null)} />}
          {(nSessions > 5 || filter) && (
            <SearchInput value={filter} onChange={setFilter} placeholder="Rechercher une soirée (nom, code ou organisateur)" className="mt-4 w-full" />
          )}
          <div className="space-y-3 mt-4">
            {data && nSessions === 0 && <p className="text-gray-400 text-center py-10">Aucune soirée.</p>}
            {data?.sessions.filter(matches).map((s) => (
              <div key={s.code} className="bg-white rounded-2xl border border-purple-100 p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-bold text-gray-900">{s.name} <span className="font-mono text-fuchsia-600 text-sm ml-1">{formatCode(s.code)}</span></p>
                  <p className="text-xs text-gray-500">
                    Créée le {fmtDate(Date.parse(s.createdAt))} · dernière activité {fmtDate(s.lastActivity)} · {s.played} titre{s.played > 1 ? "s" : ""} joué{s.played > 1 ? "s" : ""}, {s.queued} en attente
                  </p>
                  {s.organizer && (
                    <p className="text-xs text-gray-600">
                      👤 {s.organizer}
                      <button onClick={() => { setActFilter(s.organizer); chooseTab("codes"); window.scrollTo({ top: 0 }); }} className="ml-2 text-fuchsia-600 underline">voir son code</button>
                    </p>
                  )}
                  <p className="text-xs text-gray-400">Suppression automatique {fmtIn(s.expiresAt)}</p>
                  <p className="text-xs text-gray-600 mt-1">
                    🔑 Code régie <b className="font-mono text-sm tracking-wider">{s.regieCode ? fmtRegieCode(s.regieCode) : "—"}</b>
                    <button onClick={async () => {
                      if (!confirm(`Nouveau code régie pour « ${s.name} » ? L'ancien ne fonctionnera plus.`)) return;
                      await action({ action: "regie", code: s.code, reset: true, logoutAll: confirm("Déconnecter aussi tous les appareils déjà autorisés ?") });
                    }} className="ml-2 text-fuchsia-600 underline">{s.regieCode ? "changer" : "créer"}</button>
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {FEATURES.map((f) => {
                      const on = s.features?.[f.id];
                      return (
                        <button key={f.id} title={`${f.hint}\nCliquer pour ${on ? "désactiver" : "activer"}.`}
                          onClick={() => action({ action: "features", code: s.code, features: { [f.id]: !on } })}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${on ? "bg-fuchsia-100 text-fuchsia-700" : "bg-gray-100 text-gray-400 line-through"}`}>
                          {f.icon} {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link href={`/jukebox/${s.code}/regie`} target="_blank" className="font-bold bg-gray-900 text-white px-3 py-1.5 rounded-full">Régie</Link>
                  <Link href={`/jukebox/${s.code}/ecran`} target="_blank" className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">Écran</Link>
                  <button onClick={async () => {
                    const regieCode = s.regieCode || (await action({ action: "regie", code: s.code }))?.regieCode;
                    if (regieCode) { setLink({ name: s.name, code: s.code, regieCode }); window.scrollTo({ top: 0, behavior: "smooth" }); }
                  }} className="font-bold bg-fuchsia-600 text-white px-3 py-1.5 rounded-full">📨 Invitation</button>
                  <button onClick={() => action({ action: "delete", code: s.code }, `Supprimer définitivement « ${s.name} » ?`)}
                    className="font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "codes" && data && (
        <Activations list={data.activations} filter={actFilter} setFilter={setActFilter}
          onOpenParty={(code) => { setFilter(code); chooseTab("soirees"); window.scrollTo({ top: 0 }); }} sessions={data.sessions} defaults={cfg?.defaultFeatures} origin={origin}
          creationMode={cfg?.creationMode} action={action} onUseCodes={() => action({ action: "settings", creationMode: "code" })} />
      )}

      {tab === "memory" && <SongMemory call={call} total={data?.songs} focus={focus?.on === "memory" ? focus.at : null} enrich={data?.enrich} onChanged={load} />}
      {tab === "queue" && <Prefill call={call} state={data?.prefill} onChanged={load} />}

      {tab === "reglages" && cfg && (
        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-4 text-sm">
              <h2 className="font-bold text-base text-gray-900">Accès</h2>
              <label className="flex items-center justify-between gap-3">
                <span className="font-semibold">Suppression après inactivité</span>
                <select value={cfg.retentionDays} onChange={(e) => action({ action: "settings", retentionDays: Number(e.target.value) })}
                  className="border-2 border-gray-200 rounded-xl px-3 py-1.5 font-semibold">
                  {RETENTION_CHOICES.map((n) => <option key={n} value={n}>{n} jour{n > 1 ? "s" : ""}</option>)}
                </select>
              </label>
              <div>
                <p className="font-semibold mb-1.5">Qui peut créer une soirée ?</p>
                <div className="flex bg-gray-100 rounded-full p-0.5">
                  {CREATION_MODES.map((m) => (
                    <button key={m.id} onClick={() => m.id !== cfg.creationMode && action({ action: "settings", creationMode: m.id })}
                      className={`flex-1 px-2 py-1.5 rounded-full font-bold ${m.id === cfg.creationMode ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{CREATION_MODES.find((m) => m.id === cfg.creationMode)?.hint}</p>
              </div>
              {cfg.creationMode === "code" && (
                <button onClick={() => chooseTab("codes")} className="text-xs text-fuchsia-600 underline">🎟️ Gérer les codes d'activation</button>
              )}
              <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">Quota YouTube : {QUOTA_NOTE}</p>
            </div>
            <div className="bg-white rounded-2xl border border-purple-100 p-5 text-sm">
              <h2 className="font-bold text-base text-gray-900 mb-2">Mot de passe</h2>
              <ChangePasswordForm accent="bg-fuchsia-600" note="Le même mot de passe sert au super-admin Clic-Clac."
                onSubmit={(current, next) => call("POST", { action: "password", current, next })} />
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-4 text-sm">
            <h2 className="font-bold text-base text-gray-900">Nouvelles soirées</h2>
            <div>
              <p className="font-semibold mb-1">Fonctions des soirées créées par d'autres</p>
              <p className="text-xs text-gray-400 mb-2">Modifiables ensuite pour chaque soirée, dans l'onglet Soirées.</p>
              <FeatureToggles value={cfg.defaultFeatures} onChange={(f) => action({ action: "settings", defaultFeatures: f })} />
            </div>
            <div className="pt-3 border-t border-gray-100">
              <p className="font-semibold mb-1">Réglages de départ</p>
              <p className="text-xs text-gray-400 mb-2">Pour toutes les soirées créées ensuite (par vous ou par d'autres) ; la régie peut les changer pendant la soirée.</p>
              <SoireeFields value={cfg.defaultOptions} onChange={(patch) => action({ action: "settings", defaultOptions: patch })} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/* Mémoire des titres : effet immédiat d'une action sur la liste affichée.
 * Année et langue valent pour toutes les versions (modes) du titre. */
function applySong(list, body) {
  if (!list) return list;
  const id = String(body.key || "").split(":")[1];
  switch (body.action) {
    case "forgetSong": return list.filter((s) => s.key !== body.key);
    case "mergeSongs": return list.filter((s) => !body.keys.includes(s.key)).map((s) => (s.key === body.keep ? { ...s, group: undefined } : s));
    case "ignoreDup": return list.filter((s) => s.group !== body.group);
    case "songText": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, fixed: true, ...(body.artist.trim() ? { artist: body.artist.trim() } : {}), ...(body.title.trim() ? { title: body.title.trim() } : {}),
    }));
    case "validateSong": return list.map((s) => (s.key === body.key ? { ...s, validated: !!body.validated } : s));
    case "blindSong": return list.map((s) => (s.key === body.key ? { ...s, blind: !!body.blind } : s));
    case "lyricsSong": return list.map((s) => (s.key === body.key ? { ...s, lyrics: !!body.lyrics } : s));
    case "songMeta": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, enriched: true,
      ...("year" in body ? { year: parseInt(body.year, 10) || null } : {}),
      ...("fr" in body ? { fr: body.fr } : {}),
    }));
    default: return list;
  }
}

/* Effet immédiat d'une action du super-admin sur l'état affiché. */
function applyLocally(d, body) {
  if (!d) return d;
  if (body.action === "delete") return { ...d, sessions: d.sessions.filter((s) => s.code !== body.code) };
  if (body.action === "features")
    return { ...d, sessions: d.sessions.map((s) => (s.code === body.code ? { ...s, features: { ...s.features, ...body.features } } : s)) };
  if (body.action !== "settings") return d;
  const { action, defaultFeatures, defaultOptions, ...rest } = body;
  const c = d.config;
  return {
    ...d,
    config: {
      ...c, ...rest,
      ...(defaultFeatures ? { defaultFeatures: { ...c.defaultFeatures, ...defaultFeatures } } : {}),
      ...(defaultOptions ? { defaultOptions: { ...c.defaultOptions, ...defaultOptions, blind: { ...c.defaultOptions.blind, ...defaultOptions.blind } } } : {}),
    },
  };
}

/* Chiffre clé en tête de page (cliquable : ouvre la page correspondante). */
function Stat({ label, value, title, onClick, active, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} title={title}
      className={`text-left bg-white rounded-2xl border-2 px-4 py-3 min-w-0 ${active ? "border-fuchsia-500" : "border-purple-100"} ${onClick ? "hover:border-fuchsia-300" : ""}`}>
      <p className="text-xs text-gray-500 leading-tight">{label}</p>
      <p className="text-xl font-black text-gray-900 tabular-nums">{value}</p>
      {children}
    </Tag>
  );
}

/* Création d'une soirée déjà configurée : fonctions activées et réglages de
 * la régie (modifiables ensuite par la régie, sauf les fonctions). */
function CreateForm({ token, defaults, defaultOptions, onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [features, setFeatures] = useState(null);
  const [changed, setChanged] = useState(null); // réglages modifiés pour cette soirée
  const feats = features || defaults || {};
  const base = defaultOptions || SOIREE_DEFAULTS;
  const opts = { ...base, ...changed, blind: { ...base.blind, ...changed?.blind } };
  const change = (patch) => setChanged((c) => ({ ...c, ...patch, blind: { ...c?.blind, ...patch.blind } }));

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/jukebox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-jukebox-super": token },
        body: JSON.stringify({ name, maxPerParticipant: opts.maxPerParticipant, features: feats, options: opts }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création impossible.");
      onCreated(d.code, d.adminToken, name.trim(), d.regieCode);
      setName("");
      setChanged(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="bg-white rounded-2xl border border-purple-100 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input maxLength={MAX_NAME_LEN} placeholder="Nom d'une nouvelle soirée" value={name} onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-[200px] border-2 border-gray-200 rounded-xl px-4 py-2 focus:border-fuchsia-500 outline-none" />
        <button type="button" onClick={() => setMore((v) => !v)} className="text-sm font-bold text-fuchsia-600">
          ⚙️ Configuration {more ? "▲" : "▼"}
        </button>
        <button disabled={busy || !name.trim()} className="bg-fuchsia-600 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-full">
          {busy ? "Création…" : "+ Créer la soirée"}
        </button>
      </div>
      {more && (
        <div className="grid gap-5 md:grid-cols-2 text-sm pt-2 border-t border-gray-100">
          <div className="space-y-2">
            <p className="font-bold text-gray-900">Fonctions de la soirée</p>
            <p className="text-xs text-gray-400 -mt-1">La régie ne peut pas les changer.</p>
            <FeatureToggles value={feats} onChange={(f) => setFeatures(f)} />
          </div>
          <div className="space-y-2.5">
            <p className="font-bold text-gray-900">Réglages de départ de la régie</p>
            <SoireeFields value={opts} features={feats} onChange={change} />
          </div>
        </div>
      )}
    </form>
  );
}

/* Réglages d'une soirée (création, ou réglages de départ par défaut) :
 * onChange reçoit seulement ce qui change. `features` : n'affiche l'ambiance
 * et le blind test que si la fonction est activée (tous sinon). */
function SoireeFields({ value, features, onChange }) {
  const v = value || SOIREE_DEFAULTS;
  const check = "flex items-center justify-between gap-3";
  const select = "border-2 border-gray-200 rounded-xl px-2 py-1 font-semibold";
  const num = (k) => (e) => onChange({ [k]: Number(e.target.value) });
  const blind = (k, val) => onChange({ blind: { [k]: val } });
  return (
    <div className="space-y-2.5">
      <label className={check}><span>Titres en attente / invité</span>
        <select value={v.maxPerParticipant} onChange={num("maxPerParticipant")} className={select}>
          {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
        </select>
      </label>
      <label className={check}><span>Versions proposées</span>
        <select value={v.searchMode} onChange={(e) => onChange({ searchMode: e.target.value })} className={select}>
          {SEARCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className={check}><span>Fondu enchaîné</span>
        <select value={v.fade} onChange={num("fade")} className={select}>
          {FADE_CHOICES.map((n) => <option key={n} value={n}>{n ? `${n} s` : "Non"}</option>)}
        </select>
      </label>
      <label className={check}><span>Nom de l'invité</span>
        <select value={v.authorReveal} onChange={num("authorReveal")} className={select}>
          {AUTHOR_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>
      {[["dedications", "Dédicaces"], ["fairQueue", "File équitable"], ["screenQueue", "File à suivre sur l'écran"], ["guestQueue", "Invités : voir toute la file"]].map(([k, label]) => (
        <label key={k} className={check}><span>{label}</span>
          <input type="checkbox" checked={!!v[k]} onChange={(e) => onChange({ [k]: e.target.checked })} className="w-5 h-5 accent-fuchsia-600" />
        </label>
      ))}
      {(!features || features.theme) && (
        <label className={check}><span>🎨 Ambiance</span>
          <select value={v.palette} onChange={(e) => onChange({ palette: e.target.value })} className={select}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}
      {(!features || features.blindtest) && (
        <>
          <label className={check}><span>🕵️ Blind test</span>
            <select value={v.blind.mode} onChange={(e) => blind("mode", e.target.value)} className={select}>
              {BLIND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Dévoiler la réponse</span>
            <select value={v.blind.reveal} onChange={(e) => blind("reveal", Number(e.target.value))} className={select}>
              {BLIND_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Titre suivant</span>
            <select value={v.blind.after} onChange={(e) => blind("after", Number(e.target.value))} className={select}>
              {BLIND_AFTER_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Titres piochés</span>
            <select value={v.blind.lang} onChange={(e) => blind("lang", e.target.value)} className={select}>
              {BLIND_LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Vidéos validées seulement</span>
            <input type="checkbox" checked={!!v.blind.validated} onChange={(e) => blind("validated", e.target.checked)} className="w-5 h-5 accent-fuchsia-600" />
          </label>
        </>
      )}
    </div>
  );
}

/* ---------- Codes d'activation individuels ---------- */

const ACT_MAX_CHOICES = [1, 2, 3, 5, 10, 20, null]; // null : illimité
const ACT_EXPIRY_CHOICES = [["", "Sans expiration"], ["7", "7 jours"], ["30", "1 mois"], ["90", "3 mois"], ["365", "1 an"]];
const ACT_STATUS = {
  active: ["Actif", "bg-green-100 text-green-700"],
  spent: ["Épuisé", "bg-amber-100 text-amber-700"],
  expired: ["Expiré", "bg-gray-100 text-gray-500"],
  revoked: ["Désactivé", "bg-red-100 text-red-600"],
};
const actMaxLabel = (n) => (n == null ? "Illimité" : `${n} soirée${n > 1 ? "s" : ""}`);
const fmtDay = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dayInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

function activationText({ origin, a }) {
  const link = `${origin}/jukebox?activation=${a.code}`;
  const host = origin.replace(/^https?:\/\//, "");
  return [
    `Bonjour ${a.label},`,
    "",
    `Voici votre code d'activation Jukebox : ${a.code}`,
    `Il vous permet de créer ${a.maxParties == null ? "autant de soirées que vous voulez" : actMaxLabel(a.maxParties)}${a.expiresAt ? `, jusqu'au ${fmtDay(a.expiresAt)}` : ""}.`,
    "",
    `Pour lancer une soirée : ${link}`,
    `Depuis un téléphone, vous arrivez sur la télécommande ; pour la musique, ouvrez ${host}/tv sur la télé (ou la régie sur un ordinateur).`,
  ].join("\n");
}

function Activations({ list, sessions, defaults, origin, creationMode, action, onUseCodes, filter, setFilter, onOpenParty }) {
  const [shared, setShared] = useState(null); // code dont le message est affiché
  if (list == null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
        La table des codes d'activation n'existe pas encore : exécutez la partie <b>v19</b> de <code>scripts/jukebox.sql</code> dans Supabase.
      </div>
    );
  }
  const q = filter.trim().toLowerCase();
  const shown = list.filter((a) => !q || a.label.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
  return (
    <div className="space-y-4">
      {creationMode !== "code" && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800 flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-[220px]">
            Les codes ne sont demandés qu'en mode de création « Avec un code » (actuellement : {CREATION_MODES.find((m) => m.id === creationMode)?.label}).
          </span>
          <button onClick={onUseCodes} className="font-bold bg-amber-600 text-white px-4 py-1.5 rounded-full">Passer en « Avec un code »</button>
        </div>
      )}
      <ActivationForm defaults={defaults} onCreate={async (body) => {
        const d = await action({ action: "actCreate", ...body });
        if (d?.activation) setShared(d.activation.id);
        return !!d;
      }} />
      {(list.length > 5 || filter) && <SearchInput value={filter} onChange={setFilter} placeholder="Rechercher (organisateur ou code)" className="w-full" />}
      {list.length === 0 && <p className="text-gray-400 text-center py-8">Aucun code d'activation.</p>}
      {shown.map((a) => {
        const parties = sessions.filter((s) => s.activationId === a.id);
        const [label, cls] = ACT_STATUS[a.status] || ACT_STATUS.active;
        return (
          <div key={a.id} className="bg-white rounded-2xl border border-purple-100 p-4 space-y-3">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="flex-1 min-w-[220px]">
                <p className="font-bold text-gray-900">
                  {a.label}
                  <span className={`ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                </p>
                <p className="font-mono font-black text-xl tracking-widest text-fuchsia-600 select-all">{a.code}</p>
                <p className="text-xs text-gray-500">
                  {a.used} soirée{a.used > 1 ? "s" : ""} créée{a.used > 1 ? "s" : ""} sur {a.maxParties == null ? "illimité" : a.maxParties}
                  {" · "}créé le {fmtDate(Date.parse(a.createdAt))}
                  {a.lastUsedAt && <> · dernière utilisation {fmtDate(Date.parse(a.lastUsedAt))}</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <button onClick={() => setShared(shared === a.id ? null : a.id)} className="font-bold bg-fuchsia-600 text-white px-3 py-1.5 rounded-full">📨 Envoyer</button>
                <button onClick={() => action({ action: "actUpdate", id: a.id, revoked: !a.revoked },
                  a.revoked ? null : `Désactiver le code de ${a.label} ? Il ne permettra plus de créer de soirée (les soirées déjà créées continuent).`)}
                  className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">{a.revoked ? "Réactiver" : "Désactiver"}</button>
                <button onClick={() => action({ action: "actDelete", id: a.id }, `Supprimer le code de ${a.label} ? Les soirées déjà créées sont gardées.`)}
                  className="font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Supprimer</button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-gray-500">Soirées</span>
                <select value={a.maxParties ?? ""} onChange={(e) => action({ action: "actUpdate", id: a.id, maxParties: e.target.value === "" ? null : Number(e.target.value) })}
                  className="border-2 border-gray-200 rounded-xl px-2 py-1 font-semibold">
                  {[...new Set([...ACT_MAX_CHOICES, a.maxParties])].sort((x, y) => (x ?? 1e9) - (y ?? 1e9)).map((n) => (
                    <option key={n ?? "inf"} value={n ?? ""}>{actMaxLabel(n)}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-gray-500">Expire le</span>
                <input type="date" value={dayInput(a.expiresAt)}
                  onChange={(e) => action({ action: "actUpdate", id: a.id, expiresAt: e.target.value ? `${e.target.value}T23:59:59` : null })}
                  className="border-2 border-gray-200 rounded-xl px-2 py-0.5" />
                {a.expiresAt && <button onClick={() => action({ action: "actUpdate", id: a.id, expiresAt: null })} className="text-xs text-gray-400 underline">jamais</button>}
              </label>
              {a.used > 0 && (
                <button onClick={() => action({ action: "actUpdate", id: a.id, resetUsed: true }, `Remettre à zéro le compteur de ${a.label} ? Il pourra de nouveau créer ${actMaxLabel(a.maxParties)}.`)}
                  className="text-xs text-fuchsia-600 underline">remettre le compteur à zéro</button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-500 mr-1">Fonctions :</span>
              {FEATURES.map((f) => {
                const on = (a.features || defaults || {})[f.id];
                return (
                  <button key={f.id} title={`${f.hint}\nPour les prochaines soirées créées avec ce code.`}
                    onClick={() => action({ action: "actUpdate", id: a.id, features: { ...(a.features || defaults), [f.id]: !on } })}
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${on ? "bg-fuchsia-100 text-fuchsia-700" : "bg-gray-100 text-gray-400 line-through"}`}>
                    {f.icon} {f.label}
                  </button>
                );
              })}
              {!a.features && <span className="text-[11px] text-gray-400">(par défaut)</span>}
            </div>
            {parties.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-500 mr-1">🎉 Soirées :</span>
                {parties.map((p) => (
                  <button key={p.code} onClick={() => onOpenParty(p.code)} title="Gérer cette soirée (régie, écran, invitation, réglages)"
                    className="text-xs font-semibold bg-purple-50 hover:bg-fuchsia-100 text-gray-800 px-2.5 py-1 rounded-full">
                    {p.name} <span className="font-mono text-fuchsia-600">{formatCode(p.code)}</span> →
                  </button>
                ))}
              </div>
            )}
            {a.used > parties.length && (
              <p className="text-[11px] text-gray-400">{a.used - parties.length} soirée{a.used - parties.length > 1 ? "s" : ""} déjà supprimée{a.used - parties.length > 1 ? "s" : ""}.</p>
            )}
            {shared === a.id && <ShareBox title={`Code pour ${a.label}`} subject="Votre code d'activation Jukebox"
              message={activationText({ origin, a })} onClose={() => setShared(null)} />}
          </div>
        );
      })}
    </div>
  );
}

function ActivationForm({ defaults, onCreate }) {
  const [label, setLabel] = useState("");
  const [max, setMax] = useState(1);
  const [expiry, setExpiry] = useState("");
  const [features, setFeatures] = useState(null); // null : fonctions par défaut
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    setBusy(true);
    const ok = await onCreate({
      label, maxParties: max,
      expiresAt: expiry ? new Date(Date.now() + Number(expiry) * 864e5).toISOString() : null,
      features,
    });
    setBusy(false);
    if (ok) { setLabel(""); setFeatures(null); setOpen(false); }
  };
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-purple-100 p-5 space-y-3 text-sm">
      <h2 className="font-bold text-base text-gray-900">Nouveau code d'activation</h2>
      <div className="flex flex-wrap gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} placeholder="Organisateur (ex. : Max Dupont)"
          className="flex-1 min-w-[200px] border-2 border-gray-200 rounded-xl px-3 py-2 focus:border-fuchsia-500 outline-none" />
        <select value={max ?? ""} onChange={(e) => setMax(e.target.value === "" ? null : Number(e.target.value))}
          className="border-2 border-gray-200 rounded-xl px-3 py-2 font-semibold">
          {ACT_MAX_CHOICES.map((n) => <option key={n ?? "inf"} value={n ?? ""}>{actMaxLabel(n)}</option>)}
        </select>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="border-2 border-gray-200 rounded-xl px-3 py-2 font-semibold">
          {ACT_EXPIRY_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button disabled={busy || !label.trim()} className="bg-fuchsia-600 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-full">
          {busy ? "Création…" : "Créer le code"}
        </button>
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-fuchsia-600 underline">
        {open ? "Masquer les fonctions" : `Fonctions des soirées : ${features ? "personnalisées" : "par défaut"}`}
      </button>
      {open && (
        <div className="space-y-2">
          <FeatureToggles value={features || defaults} onChange={setFeatures} />
          {features && <button type="button" onClick={() => setFeatures(null)} className="text-xs text-gray-400 underline">Revenir aux fonctions par défaut</button>}
        </div>
      )}
    </form>
  );
}

/* Message à transmettre : copie, partage (téléphone) ou e-mail. */
function ShareBox({ title, subject, message, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-fuchsia-50 border border-fuchsia-200 rounded-2xl p-4 space-y-2">
      <p className="font-bold text-gray-900">{title}</p>
      <pre className="whitespace-pre-wrap break-words bg-white rounded-xl px-3 py-2 text-xs text-gray-700 font-sans">{message}</pre>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch (e) { /* ignoré */ } }}
          className="bg-gray-900 text-white text-sm font-bold px-4 py-2 rounded-full">{copied ? "✓ Copié" : "Copier"}</button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button type="button" onClick={async () => { try { await navigator.share({ title: subject, text: message }); } catch (e) { /* annulé */ } }}
            className="bg-fuchsia-600 text-white text-sm font-bold px-4 py-2 rounded-full">Partager…</button>
        )}
        <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`}
          className="bg-white border border-gray-200 text-sm font-bold px-4 py-2 rounded-full">✉️ E-mail</a>
        <button type="button" onClick={onClose} className="text-sm text-gray-400 underline">Fermer</button>
      </div>
    </div>
  );
}

/* Interrupteurs des fonctions (historique, thème, blind test). */
function FeatureToggles({ value, onChange }) {
  return (
    <div className="space-y-2">
      {FEATURES.map((f) => (
        <label key={f.id} className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={!!value?.[f.id]} onChange={(e) => onChange({ ...value, [f.id]: e.target.checked })}
            className="w-5 h-5 mt-0.5 accent-fuchsia-600 shrink-0" />
          <span><span className="font-semibold">{f.icon} {f.label}</span><span className="block text-xs text-gray-400">{f.hint}</span></span>
        </label>
      ))}
    </div>
  );
}

/* Invitation à transmettre à l'organisateur : adresses de la télécommande et
 * de la régie, code régie (Access.jsx). */
function InviteBox({ name, code, regieCode, origin, onClose }) {
  return (
    <div className="mt-4">
      <ShareBox title={`Invitation pour l'organisateur de « ${name} »`} subject={`Jukebox · soirée « ${name} »`}
        message={inviteText({ origin, code, name, regieCode })} onClose={onClose} />
    </div>
  );
}

function Page({ children }) {
  return (
    <div className="min-h-screen bg-purple-50 px-4 py-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/jukebox" className="inline-flex items-center gap-2 text-sm font-bold text-gray-500 mb-4">← Jukebox</Link>
        {children}
      </div>
    </div>
  );
}

/* Mémoire « titre Deezer → vidéo YouTube », à passer en revue : filtres
 * (à vérifier / validés, mode), aperçu de la vidéo retenue, validation,
 * changement de vidéo (repasse « à vérifier »), oubli (le titre sera recherché à
 * nouveau au prochain ajout). */
const STATUS_FILTERS = [["all", "Tous"], ["todo", "À vérifier"], ["suspect", "🧐 Suspects"], ["dups", "👯 Doublons"], ["missing", "⚠️ À remplacer"], ["ok", "Validés"], ["blind", "🕵️ Blind test"], ["lyrics", "📝 Avec paroles"]];
const SORTS = [["added", "Derniers ajoutés"], ["plays", "Plus joués"], ["rank", "Plus connus"], ["year", "Année"], ["alpha", "A → Z"]];
const LANG_FILTERS = [["", "Toutes langues"], ["fr", "🇫🇷 Français"], ["intl", "🌍 International"], ["unknown", "❓ Langue inconnue"]];
const FR_NEXT = { true: false, false: null, null: true }; // clic sur la langue : 🇫🇷 → 🌍 → ❓
const MODE_TAG = {
  normal: "bg-sky-100 text-sky-700",
  karaoke: "bg-fuchsia-100 text-fuchsia-700",
};

function SongMemory({ call, total, focus, enrich, onChanged }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("added");
  const [editing, setEditing] = useState(null); // clé du titre dont on corrige le texte
  // tuile « Titres en mémoire » : liste complète, sans filtre
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setStatus("all");
    setQ("");
    setLang("");
    setDecade("");
  }, [focus]);
  const [mode, setMode] = useState("");
  const [lang, setLang] = useState("");
  const [decade, setDecade] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [songs, setSongs] = useState(null);
  const [err, setErr] = useState("");
  const [fixing, setFixing] = useState(null); // titre dont on change la vidéo
  const [retitling, setRetitling] = useState(null); // titre rattaché à un autre titre Deezer
  const [preview, setPreview] = useState(null); // clé du titre en aperçu
  const [review, setReview] = useState(null); // revue : clés des titres à passer, position

  const lastAct = useRef(0); // liste relue avant la dernière action : périmée
  const queue = useRef(Promise.resolve());
  const load = useCallback(async () => {
    const started = Date.now();
    try {
      const qs = new URLSearchParams({ songs: "1", q, status, mode, lang, decade, sort });
      const res = await fetch(`/api/jukebox/super?${qs}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      if (started < lastAct.current) return;
      setSongs(d.songs);
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, [q, status, mode, lang, decade, sort]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  // Effet affiché dès le clic, actions envoyées dans l'ordre ; la liste n'est
  // pas relue après chaque action (un titre validé reste visible jusqu'au
  // prochain changement de filtre, sans décaler les lignes sous la souris).
  const run = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    lastAct.current = Date.now();
    setSongs((list) => applySong(list, body));
    const p = queue.current.then(() => call("POST", body));
    queue.current = p.catch(() => {});
    try { await p; } catch (e) { alert(e.message); lastAct.current = Date.now(); load(); }
  };
  // appels successifs (~45 s chacun, MusicBrainz : 1 requête / s) jusqu'au bout
  const stopEnrich = useRef(false);
  const enrichNow = async () => {
    stopEnrich.current = false;
    setEnriching({ done: 0 });
    try {
      for (let total = 0; !stopEnrich.current;) {
        const d = await call("POST", { action: "enrich" });
        total += d.done;
        setEnriching({ done: total, pending: d.pending });
        load();
        if (!d.pending || !d.done) break;
      }
      onChanged?.();
    } catch (e) { alert(e.message); } finally { setEnriching(false); }
  };
  const editYear = (s) => {
    const v = prompt(`Année de sortie de « ${s.label} » (vide : inconnue)`, s.year || "");
    if (v !== null) run({ action: "songMeta", key: s.key, year: v.trim() });
  };

  return (
    <div className="bg-white rounded-2xl border border-purple-100">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex justify-between items-center px-5 py-4 font-bold text-gray-900">
        <span>🧠 Mémoire des titres {typeof total === "number" && <span className="text-gray-400 font-normal">({total})</span>}</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <p className="text-xs text-gray-500">
            Vidéo YouTube retenue pour chaque titre et chaque mode (cliquez la miniature pour l'écouter ici). <b>Valider</b> confirme
            qu'elle est bonne ; <b>Changer la vidéo</b> en choisit une autre, qui repasse « À vérifier » : testez-la (aperçu ouvert d'office) puis validez-la. Les corrections « Mauvaise vidéo ? » faites en régie arrivent aussi ici à vérifier ;
            <b> Oublier</b> la fera rechercher à nouveau au prochain ajout. L'<b>année</b> et la <b>langue</b> (filtres du blind test)
            sont trouvées automatiquement ; cliquez-les pour les corriger, comme le <b>titre</b> lui-même s'il désigne une reprise ou une compilation. <b>📝 Paroles</b> indique que la vidéo affiche les paroles
            (deviné d'après son titre YouTube : vérifiez-le en validant).
          </p>
          {(enrich > 0 || enriching) && (
            <div className="flex flex-wrap items-center gap-3 text-xs bg-sky-50 text-sky-800 rounded-xl px-3 py-2">
              <span>🔎 {enrich} ligne{enrich > 1 ? "s" : ""} sans année ni langue : complétées chaque nuit (Deezer + MusicBrainz, sans quota YouTube, environ 4 s par titre).</span>
              {enriching ? (
                <span className="flex items-center gap-2 font-bold">
                  ⏳ {enriching.done} titre{enriching.done > 1 ? "s" : ""} enrichi{enriching.done > 1 ? "s" : ""}{enriching.pending != null ? `, ${enriching.pending} ligne${enriching.pending > 1 ? "s" : ""} restante${enriching.pending > 1 ? "s" : ""}` : ""}…
                  <button onClick={() => { stopEnrich.current = true; }} className="underline font-normal">arrêter</button>
                </span>
              ) : (
                <button onClick={enrichNow} className="font-bold bg-sky-600 text-white px-3 py-1 rounded-full">Tout enrichir maintenant</button>
              )}
            </div>
          )}
          {(() => {
            const todo = (songs || []).filter((s) => !s.validated && !s.missing);
            return todo.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 bg-fuchsia-50 rounded-xl px-3 py-2">
                <button onClick={() => { setPreview(null); setReview({ keys: todo.map((s) => s.key), i: 0 }); }}
                  className="text-sm font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 px-4 py-1.5 rounded-full">
                  ▶ Revue des titres à vérifier ({todo.length})
                </button>
                <span className="text-xs text-fuchsia-900/70">
                  Un titre à la fois, vidéo lancée à 40 s, raccourcis clavier. Titres non validés de la liste affichée, dans son ordre (tri « Plus joués » : les plus utiles d'abord).
                </span>
              </div>
            );
          })()}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex bg-gray-100 rounded-full p-0.5 text-sm">
              {STATUS_FILTERS.map(([id, label]) => (
                <button key={id} onClick={() => setStatus(id)}
                  className={`px-3 py-1 rounded-full font-bold ${status === id ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                  {label}
                </button>
              ))}
            </div>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
              <option value="">Tous les modes</option>
              {SEARCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
              {LANG_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select value={decade} onChange={(e) => setDecade(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
              <option value="">Toutes décennies</option>
              {DECADES.map((d) => <option key={d} value={d}>{decadeLabel(d)}</option>)}
              <option value="unknown">❓ Année inconnue</option>
            </select>
            {status !== "dups" && (
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
                {SORTS.map(([id, label]) => <option key={id} value={id}>↕ {label}</option>)}
              </select>
            )}
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher un artiste, un titre…" className="flex-1 min-w-[180px]" />
          </div>
          {status === "suspect" && <p className="text-xs text-gray-500">Titres non validés dont la vidéo semble ne pas correspondre : durée très différente du titre, titre absent de la vidéo, version live, reprise… Vérifiez-les puis validez ou changez la vidéo.</p>}
          {status === "dups" && <p className="text-xs text-gray-500">Titres qui se ressemblent dans le même mode (même vidéo, ou interprète et titre proches). <b>Garder celui-ci</b> fusionne le groupe : écoutes, étiquettes, année et langue sont regroupées sur la ligne gardée, et les autres titres Deezer joueront sa vidéo (sans nouvelle recherche YouTube).</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          {review && (
            <SongReview review={review} setReview={setReview} songs={songs} run={run} editYear={editYear}
              busy={!!(fixing || retitling)} onFix={setFixing} onRetitle={setRetitling} onClose={() => { setReview(null); load(); }} />
          )}
          {retitling && <SongTitleChooser song={retitling} call={call} onClose={() => setRetitling(null)}
            onDone={(key) => {
              // revue en cours : la ligne change de clé (autre titre Deezer)
              if (key && key !== retitling.key) setReview((r) => r && { ...r, keys: r.keys.map((k) => (k === retitling.key ? key : k)) });
              load();
            }} />}
          {fixing && <SongVideoChooser song={fixing} call={call} onClose={() => setFixing(null)}
            onDone={() => { setStatus((st) => (st === "ok" ? "all" : st)); if (!review) setPreview(fixing.key); load(); }} />}
          {songs === null ? <p className="text-sm text-gray-400">Chargement…</p> : songs.length === 0 ? (
            <p className="text-sm text-gray-400">{status === "todo" ? "Rien à vérifier 🎉" : status === "missing" ? "Aucune vidéo disparue 👍" : status === "blind" ? "Aucun titre marqué « Blind test » : utilisez l'étiquette 🕵️ sur les titres (filtre Tous)." : status === "lyrics" ? "Aucun titre marqué « Avec paroles » : utilisez l'étiquette 📝 sur les titres (filtre Tous)." : "Aucun titre."}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {songs.map((s, i) => (<Fragment key={s.key}>
                {s.group != null && s.group !== songs[i - 1]?.group && (
                  <li className="flex flex-wrap items-center justify-between gap-2 pt-4 pb-1">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">👯 Doublons possibles · {s.dupWhy}</span>
                    <button onClick={() => run({ action: "ignoreDup", group: s.group, keys: songs.filter((x) => x.group === s.group).map((x) => x.key) })}
                      className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Ce ne sont pas des doublons</button>
                  </li>
                )}
                <li className="flex flex-wrap items-center gap-3 py-2.5">
                  <PreviewThumb videoId={s.videoId} active={preview === s.key} onClick={() => setPreview(preview === s.key ? null : s.key)} />
                  <div className="flex-1 min-w-[160px]">
                    {editing === s.key ? (
                      <SongTextForm song={s} onCancel={() => setEditing(null)}
                        onSave={(artist, title) => { setEditing(null); run({ action: "songText", key: s.key, artist, title }); }} />
                    ) : (
                      <SongName song={s} onArtist={(a) => { setQ(a); setStatus("all"); }} onTitle={() => setRetitling(s)} onEdit={() => setEditing(s.key)} />
                    )}
                    <VideoTitle song={s} className="truncate" />
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${MODE_TAG[s.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(s.mode)}</span>
                      {s.missing
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-red-100 text-red-700" title="La vidéo n'existe plus ou n'est plus lisible : choisissez-en une autre">⚠️ Vidéo disparue · à remplacer</span>
                        : s.validated
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-green-100 text-green-700">✓ Validé</span>
                        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500">À vérifier</span>}
                      <button onClick={() => editYear(s)} title="Année de sortie (cliquer pour corriger)"
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>
                        {s.year || (s.enriched ? "année ?" : "…")}
                      </button>
                      <button onClick={() => run({ action: "songMeta", key: s.key, fr: FR_NEXT[String(s.fr)] })}
                        title="Langue (cliquer : français → international → inconnue)"
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                        {s.fr === true ? "🇫🇷 Français" : s.fr === false ? "🌍 International" : s.enriched ? "❓ langue" : "…"}
                      </button>
                      <button onClick={() => run({ action: "blindSong", key: s.key, blind: !s.blind })}
                        title={s.blind ? "Retirer du blind test" : "Utiliser dans le blind test"}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        🕵️ Blind test{s.blind ? "" : " ?"}
                      </button>
                      <button onClick={() => run({ action: "lyricsSong", key: s.key, lyrics: !s.lyrics })}
                        title={s.lyrics ? "La vidéo n'affiche pas les paroles" : "La vidéo affiche les paroles"}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.lyrics ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        📝 Paroles{s.lyrics ? "" : " ?"}
                      </button>
                      {s.suspect?.length > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700" title="Vidéo à vérifier en priorité">🧐 {s.suspect.join(" · ")}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{s.plays > 0 && <span className="font-bold text-gray-500" title="Joué jusqu'au bout en soirée">▶ joué {s.plays}× · </span>}{formatDuration(s.duration)} · vérifié le {new Date(s.checkedAt).toLocaleDateString("fr-FR")}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {s.group != null && (
                      <button onClick={() => {
                        const others = songs.filter((x) => x.group === s.group && x.key !== s.key);
                        run({ action: "mergeSongs", keep: s.key, keys: others.map((x) => x.key) },
                          `Garder « ${s.artist} – ${s.title} » et y fusionner :\n${others.map((x) => `• ${x.artist} – ${x.title}`).join("\n")}\n\nLes autres titres joueront cette vidéo.`);
                      }} className="text-xs font-bold text-white bg-fuchsia-600 px-3 py-1.5 rounded-full">⭐ Garder celui-ci</button>
                    )}
                    {s.missing ? null : s.validated ? (
                      <button onClick={() => run({ action: "validateSong", key: s.key, validated: false })}
                        className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">Retirer la validation</button>
                    ) : (
                      <button onClick={() => run({ action: "validateSong", key: s.key, validated: true })}
                        className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1.5 rounded-full">✓ Valider</button>
                    )}
                    <button onClick={() => setFixing(s)} className={`text-xs font-bold px-3 py-1.5 rounded-full ${s.missing ? "bg-red-600 text-white" : "bg-gray-100"}`}>
                      {s.missing ? "Remplacer la vidéo" : "Changer la vidéo"}
                    </button>
                    <button onClick={() => run({ action: "forgetSong", key: s.key }, `Oublier « ${s.label || s.key} » (${modeLabel(s.mode)}) ?\nLe titre sera recherché à nouveau au prochain ajout.`)}
                      className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Oublier</button>
                  </div>
                  {preview === s.key && (
                    <div className="w-full max-w-xl"><VideoPreview videoId={s.videoId} onClose={() => setPreview(null)} /></div>
                  )}
                </li>
              </Fragment>))}
            </ul>
          )}
          {songs?.length === 200 && <p className="text-xs text-gray-400 text-center">200 premiers titres affichés : affinez avec les filtres ou la recherche.</p>}
          <Backup call={call} onImported={() => { load(); onChanged?.(); }} />
        </div>
      )}
    </div>
  );
}

const STOP_TEXT = {
  quota: "quota épuisé, les titres restants seront cherchés demain",
  error: "YouTube indisponible, les titres restants seront cherchés demain",
  time: "temps écoulé", empty: "file terminée",
};

/* Pré-remplissage : titres mis en attente, cherchés chaque matin vers 6 h
 * avec le reste du quota YouTube de la veille. */
function Prefill({ call, state, onChanged }) {
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState("playlist"); // playlist | lines
  const [lines, setLines] = useState("");
  const [modes, setModes] = useState(["normal"]);
  const [blind, setBlind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [plQuery, setPlQuery] = useState("");
  const [playlists, setPlaylists] = useState(null);
  const [showQueue, setShowQueue] = useState(true);
  const [queueVersion, setQueueVersion] = useState(0);

  const toggle = (id) => setModes((ms) => (ms.includes(id) ? ms.filter((m) => m !== id) : [...ms, id]));
  const send = async (body) => {
    setBusy(true);
    setMsg(null);
    try {
      const d = await call("POST", { action: "prefill", modes, blind, ...body });
      setMsg({ ok: true, text: `${d.added} ajouté${d.added > 1 ? "s" : ""} à la file${d.skipped ? `, ${d.skipped} déjà en mémoire ou en attente` : ""}.`, notFound: d.notFound });
      if (body.lines) setLines("");
      onChanged();
      setQueueVersion((v) => v + 1);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Recherche de playlists Deezer, ou lien de playlist collé (ajout direct)
  const isLink = /deezer|^\d{3,15}$/i.test(plQuery.trim());
  const findPlaylists = async (e) => {
    e.preventDefault();
    const q = plQuery.trim();
    if (!q) return;
    if (isLink) return send({ playlist: q });
    try {
      const res = await fetch(`/api/jukebox/super?playlists=${encodeURIComponent(q)}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Recherche impossible.");
      setPlaylists(d.playlists);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };
  const last = state?.last;
  const cost = (n) => `${n} recherche${n > 1 ? "s" : ""} YouTube${modes.length > 1 ? ` × ${modes.length} modes` : ""}`;

  return (
    <div className="bg-white rounded-2xl border border-purple-100">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex justify-between items-center px-5 py-4 font-bold text-gray-900">
        <span>🌅 Pré-remplir la mémoire {state && <span className="text-gray-400 font-normal">({state.pending} en attente)</span>}</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3 text-sm">
          <p className="text-xs text-gray-500">
            Les titres en attente sont cherchés sur YouTube <b>chaque matin vers 6 h</b>, jusqu'à épuisement du quota (une centaine
            par jour au mieux). C'est le reste du quota de la veille : les soirées gardent un quota neuf. Chaque titre coûte une
            recherche par mode choisi ; les vidéos trouvées arrivent « À vérifier » dans la mémoire.
          </p>
          {last && (
            <p className="text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
              Dernier passage le {fmtDate(Date.parse(last.at))} : {last.found} trouvé{last.found > 1 ? "s" : ""}
              {last.failed ? `, ${last.failed} sans résultat` : ""} ({STOP_TEXT[last.stop] || last.stop}).
              {last.error && <span className="block text-gray-400">{last.error}</span>}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-600">Modes :</span>
            {SEARCH_MODES.map((m) => (
              <button key={m.id} onClick={() => toggle(m.id)}
                className={`px-3 py-1 rounded-full font-bold ${modes.includes(m.id) ? "bg-fuchsia-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="w-4 h-4 accent-violet-600" />
            <span>Marquer ces titres <b>🕵️ Blind test</b> (versions Normale : la vidéo est masquée)</span>
          </label>

          <div className="flex bg-gray-100 rounded-full p-0.5 w-fit">
            {[["playlist", "🎧 Playlist Deezer"], ["lines", "📝 Liste de titres"]].map(([id, label]) => (
              <button key={id} onClick={() => setSource(id)}
                className={`px-3 py-1 rounded-full font-bold ${source === id ? "bg-white shadow text-gray-900" : "text-gray-500"}`}>{label}</button>
            ))}
          </div>

          {source === "playlist" ? (
            <div className="space-y-2">
              <form onSubmit={findPlaylists} className="flex gap-2">
                <input value={plQuery} onChange={(e) => setPlQuery(e.target.value)}
                  placeholder="« blind test années 80 », « soirée »… ou lien de playlist Deezer"
                  className="flex-1 min-w-0 border-2 border-gray-200 rounded-full px-4 py-2 focus:border-fuchsia-500 outline-none" />
                <button disabled={busy || !plQuery.trim() || !modes.length} className="font-bold bg-fuchsia-600 disabled:opacity-40 text-white px-4 py-2 rounded-full">
                  {busy ? "…" : isLink ? "Ajouter" : "Chercher"}
                </button>
              </form>
              <p className="text-xs text-gray-400">
                Playlists publiques de Deezer : celles de Deezer, Filtr, Digster… ou n'importe quelle playlist partagée
                (Deezer → Partager → Copier le lien). 500 titres maximum par playlist.
              </p>
              {playlists && (playlists.length === 0 ? <p className="text-gray-400">Aucune playlist trouvée.</p> : (
                <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {playlists.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                      {p.cover && <img src={p.cover} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <a href={`https://www.deezer.com/playlist/${p.id}`} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 hover:underline line-clamp-1">{p.title}</a>
                        <p className="text-xs text-gray-400">{p.tracks} titres · {p.by} · {cost(Math.min(p.tracks, 500))}</p>
                      </div>
                      <button disabled={busy || !modes.length} onClick={() => send({ playlist: String(p.id) })}
                        className="font-bold bg-gray-900 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-full shrink-0">+ File</button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={6}
                placeholder={"Un titre par ligne, par exemple :\nQueen - Bohemian Rhapsody\nAngèle - Balance ton quoi"}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 focus:border-fuchsia-500 outline-none" />
              <p className="text-xs text-gray-400">Pratique pour copier une liste trouvée sur un site (100 lignes max) : chaque ligne est cherchée sur Deezer.</p>
              <button disabled={busy || !lines.trim() || !modes.length} onClick={() => send({ lines })}
                className="font-bold bg-fuchsia-600 disabled:opacity-40 text-white px-4 py-2 rounded-full">
                {busy ? "…" : "Ajouter à la file"}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => setShowQueue((v) => !v)} className="font-bold bg-gray-100 px-4 py-2 rounded-full">
              {showQueue ? "Masquer la file" : `Voir la file (${state?.pending ?? 0})`}
            </button>
          </div>

          {msg && (
            <div className={msg.ok ? "text-green-700" : "text-red-600"}>
              <p>{msg.text}</p>
              {msg.notFound?.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">Introuvables sur Deezer : {msg.notFound.join(" · ")}</p>
              )}
            </div>
          )}

          {showQueue && <PrefillQueue call={call} version={queueVersion} onChanged={onChanged} />}
        </div>
      )}
    </div>
  );
}

/* File du pré-remplissage : recherche, retrait, passage en tête, vidage. */
function PrefillQueue({ call, version, onChanged }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jukebox/super?prefill=1", { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } });
      const d = await res.json();
      if (res.ok) setItems(d.items);
    } catch (e) { /* ignoré */ }
  }, []);
  useEffect(() => { load(); }, [load, version]);

  // effet affiché tout de suite, actions envoyées dans l'ordre
  const queue = useRef(Promise.resolve());
  const send = async (body, local) => {
    setItems(local);
    setSel(new Set());
    const p = queue.current.then(() => call("POST", body));
    queue.current = p.catch(() => {});
    try { await p; onChanged(); } catch (e) { alert(e.message); load(); }
  };
  const edit = (keys, op) => {
    const set = new Set(keys);
    const hit = items.filter((it) => set.has(it.key));
    const rest = items.filter((it) => !set.has(it.key));
    send({ action: "prefillEdit", keys, op }, op === "top" ? [...hit, ...rest] : rest);
  };
  const clear = () => {
    if (!confirm(`Vider la file (${items.length} titres en attente) ?`)) return;
    send({ action: "clearPrefill" }, []);
  };

  if (!items) return <p className="text-gray-400">Chargement…</p>;
  if (!items.length) return <p className="text-gray-400">La file est vide.</p>;
  const term = q.trim().toLowerCase();
  const shown = term ? items.filter((it) => `${it.artist} ${it.title}`.toLowerCase().includes(term)) : items;
  const toggleSel = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allShown = shown.length > 0 && shown.every((it) => sel.has(it.key));

  return (
    <div className="border border-gray-200 rounded-2xl p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer la file…"
          className="flex-1 min-w-[160px] border-2 border-gray-200 rounded-full px-3 py-1 focus:border-fuchsia-500 outline-none" />
        <span className="text-xs text-gray-400">{shown.length} / {items.length} · traités dans l'ordre, du haut vers le bas</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={allShown} onChange={() => setSel(allShown ? new Set() : new Set(shown.map((it) => it.key)))} className="accent-fuchsia-600" />
          Tout sélectionner
        </label>
        {sel.size > 0 && (
          <>
            <button onClick={() => edit([...sel], "top")} className="font-bold bg-gray-100 px-2.5 py-1 rounded-full">⤒ En priorité ({sel.size})</button>
            <button onClick={() => edit([...sel], "remove")} className="font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">Retirer ({sel.size})</button>
          </>
        )}
        <button onClick={clear} className="font-bold text-red-600 ml-auto">Vider toute la file</button>
      </div>
      <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {shown.slice(0, 300).map((it) => (
          <li key={it.key} className="flex items-center gap-2 py-1.5">
            <input type="checkbox" checked={sel.has(it.key)} onChange={() => toggleSel(it.key)} className="accent-fuchsia-600 shrink-0" />
            <span className="flex-1 min-w-0 truncate"><b>{it.artist}</b> – {it.title}</span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${MODE_TAG[it.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(it.mode)}</span>
            {it.blind && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-600 text-white shrink-0">🕵️</span>}
            <button onClick={() => edit([it.key], "top")} title="Traiter en premier" className="text-gray-400 hover:text-gray-900 px-1 shrink-0">⤒</button>
            <button onClick={() => edit([it.key], "remove")} title="Retirer" className="text-gray-400 hover:text-red-600 px-1 shrink-0">✕</button>
          </li>
        ))}
        {shown.length > 300 && <li className="py-2 text-xs text-gray-400">… et {shown.length - 300} autres (filtrez pour les voir)</li>}
      </ul>
    </div>
  );
}

function SongVideoChooser({ song, call, onClose, onDone }) {
  return (
    <VideoChooser title={song.label || song.key} subtitle={`Mode ${modeLabel(song.mode)}`} initial={song.videoId}
      onClose={onClose} onDone={onDone}
      load={() => call("POST", { action: "songVideos", key: song.key })}
      choose={(videoId) => call("POST", { action: "replaceSong", key: song.key, videoId })} />
  );
}

/* Revue des titres à vérifier, un par un : vidéo lancée à 40 s (là où les
 * paroles s'affichent), étiquettes en grand, raccourcis clavier. Les actions
 * passent par run() (effet immédiat sur la liste de la mémoire). */
const REVIEW_START = 40;
function SongReview({ review, setReview, songs, run, editYear, busy, onFix, onRetitle, onClose }) {
  const { keys, i } = review;
  const [editing, setEditing] = useState(null); // correction du texte : champ à éditer (artist | title)
  const [artistOpen, setArtistOpen] = useState(false); // autres titres de l'interprète, sans quitter la revue
  useEffect(() => setEditing(null), [i]);
  const song = i < keys.length ? (songs || []).find((s) => s.key === keys[i]) : null;
  const go = (d) => setReview((r) => ({ ...r, i: Math.max(0, Math.min(r.keys.length, r.i + d)) }));
  const act = {
    validate: () => { if (song && !song.missing) run({ action: "validateSong", key: song.key, validated: true }); go(1); },
    lyrics: () => song && run({ action: "lyricsSong", key: song.key, lyrics: !song.lyrics }),
    blind: () => song && run({ action: "blindSong", key: song.key, blind: !song.blind }),
    fix: () => song && onFix(song),
    text: () => song && setEditing("title"),
    artist: () => setArtistOpen((v) => !v),
    retitle: () => song && onRetitle(song),
    forget: () => {
      if (!song || !confirm(`Oublier « ${song.label || song.key} » (${modeLabel(song.mode)}) ?\nLe titre sera recherché à nouveau au prochain ajout.`)) return;
      run({ action: "forgetSong", key: song.key });
      go(1);
    },
    next: () => go(1),
    prev: () => go(-1),
  };
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const onKey = (e) => {
      if (busy || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const a = actRef.current;
      const k = e.key.toLowerCase();
      const fn = { v: a.validate, p: a.lyrics, b: a.blind, c: a.fix, o: a.forget, t: a.text, r: a.retitle, a: a.artist, arrowright: a.next, n: a.next, arrowleft: a.prev, escape: onClose }[k];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const Key = ({ k }) => <kbd className="ml-1.5 text-[10px] font-mono bg-black/10 rounded px-1 py-0.5">{k}</kbd>;
  const tool = "text-sm font-bold bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl text-left whitespace-nowrap";
  const tag = "text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap";
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-2 sm:p-3" onClick={onClose}>
      {/* Écran de portable : vidéo à gauche (taille réglée sur la hauteur de l'écran), infos et boutons à droite. */}
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-6xl max-h-[97vh] flex flex-col bg-white rounded-3xl p-4 gap-3 shadow-2xl">
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600 whitespace-nowrap">
            Revue · {Math.min(i + 1, keys.length)} / {keys.length}
          </p>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${(Math.min(i, keys.length) / keys.length) * 100}%` }} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Fermer (Échap)" title="Fermer (Échap)">×</button>
        </div>
        {i >= keys.length ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-3xl">🎉</p>
            <p className="font-bold">Revue terminée</p>
            <div className="flex justify-center gap-2">
              <button onClick={() => go(-1)} className="text-sm font-bold bg-gray-100 px-4 py-2 rounded-full">← Revenir au dernier</button>
              <button onClick={onClose} className="text-sm font-bold text-white bg-fuchsia-600 px-4 py-2 rounded-full">Fermer</button>
            </div>
          </div>
        ) : !song ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-sm text-gray-500">Ce titre n'est plus dans la liste (oublié, ou filtre changé).</p>
            <button onClick={() => go(1)} className="text-sm font-bold bg-gray-100 px-4 py-2 rounded-full">Suivant →</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)] items-start">
            <div className="mx-auto w-full" style={{ maxWidth: "calc((97vh - 120px) * 16 / 9)" }}>
              <VideoPreview videoId={song.videoId} start={song.duration > REVIEW_START + 20 ? REVIEW_START : 0} />
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                <div className="flex-1 min-w-0"><VideoTitle song={song} className="truncate" /></div>
                <a href={`https://www.youtube.com/watch?v=${song.videoId}`} target="_blank" rel="noreferrer" className="shrink-0 hover:text-gray-700 underline">YouTube ↗</a>
              </div>
            </div>

            <div className="space-y-3 min-w-0">
              <div>
                {editing ? (
                  <SongTextForm song={song} focus={editing} onCancel={() => setEditing(null)}
                    onSave={(artist, title) => { setEditing(null); run({ action: "songText", key: song.key, artist, title }); }} />
                ) : (
                  <SongName song={song} wrap className="text-lg font-bold leading-snug" artistActive={artistOpen}
                    artistHint="Autres titres de cet interprète (A)" titleHint="Corriger le texte (T)"
                    onArtist={() => setArtistOpen((v) => !v)} onTitle={() => setEditing("title")} onEdit={() => setEditing("artist")} />
                )}
                {song.suspect?.length > 0 && (
                  <p className="mt-1.5 text-xs font-bold text-orange-700 bg-orange-50 rounded-lg px-2 py-1">🧐 À vérifier de près : {song.suspect.join(" · ")}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className={`${tag} ${MODE_TAG[song.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(song.mode)}</span>
                  {song.missing
                    ? <span className={`${tag} bg-red-100 text-red-700`}>⚠️ Vidéo disparue · à remplacer</span>
                    : song.validated
                    ? <span className={`${tag} bg-green-100 text-green-700`}>✓ Validé</span>
                    : <span className={`${tag} bg-gray-100 text-gray-500`}>À vérifier</span>}
                  <button onClick={() => editYear(song)} title="Année de sortie (cliquer pour corriger)"
                    className={`${tag} ${song.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>
                    {song.year || (song.enriched ? "année ?" : "…")}
                  </button>
                  <button onClick={() => run({ action: "songMeta", key: song.key, fr: FR_NEXT[String(song.fr)] })} title="Langue (cliquer : français → international → inconnue)"
                    className={`${tag} ${song.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                    {song.fr === true ? "🇫🇷 Français" : song.fr === false ? "🌍 International" : song.enriched ? "❓ langue" : "…"}
                  </button>
                  <span className="text-xs text-gray-400">
                    {song.plays > 0 && <b className="text-gray-500">▶ joué {song.plays}× · </b>}{formatDuration(song.duration)}
                  </span>
                </div>
                {artistOpen && song.artist && <div className="max-h-48 overflow-y-auto mt-2"><ArtistSongs artist={song.artist} current={song.key} /></div>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={act.lyrics} className={`text-sm font-bold px-3 py-2 rounded-xl text-left ${song.lyrics ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"}`}>
                  📝 {song.lyrics ? "Avec paroles" : "Sans paroles"}<Key k="P" />
                </button>
                <button onClick={act.blind} className={`text-sm font-bold px-3 py-2 rounded-xl text-left ${song.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"}`}>
                  🕵️ {song.blind ? "Blind test" : "Pas au blind"}<Key k="B" />
                </button>
                <button onClick={act.fix} className={tool}>🎬 {song.missing ? "Remplacer vidéo" : "Changer vidéo"}<Key k="C" /></button>
                <button onClick={act.text} className={tool} title="Corriger l'interprète ou le titre affichés (faute, majuscules, mention en trop), sans changer de titre ni de vidéo">✎ Texte<Key k="T" /></button>
                <button onClick={act.artist} className={`${tool} ${artistOpen ? "!bg-fuchsia-100 text-fuchsia-800" : ""}`} title="Autres titres de cet interprète en mémoire, pour comparer (orthographe, doublons)">👤 Interprète<Key k="A" /></button>
                <button onClick={act.retitle} className={tool} title="Mauvais titre Deezer (reprise, compilation…) : rattacher au bon titre">🔁 Autre titre<Key k="R" /></button>
              </div>

              <div className="flex gap-2">
                <button onClick={act.prev} disabled={i === 0} title="Précédent (←)" className="text-sm font-bold bg-gray-100 px-3 py-3 rounded-2xl disabled:opacity-40">←</button>
                <button onClick={act.next} className="text-sm font-bold bg-gray-100 px-3 py-3 rounded-2xl whitespace-nowrap">Passer<Key k="→" /></button>
                <button onClick={act.validate} disabled={song.missing}
                  className="flex-1 text-sm font-bold text-white bg-green-600 hover:bg-green-700 px-3 py-3 rounded-2xl disabled:opacity-40 whitespace-nowrap">
                  ✓ Valider et suivant<Key k="V" />
                </button>
              </div>
              <div className="flex items-start gap-3">
                <details className="flex-1 text-xs text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-600">Aide</summary>
                  <p className="mt-1">
                    Validé = la vidéo est le bon titre, dans la bonne version, et les étiquettes sont justes. <b>✎ Texte</b> corrige l'interprète
                    ou le titre affichés (faute, majuscules ; clic sur le titre aussi) ; <b>👤 Interprète</b> montre ses autres titres en mémoire (clic sur
                    son nom aussi) ; <b>🔁 Autre titre</b> rattache au bon titre Deezer (reprise, compilation). On reste dans la revue. Échap pour fermer.
                  </p>
                </details>
                <button onClick={act.forget} className="text-xs font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg shrink-0">Oublier<Key k="O" /></button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Mauvais titre Deezer (reprise, compilation…) : recherche dans Deezer et
 * rattachement de la ligne au bon titre (vidéo conservée). */
function SongTitleChooser({ song, call, onClose, onDone }) {
  const [q, setQ] = useState((song.label || "").replace(" – ", " "));
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const search = async (e) => {
    e?.preventDefault();
    setError("");
    setList(null);
    try { setList((await call("POST", { action: "deezerSearch", q })).results || []); } catch (err) { setError(err.message); setList([]); }
  };
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = async (t) => {
    setBusy(true);
    setError("");
    try {
      const d = await call("POST", { action: "retargetSong", key: song.key, deezerId: t.deezerId });
      onDone(d.key);
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const current = song.key.split(":")[1];
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-3xl p-5 space-y-3 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600">Corriger le titre</p>
            <p className="font-bold leading-snug">{song.label || song.key}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fermer">×</button>
        </div>
        <p className="text-xs text-gray-500">
          Choisissez la version originale : la ligne prend son artiste et son titre (réponses du blind test), la vidéo et les
          étiquettes sont conservées, l'année et la langue sont cherchées à nouveau.
        </p>
        <form onSubmit={search} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artiste et titre"
            className="flex-1 border-2 border-gray-200 rounded-full px-4 py-1.5 text-sm focus:border-fuchsia-500 outline-none" />
          <button className="text-sm font-bold text-white bg-fuchsia-600 px-4 py-1.5 rounded-full">Chercher</button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {list === null ? <p className="text-sm text-gray-400">Recherche…</p> : list.length === 0 ? <p className="text-sm text-gray-400">Aucun résultat.</p> : (
          <ul className="divide-y divide-gray-100">
            {list.map((t) => {
              const same = String(t.deezerId) === current;
              return (
                <li key={t.id}>
                  <button disabled={busy || same} onClick={() => choose(t)}
                    className="w-full flex items-center gap-3 py-2 text-left hover:bg-fuchsia-50 rounded-xl px-1 disabled:opacity-60">
                    {t.thumb ? <img src={t.thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-gray-100 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{t.title}</span>
                      <span className="block text-xs text-gray-500 truncate">{t.channel} · {formatDuration(t.duration)}</span>
                    </span>
                    {same && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">actuel</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const modeLabel = (m) => SEARCH_MODES.find((x) => x.id === m)?.label || m;

/* Champ de recherche avec croix pour l'effacer (Échap efface aussi). */
function SearchInput({ value, onChange, placeholder, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }}
        className="w-full border-2 border-gray-200 bg-white rounded-full pl-4 pr-9 py-1.5 text-sm focus:border-fuchsia-500 outline-none" />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Effacer la recherche" title="Effacer"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs font-bold leading-6 text-center">✕</button>
      )}
    </div>
  );
}

/* Titre d'origine de la vidéo YouTube (et sa chaîne), en petit sous le libellé. */
function VideoTitle({ song, className = "" }) {
  if (!song.videoTitle) return null;
  return (
    <p className={`text-[11px] text-gray-400 ${className}`} title={`Vidéo YouTube : ${song.videoTitle}${song.videoChannel ? ` · ${song.videoChannel}` : ""}`}>
      ▶ {song.videoTitle}{song.videoChannel && <span className="text-gray-300"> · {song.videoChannel}</span>}
    </p>
  );
}

/* Interprète (clic : tous ses titres) – titre (clic : rattacher à un autre
 * titre Deezer) ; ✏️ corrige le texte affiché sans changer de titre. */
function SongName({ song, onArtist, onTitle, onEdit, wrap = false, artistActive = false, className = "text-sm font-semibold",
  artistHint = "Voir tous les titres de cet interprète", titleHint = "Mauvais artiste ou titre (reprise, compilation…) ? Cliquer pour rattacher au bon titre Deezer" }) {
  if (!song.label) return <span className="text-gray-400 font-mono text-xs">{song.key}</span>;
  return (
    <div className={`flex items-baseline gap-1 min-w-0 text-gray-900 ${className}`} title={song.fixed || song.label !== `${song.artist} – ${song.title}` ? `Libellé Deezer : ${song.label}` : undefined}>
      <span className={wrap ? "" : "truncate"}>
        {song.artist && <><button onClick={() => onArtist(song.artist)} title={artistHint} className={`hover:text-fuchsia-700 hover:underline ${artistActive ? "text-fuchsia-700 underline" : ""}`}>{song.artist}</button>{" – "}</>}
        <button onClick={onTitle} title={titleHint} className="hover:text-fuchsia-700 text-left">{song.title}</button>
      </span>
      {song.fixed && <span className="shrink-0 text-[10px] font-bold text-fuchsia-600" title={`Corrigé à la main · libellé Deezer : ${song.label}`}>✏️</span>}
      <button onClick={onEdit} title="Corriger le texte (interprète, titre) sans changer de titre ni de vidéo"
        className="shrink-0 text-xs text-gray-400 hover:text-fuchsia-700 px-1">✎</button>
    </div>
  );
}

function SongTextForm({ song, onSave, onCancel, focus = "artist" }) {
  const [artist, setArtist] = useState(song.artist || "");
  const [title, setTitle] = useState(song.title || "");
  const submit = (e) => { e.preventDefault(); onSave(artist, title); };
  return (
    <form onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && onCancel()} className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Interprète" autoFocus={focus !== "title"}
          className="flex-1 min-w-[120px] border-2 border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-fuchsia-500 outline-none" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre" autoFocus={focus === "title"}
          className="flex-[2] min-w-[160px] border-2 border-gray-200 rounded-lg px-2 py-1 text-sm focus:border-fuchsia-500 outline-none" />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button className="font-bold text-white bg-fuchsia-600 px-3 py-1 rounded-full">Enregistrer</button>
        <button type="button" onClick={onCancel} className="font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Annuler</button>
        {song.fixed && <button type="button" onClick={() => onSave("", "")} className="text-gray-500 underline">Revenir au texte automatique</button>}
        <span className="text-gray-400">Libellé Deezer : {song.label}</span>
      </div>
    </form>
  );
}

/* Sauvegarde de la mémoire : export CSV (toutes les colonnes), import pour
 * restaurer (titres ajoutés ou mis à jour, jamais supprimés). */
const CSV_COLS = ["key", "label", "artist_fix", "title_fix", "video_id", "video_title", "video_channel", "duration", "song_duration",
  "validated", "blind", "lyrics", "missing", "plays", "rank", "year", "fr", "merged_into", "checked_at", "enriched_at", "created_at"];
const csvCell = (v) => (v == null ? "" : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  const [head, ...body] = rows;
  return (body || []).map((r) => Object.fromEntries((head || []).map((h, i) => [h.replace(/^\uFEFF/, "").trim(), r[i] ?? ""])));
}
function Backup({ call, onImported }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const file = useRef(null);
  const exportCsv = async () => {
    setBusy(true);
    try {
      const { rows } = await call("POST", { action: "exportSongs" });
      const csv = "\uFEFF" + [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `jukebox-memoire-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`${rows.length} lignes exportées.`);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const importCsv = async (f) => {
    if (!f) return;
    const rows = parseCsv(await f.text());
    if (!rows.length || !("key" in rows[0]) || !("video_id" in rows[0])) { setMsg("Fichier non reconnu (export de la mémoire attendu)."); return; }
    if (!confirm(`Importer ${rows.length} lignes ?\nLes titres absents sont ajoutés, ceux déjà en mémoire sont remplacés par la version du fichier. Rien n'est supprimé.`)) return;
    setBusy(true);
    try {
      const d = await call("POST", { action: "importSongs", rows });
      setMsg(`${d.imported} lignes importées${d.skipped ? `, ${d.skipped} ignorées (incomplètes)` : ""}.`);
      onImported();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100 text-xs">
      <span className="font-bold text-gray-500">💾 Sauvegarde</span>
      <button disabled={busy} onClick={exportCsv} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full disabled:opacity-50">⬇️ Exporter (CSV)</button>
      <button disabled={busy} onClick={() => file.current?.click()} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full disabled:opacity-50">⬆️ Importer</button>
      <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
      {msg && <span className="text-gray-500">{msg}</span>}
    </div>
  );
}

/* Revue : autres titres de l'interprète en mémoire (tous modes), pour
 * comparer l'orthographe, repérer un doublon ou une version différente. */
function ArtistSongs({ artist, current }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let off = false;
    setList(null);
    const qs = new URLSearchParams({ songs: "1", q: artist, status: "all", sort: "alpha" });
    fetch(`/api/jukebox/super?${qs}`, { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } })
      .then((r) => r.json()).then((d) => !off && setList(d.songs || [])).catch(() => !off && setList([]));
    return () => { off = true; };
  }, [artist]);
  const others = (list || []).filter((s) => s.key !== current);
  const norm = (x) => String(x || "").toLowerCase();
  return (
    <div className="mt-2 rounded-xl bg-fuchsia-50/60 border border-fuchsia-100 px-3 py-2 text-xs">
      <p className="font-bold text-fuchsia-900 mb-1">👤 Autres titres de « {artist} » en mémoire {list && `(${others.length})`}</p>
      {!list ? <p className="text-gray-400">Chargement…</p> : others.length === 0 ? <p className="text-gray-500">Aucun autre titre.</p> : (
        <ul className="max-h-40 overflow-y-auto divide-y divide-fuchsia-100">
          {others.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
              <span className={`font-semibold ${norm(s.artist) !== norm(artist) ? "text-orange-700" : "text-gray-800"}`}
                title={norm(s.artist) !== norm(artist) ? "Interprète écrit autrement" : undefined}>{s.artist}</span>
              <span className="text-gray-700">– {s.title}</span>
              <span className={`text-[10px] font-bold px-1.5 rounded-full ${MODE_TAG[s.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(s.mode)}</span>
              {s.year && <span className="text-gray-400">{s.year}</span>}
              {s.missing ? <span className="text-red-600 font-bold">⚠️ à remplacer</span> : s.validated ? <span className="text-green-700 font-bold">✓</span> : <span className="text-gray-400">à vérifier</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
