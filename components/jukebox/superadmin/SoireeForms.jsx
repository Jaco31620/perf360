"use client";
import { useState } from "react";
import { inviteText } from "../Access";
import { MAX_NAME_LEN, MAX_CHOICES, SEARCH_MODES, FADE_CHOICES, AUTHOR_REVEAL_CHOICES, FEATURES, THEMES, SOIREE_DEFAULTS, maxLabel } from "@/lib/jukebox";
import { BLIND_MODES, BLIND_REVEAL_CHOICES, BLIND_AFTER_CHOICES, BLIND_LANGS } from "@/lib/jukeboxBlind";

/* Création d'une soirée déjà configurée : fonctions activées et réglages de
 * la régie (modifiables ensuite par la régie, sauf les fonctions). */
export function CreateForm({ token, defaults, defaultOptions, onCreated }) {
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
export function SoireeFields({ value, features, onChange }) {
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

/* Message à transmettre : copie, partage (téléphone) ou e-mail. */
export function ShareBox({ title, subject, message, onClose }) {
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
export function FeatureToggles({ value, onChange }) {
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
export function InviteBox({ name, code, regieCode, origin, onClose }) {
  return (
    <div className="mt-4">
      <ShareBox title={`Invitation pour l'organisateur de « ${name} »`} subject={`Jukebox · soirée « ${name} »`}
        message={inviteText({ origin, code, name, regieCode })} onClose={onClose} />
    </div>
  );
}
