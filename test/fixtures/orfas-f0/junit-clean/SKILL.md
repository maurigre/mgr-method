---
name: junit-clean
description: Padroniza testes unitários Java com JUnit 5 seguindo 13 regras estritas de qualidade, performance e clareza (sem herança, naming should+camelCase, sem comentários, ParameterizedTest, escopo próprio, AAA, profundidade boundary+MC/DC, assertThatThrownBy Sonar-safe). Opera em modo CRIAÇÃO (gerar testes novos), REFATORAÇÃO (limpar testes existentes) ou MISTO. Use quando o usuário pedir para criar, gerar, padronizar, limpar ou refatorar testes unitários Java, transformar em parametrizado, ou remover DisplayName e comentários. Também invocada pelo spec-create em tasks de teste de projetos Java.
---

# junit-clean — Testes Java padronizados (13 regras)

Stack alvo: Java 8+ com JUnit 5 (Jupiter); AssertJ/Mockito/Hamcrest se detectados.

## Interação inicial (pular se invocada por outra skill com escopo definido)

1. **Modo:** criar testes novos · refatorar existentes · misto (refatorar adjacentes +
   criar novos, com checkpoint entre os dois).
2. **Origem do escopo:** classe/método específico (path) · spec
   (`/specs/<feature>/03-spec.md`) · lista de comportamentos no chat · invocada.
3. **Localização dos testes:** Maven/Gradle (`src/test/java/...`) · custom (perguntar).

Antes de gerar: detectar stack (versão do JUnit, presença de AssertJ, Mockito) e o
estilo do projeto — se usa AssertJ, usar AssertJ; se só JUnit assertions, manter. Não
forçar troca sem perguntar.

## AS 13 REGRAS (não-negociáveis; violação exige override explícito do usuário)

| # | Regra | Verificação |
|---|-------|-------------|
| 1 | Sem subclasses | `extends` não aparece em classes de teste |
| 2 | Naming `should...When...` camelCase | Sem `@DisplayName`, sem underscores |
| 3 | Sem comentários | Nenhum `//` dentro de métodos de teste |
| 4 | `@ParameterizedTest` quando aplicável | Casos similares consolidados |
| 5 | Escopo próprio + sem `@TestInstance(PER_CLASS)` | Lifecycle PER_METHOD |
| 6 | Sem constantes globais | Sem `private static final` de dados de teste |
| 7 | Limpos, claros, performáticos | Sem `Thread.sleep`, sem `SpringBootTest` desnecessário |
| 8 | Métodos ≤ 25 linhas | Testes grandes quebrados ou refatorados |
| 9 | Sem métodos estáticos | Exceto `@MethodSource` quando necessário |
| 10 | Mockito flexível | `@Mock`/`@InjectMocks` OU `mock()`, ambos OK |
| 11 | AAA com linhas em branco | 3 blocos visualmente separados |
| 12 | Profundidade: branches + edges + exceptions + interações | 4 dimensões cobertas |
| 13 | `assertThatThrownBy` Sonar-safe | Apenas 1 invocação no lambda |

### Detalhamento essencial

**1. Sem subclasses:** nada de `extends AbstractTest/BaseTest` nem superclasse abstrata
de setup. Alternativas: `@BeforeEach` na própria classe, métodos privados de instância,
fixtures via `@ParameterizedTest` + `@MethodSource`.

**2. Naming:** `should<Resultado>When<Condicao>()` (ou `should<Resultado>()` se a
condição é óbvia). SEMPRE camelCase, NUNCA underscores, verbo no infinitivo após should.
Válidos: `shouldReturnEmptyWhenInputIsNull`, `shouldThrowProcessingExceptionWhenServiceClassificationFails`.
Inválidos (refatorar): `should_returnEmpty_when_inputIsNull`, `testReturnEmpty`,
`shouldReturnEmpty_whenInputIsNull`. Em parametrizado, o caso descritivo vai no atributo
`name` do `@ParameterizedTest` — `@DisplayName` continua proibido.

**3. Sem comentários** em métodos de teste (nem `// arrange` / `// given`). Estrutura
visual via linhas em branco (Regra 11). Exceção única: Javadoc de CLASSE para domínio
complexo (ex.: regra de negócio CTe/GRIS) — em método, NUNCA.

