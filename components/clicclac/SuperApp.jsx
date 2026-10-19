"use client";
/*
 * Clic-Clac — super-admin (/clic-clac/super) : création des albums et de leurs
 * quotas, suivi du stockage, prolongation, nouveau code organisateur, suppression.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, superToken, storage, formatBytes, formatDate } from "./client";
import { DEFAULT_SETTINGS } from "@/lib/clicclac/settings";

const STORAGE_FREE = 1e9; // ordre de grandeur de l'offre gratuite Supabase (stockage)

export default function SuperApp() {
  const [token, setToken] = useState(undefined);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => { setToken(superToken()); setOrigin(window.location.origin); }, []);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await api("/super/albums", { token })); }
    catch (e) { if (e.status === 401) { storage.set("cc_super", null); setToken(null); } }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const login = async (e) => {
    e.preventDefault();
    setErr("");
    try { const r = await api("/super/login", { method: "POST", body: { password: pw } }); storage.set("cc_super", r.token); setToken(r.token); setPw(""); }
    catch (e2) { setErr(e2.message); }
  };

  if (token === undefined) return null;
  if (!token) {
    return (
      <Page>
        <form onSubmit={login} className="max-w-sm mx-auto bg-white rounded-3xl shadow-xl p-7 mt-10 space-y-4">
          <h1 className="text-xl font-black">Super-admin Clic-Clac</h1>
          <input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe"
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-[#ff5a5f] outline-none" />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button className="w-full bg-gray-900 text-white font-bold py-3 rounded-full">Se connecter</button>
        </form>
      </Page>
    );
  }

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#ff5a5f]">Super-admin</p>
          <h1 className="text-3xl font-black text-gray-900">Albums Clic-Clac</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setCreating(true); setCreated(null); }} className="bg-[#ff5a5f] text-white font-bold px-5 py-2.5 rounded-full">+ Nouvel album</button>
          <button onClick={() => { storage.set("cc_super", null); setToken(null); }} className="text-sm text-gray-400 underline">Se déconnecter</button>
        </div>
      </div>

      {data && (
        <div className="bg-white rounded-2xl border border-orange-100 p-4 mb-5">
          <div className="flex justify-between text-sm"><span className="font-semibold">Stockage utilisé (tous albums)</span><span>{formatBytes(data.totalBytes)} / ~1 Go (offre gratuite)</span></div>
          <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-[#ff5a5f]" style={{ width: `${Math.min(100, (data.totalBytes / STORAGE_FREE) * 100)}%` }} /></div>
          <p className="text-xs text-gray-400 mt-1">Le volume téléchargé (consultation des galeries) compte aussi dans l'offre gratuite Supabase (~5 Go/mois, partagés avec les autres applis).</p>
        </div>
      )}

      {creating && <CreateForm token={token} onCancel={() => setCreating(false)} onCreated={(r) => { setCreating(false); setCreated(r); load(); }} />}
      {created && <Credentials origin={origin} {...created} onClose={() => setCreated(null)} />}

      <div className="space-y-3">
        {data?.albums.length === 0 && <p className="text-gray-400 text-center py-10">Aucun album.</p>}
        {data?.albums.map((a) => <AlbumRow key={a.id} a={a} token={token} origin={origin} reload={load} onPin={setCreated} />)}
      </div>
    </Page>
  );
}

function Page({ children }) {
  return (
    <div className="min-h-screen bg-[#fff8f3] px-4 py-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/clic-clac" className="inline-flex items-center gap-2 text-sm font-bold text-gray-500 mb-4">
          <img src="/icon-clicclac.svg" alt="" className="w-6 h-6 rounded-md" /> Clic-Clac
        </Link>
        {children}
      </div>
    </div>
  );
}

const input = "w-full border-2 border-gray-200 rounded-xl px-3 py-2 focus:border-[#ff5a5f] outline-none";

function QuotaFields({ v, set }) {
  return (
    <div className="grid sm:grid-cols-4 gap-3">
      <label className="text-sm">Photos max<input type="number" min={1} max={5000} value={v.maxPhotos} onChange={(e) => set({ maxPhotos: e.target.value })} className={input} /></label>
      <label className="text-sm">Par invité (0 = ∞)<input type="number" min={0} value={v.guestQuota} onChange={(e) => set({ guestQuota: e.target.value })} className={input} /></label>
      <label className="text-sm">Conservation (jours après)<input type="number" min={1} max={365} value={v.retentionDays} onChange={(e) => set({ retentionDays: e.target.value })} className={input} /></label>
      <label className="text-sm flex items-end gap-2 pb-2"><input type="checkbox" checked={v.keepHd} onChange={(e) => set({ keepHd: e.target.checked })} className="w-5 h-5 accent-[#ff5a5f]" /> Garder la HD (impression)</label>
    </div>
  );
}

function CreateForm({ token, onCancel, onCreated }) {
  const [v, setV] = useState({ name: "", eventDate: "", adminEmail: "", ...DEFAULT_SETTINGS });
  const [err, setErr] = useState("");
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const { maxPhotos, guestQuota, retentionDays, keepHd } = v;
      const r = await api("/super/albums", { method: "POST", token, body: { name: v.name, eventDate: v.eventDate, adminEmail: v.adminEmail, settings: { maxPhotos, guestQuota, retentionDays, keepHd } } });
      onCreated({ ...r, name: v.name });
    } catch (e2) { setErr(e2.message); }
  };
  return (
    <form onSubmit={submit} className="bg-white rounded-3xl border-2 border-[#ff5a5f] p-6 mb-5 space-y-4">
      <h2 className="text-xl font-black">Nouvel album</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="text-sm">Nom de l'événement<input required maxLength={40} value={v.name} onChange={(e) => set({ name: e.target.value })} className={input} /></label>
        <label className="text-sm">Date<input type="date" value={v.eventDate} onChange={(e) => set({ eventDate: e.target.value })} className={input} /></label>
        <label className="text-sm">E-mail organisateur (alertes)<input type="email" value={v.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} className={input} /></label>
      </div>
      <QuotaFields v={v} set={set} />
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <div className="flex gap-2">
        <button className="bg-[#ff5a5f] text-white font-bold px-6 py-2.5 rounded-full">Créer</button>
        <button type="button" onClick={onCancel} className="px-6 py-2.5 rounded-full bg-gray-100 font-semibold">Annuler</button>
      </div>
    </form>
  );
}

/* Codes à transmettre à l'organisateur (le code organisateur n'est affiché qu'une fois). */
function Credentials({ origin, code, pin, name, onClose }) {
  const text = `Clic-Clac — ${name}\nAlbum invités : ${origin}/clic-clac/${code} (code ${code})\nEspace organisateur : ${origin}/clic-clac/${code}/admin\nCode organisateur : ${pin}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-green-50 border-2 border-green-300 rounded-3xl p-6 mb-5 space-y-3">
      <h2 className="text-lg font-black text-green-900">Codes de « {name} »</h2>
      <p className="text-sm text-green-800">Le code organisateur n'est affiché qu'<b>une seule fois</b> : copiez-le et transmettez-le à l'organisateur.</p>
      <pre className="bg-white rounded-xl p-4 text-sm whitespace-pre-wrap">{text}</pre>
      <div className="flex gap-2">
        <button onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }} className="bg-green-600 text-white font-bold px-5 py-2 rounded-full">{copied ? "✓ Copié" : "Copier"}</button>
        <button onClick={onClose} className="px-5 py-2 rounded-full bg-white font-semibold">Fermer</button>
      </div>
    </div>
  );
}

function AlbumRow({ a, token, origin, reload, onPin }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(null);
  const s = a.settings;
  const expired = a.expires_at && new Date(a.expires_at) < new Date(Date.now() + 3 * 864e5);
  const patch = async (body) => {
    try { const r = await api(`/super/albums/${a.id}`, { method: "PATCH", token, body }); if (r.pin) onPin({ code: a.code, pin: r.pin, name: a.name }); reload(); return true; }
    catch (e) { alert(e.message); return false; }
  };

  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="font-black text-gray-900">{a.name} <span className="ml-1 font-mono text-sm text-[#ff5a5f] tracking-wider">{a.code}</span></p>
          <p className="text-xs text-gray-500">
            {a.event_date ? formatDate(a.event_date) : "sans date"} · suppression le <span className={expired ? "text-red-600 font-bold" : ""}>{formatDate(a.expires_at)}</span>
            {a.admin_email && <> · {a.admin_email}</>}
          </p>
        </div>
        <div className="text-sm text-right">
          <p><b>{a.usage.photos}</b> / {s.maxPhotos} photos{a.usage.pending ? ` · ${a.usage.pending} en attente` : ""}</p>
          <p className="text-gray-400">{formatBytes(a.usage.bytes)}{s.keepHd ? " · HD" : ""} · {s.guestQuota || "∞"}/invité</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <Link href={`/clic-clac/${a.code}/admin`} className="px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-900 text-white">Ouvrir (organisateur)</Link>
        <a href={`/clic-clac/${a.code}/live`} target="_blank" className="px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-100">Live</a>
        <button onClick={() => { setEdit((x) => !x); setV({ name: a.name, eventDate: a.event_date || "", adminEmail: a.admin_email || "", ...s }); }} className="px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-100">Quotas & infos</button>
        <button onClick={() => patch({ extendDays: 30 })} className="px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-100">+30 jours</button>
        <button onClick={() => confirm("Générer un nouveau code organisateur ? L'ancien ne fonctionnera plus.") && patch({ regenPin: true })} className="px-3 py-1.5 rounded-full text-sm font-semibold bg-gray-100">Nouveau code orga</button>
        <button onClick={async () => {
          if (!confirm(`Supprimer définitivement « ${a.name} » et ses ${a.usage.photos} photos ?`)) return;
          try { await api(`/super/albums/${a.id}`, { method: "DELETE", token }); reload(); } catch (e) { alert(e.message); }
        }} className="px-3 py-1.5 rounded-full text-sm font-semibold text-red-600 bg-red-50">Supprimer</button>
      </div>
      {edit && v && (
        <form onSubmit={async (e) => {
          e.preventDefault();
          const { maxPhotos, guestQuota, retentionDays, keepHd } = v;
          const ok = await patch({ name: v.name, eventDate: v.eventDate, adminEmail: v.adminEmail, settings: { maxPhotos, retentionDays, keepHd } });
          // le quota par invité est un réglage organisateur : on le met à jour via la route d'album
          if (ok && String(guestQuota) !== String(s.guestQuota)) await api(`/${a.code}/settings`, { method: "PATCH", token, body: { settings: { guestQuota } } }).catch(() => {});
          if (ok) { setEdit(false); reload(); }
        }} className="mt-4 pt-4 border-t border-gray-100 space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-sm">Nom<input maxLength={40} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={input} /></label>
            <label className="text-sm">Date<input type="date" value={v.eventDate} onChange={(e) => setV({ ...v, eventDate: e.target.value })} className={input} /></label>
            <label className="text-sm">E-mail organisateur<input type="email" value={v.adminEmail} onChange={(e) => setV({ ...v, adminEmail: e.target.value })} className={input} /></label>
          </div>
          <QuotaFields v={v} set={(p) => setV({ ...v, ...p })} />
          <p className="text-xs text-gray-400">Modifier la date ou la durée de conservation recalcule la date de suppression.</p>
          <button className="bg-gray-900 text-white font-bold px-5 py-2 rounded-full">Enregistrer</button>
        </form>
      )}
    </div>
  );
}
