---
name: evidence-capture
description: Registra as evidências AI-First de uma funcionalidade - prompts usados, revisões (o que foi corrigido ou rejeitado da IA) e habilidades delegadas - dentro de specs/<feature>/ai/, e mantém um índice global em ai/index.md. Feita para desafios e projetos AI-First que exigem a pasta ai/ (skills.md, prompts.md, revisoes.md). Use ao concluir uma funcionalidade, quando o usuário pedir para registrar evidências, documentar o uso de IA, gerar a pasta ai/, ou preparar a entrega de um desafio técnico. Invocada pelo spec-create/spec-execute ao fechar uma feature, ou diretamente. Organiza e pergunta; nunca inventa o conteúdo das revisões.
---

# evidence-capture — Evidências AI-First por funcionalidade

Você registra, de forma estruturada e honesta, como a IA foi usada em cada
funcionalidade. As evidências ficam **junto da feature** (`specs/<feature>/ai/`), com um
índice global fino em `ai/index.md`. Isso mantém coesão (spec, plano, execução e
evidências no mesmo lugar) e ainda atende quem espera a pasta `ai/` na raiz.

## Regra soberana: organizar, nunca inventar (Lei 1)

Você NÃO sabe o que o usuário revisou, corrigiu ou rejeitou da IA — esse julgamento
crítico é dele e é o que o desafio mais avalia. Seu papel é **estruturar, perguntar e
registrar**, jamais preencher revisões plausíveis. Campo sem informação real →
`[a preencher pelo autor]`, nunca um texto fabricado. O mesmo vale para prompts: registre
os que foram efetivamente usados (o usuário fornece ou você recupera do histórico da
sessão/`mgr-code`), não invente prompts que "poderiam" ter sido usados.

## Guarda de política (antes de tudo)

Verifique a CONSTITUTION do projeto. Se `Evidências AI-First: desabilitado` (ou ausente),
avise e CONFIRME antes de prosseguir — um registro avulso é permitido, mas consciente.

## Escopo (obrigatório ao iniciar)

Determine a funcionalidade-alvo:
- Invocada por `spec-create`/`spec-execute` → recebe o `<feature-slug>`.
- Direta → perguntar qual feature (listar as pastas de `specs/`).

Crie/atualize `specs/<slug>/ai/` com três arquivos (templates em `templates/`).

## `specs/<slug>/ai/prompts.md` — prompts desta feature

Registrar cada prompt relevante usado NESTA funcionalidade: o texto do prompt (ou resumo
fiel), a ferramenta (Claude Code / Copilot / etc.), a fase SDD (spec, execução, teste,
review) e **o que ele produziu**. Fonte dos prompts, nesta ordem:
1. O usuário cola/aponta os prompts que usou.
2. Se disponível, recuperar do histórico da sessão ou do `mgr-code`.
3. Sem fonte → registrar os que o usuário confirmar; não completar com invenção.

## `specs/<slug>/ai/revisoes.md` — o que foi revisado/corrigido/rejeitado (o mais importante)

Conduza uma entrevista curta e específica, sem sugerir as respostas:
- Que sugestões da IA você **aceitou como veio**?
- O que você **corrigiu** antes de usar? (o quê e por quê)
- O que você **rejeitou** por completo? (o quê e por quê)
- Onde a IA **errou** (bug, regra de negócio incompreendida, over-engineering)?
- Que decisão sua **contrariou** a sugestão da IA?

Registrar as respostas verbatim. Nada de "a IA sugeriu X e foi aceito" sem o usuário ter
dito — se ele não respondeu um item, deixar `[a preencher pelo autor]`.

## `specs/<slug>/ai/skills.md` — habilidades delegadas à IA

Quais áreas/habilidades foram delegadas nesta feature (ex.: geração do trecho OpenAPI,
esboço dos testes de contrato, sugestão de estrutura de camadas), e o grau de autonomia
(rascunho revisado por humano / gerado e aceito / apenas consulta). Derivável em parte do
`05-execution.md` (skills invocadas), mas confirmar com o usuário.

## `ai/index.md` — índice global (raiz)

Manter na raiz um índice que: lista cada funcionalidade com link para o seu
`specs/<slug>/ai/`, um resumo de 1-2 linhas do uso de IA naquela feature, e uma seção
"Visão geral" com os padrões que se repetiram (o que a IA acertou/errou no projeto todo).
Atualizar a cada nova feature registrada. Este arquivo é o ponto de entrada que satisfaz a
exigência da pasta `ai/` na raiz, sem duplicar conteúdo — ele **aponta**, não copia.

## Esforço (opcional, honesto)

Se o usuário quiser registrar esforço, adicionar em cada `revisoes.md` uma linha de
esforço percebido (ex.: "≈ 2h, maior parte no ajuste das regras de 422"). **Não registrar
tokens nem tempo automático** — a skill não os mede de forma confiável; só o que o usuário
informar explicitamente entra, e como declaração dele, não como medição.

## Integração com o fluxo SDD

- `spec-create`/`spec-execute` invocam esta skill na fase de Completion de cada feature,
  passando o slug; ela então conduz o registro e atualiza o índice.
- O `06-completion.md` da feature passa a referenciar `ai/` da própria feature.
- `mgr-code` disponível → recuperar prompts/decisões já registrados da sessão para
  pré-preencher (o usuário confirma); ausente → conduzir só com o que o usuário fornece.

## Encerramento

Mostrar o que foi gravado (os três arquivos + a entrada no índice) e listar
explicitamente os campos que ficaram `[a preencher pelo autor]`, para o usuário completar
o julgamento crítico — a parte que só ele pode escrever.
