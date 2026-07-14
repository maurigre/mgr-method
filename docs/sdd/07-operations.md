# 07 — Operação e release

> Fonte: `.github/workflows/`, `package.json`, `CHANGELOG.md`, histórico de git.

## Pipelines

| Workflow | Gatilho | Passos |
|---|---|---|
| `ci.yml` | push em `main`, PR | `setup-node lts/*` → `npm ci` → `node bin/mgr.js validate` → `npm run coverage` → Coveralls (`fail-on-error: false`) |
| `publish.yml` | tags `v*` | **gates-only**: `npm ci` → `validate` → `npm test` → checa `tag == package.json` → imprime o comando de publish manual |

O `publish.yml` **não publica**. É deliberado (ver abaixo).

## Publicação: MANUAL (decisão forçada por bugs do npm)

Ambos os caminhos automatizados de autenticação do npm estão quebrados **do lado do registry**:

| Caminho | Erro | Bug |
|---|---|---|
| OIDC Trusted Publishing | `OIDC token exchange error - package not found` (404 no token exchange) mesmo com config correta | `npm/cli#8730` |
| Granular token com `bypass_2fa: true` | `E403 — Two-factor authentication is required` | `npm/cli#8869` |

Testado exaustivamente: Node 22 e 24, com e sem `registry-url`, Trusted Publisher recriado,
`repository.url` corrigido. **Nenhum wrapper (ex.: `JS-DevTools/npm-publish`) resolve** — usam
os mesmos dois mecanismos.

**Procedimento de release (atual):**
```
1. bump em package.json + package-lock.json
2. entrada no CHANGELOG.md (Keep a Changelog)
3. commit `chore: bump X.Y.Z` → push → tag vX.Y.Z → push da tag  (dispara os gates)
4. npm publish --access public --otp=<recovery-code>      ← MANUAL
```
O 2FA da conta é **passkey/WebAuthn** (o npm removeu cadastro TOTP em ~set/2025), então o
`--otp` recebe um **recovery code de uso único** (npmjs.com → Account → 2FA → Recovery Codes).

**Reavaliar** quando o npm corrigir `#8730` ou `#8869`.

## Versionamento

- **SemVer** + **Keep a Changelog** (`CHANGELOG.md`).
- Toda versão publicada tem entrada no CHANGELOG e tag `vX.Y.Z`.
- Versões publicadas **não podem ser sobrescritas** — erro → **sempre bump**.

## Observabilidade

Não se aplica (CLI local, sem serviço em execução). Sem tracing/métricas.
