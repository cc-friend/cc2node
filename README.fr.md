# cc2node

[![npm](https://img.shields.io/npm/v/cc2node.svg)](https://www.npmjs.com/package/cc2node)
[![ci](https://github.com/cc-friend/cc2node/actions/workflows/ci.yml/badge.svg)](https://github.com/cc-friend/cc2node/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[English](README.md) | [中文](README.zh.md) | **Français**

Convertit n'importe quelle version de Claude Code compilée avec Bun en un build Node pur qui s'exécute sur un simple **Node 18+**. Aucun runtime Bun requis. Basé sur [unbun](https://www.npmjs.com/package/unbunjs).

Claude Code 2.1.112+ est distribué sous forme de binaire [Bun](https://bun.sh) `--compile`. cc2node le télécharge, analyse le graphe de modules embarqué avec unbun, « de-bun » le bundle d'entrée pour qu'il s'exécute sous Node, le transpile en un unique `cli.js` compatible Node 18, et embarque ripgrep ainsi que les dépendances d'exécution que Bun fournissait nativement.

```sh
npx cc2node 2.1.185                       # Ou npx cc2node latest
node cc2node-2.1.185-*/cli.js --version   # 2.1.185 (Claude Code)
```

## Pourquoi

Exécuter Claude Code là où le binaire officiel ne le peut pas : des systèmes anciens ou contraints où le binaire Bun signé ou un Node trop récent refuse de démarrer — un MacBook macOS 11 Intel (le Node 24+ précompilé meurt avec une erreur libc++), un Linux ancien ou minimal (glibc ancienne ; le ripgrep embarqué est le build statique musl), ou des machines figées sur un vieux Node (images d'entreprise, politiques LTS, bases CI). Le `cli.js` produit par cc2node s'exécute sur tous ces environnements (Node 18+).

Autres usages :

- Lire ou auditer le vrai code source de `cli.js` (esbuild l'embellit).
- Comparer (diff) le `cli.js` de deux versions pour voir ce qui a changé.
- Patcher ou personnaliser via le shim Bun-vers-Node éditable.
- Déboguer sous `node --inspect`, profileurs, outils de couverture ou loaders personnalisés.
- Empreinte plus légère (environ 35 Mo contre 220 Mo pour le binaire).
- Installations reproductibles et hors ligne : construire une fois, exécuter plus tard avec seulement Node.
- Épingler et conserver plusieurs versions côte à côte.

Les addons natifs et `rg` sont spécifiques à la plateforme ; construisez donc avec `--platform` pour votre cible. Le cœur JavaScript est indépendant de la plateforme.

## Utilisation

```
cc2node <version|tarball|binary> [options]

Entrée :
  <version>            p. ex. 2.1.185, ou "latest" / "stable".
                       Téléchargé depuis downloads.claude.ai (repli sur GitHub, puis npm).
  <tarball|binary>     un claude-*.tar.gz ou un binaire Bun `claude` déjà extrait.

Options :
  -p, --platform <p>   plateforme cible (par défaut : cet hôte)
  -o, --out <dir>      répertoire de sortie (par défaut : ./cc2node-<version>-<platform>)
      --no-ripgrep     ne pas embarquer ripgrep
      --no-install     ne pas npm install les dépendances d'exécution dans la sortie
      --keep-temp      conserver le répertoire de travail temporaire
  -h, --help / -v, --version

Plateformes : linux-x64, linux-x64-musl, linux-arm64, linux-arm64-musl, darwin-x64, darwin-arm64.
```

Le répertoire de sortie contient `cli.js` (s'exécute sur Node 18+), `bun-shim.cjs`, les addons `*.node`, `rg`, un `package.json` et un `node_modules` (ws, undici, ajv, ajv-formats). La configuration est lue depuis `~/.claude`, comme le build officiel.

## Fonctionnement

1. Télécharger le binaire Bun depuis downloads.claude.ai (SHA-256 vérifié ; replis sur GitHub et npm).
2. Analyser le graphe de modules embarqué avec [unbun](https://www.npmjs.com/package/unbunjs) et récupérer le module d'entrée ainsi que les addons natifs.
3. « De-bun » `cli.js` : retirer la directive `// @bun`, invoquer le wrapper CommonJS que Bun appelle normalement lui-même, et préfixer `bun-shim.cjs` (une réimplémentation Node des API `Bun.*`).
4. Transpiler vers Node 18 avec esbuild (abaissement de `using`) et préfixer de petits polyfills d'exécution, produisant un unique `cli.js` qui s'exécute de Node 18 à 26+.
5. Ajouter ripgrep et faire un `npm install` des dépendances d'exécution.

## API de bibliothèque

```ts
import { convert } from 'cc2node';

const { version, outDir } = await convert({ input: '2.1.185', platform: 'linux-x64' });
console.log(version, outDir);
```

`convert(options)` se résout en `{ version, platform, outDir, modules }`. Options : `input` (requis), `platform`, `out`, `ripgrep`, `install`, `keepTemp`, `log`. Également exportés : `PLATFORMS`, `hostPlatform`.

## Développement

```sh
npm install
npm run checkall   # tsc typecheck + biome lint + biome format check + unit tests (no writes)
npm run fixall     # biome autofix (lint + format)
npm test           # unit tests (tsx + node:test)
npm run build      # compile TypeScript to dist/
npm run e2e        # heavy: convert real releases and run cli.js across Node majors (network)
npm run release:patch   # vbt: bump, commit, tag vX.Y.Z, push → triggers the publish workflow (also :minor / :major)
```

La CI exécute `checkall` sur Node 18–24 à chaque push/PR.

## Licence

MIT
