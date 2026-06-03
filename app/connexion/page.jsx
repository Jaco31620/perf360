"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function ConnexionPage() {
  const { signIn, user, signOut } = useAuth();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");

  const handleSubmit = async () => {
    if (!email.trim()) return setErr("Entre ton adresse email.");
    setStatus("sending"); setErr("");
    try {
      await signIn(email.trim(), next);
      setStatus("sent");
    } catch (e) {
      setErr(e.message || "Une erreur est survenue.");
      setStatus("idle");
    }
  };

  if (user) {
    return (
      <main className="max-w-md mx-auto px-4 py-16 text-center space-y-6">
        <div className="text-5xl">✅</div>
        <h1 className="text-2xl font-bold text-gray-800">Tu es connecté</h1>
        <p className="text-gray-500 text-sm">{user.email}</p>
        <div className="flex flex-col gap-2">
          <Link href={next} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg text-sm font-medium">
            {next === "/" ? "Retour aux apps" : "Continuer"}
          </Link>
          <button onClick={signOut} className="text-xs text-gray-400 hover:underline">Se déconnecter</button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-4 py-16 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold text-gray-800">Connexion</h1>
        <p className="text-gray-500 text-sm">Reçois un lien de connexion par email — pas de mot de passe à retenir.</p>
      </div>
      {status === "sent" ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center space-y-2">
          <div className="text-3xl">📧</div>
          <h2 className="font-bold text-gray-800">Email envoyé !</h2>
          <p className="text-sm text-gray-600">Clique sur le lien dans l'email que nous t'avons envoyé à <strong>{email}</strong> pour te connecter.</p>
          <p className="text-xs text-gray-400 mt-2">Pense à vérifier tes spams.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Ton email</label>
            <input type="email" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
              value={email} onChange={e => setEmail(e.target.value)} placeholder="ton@email.fr"
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          {err && <p className="text-red-500 text-xs">{err}</p>}
          <button onClick={handleSubmit} disabled={status === "sending"}
            className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-3 rounded-xl font-semibold">
            {status === "sending" ? "Envoi…" : "Recevoir le lien de connexion"}
          </button>
        </div>
      )}
      <p className="text-center text-xs text-gray-400">
        <Link href={next} className="hover:underline">← Retour</Link>
      </p>
    </main>
  );
}
