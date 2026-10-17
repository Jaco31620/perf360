# perf360

## Karaoké « Laure 50 ans » (`/laure50`)

Section autonome, non liée à l'accueil.

| Page | Rôle |
|---|---|
| `/laure50/ecran` | **Régie** (ordinateur branché sur l'enceinte et la TV) : joue `public/laure50/karaoke.mp4`, publie l'état de lecture. Demande la clé régie. |
| `/laure50` | **Téléphones** : paroles synchronisées (aucun son). |
| `/laure50/qr` | QR code vers `/laure50`. |

- Synchro : horloge recalée sur le serveur façon NTP (`/api/laure50/time`), état `{playing, pos, at, shift, rev}` lu chaque seconde (`/api/laure50/state`), position recalculée à chaque image. `at` est horodaté par la régie (horloge serveur corrigée) au moment de la lecture de `currentTime`. Mesuré en local : écart ≤ 25 ms.
- Régie : espace = lecture/pause, Début (Home), F = plein écran, ← → = décalage téléphones (±0,6 s, pour une enceinte Bluetooth), « Test téléphones » = lecture à 40 s. Barre masquée après 3,5 s.
- Stockage : Supabase, tables `laure50_state` / `laure50_phones` (`scripts/laure50.sql`, RLS deny-all, accès service_role). `LAURE50_STORE=memory` pour tester en local sans la base.
- Clé régie : colonne `laure50_state.regie_key` dans Supabase (ou variable d'environnement `REGIE_KEY`, prioritaire) ; en local, `laure` par défaut.
- Fichiers de référence : `public/laure50/{karaoke.mp4, logo.png, lyrics.json}`.
