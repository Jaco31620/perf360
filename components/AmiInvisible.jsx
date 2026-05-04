"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const TABS = ["Participants", "Exclusions", "Message", "Tirage", "Historique"];
const ICONS = ["👥", "🚫", "✉️", "🎲", "📋"];
const ADMIN_PASSWORD = "admin1234"; // À changer

const defaultTemplate = `Bonjour {prenom_offreur} 🎁

Le tirage au sort Ami Invisible vient d'avoir lieu !

Tu offres un cadeau à : {prenom_receveur} {nom_receveur}

Garde le secret et bonne préparation !`;

// ── Helpers ──────────────────────────────────────────────────────
const fill = (t, o, r) =>
  t.replace("{prenom_offreur}", o.prenom).replace("{nom_offreur}", o.nom)
   .replace("{prenom_receveur}", r.prenom).replace("{nom_receveur}", r.nom);

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const fmtDate = iso => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

// ── Supabase helpers ─────────────────────────────────────────────
// Utilise localStorage par utilisateur (clé unique par navigateur)
// Pour une vraie auth Supabase, remplacer userId par supabase.auth.getUser()
function getUserId() {
  if (typeof window === "undefined") return "anon";
  let id = localStorage.getItem("perf360_uid");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("perf360_uid", id); }
  return id;
}

async function loadFromSupabase(table) {
  const uid = getUserId();
  const { data } = await supabase.from(table).select("data").eq("user_id", uid).single();
  return data?.data || null;
}

async function saveToSupabase(table, value) {
  const uid = getUserId();
  await supabase.from(table).upsert({ user_id: uid, data: value }, { onConflict: "user_id" });
}

