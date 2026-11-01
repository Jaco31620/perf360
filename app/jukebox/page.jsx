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
import AccessRequest from "@/components/jukebox/AccessRequest";
import { DEFAULT_MAX_PER_PARTICIPANT, MAX_NAME_LEN, MAX_CHOICES, maxLabel, autoCloseAt } from "@/lib/jukebox";
import { fmtRegieCode } from "@/components/jukebox/Access";
import ShareActions from "@/components/jukebox/ShareActions";
import { inviteText } from "@/lib/jukeboxMessages";

const fmtWhen = (ms) => new Date(ms).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

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
  const [created, setCreated] = useState(null); // soirée créée : { code, name, regieCode, endsAt, mailedTo, target }
  const [closedCodes, setClosedCodes] = useState([]); // « Mes soirées » fermées
  const [prolong, setProlong] = useState(null); // ?prolonger=<code> : demande de prolongation

  useEffect(() => {
    setMine(myParties());
    setIsSuper(!!getSuperToken());
    // code d'activation : lien reçu, sinon dernier code utilisé sur cet appareil
    const qs = new URLSearchParams(window.location.search);
    const fromLink = qs.get("activation");
    if (fromLink || qs.has("creer") || qs.get("prolonger")) setView("create");
    if (/^\d{6}$/.test(qs.get("prolonger") || "")) setProlong(qs.get("prolonger"));
    const onPop = () => setView(new URLSearchParams(window.location.search).has("creer") || new URLSearchParams(window.location.search).get("activation") ? "create" : "home");
    window.addEventListener("popstate", onPop);
    let saved = "";
    try { saved = localStorage.getItem(ACT_KEY) || ""; } catch (e) { /* stockage indisponible */ }
    if (fromLink || saved) setCreationCode((fromLink || saved).toUpperCase());
    // soirées supprimées depuis (par le super-admin) : retirées de la liste
    for (const p of myParties()) {
      fetch(`/api/jukebox/${p.code}`, { cache: "no-store" }).then(async (r) => {
        if (r.status !== 404) return;
        if ((await r.json().catch(() => ({}))).closed) return setClosedCodes((l) => [...l, p.code]); // fermée, pas supprimée : on la garde
        forgetParty(p.code);
        setMine(myParties());
      }).catch(() => {});
    }
    fetch("/api/jukebox", { cache: "no-store" }).then((r) => r.json()).then((d) => { setMode(d.creationMode || "open"); if (d.defaultMax != null) setMax(d.defaultMax); }).catch(() => {});
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (v) => {
    setView(v);
    setEditCode(false);
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
      } catch (e) { if (!gone) setActInfo({ ok: false, error: "Vérification impossible (réseau) : vérifiez la connexion, puis retapez le code." }); }
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
      // d'abord l'écran « Votre soirée est prête » : code régie à noter, accès à s'envoyer
      setCreated({ code: data.code, name: name.trim(), regieCode: data.regieCode, endsAt: data.endsAt, mailedTo: data.mailedTo, target: phone ? "telecommande" : "regie" });
      setBusy(false);
      window.scrollTo({ top: 0 });
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
              <span className="flex-1 min-w-0 truncate text-gray-700">{c.name}{closedCodes.includes(c.code) && <span className="ml-2 text-[11px] font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">🔒 fermée</span>}</span>
              <span className="flex items-center gap-3 shrink-0">
                <Link href={`/jukebox/${c.code}/telecommande`} className="text-sm font-semibold text-fuchsia-600 hover:underline">📱 Télécommande</Link>
                <Link href={`/jukebox/${c.code}/regie`} className="text-sm font-semibold text-fuchsia-600 hover:underline">💻 Régie</Link>
                <button onClick={() => remove(c.code)} className="text-gray-300 hover:text-red-500" aria-label={`Retirer la soirée ${c.name || formatCode(c.code)}`}>✕</button>
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

        {created ? (
          <Ready created={created} onGo={() => router.push(`/jukebox/${created.code}/${created.target}`)} />
        ) : prolong ? (
          <AccessRequest open intro={`Votre soirée ${formatCode(prolong)} est fermée. Dites-nous jusqu'à quand vous souhaitez la prolonger :`}
            initialMessage={`Prolongation de la soirée ${formatCode(prolong)} jusqu'au …`} />
        ) : view === "create" ? (
          closed ? (
            <div className="space-y-5">
              <div className="bg-white rounded-3xl p-7 shadow-xl space-y-3">
                <p className="text-gray-700">La création de soirées est réservée à l'organisateur du service : faites votre demande ci-dessous, il vous crée votre soirée et vous envoie votre lien régie.</p>
              </div>
              <AccessRequest open intro="Dites-m'en un peu plus sur votre soirée : je vous réponds par e-mail avec votre accès." />
              {myList}
            </div>
          ) : (
            <div className="space-y-5">
            {myList}
            <form onSubmit={create} className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl space-y-5">
              {isSuper && mode !== "open" && (
                <p className="text-sm rounded-2xl bg-amber-50 text-amber-800 px-4 py-3">🔓 Vous êtes connecté en <b>super-admin</b> sur cet appareil : création sans code. Les autres visiteurs voient le code d'activation et le formulaire de demande d'accès (testez dans une fenêtre de navigation privée).</p>
              )}
              {needCode && (
                <section className="space-y-1.5">
                  <p className="text-sm font-bold text-gray-900">Code d'activation</p>
                  {actInfo?.ok && !editCode ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-green-50 border-2 border-green-200 px-4 py-3">
                      <span className="text-green-600 text-xl">✓</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-mono font-bold tracking-widest text-gray-900">{creationCode}</p>
                        <p className="text-sm text-green-700 truncate">👋 {actLine}</p>
                        {actInfo.validDays && <p className="text-xs text-gray-600 mt-0.5">🔒 La soirée restera ouverte jusqu'au <b>{fmtWhen(autoCloseAt(Date.now(), actInfo.validDays))}</b> : créez-la peu avant la fête.</p>}
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
            {needCode && !actInfo?.ok && <AccessRequest />}
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
                <span className="block text-sm text-white/75">{needCode ? "Avec votre code d'activation, ou demandez votre accès." : closed ? "Sur demande : faites votre demande d'accès." : "Créez votre jukebox."}</span>
              </span>
              <span className="text-2xl">→</span>
            </button>
          </div>
        )}

        <p className="mt-8 text-center">
          <Link href="/jukebox/aide" className="text-white/80 hover:text-white text-sm font-semibold underline">❓ Mode d'emploi : télé, ordinateur, invités, blind test</Link>
        </p>
      </div>
    </div>
  );
}

/* Après la création : code régie à noter, accès à s'envoyer, puis la régie. */
function Ready({ created, onGo }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const msg = origin ? inviteText({ origin, code: created.code, name: created.name, regieCode: created.regieCode }) : "";
  return (
    <div className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl space-y-5">
      <div className="text-center">
        <p className="text-4xl">🎉</p>
        <h2 className="text-2xl font-black text-gray-900 mt-1">Votre soirée est prête !</h2>
        <p className="text-gray-500">« {created.name} » · code invités <b className="font-mono">{formatCode(created.code)}</b></p>
      </div>
      <div className="rounded-2xl bg-amber-50 border-2 border-amber-200 p-4 text-center">
        <p className="text-sm font-bold text-amber-900">🔑 Votre code régie : notez-le</p>
        <p className="font-mono font-black text-4xl tracking-widest text-gray-900 my-1">{fmtRegieCode(created.regieCode)}</p>
        <p className="text-xs text-amber-800">Il vous permet de reprendre la main depuis un autre téléphone ou ordinateur. Ne le donnez pas aux invités.</p>
      </div>
      {created.endsAt && <p className="text-sm text-gray-600 text-center">🔒 Ouverte jusqu'au <b>{fmtWhen(created.endsAt)}</b>.</p>}
      {created.mailedTo
        ? <p className="text-sm text-green-700 bg-green-50 rounded-2xl px-4 py-3">✓ Vos accès (liens et code régie) ont été envoyés à <b>{created.mailedTo}</b>.</p>
        : msg && (
          <div className="space-y-2">
            <p className="text-sm font-bold text-gray-900">📨 Envoyez-vous vos accès (liens + code régie) :</p>
            <ShareActions subject={`Mes accès Jukebox · « ${created.name} »`} message={msg} />
          </div>
        )}
      <button onClick={onGo} className="w-full text-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-full">
        Continuer vers la {created.target === "regie" ? "régie" : "télécommande"} →
      </button>
    </div>
  );
}
