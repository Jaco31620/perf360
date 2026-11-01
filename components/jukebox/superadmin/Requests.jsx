"use client";
/*
 * Super-admin — demandes d'accès (formulaire de /jukebox). Valider crée le
 * code d'activation et l'envoie par e-mail au demandeur ; refuser (avec ou
 * sans e-mail). Lien direct depuis l'e-mail reçu : /jukebox/admin?demande=<id>.
 */
import { useEffect, useRef, useState } from "react";
import { activationText } from "@/lib/jukeboxMessages";
import { ACT_MAX_CHOICES, ACT_EXPIRY_CHOICES, actMaxLabel, fmtDay } from "./Activations";
import { FeatureToggles, ShareBox } from "./SoireeForms";
import { fmtDate } from "./shared";

const STATUS = { approved: ["✓ Validée", "bg-green-100 text-green-700"], rejected: ["Refusée", "bg-gray-100 text-gray-500"] };

export function Requests({ list, activations, defaults, origin, action, highlight, onShowCode }) {
  const [history, setHistory] = useState(false);
  const [failed, setFailed] = useState(null); // { activation, mailError } : code créé, e-mail non parti
  if (list == null) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-800">
        La table des demandes n'existe pas encore : exécutez la partie <b>v23</b> de <code>scripts/jukebox.sql</code> dans Supabase.
        En attendant, les demandes arrivent seulement par e-mail.
      </div>
    );
  }
  const pending = list.filter((r) => r.status === "pending");
  const done = list.filter((r) => r.status !== "pending");
  const hl = list.find((r) => r.id === highlight);
  return (
    <div className="space-y-4">
      {hl && hl.status !== "pending" && (
        <p className="bg-gray-50 border border-gray-200 rounded-2xl p-4 text-sm text-gray-600">La demande de <b>{hl.name}</b> a déjà été traitée ({STATUS[hl.status]?.[0].toLowerCase()} le {fmtDate(Date.parse(hl.handledAt))}).</p>
      )}
      {failed && <MailFailed result={failed} origin={origin} onClose={() => setFailed(null)} />}
      {pending.length === 0 && <p className="text-gray-400 text-center py-8">Aucune demande en attente.</p>}
      {pending.map((r) => (
        <Pending key={r.id} r={r} defaults={defaults} origin={origin} action={action} highlight={r.id === highlight} onFailed={setFailed} />
      ))}
      {done.length > 0 && (
        <div>
          <button onClick={() => setHistory((v) => !v)} className="text-sm text-gray-500 underline">
            {history ? "Masquer" : "Voir"} les demandes traitées ({done.length})
          </button>
          {history && (
            <div className="mt-3 space-y-2">
              {done.map((r) => {
                const [label, cls] = STATUS[r.status] || ["", ""];
                const act = activations?.find((a) => a.id === r.activationId);
                return (
                  <div key={r.id} className={`bg-white rounded-2xl border p-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${r.id === highlight ? "border-fuchsia-300" : "border-purple-100"}`}>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
                    <span className="font-bold text-gray-900">{r.name}</span>
                    <span className="text-gray-500">{r.email}</span>
                    <span className="text-xs text-gray-400">le {fmtDate(Date.parse(r.handledAt || r.createdAt))}</span>
                    {act && <button onClick={() => onShowCode(act.code)} className="text-xs font-mono text-fuchsia-600 underline">{act.code}</button>}
                    <button onClick={() => action({ action: "reqDelete", id: r.id }, `Supprimer la demande de ${r.name} de l'historique ?`)} className="ml-auto text-xs text-gray-400 underline">supprimer</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const texts = (a) => ({
  partiesText: a.maxParties == null ? "autant de soirées que vous voulez" : actMaxLabel(a.maxParties),
  expiresText: a.expiresAt ? fmtDay(a.expiresAt) : null,
});

function MailFailed({ result, origin, onClose }) {
  const a = result.activation;
  return (
    <div className="bg-white rounded-2xl border border-amber-300 p-4 space-y-3 text-sm">
      <p className="text-amber-800">Code <b className="font-mono">{a.code}</b> créé pour {a.label}, mais l'e-mail à {result.email} n'est pas parti ({result.mailError}). Envoyez-le à la main :</p>
      <ShareBox title={`Code pour ${a.label}`} subject="Votre accès Jukebox" message={activationText({ origin, code: a.code, label: a.label, ...texts(a) })} onClose={onClose} />
    </div>
  );
}

function Pending({ r, defaults, origin, action, highlight, onFailed }) {
  const [label, setLabel] = useState(r.name);
  const [max, setMax] = useState(1);
  const [expiry, setExpiry] = useState("90");
  const [features, setFeatures] = useState(null);
  const [showFeat, setShowFeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [highlight]);

  const expiresAt = expiry ? new Date(Date.now() + Number(expiry) * 864e5).toISOString() : null;

  const approve = async () => {
    if (!label.trim()) return;
    setBusy(true);
    const d = await action({
      action: "reqApprove", id: r.id, label: label.trim(), maxParties: max, expiresAt, features, origin,
      ...texts({ maxParties: max, expiresAt }),
    }, `Valider la demande de ${r.name} ?\n\nUn code d'activation (${actMaxLabel(max)}) sera créé et envoyé à ${r.email}.`);
    setBusy(false);
    if (d?.mailError) onFailed(d); // e-mail non parti : message à envoyer à la main
  };

  return (
    <div ref={ref} className={`bg-white rounded-2xl border p-4 space-y-3 text-sm ${highlight ? "border-fuchsia-400 ring-4 ring-fuchsia-100" : "border-purple-100"}`}>
      <div>
        <p className="font-bold text-base text-gray-900">{r.name} <span className="font-normal text-xs text-gray-400 ml-1">demande du {fmtDate(Date.parse(r.createdAt))}</span></p>
        <p className="text-gray-600">✉️ <a href={`mailto:${r.email}`} className="underline">{r.email}</a></p>
        {(r.date || r.guests) && <p className="text-gray-600">{r.date && <>📅 {r.date}</>}{r.date && r.guests && " · "}{r.guests && <>👥 {r.guests} invités</>}</p>}
        {r.message && <p className="mt-1 whitespace-pre-wrap text-gray-700 bg-gray-50 rounded-xl px-3 py-2">{r.message}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} title="Nom de l'organisateur sur le code"
          className="flex-1 min-w-[180px] border-2 border-gray-200 rounded-xl px-3 py-1.5 focus:border-fuchsia-500 outline-none" />
        <select value={max ?? ""} onChange={(e) => setMax(e.target.value === "" ? null : Number(e.target.value))} className="border-2 border-gray-200 rounded-xl px-2 py-1.5 font-semibold">
          {ACT_MAX_CHOICES.map((n) => <option key={n ?? "inf"} value={n ?? ""}>{actMaxLabel(n)}</option>)}
        </select>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="border-2 border-gray-200 rounded-xl px-2 py-1.5 font-semibold">
          {ACT_EXPIRY_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <button type="button" onClick={() => setShowFeat((v) => !v)} className="text-xs text-fuchsia-600 underline">
        {showFeat ? "Masquer les fonctions" : `Fonctions des soirées : ${features ? "personnalisées" : "par défaut"}`}
      </button>
      {showFeat && <FeatureToggles value={features || defaults} onChange={setFeatures} />}
      <div className="flex flex-wrap gap-2">
        <button onClick={approve} disabled={busy || !label.trim()} className="font-bold bg-green-600 disabled:opacity-40 text-white px-4 py-2 rounded-full">
          {busy ? "Envoi…" : "✅ Valider et envoyer le code"}
        </button>
        <button onClick={() => {
          const notify = confirm(`Refuser la demande de ${r.name}.\n\nOK : prévenir par e-mail · Annuler : refuser sans e-mail`);
          action({ action: "reqReject", id: r.id, notify });
        }} className="font-bold bg-gray-100 px-4 py-2 rounded-full">Refuser</button>
      </div>
    </div>
  );
}
