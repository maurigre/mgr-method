# ADR-0008: Composição entre skill do método e skill plugável de mesmo nome

Date: 2026-08-25
Deciders: Mauri Reis

## Status

Accepted

## Context

O método instala suas skills em `<motor>/skills/<nome>` e uma skill plugável usa a mesma
convenção. Quando os nomes coincidem, as duas disputam a mesma pasta. A colisão entre
registries já tinha resposta (sufixo `--<registry>`, ADR-0004); a colisão entre **método e
plugin** nunca foi especificada.

O defeito apareceu na validação de aceitação do pacote `0.6.0-beta.1` já publicado: o
instalador escrevia o plugin por cima da skill do método, que desaparecia sem aviso e sem
registro, e a remoção posterior apagava a pasta inteira. Atinge justamente as duas skills
publicadas no registry oficial (`@mgr/junit-clean` e `@mgr/diagnosing-bugs`), que são skills
do núcleo. Uma trava conservadora foi aplicada de imediato — o `add` passou a recusar
instalação sobre pasta de skill do método —, mas ela fecha um caso legítimo: querer, naquele
projeto, a versão publicada no registry no lugar da que vem no pacote.

Cinco problemas foram verificados por experimento e delimitam o que a decisão precisa
resolver: o `manifest.json` do método continua afirmando que instalou a skill enquanto a pasta
contém outra coisa; nenhum comando consegue relatar a substituição; todo `install`/`update`
escreve a skill do método e em seguida a sobrescreve, deixando uma janela com o conteúdo que
o usuário não escolheu; com o registry fora do ar o `restore` falha e a pasta fica com a
versão do método enquanto o lockfile afirma que o plugin está instalado; e a decisão não
sobrevive à máquina, sendo reproduzida por acidente de ordem de escrita em vez de registro.

Hipótese descartada por experimento: supunha-se que o `mgr update` sobrescreveria o plugin
com a skill do método em silêncio. Não ocorre — `install` e `update` executam a restauração
dos plugins depois de instalar o método, então o plugin é reescrito e sobrevive.

**Reference:** Spec técnica em specs/composicao-metodo-plugin/03-spec.md.

## Decision

A disputa de pasta vira **decisão do usuário, tomada uma vez e registrada de forma durável**.

1. **Detecção por cruzamento de duas fontes.** Ao instalar, o núcleo classifica a pasta de
   destino em quatro casos: livre (instala); ocupada pelo mesmo plugin (reinstalação
   idempotente); ocupada sem manifest de plugin **e** com o nome presente em
   `manifest.json.skills[]` do método (colisão com o método — pergunta); ocupada por qualquer
   outra coisa (recusa mantida). Cruzar disco e manifesto evita tanto oferecer substituição do
   que não é do método quanto recusar sem saída o que é.
2. **A pergunta é um callback injetado próprio** (`resolveCollision`), separado do `confirm`
   de segurança do ADR-0007, com respostas `alongside` (default) e `replace`. Sem o callback e
   havendo colisão, o núcleo lança erro explícito — é o que impede a restauração não
   interativa de decidir sozinha.
3. **O registro é o campo opcional `replaces` na entrada do lockfile**, com o nome curto da
   skill do método substituída. O lockfile é o contrato do time, versionado no Git: a decisão
   viaja com o repositório e aparece no diff do code review.
4. **`lockfileVersion` permanece `1`.** O campo é aditivo; lockfiles gerados antes seguem
   válidos e versões anteriores do CLI degradam para o comportamento atual em vez de quebrar.
5. **O instalador do método passa a excluir a skill substituída, por motor.** O conjunto de
   cada alvo é filtrado a partir de um mapa calculado por função pura do núcleo e entregue
   pela borda, de modo que o instalador do método continue sem conhecer o subsistema de
   plugins (INV-3/INV-5).
6. **O manifesto local ganha `replaced` por motor e mantém `skills[]` intacto**, para que a
   skill do método volte quando o plugin for removido.
