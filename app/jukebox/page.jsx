"use client";
/*
 * Jukebox — accueil : rejoindre une soirée avec son code, ou en créer une
 * (le créateur devient régie et reçoit un jeton gardé en local). La création
 * suit le réglage du super-admin : libre, sur code d'activation individuel
 * (pré-rempli par le lien ?activation=…, retenu sur l'appareil tant qu'il
 * reste des soirées), ou réservée.
 * Deux vues : accueil (rejoindre une soirée, mes soirées, bouton « Organiser »)
 * et création (directe avec ?activation=… ou ?creer).
 */
const ACT_KEY = "jukebox:activation";
const actReady = (c) => c.replace(/[^A-Za-z0-9]/g, "").length === 8;
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
  const [actInfo, setActInfo] = useState(null); // { ok, label, remaining } | { ok: false, error }
  const [view, setView] = useState("home"); // home | create
  const [editCode, setEditCode] = useState(false);

  useEffect(() => {
    setMine(myParties());
    setIsSuper(!!getSuperToken());
    // code d'activation : lien reçu, sinon dernier code utilisé sur cet appareil
    const qs = new URLSearchParams(window.location.search);
    const fromLink = qs.get("activation");
    if (fromLink || qs.has("creer")) setView("create");
    const onPop = () => setView(new URLSearchParams(window.location.search).has("creer") || new URLSearchParams(window.location.search).get("activation") ? "create" : "home");
    window.addEventListener("popstate", onPop);
    let saved = "";
    try { saved = localStorage.getItem(ACT_KEY) || ""; } catch (e) { /* stockage indisponible */ }
    if (fromLink || saved) setCreationCode((fromLink || saved).toUpperCase());
    // soirées supprimées depuis (à la main ou après inactivité) : retirées de la liste
    for (const p of myParties()) {
      fetch(`/api/jukebox/${p.code}`, { cache: "no-store" }).then((r) => {
        if (r.status !== 404) return;
        forgetParty(p.code);
        setMine(myParties());
      }).catch(() => {});
    }
    fetch("/api/jukebox", { cache: "no-store" }).then((r) => r.json()).then((d) => { setMode(d.creationMode || "open"); if (d.defaultMax != null) setMax(d.defaultMax); }).catch(() => {});
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (v) => {
    setView(v);
    const url = v === "create" ? `/jukebox?creer${creationCode && new URLSearchParams(window.location.search).get("activation") ? `&activation=${encodeURIComponent(creationCode)}` : ""}` : "/jukebox";
    window.history.pushState(null, "", url);
    window.scrollTo(0, 0);
  };
  const needCode = mode === "code" && !isSuper;
  const closed = mode === "super" && !isSuper;

  // vérification du code d'activation dès qu'il est complet
  useEffect(() => {
    setActInfo(null);
    if (!needCode || !actReady(creationCode)) return;
    let gone = false;
    const t = setTimeout(async () => {
      try {
        const d = await (await fetch(`/api/jukebox?check=${encodeURIComponent(creationCode)}`, { cache: "no-store" })).json();
        if (!gone) setActInfo(d);
      } catch (e) { /* réseau : vérifié à la création */ }
    }, 300);
    return () => { gone = true; clearTimeout(t); };
  }, [creationCode, needCode]);

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
      try {
        // code gardé pour la prochaine soirée s'il en reste
        if (needCode && actInfo?.ok && actInfo.remaining !== 1) localStorage.setItem(ACT_KEY, creationCode);
        else if (needCode) localStorage.removeItem(ACT_KEY);
      } catch (e) { /* stockage indisponible */ }
      rememberParty(data.code, name.trim());
      // téléphone : la télécommande (la musique viendra d'une télé ou d'un ordinateur) ; ordinateur : la régie
      const phone = window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900;
      router.push(`/jukebox/${data.code}/${phone ? "telecommande" : "regie"}`);
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

  const actLine = actInfo?.ok
    ? `${actInfo.label} · ${actInfo.remaining == null ? "soirées illimitées" : `${actInfo.remaining} soirée${actInfo.remaining > 1 ? "s" : ""} restante${actInfo.remaining > 1 ? "s" : ""}`}`
    : null;
  const codeOk = !needCode || (actReady(creationCode) && actInfo?.ok);

  const myList = mine.length > 0 ? (
    <div className="bg-white/95 rounded-3xl p-5 shadow-xl">
        <h2 className="font-bold text-gray-900 mb-2">{view === "create" ? "Reprendre une soirée déjà créée" : "Mes soirées"}</h2>
        <ul className="divide-y divide-gray-100">
          {mine.map((c) => (
            <li key={c.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className="font-mono font-bold text-indigo-600 shrink-0">{formatCode(c.code)}</span>
              <span className="flex-1 min-w-0 truncate text-gray-700">{c.name}</span>
              <span className="flex items-center gap-3 shrink-0">
                <Link href={`/jukebox/${c.code}/telecommande`} className="text-sm font-semibold text-fuchsia-600 hover:underline">📱 Télécommande</Link>
                <Link href={`/jukebox/${c.code}/regie`} className="text-sm font-semibold text-fuchsia-600 hover:underline">💻 Régie</Link>
                <button onClick={() => remove(c.code)} className="text-gray-300 hover:text-red-500" aria-label="Retirer">✕</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
  ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900 px-4 py-8">
      <div className="max-w-xl mx-auto">
        <div className="flex justify-between items-center mb-6 text-white text-sm">
          {view === "create"
            ? <button onClick={() => go("home")} className="font-bold opacity-90 hover:opacity-100">← Jukebox</button>
            : <Link href="/" className="font-bold opacity-90 hover:opacity-100">← perf360</Link>}
        </div>

        <div className="text-center text-white mb-8">
          <div className="text-5xl mb-2">🎶</div>
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">{view === "create" ? "Créer une soirée" : "Jukebox"}</h1>
          <p className="mt-3 text-white/85 text-lg">
            {view === "create" ? "Quelques secondes, et vos invités pourront proposer leurs titres."
              : "Les invités proposent leurs titres depuis leur téléphone, la musique s'enchaîne sur la télé ou l'ordinateur."}
          </p>
        </div>

        {view === "create" ? (
          closed ? (
            <div className="space-y-5">
              <div className="bg-white rounded-3xl p-7 shadow-xl space-y-3">
                <p className="text-gray-700">La création de soirées est réservée à l'organisateur du service. Contactez-le pour obtenir un code d'activation ou votre lien régie.</p>
              </div>
              {myList}
            </div>
          ) : (
            <div className="space-y-5">
            {myList}
            <form onSubmit={create} className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl space-y-5">
              {needCode && (
                <section className="space-y-1.5">
                  <p className="text-sm font-bold text-gray-900">Code d'activation</p>
                  {actInfo?.ok && !editCode ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-green-50 border-2 border-green-200 px-4 py-3">
                      <span className="text-green-600 text-xl">✓</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-bold tracking-widest text-gray-900">{creationCode}</p>
                        <p className="text-sm text-green-700 truncate">👋 {actLine}</p>
                      </div>
                      <button type="button" onClick={() => setEditCode(true)} className="text-sm text-gray-500 hover:text-gray-800 underline shrink-0">changer</button>
                    </div>
                  ) : (
                    <>
                      <input
                        placeholder="ABCD-EFGH" autoComplete="off" autoCapitalize="characters" value={creationCode} autoFocus={!creationCode}
                        onChange={(e) => setCreationCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-\s]/g, "").slice(0, 10))}
                        className={`w-full text-center text-2xl border-2 rounded-2xl px-4 py-3 font-mono tracking-widest outline-none ${actInfo?.ok ? "border-green-400" : actInfo ? "border-red-300" : "border-gray-200 focus:border-indigo-500"}`}
                      />
                      {actInfo?.ok ? <p className="text-sm text-green-700">👋 {actLine}</p>
                        : actInfo ? <p className="text-sm text-red-600">{actInfo.error}</p>
                        : <p className="text-xs text-gray-400">Le code reçu avec votre lien d'invitation.</p>}
                    </>
                  )}
                </section>
              )}
              <section className="space-y-1.5">
                <p className="text-sm font-bold text-gray-900">Nom de la soirée</p>
                <input
                  maxLength={MAX_NAME_LEN} placeholder="Ex. : Les 40 ans de Max" autoFocus={!needCode || !!actInfo?.ok}
                  value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full text-lg border-2 border-gray-200 rounded-2xl px-4 py-3 focus:border-indigo-500 outline-none"
                />
                <p className="text-xs text-gray-400">Affiché sur l'écran et sur le téléphone des invités.</p>
              </section>
              <label className="flex items-center justify-between gap-3 text-sm text-gray-700">
                <span><b className="text-gray-900">Titres en attente par invité</b><br /><span className="text-xs text-gray-400">Modifiable ensuite dans les réglages.</span></span>
                <select value={max} onChange={(e) => setMax(Number(e.target.value))}
                  className="border-2 border-gray-200 rounded-xl px-3 py-1.5 font-semibold shrink-0">
                  {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
                </select>
              </label>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button disabled={busy || !name.trim() || !codeOk}
                className="w-full text-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold py-3.5 rounded-full transition-colors">
                {busy ? "Création…" : "Créer la soirée"}
              </button>
              <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600 space-y-1">
                <p className="font-semibold text-gray-800">Et ensuite ?</p>
                <p>📱 Sur téléphone, vous arrivez sur la <b>télécommande</b> ; 💻 sur ordinateur, sur la <b>régie</b>.</p>
                <p>📺 Vous pourrez alors afficher la soirée sur une télé (son compris) et partager le QR code aux invités.</p>
              </div>
            </form>
            </div>
          )
        ) : (
          <div className="space-y-5">
            {myList}

            <form onSubmit={join} className="bg-white rounded-3xl p-6 shadow-xl space-y-3">
              <h2 className="text-xl font-bold text-gray-900">🎤 Rejoindre une soirée</h2>
              <p className="text-sm text-gray-500">Scannez le QR code affiché, ou saisissez le code de la soirée.</p>
              <div className="flex gap-2">
                <input
                  inputMode="numeric" autoComplete="off" placeholder="123 456" value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, "").slice(0, 7))}
                  className="flex-1 min-w-0 text-center text-2xl font-bold tracking-[0.25em] border-2 border-gray-200 rounded-2xl py-2.5 focus:border-fuchsia-500 outline-none"
                />
                <button disabled={code.replace(/\D/g, "").length !== 6}
                  className="bg-fuchsia-600 hover:bg-fuchsia-700 disabled:opacity-40 text-white font-bold px-5 rounded-2xl transition-colors">
                  OK
                </button>
              </div>
            </form>

            <button onClick={() => go("create")}
              className="w-full flex items-center gap-4 text-left bg-white/10 hover:bg-white/20 border-2 border-white/30 rounded-3xl p-5 text-white transition-colors">
              <span className="text-3xl">🎛️</span>
              <span className="flex-1">
                <span className="block text-lg font-bold">Organiser une soirée</span>
                <span className="block text-sm text-white/75">Créez votre jukebox{needCode ? " avec votre code d'activation" : ""}.</span>
              </span>
              <span className="text-2xl">→</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
