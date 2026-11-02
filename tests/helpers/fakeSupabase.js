/*
 * Faux client Supabase pour les tests : sb.from(table) renvoie une requête
 * chaînable (select, eq, in, like, order, range, maybeSingle, insert…) qui
 * enregistre les appels ; `await` la résout via handler({ table, ops }),
 * qui renvoie { data, error }. Aucune base, aucune variable d'environnement.
 */
export function fakeSupabase(handler) {
  const calls = [];
  const from = (table) => {
    const ops = [];
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === "then") {
          return (ok, ko) => Promise.resolve()
            .then(() => handler({ table, ops, op: (name) => ops.find((o) => o.name === name) }) || { data: null, error: null })
            .then(ok, ko);
        }
        return (...args) => { ops.push({ name: prop, args }); return q; };
      },
    });
    calls.push({ table, ops });
    return q;
  };
  return { from, calls };
}
