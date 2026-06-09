"use client";
/*
 * Client Supabase PUBLIC (clé anon) — utilisé uniquement côté navigateur pour
 * le Storage (logos du bucket ffbb-assets) et l'auth. Tous les accès aux données
 * passent désormais par les routes serveur (/api/ffbb/*), pas par ce client.
 *
 * Initialisation PARESSEUSE via Proxy : on ne crée le client qu'au premier usage
 * réel, et non au chargement du module. Ainsi, si les variables publiques ne sont
 * pas injectées (ex. au prérendu/build), le module ne casse plus tout le build —
 * l'erreur n'apparaît qu'à l'utilisation effective, côté navigateur.
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;
function getClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Variables Supabase publiques manquantes (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)."
    );
  }
  _client = createClient(url, key);
  return _client;
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const client = getClient();
      const value = client[prop];
      return typeof value === "function" ? value.bind(client) : value;
    },
  }
);
