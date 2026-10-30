"use client";
/*
 * Jukebox — accueil : rejoindre une soirée avec son code, ou en créer une
 * (le créateur devient régie et reçoit un jeton gardé en local). La création
 * suit le réglage du super-admin : libre, sur code de création, ou réservée.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { myParties, rememberParty, setAdminToken, forgetParty, formatCode, getSuperToken } from "@/components/jukebox/storage";
import { DEFAULT_MAX_PER_PARTICIPANT, MAX_NAME_LEN, MAX_CHOICES, maxLabel } from "@/lib/jukebox";

export default function JukeboxHome() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [max, setMax] = useState(DEFAULT_MAX_PER_PARTICIPANT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mine, setMine] = useState([]);
  const [mode, setMode] = useState("open");
  const [creationCode, setCreationCode] = useState("");
  const [isSuper, setIsSuper] = useState(false);

  useEffect(() => {
    setMine(myParties());
    setIsSuper(!!getSuperToken());
    fetch("/api/jukebox", { cache: "no-store" }).then((r) => r.json()).then((d) => setMode(d.creationMode || "open")).catch(() => {});
  }, []);
  const needCode = mode === "code" && !isSuper;
  const closed = mode === "super" && !isSuper;

  const join = (e) => {
    e.preventDefault();
    const c = code.replace(/\D/g, "");
    if (c.length === 6) router.push(`/jukebox/${c}`);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jukebox", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(isSuper ? { "x-jukebox-super": getSuperToken() } : {}) },
        body: JSON.stringify({ name, maxPerParticipant: max, creationCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Création impossible.");
      setAdminToken(data.code, data.adminToken);
      rememberParty(data.code, name.trim());
      router.push(`/jukebox/${data.code}/regie`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const remove = (c) => {
    if (!confirm(`Retirer la soirée ${formatCode(c)} de cette liste ?\n(Vous perdrez l'accès régie sur cet appareil.)`)) return;
    forgetParty(c);
    setMine(myParties());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8 text-white text-sm">
          <Link href="/" className="font-bold opacity-90 hover:opacity-100">← perf360</Link>
        </div>

        <div className="text-center text-white mb-10">
          <div className="text-5xl mb-3">🎶</div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">Jukebox</h1>
          <p className="mt-3 text-white/85 text-lg">Les invités proposent leurs titres depuis leur téléphone, la régie les enchaîne.</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <form onSubmit={join} className="bg-white rounded-3xl p-7 shadow-xl space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Proposer des titres</h2>
            <p className="text-sm text-gray-500">Saisissez le code affiché à l'écran.</p>
            <input
              inputMode="numeric" autoComplete="off" placeholder="123 456" value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
              className="w-full text-center text-3xl font-bold tracking-[0.3em] border-2 border-gray-200 rounded-2xl py-3 focus:border-fuchsia-500 outline-none"
            />
            <button disabled={code.replace(/\D/g, "").length !== 6}
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white font-bold py-3 rounded-full transition-colors">
              Rejoindre
            </button>
          </form>

          {closed ? (
            <div className="bg-white/90 rounded-3xl p-7 shadow-xl space-y-3">
              <h2 className="text-xl font-bold text-gray-900">Lancer une soirée</h2>
              <p className="text-gray-600">La création de soirées est réservée à l'organisateur. Contactez-le pour obtenir votre lien régie.</p>
            </div>
          ) : (
          <form onSubmit={create} className="bg-white rounded-3xl p-7 shadow-xl space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Lancer une soirée</h2>
            <input
              maxLength={MAX_NAME_LEN} placeholder="Ex. : Les 40 ans de Max"
              value={name} onChange={(e) => setName(e.target.value)}
              className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-indigo-500 outline-none"
            />
            <label className="flex items-center justify-between text-sm text-gray-600">
              Titres en attente par invité
              <select value={max} onChange={(e) => setMax(Number(e.target.value))}
                className="border-2 border-gray-200 rounded-xl px-3 py-1.5 font-semibold">
                {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
              </select>
            </label>
            {needCode && (
              <input
                placeholder="Code de création" autoComplete="off" value={creationCode}
                onChange={(e) => setCreationCode(e.target.value.toUpperCase())}
                className="w-full border-2 border-gray-200 rounded-2xl px-4 py-3 font-mono tracking-widest focus:border-indigo-500 outline-none"
              />
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={busy || !name.trim() || (needCode && !creationCode.trim())}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold py-3 rounded-full transition-colors">
              {busy ? "Création…" : "Ouvrir la régie"}
            </button>
          </form>
          )}
        </div>

        {mine.length > 0 && (
          <div className="mt-8 bg-white/95 rounded-3xl p-6 shadow-xl">
            <h2 className="font-bold text-gray-900 mb-3">Mes soirées</h2>
            <ul className="divide-y divide-gray-100">
              {mine.map((c) => (
                <li key={c.code} className="flex items-center gap-3 py-3">
                  <span className="font-mono font-bold text-indigo-600 shrink-0">{formatCode(c.code)}</span>
                  <span className="flex-1 min-w-0 truncate text-gray-700">{c.name}</span>
                  <Link href={`/jukebox/${c.code}/regie`} className="text-sm font-semibold text-fuchsia-600 hover:underline shrink-0">Régie</Link>
                  <button onClick={() => remove(c.code)} className="text-gray-300 hover:text-red-500 shrink-0" aria-label="Retirer">✕</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