// ── UI atoms ─────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Carnet modal ─────────────────────────────────────────────────
function CarnetModal({ carnet, current, onSelect, onClose }) {
  const [sel, setSel] = useState([]);
  const currentEmails = new Set(current.map(p => p.email?.toLowerCase()));
  const toggle = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const confirm = () => { onSelect(carnet.filter(p => sel.includes(p.id))); onClose(); };

  return (
    <Modal title="📖 Carnet de participants" onClose={onClose}>
      <p className="text-xs text-gray-400">Sélectionne les participants à ajouter.</p>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {carnet.length === 0 && <p className="text-gray-400 text-sm">Carnet vide.</p>}
        {carnet.map(p => {
          const already = currentEmails.has(p.email?.toLowerCase());
          const checked = sel.includes(p.id);
          return (
            <div key={p.id} onClick={() => !already && toggle(p.id)}
              className={`flex items-center gap-3 border rounded-lg px-3 py-2 cursor-pointer transition-colors
                ${already ? "bg-gray-50 opacity-50 cursor-default" : checked ? "border-red-400 bg-red-50" : "hover:bg-gray-50"}`}>
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                ${already ? "bg-gray-300 border-gray-300" : checked ? "bg-red-500 border-red-500" : "border-gray-300"}`}>
                {(checked || already) && <span className="text-white text-xs">✓</span>}
              </div>
              <div>
                <p className="text-sm font-medium">{p.prenom} {p.nom}</p>
                <p className="text-xs text-gray-400">{p.email}</p>
              </div>
              {already && <span className="ml-auto text-xs text-gray-400">Déjà ajouté</span>}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button onClick={confirm} disabled={sel.length === 0}
          className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-40 text-white py-2 rounded-lg text-sm font-medium">
          Ajouter {sel.length > 0 ? `(${sel.length})` : ""}
        </button>
        <button onClick={onClose} className="flex-1 border py-2 rounded-lg text-sm">Annuler</button>
      </div>
    </Modal>
  );
}

// ── Participants ─────────────────────────────────────────────────
function ParticipantsTab({ participants, setParticipants, carnet, setCarnet }) {
  const [form, setForm] = useState({ prenom: "", nom: "", email: "", tel: "" });
  const [editId, setEditId] = useState(null);
  const [err, setErr] = useState("");
  const [showCarnet, setShowCarnet] = useState(false);

  const reset = () => { setForm({ prenom: "", nom: "", email: "", tel: "" }); setEditId(null); setErr(""); };

  const save = async () => {
    if (!form.prenom.trim() || !form.nom.trim()) return setErr("Prénom et nom requis.");
    if (!form.email.trim()) return setErr("Email requis.");
    if (editId) {
      setParticipants(p => p.map(x => x.id === editId ? { ...x, ...form } : x));
    } else {
      const newP = { ...form, id: Date.now() };
      setParticipants(p => [...p, newP]);
      const already = carnet.find(c => c.email.toLowerCase() === form.email.toLowerCase());
      if (!already) {
        const newCarnet = [...carnet, { ...form, id: newP.id }];
        setCarnet(newCarnet);
        await saveToSupabase("carnet", newCarnet);
      }
    }
    reset();
  };

  const importFromCarnet = (selected) => {
    const toAdd = selected.map(p => ({ ...p, id: Date.now() + Math.random() }));
    setParticipants(p => [...p, ...toAdd]);
  };

  return (
    <div className="space-y-6">
      {showCarnet && <CarnetModal carnet={carnet} current={participants} onSelect={importFromCarnet} onClose={() => setShowCarnet(false)} />}
      <div className="bg-white rounded-xl shadow p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold text-gray-700">{editId ? "Modifier" : "Ajouter un participant"}</h2>
          {!editId && (
            <button onClick={() => setShowCarnet(true)}
              className={`text-xs border px-3 py-1 rounded-full ${carnet.length > 0 ? "text-red-500 border-red-300 hover:bg-red-50" : "text-gray-300 border-gray-200 cursor-default"}`}>
              📖 Carnet {carnet.length > 0 ? `(${carnet.length})` : "(vide)"}
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[["prenom", "Prénom *"], ["nom", "Nom *"], ["email", "Email *"], ["tel", "Téléphone"]].map(([k, l]) => (
            <div key={k}>
              <label className="text-xs text-gray-500 mb-1 block">{l}</label>
              <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={l.replace(" *", "")} />
            </div>
          ))}
        </div>
        {err && <p className="text-red-500 text-xs">{err}</p>}
        <div className="flex gap-2">
          <button onClick={save} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium">{editId ? "Mettre à jour" : "Ajouter"}</button>
          {editId && <button onClick={reset} className="border px-4 py-2 rounded-lg text-sm">Annuler</button>}
        </div>
      </div>
      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-gray-700 mb-3">Pour ce tirage ({participants.length})</h2>
        {participants.length === 0 ? <p className="text-gray-400 text-sm">Aucun participant ajouté.</p> : (
          <div className="space-y-2">
            {participants.map(p => (
              <div key={p.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-medium">{p.prenom} {p.nom}</p>
                  <p className="text-xs text-gray-400">{p.email}{p.tel ? ` · ${p.tel}` : ""}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setForm({ prenom: p.prenom, nom: p.nom, email: p.email, tel: p.tel }); setEditId(p.id); }} className="text-xs text-blue-500 hover:underline">Modifier</button>
                  <button onClick={() => setParticipants(p2 => p2.filter(x => x.id !== p.id))} className="text-xs text-red-400 hover:underline">Retirer</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Exclusions ───────────────────────────────────────────────────
function ExclusionsTab({ participants, exclusions, setExclusions }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [err, setErr] = useState("");

  const add = () => {
    if (!from || !to) return setErr("Sélectionne deux participants.");
    if (from === to) return setErr("Un participant ne peut pas s'exclure lui-même.");
    const key = `${from}->${to}`;
    if (exclusions.find(e => e.key === key)) return setErr("Exclusion déjà existante.");
    setExclusions(ex => [...ex, { key, from, to }]);
    setFrom(""); setTo(""); setErr("");
  };
  const name = id => { const p = participants.find(x => String(x.id) === String(id)); return p ? `${p.prenom} ${p.nom}` : ""; };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow p-5 space-y-4">
        <h2 className="font-semibold text-gray-700">Ajouter une exclusion</h2>
        <div className="flex items-center gap-3">
          <select className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            value={from} onChange={e => setFrom(e.target.value)}>
            <option value="">-- Personne A --</option>
            {participants.map(p => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
          </select>
          <span className="text-sm text-gray-500 whitespace-nowrap font-medium">ne peut pas offrir à</span>
          <select className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            value={to} onChange={e => setTo(e.target.value)}>
            <option value="">-- Personne B --</option>
            {participants.map(p => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
          </select>
        </div>
        {err && <p className="text-red-500 text-xs">{err}</p>}
        <button onClick={add} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium">Ajouter</button>
      </div>
      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold text-gray-700 mb-3">Exclusions ({exclusions.length})</h2>
        {exclusions.length === 0 ? <p className="text-gray-400 text-sm">Aucune exclusion.</p> : (
          <div className="flex flex-wrap gap-2">
            {exclusions.map(e => (
              <span key={e.key} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                {name(e.from)} ↛ {name(e.to)}
                <button onClick={() => setExclusions(ex => ex.filter(x => x.key !== e.key))} className="ml-1 hover:opacity-70">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Message ──────────────────────────────────────────────────────
function MessageTab({ template, setTemplate }) {
  return (
    <div className="bg-white rounded-xl shadow p-5 space-y-3">
      <h2 className="font-semibold text-gray-700">Template du message</h2>
      <p className="text-xs text-gray-400">Variables : <code className="bg-gray-100 px-1 rounded">{"{prenom_offreur}"}</code> <code className="bg-gray-100 px-1 rounded">{"{nom_offreur}"}</code> <code className="bg-gray-100 px-1 rounded">{"{prenom_receveur}"}</code> <code className="bg-gray-100 px-1 rounded">{"{nom_receveur}"}</code></p>
      <textarea rows={12} className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-300"
        value={template} onChange={e => setTemplate(e.target.value)} />
      <button onClick={() => setTemplate(defaultTemplate)} className="text-xs text-gray-400 hover:underline">Réinitialiser</button>
    </div>
  );
}

// ── Tirage ───────────────────────────────────────────────────────
function TirageTab({ participants, exclusions, template, onTirageSaved }) {
  const [eventName, setEventName] = useState("");
  const [status, setStatus] = useState("idle");
  const [pairs, setPairs] = useState(null);
  const [sentLog, setSentLog] = useState([]);
  const [tirageErr, setTirageErr] = useState("");
  const [errName, setErrName] = useState("");
  const [preview, setPreview] = useState(null);
  const [resendTarget, setResendTarget] = useState(null);

  const draw = async () => {
    setTirageErr(""); setErrName("");
    if (!eventName.trim()) return setErrName("Nomme l'événement avant de tirer.");
    if (participants.length < 2) return setTirageErr("Il faut au moins 2 participants.");
    const excluded = new Set(exclusions.map(e => `${e.from}->${e.to}`));
    let result = null;
    for (let attempt = 0; attempt < 200; attempt++) {
      const receivers = shuffle(participants);
      let valid = true; const p = [];
      for (let i = 0; i < participants.length; i++) {
        const g = participants[i], r = receivers[i];
        if (g.id === r.id || excluded.has(`${g.id}->${r.id}`)) { valid = false; break; }
        p.push([g, r]);
      }
      if (valid) { result = p; break; }
    }
    if (!result) return setTirageErr("Impossible de trouver une combinaison valide. Réduisez les exclusions.");
    const tirage = {
      id: Date.now(), eventName: eventName.trim(), date: new Date().toISOString(),
      pairs: result.map(([g, r]) => ({ offreur: g, receveur: r, message: fill(template, g, r) })), template,
    };
    const existing = await loadFromSupabase("tirages") || [];
    await saveToSupabase("tirages", [tirage, ...existing]);
    onTirageSaved();
    setPairs(result); setStatus("done"); setSentLog([]);
  };

  const sendOne = async (idx) => {
    setResendTarget(idx);
    await new Promise(r => setTimeout(r, 500));
    setResendTarget(null);
    setSentLog(l => [...l, idx]);
  };

  const sendAll = async () => {
    setStatus("sending");
    for (let i = 0; i < pairs.length; i++) await sendOne(i);
    setStatus("sent");
  };

  return (
    <div className="space-y-6">
      {status !== "sent" && (
        <div className="bg-white rounded-xl shadow p-5 space-y-4">
          <h2 className="font-semibold text-gray-700">Lancer le tirage</h2>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Nom de l'événement *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={eventName} onChange={e => setEventName(e.target.value)} placeholder="Ex : Noël famille 2025, Anniv Sophie…" />
            {errName && <p className="text-red-500 text-xs mt-1">{errName}</p>}
          </div>
          <p className="text-sm text-gray-400">👥 {participants.length} participant(s) · 🚫 {exclusions.length} exclusion(s)</p>
          {tirageErr && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg p-3">{tirageErr}</div>}
          {status === "idle" && (
            <button onClick={draw} disabled={participants.length < 2}
              className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-3 rounded-xl font-semibold">
              🎲 Effectuer le tirage
            </button>
          )}
          {(status === "done" || status === "sending") && pairs && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">
                ✅ Tirage effectué et sauvegardé !
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2 font-medium">Aperçu d'un message :</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  {pairs.map(([g], i) => (
                    <button key={i} onClick={() => setPreview(preview === i ? null : i)}
                      className={`text-xs px-2 py-1 rounded-full border ${preview === i ? "bg-red-500 text-white border-red-500" : "bg-white text-gray-600"}`}>
                      {g.prenom}
                    </button>
                  ))}
                </div>
                {preview !== null && (
                  <pre className="bg-gray-50 border rounded-lg p-3 text-sm whitespace-pre-wrap font-mono text-gray-700">
                    {fill(template, pairs[preview][0], pairs[preview][1])}
                  </pre>
                )}
              </div>
              <div className="border rounded-lg divide-y">
                {pairs.map(([g], i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-gray-700">{g.prenom} {g.nom} <span className="text-gray-400 text-xs">({g.email})</span></span>
                    {sentLog.includes(i)
                      ? <span className="text-xs text-green-600 font-medium">✓ Envoyé</span>
                      : <button onClick={() => sendOne(i)} disabled={resendTarget !== null}
                          className="text-xs text-red-500 hover:underline disabled:opacity-40">
                          {resendTarget === i ? "⏳" : "Envoyer"}
                        </button>
                    }
                  </div>
                ))}
              </div>
              {status === "done" && (
                <div className="flex gap-2">
                  <button onClick={draw} className="border border-red-300 text-red-500 px-4 py-2 rounded-lg text-sm hover:bg-red-50">Refaire</button>
                  <button onClick={sendAll} className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium">📨 Envoyer à tous</button>
                </div>
              )}
              {status === "sending" && (
                <div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                    <div className="bg-red-500 h-2 rounded-full transition-all" style={{ width: `${(sentLog.length / pairs.length) * 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">Envoi… {sentLog.length}/{pairs.length}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {status === "sent" && (
        <div className="bg-white rounded-xl shadow p-8 text-center space-y-4">
          <div className="text-5xl">🎉</div>
          <h2 className="text-xl font-bold text-gray-800">Tirage terminé !</h2>
          <p className="text-gray-500 text-sm">Tous les messages ont été envoyés.</p>
          <button onClick={() => { setStatus("idle"); setPairs(null); setSentLog([]); setEventName(""); }}
            className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Nouveau tirage</button>
        </div>
      )}
    </div>
  );
}

// ── Historique ───────────────────────────────────────────────────
function HistoriqueTab({ carnet, setCarnet, setParticipants, setTab }) {
  const [tirages, setTirages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [pwModal, setPwModal] = useState(false);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [resendTarget, setResendTarget] = useState(null);
  const [resendDone, setResendDone] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => { loadFromSupabase("tirages").then(t => { setTirages(t || []); setLoading(false); }); }, []);

  const tryUnlock = () => {
    if (pw === ADMIN_PASSWORD) { setUnlocked(true); setPwModal(false); setPw(""); setPwErr(""); }
    else setPwErr("Mot de passe incorrect.");
  };

  const simulateResend = async (idx) => {
    setResendTarget(idx);
    await new Promise(r => setTimeout(r, 600));
    setResendTarget(null);
    setResendDone(d => [...d, idx]);
  };

  const deleteTirage = async (id) => {
    const updated = tirages.filter(t => t.id !== id);
    await saveToSupabase("tirages", updated);
    setTirages(updated);
    setDeleteConfirm(null);
    if (selected?.id === id) setSelected(null);
  };

  const importParticipants = async (tirage) => {
    const toImport = tirage.pairs.map(p => p.offreur);
    let newCarnet = [...carnet];
    toImport.forEach(p => {
      const already = newCarnet.find(c => c.email.toLowerCase() === p.email.toLowerCase());
      if (!already) newCarnet.push({ ...p, id: Date.now() + Math.random() });
    });
    setCarnet(newCarnet);
    await saveToSupabase("carnet", newCarnet);
    setParticipants(toImport.map(p => ({ ...p, id: Date.now() + Math.random() })));
    setTab(0);
  };

  if (loading) return <div className="text-center text-gray-400 py-10">Chargement…</div>;

  return (
    <div className="space-y-4">
      {!selected && (
        tirages.length === 0
          ? <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400"><p className="text-3xl mb-2">📭</p><p>Aucun tirage sauvegardé.</p></div>
          : tirages.map(t => (
            <div key={t.id} className="bg-white rounded-xl shadow p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-800">{t.eventName}</p>
                <p className="text-xs text-gray-400">{fmtDate(t.date)} · {t.pairs.length} participants</p>
              </div>
              <div className="flex gap-2 items-center">
                <button onClick={() => { setSelected(t); setUnlocked(false); setResendDone([]); }} className="text-sm text-red-500 hover:underline font-medium">Ouvrir</button>
                <button onClick={() => setDeleteConfirm(t.id)} className="text-gray-400 hover:text-red-400">🗑</button>
              </div>
            </div>
          ))
      )}
      {selected && (
        <div className="bg-white rounded-xl shadow p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-sm">← Retour</button>
            <div className="flex-1">
              <h2 className="font-bold text-gray-800">{selected.eventName}</h2>
              <p className="text-xs text-gray-400">{fmtDate(selected.date)} · {selected.pairs.length} participants</p>
            </div>
            <button onClick={() => importParticipants(selected)}
              className="text-xs bg-red-50 border border-red-300 text-red-500 px-3 py-1 rounded-full hover:bg-red-100">
              ♻️ Réutiliser ces participants
            </button>
          </div>
          {!unlocked
            ? <button onClick={() => setPwModal(true)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50">🔒 Voir les paires (admin)</button>
            : <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700">⚠️ Mode admin — paires visibles</div>
          }
          <div className="border rounded-lg divide-y">
            {selected.pairs.map((p, i) => (
              <div key={i} className="px-3 py-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{p.offreur.prenom} {p.offreur.nom}</span>
                    <span className="text-xs text-gray-400 ml-2">{p.offreur.email}</span>
                    {unlocked && <span className="ml-2 text-xs text-purple-600 font-medium">→ {p.receveur.prenom} {p.receveur.nom}</span>}
                  </div>
                  <button onClick={() => simulateResend(i)} disabled={resendTarget !== null}
                    className={`text-xs px-3 py-1 rounded-full border transition-colors ${resendDone.includes(i) ? "border-green-400 text-green-600" : "border-red-300 text-red-500 hover:bg-red-50"}`}>
                    {resendTarget === i ? "⏳" : resendDone.includes(i) ? "✓ Renvoyé" : "Renvoyer"}
                  </button>
                </div>
                {unlocked && <pre className="bg-gray-50 rounded p-2 text-xs font-mono text-gray-600 whitespace-pre-wrap">{p.message}</pre>}
              </div>
            ))}
          </div>
        </div>
      )}
      {pwModal && (
        <Modal title="🔒 Accès admin" onClose={() => { setPwModal(false); setPw(""); setPwErr(""); }}>
          <p className="text-sm text-gray-500">Mot de passe administrateur requis.</p>
          <input type="password" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && tryUnlock()} placeholder="Mot de passe" autoFocus />
          {pwErr && <p className="text-red-500 text-xs">{pwErr}</p>}
          <button onClick={tryUnlock} className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-medium">Déverrouiller</button>
        </Modal>
      )}
      {deleteConfirm && (
        <Modal title="Supprimer ce tirage ?" onClose={() => setDeleteConfirm(null)}>
          <p className="text-sm text-gray-500">Cette action est irréversible.</p>
          <div className="flex gap-2">
            <button onClick={() => deleteTirage(deleteConfirm)} className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-medium">Supprimer</button>
            <button onClick={() => setDeleteConfirm(null)} className="flex-1 border py-2 rounded-lg text-sm">Annuler</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────
export default function AmiInvisible() {
  const [tab, setTab] = useState(0);
  const [participants, setParticipants] = useState([]);
  const [exclusions, setExclusions] = useState([]);
  const [template, setTemplate] = useState(defaultTemplate);
  const [carnet, setCarnet] = useState([]);
  const [histKey, setHistKey] = useState(0);

  useEffect(() => { loadFromSupabase("carnet").then(c => { if (c) setCarnet(c); }); }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-6">
          <Link href="/" className="text-xs text-gray-400 hover:underline block mb-2">← perf360.fr</Link>
          <h1 className="text-3xl font-bold text-red-600">🎁 Ami Invisible</h1>
          <p className="text-gray-500 text-sm mt-1">Organisez votre tirage en toute confidentialité</p>
          <button onClick={() => { setParticipants([]); setExclusions([]); setTab(0); }}
            className="mt-3 text-xs border border-red-300 text-red-500 px-4 py-1.5 rounded-full hover:bg-red-50">
            ＋ Nouveau tirage
          </button>
        </div>
        <div className="flex bg-white rounded-xl shadow overflow-hidden mb-6">
          {TABS.map((t, i) => (
            <button key={t} onClick={() => { setTab(i); if (i === 4) setHistKey(k => k + 1); }}
              className={`flex-1 py-3 text-xs font-medium transition-colors flex flex-col items-center gap-0.5 ${tab === i ? "bg-red-500 text-white" : "text-gray-500 hover:bg-gray-50"}`}>
              <span>{ICONS[i]}</span><span>{t}</span>
            </button>
          ))}
        </div>
        {tab === 0 && <ParticipantsTab participants={participants} setParticipants={setParticipants} carnet={carnet} setCarnet={setCarnet} />}
        {tab === 1 && <ExclusionsTab participants={participants} exclusions={exclusions} setExclusions={setExclusions} />}
        {tab === 2 && <MessageTab template={template} setTemplate={setTemplate} />}
        {tab === 3 && <TirageTab participants={participants} exclusions={exclusions} template={template} onTirageSaved={() => setHistKey(k => k + 1)} />}
        {tab === 4 && <HistoriqueTab key={histKey} carnet={carnet} setCarnet={setCarnet} setParticipants={setParticipants} setTab={setTab} />}
      </div>
    </div>
  );
}
