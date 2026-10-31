"use client";
/*
 * Jukebox — accès régie côté navigateur (lib/jukeboxAccess.js) :
 *  - JoinForm : code régie à 6 chiffres sur un appareil pas encore autorisé ;
 *  - useJoinPass : QR « Ajouter un appareil » (#j=<passe> dans l'adresse) ;
 *  - AccessPanel : code régie à communiquer, invitation, ajout d'un appareil
 *    par QR à usage unique, appareils autorisés (retrait), nouveau code ;
 *  - inviteText : message prêt à envoyer à l'organisateur.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { setAdminToken, authHeaders, formatCode } from "./storage";

export const fmtRegieCode = (c) => (c ? `${c.slice(0, 3)} ${c.slice(3)}` : "…");

export function inviteText({ origin, code, name, regieCode }) {
  const base = `${origin}/jukebox/${code}`;
  return `🎶 Jukebox · soirée « ${name} »\n\n`
    + `📱 Télécommande (téléphone) : ${base}/telecommande\n`
    + `💻 Régie (ordinateur branché à la sono) : ${base}/regie\n`
    + `🔑 Code régie : ${fmtRegieCode(regieCode)}\n\n`
    + `Pour les invités : ${base} (code ${formatCode(code)}). Ne leur donnez pas le code régie.`;
}

async function join(code, body) {
  const res = await fetch(`/api/jukebox/${code}/join`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Connexion impossible.");
  setAdminToken(code, d.token);
}

/* QR à usage unique : #j=<passe> → accès accordé à cet appareil. */
export function useJoinPass(code, onJoined) {
  const [error, setError] = useState("");
  useEffect(() => {
    const m = window.location.hash.match(/j=([a-f0-9]{32})/);
    if (!m) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    join(code, { pass: m[1] }).then(onJoined, (e) => setError(e.message));
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  return error;
}

export function JoinForm({ code, name, onJoined, error: passError }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (pin.replace(/\D/g, "").length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try { await join(code, { pin }); onJoined(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-3">
      <p className="text-4xl">🔑</p>
      <p className="font-bold text-xl">{name}</p>
      <p className="text-white/70 text-sm">Saisissez le code régie de la soirée (donné par l'organisateur, ou affiché dans la régie).</p>
      <input autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="000 000" value={pin}
        onChange={(e) => setPin(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
        className="w-full text-center text-3xl font-bold tracking-[0.3em] bg-gray-900 border-2 border-white/20 rounded-2xl py-3 focus:border-fuchsia-500 outline-none" />
      <button disabled={busy || pin.replace(/\D/g, "").length !== 6}
        className="w-full bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white font-bold py-3 rounded-full">
        {busy ? "Vérification…" : "Accéder à la régie"}
      </button>
      {(error || passError) && <p className="text-sm text-red-400">{error || passError}</p>}
      <p className="text-xs text-white/40">Vous êtes invité ? <a href={`/jukebox/${code}`} className="underline">Proposez vos titres ici</a>.</p>
    </form>
  );
}

const ago = (t) => {
  const m = Math.round((Date.now() - Date.parse(t)) / 60000);
  return m < 2 ? "actif à l'instant" : m < 60 ? `actif il y a ${m} min` : m < 1440 ? `actif il y a ${Math.round(m / 60)} h` : `actif il y a ${Math.round(m / 1440)} j`;
};

/* Panneau « Accès régie » (outils de la régie, onglet Plus de la télécommande). */
export function AccessPanel({ code, name }) {
  const [info, setInfo] = useState(null); // { regieCode, devices }
  const [error, setError] = useState("");
  const [qr, setQr] = useState(null); // adresse du QR à usage unique
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const post = async (body) => {
    const res = await fetch(`/api/jukebox/${code}/admin`, {
      method: "POST", headers: { "Content-Type": "application/json", ...authHeaders(code) }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  };
  const run = async (body) => {
    setError("");
    try { const d = await post(body); setInfo((i) => ({ ...i, ...d })); return d; } catch (e) { setError(e.message); return null; }
  };
  useEffect(() => { run({ action: "access" }); }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const addDevice = async () => {
    const d = await run({ action: "joinPass" });
    if (d?.pass) setQr(`${origin}/jukebox/${code}/telecommande#j=${d.pass}`);
  };
  const copyInvite = async () => {
    const text = inviteText({ origin, code, name, regieCode: info?.regieCode });
    try {
      if (navigator.share) await navigator.share({ title: `Jukebox « ${name} »`, text });
      else { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch (e) { /* partage annulé */ }
  };
  const newCode = () => {
    if (!confirm("Créer un nouveau code régie ? L'ancien ne fonctionnera plus.")) return;
    run({ action: "regieCode", logoutAll: confirm("Déconnecter aussi tous les appareils déjà autorisés (sauf le super-admin) ?") });
  };

  return (
    <div className="bg-white/5 rounded-2xl p-4 space-y-3 text-sm">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-white/40">🔑 Code régie</p>
          <p className="font-mono text-3xl font-black tracking-widest">{fmtRegieCode(info?.regieCode)}</p>
        </div>
        <button onClick={copyInvite} className="font-bold bg-fuchsia-600 hover:bg-fuchsia-700 rounded-full px-3 py-2 text-xs">
          {copied ? "✓ Copiée" : "📨 Envoyer l'invitation"}
        </button>
      </div>
      <p className="text-xs text-white/40">
        Sur un autre appareil : ouvrir la régie ou la télécommande de la soirée et taper ce code. Ne le donnez pas aux invités.
      </p>
      <button onClick={addDevice} className="w-full font-bold bg-white/10 hover:bg-white/20 rounded-full py-2">📱 Ajouter un téléphone (QR code)</button>

      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-white/40 mb-1">Appareils autorisés</p>
        {!info?.devices ? <p className="text-xs text-white/40">Chargement…</p> : info.devices.length === 0 ? (
          <p className="text-xs text-white/40">Aucun.</p>
        ) : (
          <ul className="space-y-1">
            {info.devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{d.label}{d.me && <span className="ml-1.5 text-[11px] text-green-400">· cet appareil</span>}</p>
                  <p className="text-[11px] text-white/40">{ago(d.lastSeen)}</p>
                </div>
                {!d.me && (
                  <button onClick={() => confirm(`Retirer l'accès de « ${d.label} » ?`) && run({ action: "revokeDevice", id: d.id })}
                    className="text-xs text-white/40 hover:text-red-400 shrink-0">Retirer</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={newCode} className="text-xs text-white/40 hover:text-white underline">Changer le code régie</button>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {qr && (
        <div onClick={() => { setQr(null); run({ action: "access" }); }} className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center gap-5 p-6 cursor-pointer text-center">
          <p className="text-2xl font-bold">📱 Ajouter un téléphone</p>
          <div className="bg-white p-4 rounded-3xl"><QRCodeSVG value={qr} size={280} /></div>
          <p className="text-white/70 max-w-sm">Scannez avec le téléphone à autoriser : il ouvre la télécommande de la soirée.</p>
          <p className="text-amber-300 text-sm max-w-sm">QR code valable 10 minutes, pour un seul appareil.</p>
        </div>
      )}
    </div>
  );
}
