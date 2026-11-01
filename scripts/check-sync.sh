#!/usr/bin/env bash
# Garde-fou multi-machine : met à jour la branche si elle est seulement en retard (sans
# travail local), sinon avertit. Lancé à l'ouverture du dossier dans VSCode (voir
# .vscode/tasks.json).
# Lancé automatiquement à l'ouverture du dossier dans VSCode (voir .vscode/tasks.json).
set -u

cd "$(dirname "$0")/.." || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0

# Récupère l'état du remote sans rien modifier dans le working tree.
git fetch --quiet 2>/dev/null

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
if [ -z "$upstream" ]; then
  echo "ℹ️  Branche '$branch' sans upstream — pas de vérif de synchro."
  exit 0
fi

# behind = commits sur origin pas en local ; ahead = commits locaux pas poussés.
read -r behind ahead < <(git rev-list --left-right --count "$upstream"...HEAD 2>/dev/null)
behind=${behind:-0}
ahead=${ahead:-0}

dirty=""
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  dirty="  (+ des modifications non commitées dans le working tree)"
fi

echo "──────────────────────────────────────────────"
if [ "$behind" -gt 0 ] && [ "$ahead" -gt 0 ]; then
  echo "⚠️  DIVERGENCE : $behind commit(s) en retard ET $ahead en avance sur $upstream."
  echo "    Ne force rien — fais un 'git pull' et règle le merge (appelle Claude si besoin).$dirty"
elif [ "$behind" -gt 0 ] && [ -z "$dirty" ] && timeout 60 git pull --ff-only -q 2>/dev/null; then
  # en retard, sans travail local : mise à jour automatique (avance rapide, rien à fusionner)
  echo "✅  Mis à jour automatiquement : $behind commit(s) récupéré(s) de $upstream."
  if ! git diff --quiet "HEAD@{1}" HEAD -- package.json package-lock.json 2>/dev/null; then
    echo "    Dépendances modifiées : npm install…"
    npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1 && echo "    npm install OK" || echo "    ⚠️ npm install a échoué : lance-le à la main."
  fi
elif [ "$behind" -gt 0 ]; then
  echo "⚠️  EN RETARD de $behind commit(s) sur $upstream."
  echo "    Avant de coder, lance :  git pull$dirty"
elif [ "$ahead" -gt 0 ]; then
  echo "ℹ️  EN AVANCE de $ahead commit(s) non poussé(s).  Pense à :  git push$dirty"
else
  echo "✅  Branche '$branch' synchro avec $upstream.$dirty"
fi
echo "──────────────────────────────────────────────"
