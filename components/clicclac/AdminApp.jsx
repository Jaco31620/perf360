"use client";
/*
 * Clic-Clac — espace organisateur (/clic-clac/<code>/admin) :
 * photos (modération, suppression, ZIP de l'album), réglages (cadres, filtres,
 * quota invité, modération…), partage (QR, liens, borne, e-mail).
 * Connexion : code organisateur (PIN), ou jeton super-admin.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import Gallery from "./Gallery";
import { makeZip } from "./zip";
import { api, adminToken, superToken, storage, mergePhotos, formatBytes, formatDate } from "./client";
import { FRAMES, FILTERS } from "@/lib/clicclac/settings";

export default function AdminApp({ code }) {
  const router = useRouter();
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [tab, setTab] = useState("photos");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    setToken(adminToken(code) || superToken());
    setReady(true);
  }, [code]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const d = await api(`/${code}`, { token });
      if (!d.admin) { storage.set(`cc_admin_${code}`, null); setToken(null); return; }
      setInfo(d);
      const g = await api(`/${code}/photos`, { token });
      setPhotos((prev) => mergePhotos(prev, g.photos));
    } catch (e) {
      if (e.status === 404) setInfo(null);
    }
  }, [code, token]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);

  const login = async (e) => {
    e.preventDefault();
    setErr("");
    try {
      const { token: t } = await api(`/${code}/auth`, { method: "POST", body: { pin } });
      storage.set(`cc_admin_${code}`, t);
      setToken(t);
    } catch (e2) { setErr(e2.message); }
  };

  if (!ready) return null;
  if (!token) {
    return (
      <Page>
        <form onSubmit={login} className="max-w-sm mx-auto bg-white rounded-3xl shadow-xl p-7 mt-10 space-y-4">
          <h1 className="text-xl font-black">Espace organisateur</h1>
          <p className="text-gray-500 text-sm">Album <b>{code}</b> — saisissez votre code organisateur.</p>
          <input autoFocus value={pin} onChange={(e) => setPin(e.target.value.toUpperCase())} placeholder="Code organisateur"
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg tracking-widest focus:border-[#ff5a5f] outline-none" />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button className="w-full bg-[#ff5a5f] text-white font-bold py-3 rounded-full">Se connecter</button>
        </form>
      </Page>
    );
  }
  if (!info) return <Page><p className="text-center text-gray-500 pt-20">Chargement…</p></Page>;

  const { album, usage } = info;
  const s = info.admin.settings;
  const pending = photos.filter((p) => p.status === "pending");

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#ff5a5f]">Espace organisateur</p>
          <h1 className="text-3xl font-black text-gray-900">{album.name}</h1>
          <p className="text-sm text-gray-500">
            {album.eventDate && <>{formatDate(album.eventDate)} · </>}code <b className="tracking-wider">{album.code}</b>
            {info.role === "super" && <span className="ml-2 bg-gray-900 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">super-admin</span>}
          </p>
        </div>
        <button onClick={() => { storage.set(`cc_admin_${code}`, null); router.push("/clic-clac"); }} className="text-sm text-gray-400 underline">Se déconnecter</button>
      </header>

      <div className="grid sm:grid-cols-3 gap-3 mb-5">
        <Stat label="Photos" value={`${usage.photos} / ${s.maxPhotos}`} bar={usage.photos / s.maxPhotos} />
        <Stat label="Stockage" value={formatBytes(usage.bytes)} sub={s.keepHd ? "avec version HD" : "version standard"} />
        <Stat label="Suppression prévue" value={formatDate(album.expiresAt)} sub={`${s.retentionDays} jours après l'événement`} />
      </div>

      <nav className="flex gap-2 mb-4">
        {[["photos", `🖼️ Photos${pending.length ? ` (${pending.length} à valider)` : ""}`], ["settings", "⚙️ Réglages"], ["share", "📣 Partager"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-full font-semibold text-sm ${tab === k ? "bg-gray-900 text-white" : "bg-white text-gray-600 border border-gray-200"}`}>{l}</button>
        ))}
      </nav>

      {tab === "photos" && <PhotosTab code={code} token={token} photos={photos} pending={pending} reload={load} setPhotos={setPhotos} />}
      {tab === "settings" && <SettingsTab code={code} token={token} settings={s} album={album} reload={load} />}
      {tab === "share" && <ShareTab code={code} token={token} album={album} />}
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

function Stat({ label, value, sub, bar }) {
  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-4">
      <p className="text-xs font-semibold text-gray-400 uppercase">{label}</p>
      <p className="text-xl font-black text-gray-900">{value}</p>
      {bar != null && <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-[#ff5a5f]" style={{ width: `${Math.min(100, bar * 100)}%` }} /></div>}
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

/* ── Photos : modération, suppression, ZIP ── */
function PhotosTab({ code, token, photos, pending, reload, setPhotos }) {
  const [filter, setFilter] = useState("all");
  const [zip, setZip] = useState(null);
  const list = filter === "pending" ? pending : photos;

  const approve = async (p) => {
    await api(`/${code}/photos/${p.id}`, { method: "PATCH", token, body: { status: "published" } });
    setPhotos((l) => l.map((x) => (x.id === p.id ? { ...x, status: "published" } : x)));
  };
  const remove = async (p) => {
    await api(`/${code}/photos/${p.id}`, { method: "DELETE", token });
    setPhotos((l) => l.filter((x) => x.id !== p.id));
    reload();
  };

  const downloadAll = async () => {
    setZip({ done: 0, total: 0 });
    try {
      const { photos: all } = await api(`/${code}/photos?hd=1`, { token });
      const files = [];
      setZip({ done: 0, total: all.length });
      for (let i = 0; i < all.length; i++) {
        const p = all[i];
        const buf = new Uint8Array(await (await fetch(p.hd || p.full)).arrayBuffer());
        const who = (p.name || "invite").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 20);
        files.push({ name: `${String(all.length - i).padStart(4, "0")}-${who}${p.kind === "strip" ? "-bande" : ""}.jpg`, data: buf });
        setZip({ done: i + 1, total: all.length });
      }
      const blob = makeZip(files);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `clic-clac-${code}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) {
      alert("Téléchargement impossible : " + e.message);
    } finally {
      setZip(null);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-orange-100 p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilter("all")} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${filter === "all" ? "bg-[#ff5a5f] text-white" : "bg-gray-100 text-gray-600"}`}>Toutes ({photos.length})</button>
        <button onClick={() => setFilter("pending")} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${filter === "pending" ? "bg-amber-400 text-amber-950" : "bg-gray-100 text-gray-600"}`}>À valider ({pending.length})</button>
        <div className="flex-1" />
        {pending.length > 0 && filter === "pending" && (
          <button onClick={async () => { for (const p of pending) await approve(p); }} className="px-3 py-1.5 rounded-full text-sm font-semibold bg-green-500 text-white">✓ Tout publier</button>
        )}
        <button onClick={downloadAll} disabled={!!zip || !photos.length} className="px-4 py-1.5 rounded-full text-sm font-bold bg-gray-900 text-white disabled:opacity-50">
          {zip ? `Préparation… ${zip.done}/${zip.total}` : "⬇ Télécharger l'album (ZIP)"}
        </button>
      </div>
      <Gallery photos={list} admin canDownload onApprove={approve} onDelete={remove}
        empty={filter === "pending" ? "Aucune photo en attente." : "Aucune photo pour l'instant."} />
    </div>
  );
}

/* ── Réglages ── */
function SettingsTab({ code, token, settings, album, reload }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const set = (patch) => { setS((x) => ({ ...x, ...patch })); setSaved(""); };
  const toggle = (key, id) => set({ [key]: s[key].includes(id) ? s[key].filter((x) => x !== id) : [...s[key], id] });

  const save = async () => {
    setBusy(true);
    try {
      const r = await api(`/${code}/settings`, { method: "PATCH", token, body: { settings: s } });
      setS(r.settings); setSaved("✓ Enregistré"); reload();
    } catch (e) { setSaved("⚠ " + e.message); } finally { setBusy(false); }
  };

  const uploadFrame = async (file) => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    try { await api(`/${code}/frame`, { method: "POST", token, form }); reload(); set({ frames: [...new Set([...s.frames, "custom"])] }); }
    catch (e) { alert(e.message); }
  };

  const Mode = ({ k }) => (
    <div className="flex gap-1.5">
      {[["off", "Désactivé"], ["imposed", "Imposé"], ["choice", "Au choix de l'invité"]].map(([v, l]) => (
        <button key={v} onClick={() => set({ [k]: v })} className={`px-3 py-1.5 rounded-full text-sm font-semibold ${s[k] === v ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600"}`}>{l}</button>
      ))}
    </div>
  );
  const Check = ({ checked, onChange, children }) => (
    <label className="flex items-center gap-3 py-1.5 cursor-pointer"><input type="checkbox" checked={checked} onChange={onChange} className="w-5 h-5 accent-[#ff5a5f]" /><span>{children}</span></label>
  );

  return (
    <div className="bg-white rounded-3xl border border-orange-100 p-6 space-y-7">
      <section className="space-y-2">
        <h3 className="font-bold text-gray-900">Invités</h3>
        <Check checked={s.moderation} onChange={(e) => set({ moderation: e.target.checked })}>Valider les photos avant publication (modération)</Check>
        <Check checked={s.guestDownload} onChange={(e) => set({ guestDownload: e.target.checked })}>Les invités peuvent télécharger les photos (une par une)</Check>
        <Check checked={s.stripEnabled} onChange={(e) => set({ stripEnabled: e.target.checked })}>Proposer la bande « cabine » de 4 photos</Check>
        <label className="flex items-center gap-3 py-1.5">
          <span>Photos par invité</span>
          <input type="number" min={0} max={s.maxPhotos} value={s.guestQuota} onChange={(e) => set({ guestQuota: Math.max(0, parseInt(e.target.value, 10) || 0) })}
            className="w-24 border-2 border-gray-200 rounded-lg px-2 py-1" />
          <span className="text-sm text-gray-400">0 = illimité · la borne n'a pas de limite</span>
        </label>
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-gray-900">Cadres</h3>
        <Mode k="framesMode" />
        {s.framesMode === "choice" && (
          <div className="flex flex-wrap gap-x-5">{FRAMES.map((f) => (
            <Check key={f.id} checked={s.frames.includes(f.id)} onChange={() => toggle("frames", f.id)}>{f.label}{f.id === "custom" && !settings.customFrame ? " (à envoyer)" : ""}</Check>
          ))}</div>
        )}
        {s.framesMode === "imposed" && (
          <select value={s.imposedFrame} onChange={(e) => set({ imposedFrame: e.target.value })} className="border-2 border-gray-200 rounded-xl px-3 py-2">
            {FRAMES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}
        <div className="flex flex-wrap items-center gap-3 bg-orange-50 rounded-2xl p-3">
          <span className="text-sm text-gray-600">Cadre perso : PNG transparent posé sur la photo (idéalement au format 4:3 ou 3:4).</span>
          <input ref={fileRef} type="file" accept="image/png" className="hidden" onChange={(e) => { uploadFrame(e.target.files?.[0]); e.target.value = ""; }} />
          <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 rounded-full text-sm font-semibold bg-white border border-gray-200">{settings.customFrame ? "Changer" : "Envoyer un cadre"}</button>
          {settings.customFrame && (
            <button onClick={async () => { await api(`/${code}/frame`, { method: "DELETE", token }); reload(); }} className="px-3 py-1.5 rounded-full text-sm font-semibold text-red-600 bg-white border border-red-200">Retirer</button>
          )}
          {album.customFrameUrl && <img src={album.customFrameUrl} alt="Cadre perso" className="h-16 bg-[repeating-conic-gradient(#ddd_0_25%,#fff_0_50%)] [background-size:12px_12px] rounded" />}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-gray-900">Filtres</h3>
        <Mode k="filtersMode" />
        {s.filtersMode === "choice" && (
          <div className="flex flex-wrap gap-x-5">{FILTERS.map((f) => <Check key={f.id} checked={s.filters.includes(f.id)} onChange={() => toggle("filters", f.id)}>{f.label}</Check>)}</div>
        )}
        {s.filtersMode === "imposed" && (
          <select value={s.imposedFilter} onChange={(e) => set({ imposedFilter: e.target.value })} className="border-2 border-gray-200 rounded-xl px-3 py-2">
            {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}
      </section>

      <section className="text-sm text-gray-500 bg-gray-50 rounded-2xl p-4">
        Capacité ({s.maxPhotos} photos), durée de conservation ({s.retentionDays} jours) et version HD ({s.keepHd ? "oui" : "non"}) sont réglées par le super-admin.
      </section>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="bg-[#ff5a5f] text-white font-bold px-6 py-3 rounded-full disabled:opacity-50">{busy ? "Enregistrement…" : "Enregistrer"}</button>
        {saved && <span className="text-sm font-semibold text-gray-600">{saved}</span>}
      </div>
    </div>
  );
}

/* ── Partage ── */
function ShareTab({ code, token, album }) {
  const router = useRouter();
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState("");
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const guestUrl = `${origin}/clic-clac/${code}`;
  const copy = async (text, k) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(""), 2000); } catch (e) { /* ignoré */ } };

  const boothToken = async () => (await api(`/${code}/auth`, { method: "POST", token, body: { booth: true } })).token;
  const openBooth = async () => { storage.set(`cc_booth_${code}`, await boothToken()); router.push(`/clic-clac/${code}/borne`); };
  const copyBooth = async () => copy(`${origin}/clic-clac/${code}/borne#b=${await boothToken()}`, "booth");

  const send = async (e) => {
    e.preventDefault();
    setStatus(null);
    try {
      const r = await api(`/${code}/share`, { method: "POST", token, body: { to: to.split(/[\s,;]+/).filter(Boolean), message: msg } });
      setStatus({ ok: true, text: `✓ Envoyé à ${r.sent} destinataire${r.sent > 1 ? "s" : ""}.` }); setTo("");
    } catch (err) { setStatus({ ok: false, text: err.message }); }
  };

  const btn = "px-4 py-2 rounded-full text-sm font-semibold bg-white border border-gray-200 hover:bg-gray-50";
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-white rounded-3xl border border-orange-100 p-6 text-center space-y-3">
        <h3 className="font-bold text-gray-900">Inviter à participer</h3>
        {origin && <div className="inline-block p-3 bg-white rounded-2xl border"><QRCodeSVG value={guestUrl} size={200} /></div>}
        <p className="text-3xl font-black tracking-[0.25em] text-gray-900">{code}</p>
        <p className="text-sm text-gray-500 break-all">{guestUrl}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button onClick={() => copy(guestUrl, "guest")} className={btn}>{copied === "guest" ? "✓ Copié" : "Copier le lien invité"}</button>
          <a href={`/clic-clac/${code}/live`} target="_blank" className={btn}>📺 Écran live</a>
        </div>
      </div>
      <div className="space-y-4">
        <div className="bg-white rounded-3xl border border-orange-100 p-6 space-y-3">
          <h3 className="font-bold text-gray-900">Borne photo</h3>
          <p className="text-sm text-gray-500">Un appareil dédié (tablette, ordinateur avec webcam) en mode cabine : grand bouton, compte à rebours, pas de limite de photos, QR « récupérer ma photo ».</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={openBooth} className="px-4 py-2 rounded-full text-sm font-bold bg-[#ff5a5f] text-white">Ouvrir la borne sur cet appareil</button>
            <button onClick={copyBooth} className={btn}>{copied === "booth" ? "✓ Copié" : "Copier le lien borne"}</button>
          </div>
          <p className="text-xs text-gray-400">Le lien borne donne accès à la prise de photos sans limite pendant 7 jours : ne le partagez pas.</p>
        </div>
        <form onSubmit={send} className="bg-white rounded-3xl border border-orange-100 p-6 space-y-3">
          <h3 className="font-bold text-gray-900">Envoyer le lien de l'album par e-mail</h3>
          <textarea rows={2} value={to} onChange={(e) => setTo(e.target.value)} placeholder="adresse@exemple.fr, autre@exemple.fr"
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 resize-none focus:border-[#ff5a5f] outline-none" />
          <textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message (facultatif)"
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 resize-none focus:border-[#ff5a5f] outline-none" />
          {status && <p className={`text-sm font-semibold ${status.ok ? "text-green-600" : "text-red-600"}`}>{status.text}</p>}
          <button disabled={!to.trim()} className="bg-gray-900 text-white font-bold px-5 py-2.5 rounded-full disabled:opacity-40">Envoyer</button>
        </form>
      </div>
    </div>
  );
}
