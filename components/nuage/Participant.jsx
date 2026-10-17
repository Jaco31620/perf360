"use client";
/*
 * Nuage de mots — page participant (ouverte via QR code ou code à 6 chiffres).
 * Envoi de mots jusqu'à la limite fixée par le présentateur ; possibilité de
 * suivre le nuage en direct une fois ses mots envoyés.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import WordCloud from "./WordCloud";
import { participantId, formatCode } from "./storage";
import { MAX_WORD_LEN } from "@/lib/nuage";
import { resolveTheme } from "@/lib/nuageThemes";

export default function Participant({ code }) {
  const [session, setSession] = useState(undefined); // undefined = chargement, null = introuvable
  const [sent, setSent] = useState(0);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [showCloud, setShowCloud] = useState(false);
  const [words, setWords] = useState([]);
  const pid = useRef(null);
  const input = useRef(null);

  const refresh = useCallback(async (full) => {
    try {
      const res = await fetch(`/api/nuage/${code}?pid=${pid.current}${full ? "" : "&lite=1"}`, { cache: "no-store" });
      if (res.status === 404) return setSession(null);
      const data = await res.json();
      if (!res.ok) return;
      setSession(data.session);
      if (typeof data.sent === "number") setSent(data.sent);
      if (data.words) setWords(data.words);
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    pid.current = participantId();
    refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (session === null) return;
    const id = setInterval(() => { if (!document.hidden) refresh(showCloud); }, showCloud ? 2500 : 5000);
    if (showCloud) refresh(true);
    return () => clearInterval(id);
  }, [refresh, showCloud, session === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!word.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/nuage/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: pid.current, word }),
      });
      const data = await res.json();
      if (typeof data.sent === "number") setSent(data.sent);
      if (!res.ok) throw new Error(data.error || "Envoi impossible.");
      setFlash(word.trim());
      setWord("");
      setTimeout(() => setFlash(""), 2200);
      input.current?.focus();
      if (showCloud) refresh(true);
    } catch (err) {
      setError(err.message);
      refresh(false);
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) {
    return <Shell><p className="text-center text-white/80">Chargement…</p></Shell>;
  }
  if (session === null) {
    return (
      <Shell>
        <div className="bg-white rounded-3xl p-8 text-center shadow-xl">
          <p className="text-4xl mb-3">🤔</p>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Nuage introuvable</h1>
          <p className="text-gray-500 mb-6">Le code {formatCode(code)} ne correspond à aucun nuage.</p>
          <Link href="/nuage" className="inline-block bg-sky-500 text-white font-bold px-6 py-3 rounded-full">Saisir un autre code</Link>
        </div>
      </Shell>
    );
  }

  const unlimited = session.maxPerParticipant === 0;
  const remaining = unlimited ? Infinity : Math.max(0, session.maxPerParticipant - sent);
  const open = session.status === "open";
  const theme = resolveTheme(session.style);

  return (
    <Shell>
      <div className="bg-white rounded-3xl p-7 shadow-xl">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Code {formatCode(code)}</p>
        <h1 className="text-2xl font-extrabold text-gray-900 leading-tight mb-6">{session.question}</h1>

        {!open ? (
          <p className="text-center bg-gray-100 text-gray-600 rounded-2xl py-4 font-medium">🔒 Les envois sont fermés.</p>
        ) : remaining === 0 ? (
          <div className="text-center bg-green-50 text-green-700 rounded-2xl py-5">
            <p className="text-3xl mb-1">🎉</p>
            <p className="font-bold">Merci ! Vos mots sont dans le nuage.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              ref={input} autoFocus maxLength={MAX_WORD_LEN} value={word} placeholder="Votre mot…"
              onChange={(e) => setWord(e.target.value)} enterKeyHint="send" autoComplete="off"
              className="w-full text-xl border-2 border-gray-200 rounded-2xl px-4 py-3.5 focus:border-sky-500 outline-none"
            />
            <div className="flex items-center justify-between text-xs text-gray-400 px-1">
              <span>
                {unlimited
                  ? `Autant de mots que vous voulez${sent ? ` · ${sent} envoyé${sent > 1 ? "s" : ""}` : ""}`
                  : `${remaining} mot${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""}`}
              </span>
              <span>{word.length}/{MAX_WORD_LEN}</span>
            </div>
            <button disabled={busy || !word.trim()}
              className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white text-lg font-bold py-3.5 rounded-full transition-colors">
              {busy ? "Envoi…" : "Envoyer"}
            </button>
          </form>
        )}

        {flash && <p className="mt-4 text-center text-green-600 font-semibold">✓ « {flash} » envoyé !</p>}
        {error && <p className="mt-4 text-center text-red-600 text-sm">{error}</p>}

        {sent > 0 && (
          <button onClick={() => setShowCloud((v) => !v)} className="mt-6 w-full text-sm font-semibold text-sky-600 hover:underline">
            {showCloud ? "Masquer le nuage" : "Voir le nuage en direct"}
          </button>
        )}
      </div>

      {showCloud && (
        <div className="mt-5 rounded-3xl p-3 shadow-xl h-[60vh]" style={{ background: theme.bg }}>
          {words.length
            ? <WordCloud words={words} colors={theme.colors} weight={theme.weight} arrangement={theme.arrangement} effect={theme.effect} />
            : <p className="text-center pt-10" style={{ color: theme.sub }}>Aucun mot pour l'instant.</p>}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-500 via-sky-500 to-violet-600 px-4 py-10">
      <div className="max-w-md mx-auto">{children}</div>
    </div>
  );
}