7. **Remoção avisa, não reinstala**, e o `status` passa a relatar tanto a substituição quanto
   divergências entre o que o lockfile trava e o que existe em disco, sem corrigir em silêncio.

Emenda o ADR-0006, que descreve o schema do lockfile.

## Alternatives Considered

- **Sufixar sempre (o plugin nunca ocupa a pasta do método):** nunca destrói e é consistente
  com a regra de colisão entre registries, mas impõe ao usuário duas skills de gatilhos
  quase idênticos ativas ao mesmo tempo, sem lhe dar escolha. O argumento que a sustentava —
  de que substituir levaria à perda silenciosa do plugin no `update` — foi verificado e é
  falso. Rejeitada.
- **Recusar permanentemente (manter a trava):** simples e sem estado novo, mas torna
  impossível instalar as skills do registry oficial em qualquer projeto que já tenha as
  homônimas do método, incluindo a skill de núcleo `diagnosing-bugs`, presente em toda
  instalação. Rejeitada como solução final; mantida apenas como trava temporária até esta
  decisão ser implementada.
- **Perguntar sem registrar:** é o comportamento que o defeito original expõe. A escolha
  sobrevive apenas como conteúdo da pasta, o que faz o resultado depender da ordem de escrita
  dos comandos e impede qualquer comando de relatar o estado. Rejeitada.
- **Registrar no `.mgr-core/manifest.json` em vez do lockfile:** o diretório é estado local da
  máquina e candidato natural a `.gitignore`; a decisão não viajaria para o time nem apareceria
  no code review. Rejeitada como fonte primária, adotada apenas como reflexo local.
- **Subir `lockfileVersion` para 2:** obrigaria quem já gerou lockfile na pré-release a
  regenerá-lo sem ganho, já que o campo é aditivo e a ausência dele tem significado válido.
  Rejeitada.
- **Reinstalar a skill do método automaticamente ao remover o plugin:** exigiria que o
  instalador de plugins alcançasse o construtor de skills do pacote, acoplamento que a
  fundação evitou de propósito. Rejeitada nesta versão; o usuário é avisado e recebe o comando.

## Consequences

### Positive

- O caso legítimo volta a ser possível: usar a versão do registry no lugar da do pacote, com
  escolha explícita e informada.
- A pasta passa a receber uma escrita só, do conteúdo escolhido, em vez de escrita seguida de
  sobrescrita.
- A decisão vira contrato do time: viaja no lockfile, é revisável no PR e reproduz em clone
  limpo sem nova pergunta.
- Com o registry indisponível, a falha é explícita e a pasta fica vazia, em vez de conter
  silenciosamente uma versão que o usuário não escolheu.
- `lockfile.diff()`, criado na fundação sem consumidor de produção, passa a sustentar o
  relato de divergência do `status`.

### Negative

- Mais um campo no lockfile e mais um no manifesto local, ambos opcionais.
- Um passo interativo a mais no `add`, ainda que apenas no caso de colisão.
- O instalador do método deixa de ter um único conjunto de skills para todos os motores,
  passando a admitir conjunto por motor.

### Risks and Mitigations

- **Risco:** lockfile com `replaces` apontando para skill que não está no conjunto do método
  (editado à mão, ou o conjunto mudou de linguagem/arquitetura) — **Mitigação:** estado
  inconsistente é relatado pelo `status`, nunca corrigido em silêncio; a skill do método
  permanece disponível no pacote e volta com `mgr update`.
- **Risco:** versão anterior do CLI lendo lockfile com `replaces` ignora o campo e reinstala
  a skill do método por cima do plugin — **Mitigação:** o comportamento resultante é o já
  existente antes desta decisão (o plugin é restaurado em seguida), e a pré-release é o único
  público exposto.
- **Risco:** o usuário escolher substituir sem perceber que perde as atualizações da skill do
  método — **Mitigação:** a escolha é explícita, tem "ao lado" como default, e o `status`
  passa a mostrar permanentemente qual skill está substituída e por quem.
