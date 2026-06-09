/*
 * Client Supabase SERVEUR — utilise la clé `service_role` (secrète, jamais
 * exposée au navigateur). Elle CONTOURNE la Row-Level Security : toutes les
 * opérations base de données du dispositif FFBB passent désormais par des routes
 * API serveur qui s'appuient sur ce client, après vérification d'autorisation.
 *
 * À n'importer QUE depuis du code serveur (route handlers). Ne jamais ajouter
 * "use client" ici, et ne jamais préfixer la clé par NEXT_PUBLIC_.
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getSupabaseAdmin() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Configuration serveur incomplète : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis."
    );
  }
  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
