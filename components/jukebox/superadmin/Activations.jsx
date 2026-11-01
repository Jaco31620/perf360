"use client";
import { activationText as buildActivationText } from "@/lib/jukeboxMessages";
import DateInput from "@/components/DateInput";
import { useState } from "react";
import { formatCode } from "../storage";
import { FEATURES, validLabel } from "@/lib/jukebox";
import { CREATION_MODES, fmtDate, SearchInput, ValiditySelect } from "./shared";
import { ShareBox, FeatureToggles } from "./SoireeForms";

/* ---------- Codes d'activation individuels ---------- */

export const ACT_MAX_CHOICES = [1, 2, 3, 5, 10, 20, null]; // null : illimité
export const ACT_EXPIRY_CHOICES = [["", "Sans expiration"], ["7", "7 jours"], ["30", "1 mois"], ["90", "3 mois"], ["365", "1 an"]];
const ACT_STATUS = {
  active: ["Actif", "bg-green-100 text-green-700"],
  spent: ["Épuisé", "bg-amber-100 text-amber-700"],
  expired: ["Expiré", "bg-gray-100 text-gray-500"],
  revoked: ["Désactivé", "bg-red-100 text-red-600"],
};
export const actMaxLabel = (n) => (n == null ? "Illimité" : `${n} soirée${n > 1 ? "s" : ""}`);
export const fmtDay = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const dayInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

const actTexts = (a) => ({
  partiesText: a.maxParties == null ? "autant de soirées que vous voulez" : actMaxLabel(a.maxParties),
  expiresText: a.expiresAt ? fmtDay(a.expiresAt) : null,
  validText: a.validDays ? validLabel(a.validDays) : null,
});
const activationText = ({ origin, a }) => buildActivationText({
  origin, code: a.code, label: a.label,
  partiesText: a.maxParties == null ? "autant de soirées que vous voulez" : actMaxLabel(a.maxParties),
  expiresText: a.expiresAt ? fmtDay(a.expiresAt) : null,
  validText: a.validDays ? validLabel(a.validDays) : null,
});

export function Activations({ justSent, list, sessions, defaults, origin, creationMode, action, onUseCodes, filter, setFilter, onOpenParty }) {
  const [shared, setShared] = useState(null); // code dont le message est affiché
  const [stat, setStat] = useState("all"); // filtre par état
  const resend = async (a) => {
    const email = a.email || prompt(`Adresse e-mail de ${a.label} :`);
    if (!email) return;
    const d = await action({ action: "actResend", id: a.id, email, origin, ...actTexts(a) }, a.email ? `Renvoyer le code de ${a.label} à ${a.email} ?` : null);
    if (d?.ok) alert(`✓ Code renvoyé à ${d.email}.`);
  };
  const renameAct = (a) => {
    const label = prompt("Nom de l'organisateur :", a.label);
    if (label && label.trim() && label.trim() !== a.label) action({ action: "actUpdate", id: a.id, label: label.trim() });
  };
  const editEmail = (a) => {
    const email = prompt("E-mail de l'organisateur (vide : aucun) :", a.email || "");
    if (email !== null && email.trim() !== (a.email || "")) action({ action: "actUpdate", id: a.id, email: email.trim() });
  };
  if (list == null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
        La table des codes d'activation n'existe pas encore : exécutez la partie <b>v19</b> de <code>scripts/jukebox.sql</code> dans Supabase.
      </div>
    );
  }
  const q = filter.trim().toLowerCase();
  const counts = { all: list.length };
  for (const a of list) counts[a.status] = (counts[a.status] || 0) + 1;
  const shown = list.filter((a) => (stat === "all" || a.status === stat)
    && (!q || a.label.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q)));
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap bg-white border border-purple-100 rounded-2xl p-0.5 text-sm">
          {[["all", "Tous"], ...Object.entries(ACT_STATUS).map(([k, [l]]) => [k, l])].map(([k, l]) => (
            <button key={k} onClick={() => setStat(k)} className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap ${stat === k ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
              {l} <span className="font-normal opacity-70">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        {(list.length > 5 || filter) && <SearchInput value={filter} onChange={setFilter} placeholder="Organisateur, code ou e-mail" className="flex-1 min-w-[200px]" />}
      </div>
      {list.length === 0 && <p className="text-gray-400 text-center py-8">Aucun code d'activation.</p>}
      {shown.map((a) => {
        const parties = sessions.filter((s) => s.activationId === a.id);
        const [label, cls] = ACT_STATUS[a.status] || ACT_STATUS.active;
        return (
          <div key={a.id} className={`bg-white rounded-2xl border p-4 space-y-3 ${justSent?.id === a.id ? "border-green-400 ring-4 ring-green-100" : "border-purple-100"}`}>
            {justSent?.id === a.id && <p className="text-sm font-semibold text-green-700 bg-green-50 rounded-xl px-3 py-2">✓ Demande validée : code créé et envoyé par e-mail{justSent.sentTo ? ` à ${justSent.sentTo}` : ""}.</p>}
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="flex-1 min-w-[220px]">
                <p className="font-bold text-gray-900">
                  <button onClick={() => renameAct(a)} title="Modifier le nom" className="hover:underline">{a.label}</button>
                  <span className={`ml-2 text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                </p>
                <p className="font-mono font-black text-xl tracking-widest text-fuchsia-600 select-all">{a.code}</p>
                <button onClick={() => editEmail(a)} className="text-xs text-gray-500 hover:underline">{a.email ? `✉️ ${a.email}` : "✉️ ajouter un e-mail"}</button>
                <p className="text-xs text-gray-500">
                  {a.used} soirée{a.used > 1 ? "s" : ""} créée{a.used > 1 ? "s" : ""} sur {a.maxParties == null ? "illimité" : a.maxParties}
                  {" · "}créé le {fmtDate(Date.parse(a.createdAt))}
                  {a.lastUsedAt && <> · dernière utilisation {fmtDate(Date.parse(a.lastUsedAt))}</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <button onClick={() => resend(a)} className="font-bold bg-fuchsia-600 text-white px-3 py-1.5 rounded-full">✉️ {a.email ? "Renvoyer par e-mail" : "Envoyer par e-mail"}</button>
                <button onClick={() => setShared(shared === a.id ? null : a.id)} className="font-bold bg-fuchsia-100 text-fuchsia-800 px-3 py-1.5 rounded-full">📨 Autre envoi</button>
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
                {/* non contrôlé, enregistré en quittant le champ : la saisie de l'année au clavier ne part pas à chaque chiffre */}
                <DateInput key={`${a.id}:${a.expiresAt || ""}`} defaultValue={dayInput(a.expiresAt)}
                  onBlur={(e) => { const v = e.target.value; if (v !== dayInput(a.expiresAt) && (!v || /^\d{4}-\d{2}-\d{2}$/.test(v))) action({ action: "actUpdate", id: a.id, expiresAt: v ? `${v}T23:59:59` : null }); }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="border-2 border-gray-200 rounded-xl px-2 py-0.5" />
                {a.expiresAt && <button onClick={() => action({ action: "actUpdate", id: a.id, expiresAt: null })} className="text-xs text-gray-400 underline">jamais</button>}
              </label>
              <ValiditySelect value={a.validDays} className="text-xs"
                onChange={(days) => action({ action: "actUpdate", id: a.id, validDays: days })} />
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
  const [retention, setRetention] = useState(null);
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
      features, validDays: retention,
    });
    setBusy(false);
    if (ok) { setLabel(""); setFeatures(null); setRetention(null); setOpen(false); }
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
        <ValiditySelect value={retention} onChange={setRetention} className="py-2" />
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
