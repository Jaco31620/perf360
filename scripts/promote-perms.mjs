#!/usr/bin/env node
// Promeut les permissions "importantes" de .claude/settings.local.json (local, gitignoré)
// vers .claude/settings.json (versionné, partagé entre machines), et nettoie les doublons.
// Lancé automatiquement par le hook Stop (voir .claude/settings.json).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharedPath = join(root, '.claude', 'settings.json');
const localPath = join(root, '.claude', 'settings.local.json');

// Préfixes considérés "durables" : utiles sur toutes les machines, donc partagés.
// Modifie cette liste pour ajuster ce qui est promu automatiquement.
const IMPORTANT = [
  'Bash(git ',
  'Bash(npm ',
  'Bash(npx ',
  'Bash(pnpm ',
  'Bash(yarn ',
  'Bash(pip ',
  'Bash(pip3 ',
  'Bash(node scripts/',
  'Bash(bash scripts/',
  'Bash(tsc',
  'Bash(eslint',
  'Bash(prettier',
  'Skill(',
  'WebSearch',
];

const isImportant = (rule) => IMPORTANT.some((p) => rule === p || rule.startsWith(p));

const load = (path) => {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
};

const shared = load(sharedPath);
const local = load(localPath);

shared.permissions ??= {};
shared.permissions.allow ??= [];
const sharedAllow = shared.permissions.allow;
const localAllow = local.permissions?.allow ?? [];

const sharedSet = new Set(sharedAllow);
let changed = false;
const keepLocal = [];
for (const rule of localAllow) {
  if (isImportant(rule)) {
    if (!sharedSet.has(rule)) { sharedAllow.push(rule); sharedSet.add(rule); }
    changed = true; // retirée du local (promue ou doublon nettoyé)
  } else {
    keepLocal.push(rule);
  }
}

if (changed) {
  if (local.permissions) local.permissions.allow = keepLocal;
  writeFileSync(sharedPath, JSON.stringify(shared, null, 2) + '\n');
  writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n');
  process.stderr.write('[promote-perms] permissions durables synchronisées vers .claude/settings.json\n');
}