**4. Parametrizar:** dois+ testes que diferem SÓ em entrada/saída → `@ParameterizedTest`.
Fontes por preferência: `@ValueSource` → `@CsvSource` → `@CsvFileSource` →
`@MethodSource` (objetos complexos) → `@EnumSource` → `@ArgumentsSource` (último caso).

**5. Escopo próprio:** cada teste cria/recebe suas dependências; sem campo mutável
compartilhado; `@BeforeEach` só para inicialização limpa; sem `@BeforeAll` com estado
mutado; **proibido `@TestInstance(Lifecycle.PER_CLASS)`** — PER_METHOD padrão. Ordem de
execução não importa; testes podem rodar em paralelo.

**6. Sem constantes globais** de dados de teste — valores inline em cada teste.
Exceções: configuração técnica imutável (`TIMEOUT_MS = 5000`) ou valor que TODO teste
exige idêntico (raro). Compromisso aceitável para objeto usado em muitos testes: método
helper de instância (`validAddress()`), nunca constante.

**7. Performáticos:** sem código morto/imports não usados/mocks não chamados/assertions
redundantes; sem `Thread.sleep` (usar Awaitility); sem `@SpringBootTest` quando teste
unitário puro basta.

**8. ≤ 25 linhas** por método de teste.

**9. Sem métodos estáticos** (auxiliares ou de teste), exceto `@MethodSource`.

**10. Mockito:** `@Mock`/`@InjectMocks` E `mock()` inline — ambos aceitos.

**11. AAA:** Arrange, Act, Assert como 3 blocos separados por linha em branco (sem
comentários marcando).

**12. Profundidade (critério objetivo):** cobrir as 4 dimensões — branches (MC/DC),
edge cases (boundary), exceptions, e interações com colaboradores (verify com parâmetros
reais). Cobertura como métrica, não meta: sem inflar com getters triviais.

**13. `assertThatThrownBy` Sonar-safe:** apenas UMA invocação dentro do lambda —
preparar tudo antes, invocar só o método sob teste no lambda.

## Modo REFATORAÇÃO — fluxo

1. Ler os testes do escopo e produzir **relatório de violações** (tabela regra ×
   ocorrências × severidade) + mudanças propostas por teste (antes/depois) + mudanças
   estruturais (remoção de herança, constantes inlined).
2. **CHECKPOINT (bloqueante):** aplicar todas · aplicar algumas (quais) · revisar uma ·
   abortar.
3. Aplicar arquivo por arquivo, rodando os testes após cada um. **Se um teste verde
   quebrar após refatoração → REVERTER esse arquivo e reportar a causa** (refatoração
   nunca quebra teste verde).
4. Relatório final: arquivos modificados, testes verdes?, métricas (linhas removidas,
   consolidações em parametrizado, constantes inlined).

## Modo CRIAÇÃO — fluxo

Gerar testes cobrindo as 4 dimensões da Regra 12, seguindo as 13 regras, no estilo de
assertion do projeto. **Não inventar comportamento:** testar o que o código FAZ, não o
que deveria fazer; bug detectado no código sob teste → reportar, nunca corrigir em
silêncio. Rodar os testes ao final e apresentar resultado.

## Invocação por outra skill (ex.: spec-create)

Recebe escopo + modo + localização; pula a interação inicial; aplica as 13 regras com o
mesmo rigor. Em refatoração, o checkpoint de confirmação CONTINUA obrigatório (sobrepõe
a invocação automática). Retorna: arquivos criados/modificados, resultado dos testes,
cobertura.

## Integração mgr-code

Disponível → recuperar padrões de teste e overrides já registrados do projeto; gravar
decisões de override ao final. Indisponível → prosseguir normalmente.

## Regras de comportamento

1. As 13 regras são lei; override só explícito e documentado.
2. Detectar estilo do projeto antes de impor.
3. Refatoração nunca quebra teste verde (reverter + reportar).
4. Confirmação com diff antes de modificar; nada implícito.
5. Performance importa: teste rápido roda mais vezes.
6. Idioma do projeto (nomes em inglês → inglês).
