"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const AuthContext = createContext({});

function getAnonId() {
  if (typeof window === "undefined") return null;
  let id = localStorage.getItem("perf360_uid");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("perf360_uid", id); }
  return id;
}

// Migration : recopie les données anonymes vers le compte authentifié
async function migrateAnonData(anonId, authId) {
  if (!anonId || !authId || anonId === authId) return;
  try {
    // Tirages
    const { data: anonTirages } = await supabase.from("tirages").select("data").eq("user_id", anonId).maybeSingle();
    if (anonTirages?.data) {
      const { data: authTirages } = await supabase.from("tirages").select("data").eq("user_id", authId).maybeSingle();
      const merged = [...(anonTirages.data || []), ...(authTirages?.data || [])];
      await supabase.from("tirages").upsert({ user_id: authId, data: merged }, { onConflict: "user_id" });
      await supabase.from("tirages").delete().eq("user_id", anonId);
    }
    // Carnet
    const { data: anonCarnet } = await supabase.from("carnet").select("data").eq("user_id", anonId).maybeSingle();
    if (anonCarnet?.data) {
      const { data: authCarnet } = await supabase.from("carnet").select("data").eq("user_id", authId).maybeSingle();
      const existingEmails = new Set((authCarnet?.data || []).map(p => p.email?.toLowerCase()));
      const newContacts = (anonCarnet.data || []).filter(p => !existingEmails.has(p.email?.toLowerCase()));
      const merged = [...(authCarnet?.data || []), ...newContacts];
      await supabase.from("carnet").upsert({ user_id: authId, data: merged }, { onConflict: "user_id" });
      await supabase.from("carnet").delete().eq("user_id", anonId);
    }
  } catch (e) { console.error("Migration error:", e); }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const newUser = session?.user || null;
      if (event === "SIGNED_IN" && newUser) {
        const anonId = localStorage.getItem("perf360_uid");
        if (anonId && anonId !== newUser.id) await migrateAnonData(anonId, newUser.id);
      }
      setUser(newUser);
    });
    return () => subscription.unsubscribe();
  }, []);

  // userId = id authentifié si connecté, sinon id local
  const userId = user?.id || getAnonId();

  const signIn = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, userId, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
