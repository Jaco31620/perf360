#!/usr/bin/env bash
# Garde-fou multi-machine : averti si la branche locale n'est pas synchro avec origin.
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
elif [ "$behind" -gt 0 ]; then
  echo "⚠️  EN RETARD de $behind commit(s) sur $upstream."
  echo "    Avant de coder, lance :  git pull$dirty"
elif [ "$ahead" -gt 0 ]; then
  echo "ℹ️  EN AVANCE de $ahead commit(s) non poussé(s).  Pense à :  git push$dirty"
else
  echo "✅  Branche '$branch' synchro avec $upstream.$dirty"
fi
echo "──────────────────────────────────────────────"
