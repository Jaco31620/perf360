"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    // Supabase parse automatiquement les tokens dans l'URL (hash ou query)
    supabase.auth.getSession().then(() => {
      router.replace("/");
    });
  }, [router]);

  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
      <div className="text-4xl animate-pulse">🔐</div>
      <p className="text-gray-500">Connexion en cours…</p>
    </main>
  );
}
