"use client";
/*
 * Formulaire repliable « Changer le mot de passe » (super-admin) : mot de
 * passe actuel, nouveau, confirmation. `onSubmit(current, next)` renvoie une
 * promesse qui échoue avec un message d'erreur.
 */
import { useState } from "react";
import { KeyRound } from "lucide-react";
import PasswordInput from "@/components/PasswordInput";

const MIN_LEN = 8;

export default function ChangePasswordForm({ onSubmit, note, accent = "bg-gray-900" }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const reset = () => { setCurrent(""); setNext(""); setConfirm(""); };

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < MIN_LEN) return setMsg({ ok: false, text: `Au moins ${MIN_LEN} caractères.` });
    if (next !== confirm) return setMsg({ ok: false, text: "La confirmation ne correspond pas." });
    setBusy(true);
    setMsg(null);
    try {
      await onSubmit(current, next);
      reset();
      setMsg({ ok: true, text: "Mot de passe changé." });
      setTimeout(() => { setOpen(false); setMsg(null); }, 2500);
    } catch (err) {
      setMsg({ ok: false, text: err.message || "Changement impossible." });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 underline">
        <KeyRound size={14} /> Changer le mot de passe
      </button>
    );
  }

  const field = "w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 focus:border-gray-500 outline-none";
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3 max-w-sm">
      <p className="font-bold text-gray-900">Changer le mot de passe super-admin</p>
      {note && <p className="text-xs text-gray-500">{note}</p>}
      <PasswordInput autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Mot de passe actuel" className={field} />
      <PasswordInput value={next} onChange={(e) => setNext(e.target.value)} placeholder={`Nouveau (${MIN_LEN} caractères min.)`} autoComplete="new-password" className={field} />
      <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmer le nouveau" autoComplete="new-password" className={field} />
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => { setOpen(false); reset(); setMsg(null); }} className="flex-1 bg-gray-100 font-bold py-2.5 rounded-full">Annuler</button>
        <button disabled={busy || !current || !next || !confirm} className={`flex-[2] ${accent} disabled:opacity-40 text-white font-bold py-2.5 rounded-full`}>
          {busy ? "…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
