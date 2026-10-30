"use client";
/*
 * Jukebox — super-admin (/jukebox/admin), mot de passe de Clic-Clac :
 * toutes les soirées (activité, suppression prévue), accès à leur régie,
 * nouveau lien régie, suppression ; réglages de conservation et de création ;
 * recherches YouTube du jour.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import { getSuperToken, setSuperToken, setAdminToken, rememberParty, formatCode } from "./storage";
import { MAX_NAME_LEN, MAX_CHOICES, DEFAULT_MAX_PER_PARTICIPANT, maxLabel } from "@/lib/jukebox";

const RETENTION_CHOICES = [1, 2, 3, 7, 14, 30];
const CREATION_MODES = [
  { id: "open", label: "Tout le monde", hint: "Toute personne qui connaît l'adresse /jukebox peut créer une soirée." },
  { id: "code", label: "Avec un code", hint: "Il faut saisir le code de création ci-dessous." },
  { id: "super", label: "Super-admin seul", hint: "Vous créez les soirées ici et transmettez le lien régie." },
];
const SEARCH_QUOTA = 100; // ~10 000 unités / jour, 100 par recherche

const fmtDate = (ms) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function fmtIn(ms) {
  const d = ms - Date.now();
  if (d <= 0) return "à la prochaine purge";
  const h = Math.round(d / 3600e3);
  return h < 48 ? `dans ${h} h` : `dans ${Math.round(h / 24)} j`;
}
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

export default function SuperAdmin() {
  const [token, setToken] = useState(undefined);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [origin, setOrigin] = useState("");
  const [link, setLink] = useState(null); // { name, url } lien régie à transmettre

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

  const action = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return null;
    try { const d = await call("POST", body); await load(); return d; } catch (e) { alert(e.message); return null; }
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

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600">Super-admin</p>
          <h1 className="text-3xl font-black text-gray-900">Soirées Jukebox</h1>
        </div>
        <button onClick={() => { setSuperToken(null); setToken(null); }} className="text-sm text-gray-400 underline">Se déconnecter</button>
      </div>

      {data && (
        <div className="grid gap-4 md:grid-cols-2 mb-5">
          <div className="bg-white rounded-2xl border border-purple-100 p-5">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">Recherches YouTube aujourd'hui</span>
              <span>{data.searches} / ~{SEARCH_QUOTA}</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
              <div className={`h-full ${data.searches >= SEARCH_QUOTA * 0.8 ? "bg-red-500" : "bg-fuchsia-500"}`} style={{ width: `${Math.min(100, (data.searches / SEARCH_QUOTA) * 100)}%` }} />
            </div>
            <p className="text-sm mt-3"><span className="font-semibold">Titres en mémoire :</span> {data.songs}</p>
            <p className="text-xs text-gray-400 mt-2">Remise à zéro chaque jour à 9 h (heure de Paris). Les recherches déjà faites (30 j) et les liens collés ne comptent pas. Avec Deezer, seul l'ajout d'un titre jamais choisi compte.</p>
          </div>

          <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-3 text-sm">
            <div>
              <p className="font-semibold mb-1.5">Moteur de recherche des invités</p>
              <div className="flex bg-gray-100 rounded-full p-0.5">
                {[["deezer", "Deezer (sans quota)"], ["youtube", "YouTube"]].map(([id, label]) => (
                  <button key={id} onClick={() => id !== cfg.searchEngine && action({ action: "settings", searchEngine: id })}
                    className={`flex-1 px-2 py-1.5 rounded-full font-bold ${id === cfg.searchEngine ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {cfg.searchEngine === "deezer"
                  ? "Les invités cherchent dans le catalogue Deezer ; la vidéo YouTube n'est cherchée qu'à l'ajout (gardée 30 j, partagée entre soirées)."
                  : "Chaque recherche d'invité consomme le quota YouTube (~100 recherches nouvelles par jour)."}
              </p>
            </div>
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
                  <button key={m.id} onClick={() => m.id !== cfg.creationMode && action({
                    action: "settings", creationMode: m.id, ...(m.id === "code" && !cfg.creationCode ? { creationCode: randomCode() } : {}),
                  })}
                    className={`flex-1 px-2 py-1.5 rounded-full font-bold ${m.id === cfg.creationMode ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5">{CREATION_MODES.find((m) => m.id === cfg.creationMode)?.hint}</p>
            </div>
            {cfg.creationMode === "code" && (
              <div className="flex items-center gap-2">
                <span className="text-gray-600">Code de création :</span>
                <span className="font-mono font-black text-lg tracking-widest">{cfg.creationCode}</span>
                <button onClick={() => action({ action: "settings", creationCode: randomCode() }, "Générer un nouveau code ? L'ancien ne fonctionnera plus.")}
                  className="ml-auto text-xs text-fuchsia-600 underline">Nouveau code</button>
              </div>
            )}
          </div>
        </div>
      )}

      <CreateForm token={token} onCreated={(code, adminToken, name) => {
        setAdminToken(code, adminToken);
        rememberParty(code, name);
        setLink({ name, url: `${origin}/jukebox/${code}/regie#t=${adminToken}` });
        load();
      }} />

      {link && <LinkBox {...link} onClose={() => setLink(null)} />}

      <div className="space-y-3 mt-5">
        {data?.sessions.length === 0 && <p className="text-gray-400 text-center py-10">Aucune soirée.</p>}
        {data?.sessions.map((s) => (
          <div key={s.code} className="bg-white rounded-2xl border border-purple-100 p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex-1 min-w-[220px]">
              <p className="font-bold text-gray-900">{s.name} <span className="font-mono text-fuchsia-600 text-sm ml-1">{formatCode(s.code)}</span></p>
              <p className="text-xs text-gray-500">
                Créée le {fmtDate(Date.parse(s.createdAt))} · dernière activité {fmtDate(s.lastActivity)} · {s.played} titre{s.played > 1 ? "s" : ""} joué{s.played > 1 ? "s" : ""}, {s.queued} en attente
              </p>
              <p className="text-xs text-gray-400">Suppression automatique {fmtIn(s.expiresAt)}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Link href={`/jukebox/${s.code}/regie`} target="_blank" className="font-bold bg-gray-900 text-white px-3 py-1.5 rounded-full">Régie</Link>
              <Link href={`/jukebox/${s.code}/ecran`} target="_blank" className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">Écran</Link>
              <button onClick={async () => {
                const d = await action({ action: "regie", code: s.code }, `Créer un nouveau lien régie pour « ${s.name} » ?\nL'ancien lien régie ne fonctionnera plus.`);
                if (d?.adminToken) { setAdminToken(s.code, d.adminToken); setLink({ name: s.name, url: `${origin}/jukebox/${s.code}/regie#t=${d.adminToken}` }); }
              }} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">Nouveau lien régie</button>
              <button onClick={() => action({ action: "delete", code: s.code }, `Supprimer définitivement « ${s.name} » ?`)}
                className="font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Supprimer</button>
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

function CreateForm({ token, onCreated }) {
  const [name, setName] = useState("");
  const [max, setMax] = useState(DEFAULT_MAX_PER_PARTICIPANT);
  const [busy, setBusy] = useState(false);

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/jukebox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-jukebox-super": token },
        body: JSON.stringify({ name, maxPerParticipant: max }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création impossible.");
      onCreated(d.code, d.adminToken, name.trim());
      setName("");
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="bg-white rounded-2xl border border-purple-100 p-4 flex flex-wrap items-center gap-3">
      <input maxLength={MAX_NAME_LEN} placeholder="Nom d'une nouvelle soirée" value={name} onChange={(e) => setName(e.target.value)}
        className="flex-1 min-w-[200px] border-2 border-gray-200 rounded-xl px-4 py-2 focus:border-fuchsia-500 outline-none" />
      <label className="flex items-center gap-2 text-sm text-gray-600">
        Titres en attente / invité
        <select value={max} onChange={(e) => setMax(Number(e.target.value))} className="border-2 border-gray-200 rounded-xl px-2 py-1.5 font-semibold">
          {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
        </select>
      </label>
      <button disabled={busy || !name.trim()} className="bg-fuchsia-600 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-full">
        {busy ? "Création…" : "+ Créer la soirée"}
      </button>
    </form>
  );
}

function LinkBox({ name, url, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4 bg-fuchsia-50 border border-fuchsia-200 rounded-2xl p-4">
      <p className="font-bold text-gray-900 mb-1">Lien régie de « {name} » — à transmettre à l'organisateur</p>
      <p className="text-xs text-gray-500 mb-2">Ce lien donne le contrôle de la soirée : ne le partagez pas avec les invités.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <code className="flex-1 min-w-0 break-all bg-white rounded-lg px-3 py-2 text-xs">{url}</code>
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch (e) { /* ignoré */ } }}
          className="bg-gray-900 text-white text-sm font-bold px-4 py-2 rounded-full">{copied ? "✓ Copié" : "Copier"}</button>
        <button onClick={onClose} className="text-sm text-gray-400 underline">Fermer</button>
      </div>
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
