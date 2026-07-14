# 01 — Stack

> Extraído de `package.json`, `.github/workflows/`, `bin/`, `src/`.

## Runtime e linguagem

| Item | Valor | Evidência |
|---|---|---|
| Linguagem | **JavaScript (ESM)** — sem TypeScript | `"type": "module"`; ausência de `tsconfig.json` |
| Runtime | **Node.js ≥ 22** | `package.json` → `engines.node: ">=22"` |
| Versão do pacote | 0.3.8 | `package.json` |

O CLI valida a versão do Node **antes** de carregar o bundle ESM: `bin/mgr.cjs` (ES5/CJS)
checa `process.versions.node >= 22` e falha com mensagem clara em Node antigo, em vez de um
crash minificado.

## Dependências

| Tipo | Pacote | Uso |
|---|---|---|
| runtime | `@clack/prompts` ^1.7.0 | TUI interativa do `install` |
| runtime | `picocolors` ^1.1.1 | cores no terminal |
| dev | `esbuild` ^0.24.0 | bundle/minify do CLI |

Não há framework de aplicação, ORM, banco ou servidor HTTP — é uma CLI.

## Build e distribuição

- **Build:** `esbuild bin/mgr.js --bundle --minify --platform=node --format=esm
  --external:@clack/prompts --external:picocolors --outfile=dist/mgr.min.js` (script `build`).
- **prepack** roda o build automaticamente antes de empacotar.
- **Publicado** (`files`): `bin/mgr.cjs`, `dist/`, `skills/`, `shared/`, `LICENSE`, `README.md`.
  O `src/` **não** é publicado (vai embutido no bundle).
- **bin:** `mgr` e `mgr-method` → `bin/mgr.cjs`.

## Testes

- Runner: **`node:test` nativo** (`npm test` → `node --test`). Sem Jest/Vitest/Mocha.
- Cobertura: `node --test --experimental-test-coverage` → `lcov.info` → **Coveralls**.

## CI/CD

| Workflow | Gatilho | O que faz |
|---|---|---|
| `ci.yml` | push `main`, PR | Node `lts/*`, `npm ci`, `mgr validate`, `npm run coverage`, envia ao Coveralls (`fail-on-error: false`) |
| `publish.yml` | tags `v*` | **Apenas gates** (validate, test, tag == versão) e imprime o comando de publish manual |

**A publicação no npm é MANUAL** (recovery code do 2FA). Causa registrada: bugs abertos do npm
— trusted publishing OIDC (`npm/cli#8730`) e granular token com bypass-2FA (`npm/cli#8869`).

## Monorepo

Não. Pacote único.
