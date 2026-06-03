"use client";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const next = searchParams.get("next") || "/";
    // Supabase parse automatiquement les tokens dans l'URL (hash ou query)
    supabase.auth.getSession().then(() => {
      router.replace(next);
    });
  }, [router, searchParams]);
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
      <div className="text-4xl animate-pulse">🔐</div>
      <p className="text-gray-500">Connexion en cours…</p>
    </main>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={
      <main className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <div className="text-4xl animate-pulse">🔐</div>
        <p className="text-gray-500">Connexion en cours…</p>
      </main>
    }>
      <AuthCallbackInner />
    </Suspense>
  );
}
