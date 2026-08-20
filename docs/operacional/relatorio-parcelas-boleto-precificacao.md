# Relatório — Parcelas de NF + Boleto por Parcela + Precificação por Vencimento

**Resultado da Fase 1: `PASS`. Resultado da Fase 2: `PASS`.
`P0_CHECKLIST_NF_COM_BOLETO_POR_PARCELA = PASS`.
`P0_REQUISITOS_DOCUMENTAIS_NF_NAO_CARREGAM = PASS`.
`P0_GATE_LOGISTICO_STATUS_UI_BOLETO = PASS`** (Fase 3 pendente por decisão
explícita de sequenciamento — ver seção "Pendências").

Ambiente: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção
(`wwsndnuvnjuabpbjwlck`) não foi tocada. Nenhum commit ou push foi
executado.

## Diagnóstico

Quatro agentes de exploração em paralelo mapearam: (1) parser XML e modelo
de dados de NF, (2) catálogo de boleto e motor de análise documental, (3)
motor de precificação/VP e seleção de NFs em operação, (4) impacto em
CNAB/liquidação/conciliação/exposição/estoque. Achados centrais:

- Parser já extraía `<dup>`, mas descartava `nDup`/`vDup` de todas as
  parcelas, usando só a data da última para o vencimento agregado da NF.
- Existe um módulo adjacente `duplicatas` (P2.0) com forma parecida, mas é
  um conceito distinto (upload manual de PDF + OCR, ativo só em política
  `DUPLICATA_MERCANTIL`, sem vínculo com nenhum fluxo downstream) — **não
  reaproveitado**, para não conflar dois conceitos diferentes.
- `'boleto'` já era um código aceito na política, mas nunca existiu no
  catálogo real (`documento_tipos`) — causa raiz confirmada do bug "Tipo
  ainda não catalogado para upload nesta fase".
- O motor de precificação (`calcularAntecipacaoEmLote`/
  `calcular_memoria_financeira_nf`) **já soma o VP de uma lista de itens**
  `{id, valor, vencimento}` — a fórmula não precisa mudar nada para a Fase
  2; só precisa receber parcelas em vez de NFs quando parcelas existirem.
- `operacoes_nfs` trava uma NF a **uma única operação**
  (`already_linked_count`). Selecionar só algumas parcelas implica que as
  não selecionadas devem poder entrar numa operação **futura e diferente**
  — isso exige relaxar essa invariante para granularidade de parcela na
  Fase 2 (confirmado com o usuário via pergunta explícita antes de
  prosseguir — ver decisão abaixo).
- Fase 3 (CNAB/matching/exposição/liquidação/estoque) está **100% chaveada
  por NF** hoje, em 5 subsistemas de produção financeira distintos, sem
  nenhuma tolerância a granularidade menor. Achado revelador:
  `rlx_posicao_logistica_resultados.nf_compartilhada_entre_posicoes` já é
  uma flag para quando o arquivo do custodiante traz múltiplas posições
  para a mesma NF — ou seja, o sistema já tropeça nesse problema na
  prática hoje, só não o modela como títulos distintos.

**Decisões confirmadas com o usuário antes de implementar** (fork
arquitetural real, sem resposta única correta no texto do ticket):
1. Cardinalidade NF↔operação passa a ser **por parcela** (parcelas não
   selecionadas continuam disponíveis para uma operação futura diferente).
2. Sequenciamento: **Fase 1 completa com checkpoint agora**; Fases 2 e 3
   ficam para as próximas rodadas, com relatório entre cada uma.

## Migrations/RPCs (Fase 1)

- `supabase/migrations/20260819210000_fase1_parcelas_nf_boleto_por_parcela.sql`:
  tabela `nota_fiscal_parcelas` + RPC `registrar_parcelas_nota_fiscal`
  (bulk insert com validação de tolerância monetária, idempotente).
- `supabase/migrations/20260819220000_fase1_boleto_por_parcela.sql`:
  coluna `cardinalidade` em `documento_tipos` + linha `boleto`; coluna
  `parcela_id` em `documento_requisito_instancias` (chave única
  `(politica_requisito_id, nota_fiscal_id, parcela_id)`, `NULLS NOT
  DISTINCT`); `instanciar_requisitos_nota` recriada com fan-out
  `por_parcela`; coluna `beneficiario_estabelecimento_id` em
  `documento_versoes` (e trigger de imutabilidade atualizado para
  considerá-la); RPCs `registrar_documento_boleto_parcela` e
  `analisar_documento_boleto_gestor`.

**Achado crítico corrigido durante a implementação**: a primeira versão de
`instanciar_requisitos_nota` nesta entrega foi escrita sobre a versão
**original** da função (`20260721132903`), não a versão real vigente em
homologação (`20260727212953`, muito mais evoluída — usa
`cedente_fundo_politicas`, exige política publicada, já resolve
`documento_tipo_id` por código, chama `reconciliar_documentos_base_nf`).
Isso quebrou a função ao aplicar (`column po.cedente_fundo_id does not
exist` — `politicas_operacionais` já havia sido desacoplada de
`cedente_fundo_id` numa migration posterior). Detectado imediatamente pelo
próprio E2E ao vivo, corrigido reaplicando o fan-out `por_parcela` sobre a
versão real e re-executado com sucesso. Isso reforça por que este ticket
exige "ler o fluxo atual antes de implementar" — a "leitura" precisa ser da
versão vigente, não da primeira definição encontrada no histórico de
migrations.

## Parser XML

`src/lib/nf-parser.ts`: `parseNFeXML` retorna `parcelas: NfParsedParcela[]`
(uma por `<dup>`, com `numero_parcela`/`data_vencimento`/`valor_nominal`).
Vencimento agregado da NF continua vindo da última `<dup>` (compatibilidade
preservada). NF sem `<dup>` não gera parcelas (comportamento legado
preservado sem inventar regra nova). Testado com os números reais do
ticket (NF-78, 4×R$27.540,00 = R$110.160,00) — ver `nf-parser.test.ts`.

## Modelo de parcelas

Ver [`parcelas-nf-modelo-financeiro.md`](parcelas-nf-modelo-financeiro.md)
para o detalhamento completo do modelo, das garantias e da decisão de não
reaproveitar `duplicatas`.

## Boleto por parcela

Catálogo corrigido (`documento_tipos.codigo='boleto'`, cardinalidade
`por_parcela`), checklist instancia 1 requisito por parcela, upload e
análise reaproveitam 100% o motor de versionamento/auditoria existente via
wrappers finos. Gestor: Ver (herdado de `baixarVersaoDocumento`,
genérico)/Aprovar/Reprovar/Solicitar ajuste — todos via
`analisar_documento_boleto_gestor`, que resolve o gap de escopo multifundo
que `analisar_documento_versao` tem (só checava `role='gestor'`).

UI: novo componente `ParcelasBoletosNota` (`src/components/documentos-v2/`),
renderizado nas telas de detalhe da NF do Cedente e do Gestor, mostrando
exatamente o formato pedido: `001 | 11/10/2026 | R$ 27.540,00 | Boleto:
Aguardando análise`. O checklist geral (`ChecklistCedente`/`ChecklistGestor`)
foi ajustado para **excluir** requisitos por-parcela (`.is('parcela_id',
null)`), evitando que apareçam ali sem rótulo de parcela.

## Seleção / Elegibilidade / Precificação (Fase 2)

Implementado nesta entrega, seguindo a decisão de cardinalidade **por
parcela** confirmada na Fase 1.

### Modelo (migrations)

- `supabase/migrations/20260819230000_fase2_selecao_parcelas_operacao.sql`:
  nova tabela aditiva `operacoes_nf_parcelas` (operacao_id, nota_fiscal_id,
  parcela_id, `UNIQUE(parcela_id)`) — `operacoes_nfs` **não foi alterada**:
  existe uma FK composta real de `nota_fiscal_entregas` para
  `operacoes_nfs(operacao_id, nota_fiscal_id)` (rastreamento logístico da NF
  inteira dentro da operação), então a granularidade de parcela foi
  resolvida com uma tabela nova em vez de quebrar essa chave. `operacoes_nfs`
  continua com 1 linha por NF tocada pela operação — para NF sem parcelas
  isso já significa "a NF inteira"; para NF com parcelas passa a significar
  "esta operação toca alguma parcela desta NF". Também adiciona
  `operacao_calculo_nfs.parcela_id` (nullable) e troca a unique constraint
  por `UNIQUE NULLS NOT DISTINCT (operacao_id, nota_fiscal_id, parcela_id)`,
  permitindo N linhas de memória de cálculo por NF (uma por parcela) sem
  quebrar o caso legado (1 linha, parcela_id null).
- `supabase/migrations/20260819240000_fase2_solicitar_aprovar_operacao_por_parcela.sql`:
  `solicitar_operacao_antecipacao_atomica` ganha `p_parcela_ids uuid[]
  DEFAULT NULL` — para NF sem parcelas o comportamento é 100% o legado
  (trava por presença em `operacoes_nfs`); para NF com parcelas a trava
  passa a ser por `nota_fiscal_parcelas.status='disponivel' FOR UPDATE`
  (mesmo padrão de lock usado para a NF inteira), com validação de que toda
  NF com parcelas no lote tenha ao menos uma selecionada. `notas_fiscais.status`
  só vira `em_antecipacao` quando nenhuma parcela `disponivel` restar —
  senão permanece `aprovada`, deixando as parcelas não selecionadas
  disponíveis para uma operação **futura e diferente** (a decisão
  arquitetural confirmada na Fase 1). `aprovar_operacao_atomica_financeiro_v1`
  passa a ter dois ramos no loop de cálculo: NFs sem parcelas (idêntico ao
  legado, 1 linha de memória por NF) e parcelas cedidas nesta operação (1
  linha de memória por parcela, usando o valor/vencimento da própria
  parcela), seguido de uma única agregação `GROUP BY nota_fiscal_id` que
  grava `notas_fiscais.valor_antecipado`/`taxa_desagio` corretamente mesmo
  quando só parte das parcelas da NF está nesta operação.
- **Achado corrigido durante a implementação**: a primeira versão de
  `aprovar_operacao_atomica_financeiro_v1` usava `nf` como nome de variável
  PL/pgSQL **e** como alias de tabela no UPDATE final
  (`UPDATE public.notas_fiscais nf ...`), causando `column reference "nf.id"
  is ambiguous` ao vivo — clássica colisão de nomes em PL/pgSQL. Corrigido
  renomeando o alias da UPDATE para `n`. Detectado e corrigido pelo próprio
  E2E ao vivo antes de fechar a entrega.

### Elegibilidade documental por parcela

- **Bug corrigido** (introduzido de forma dormente pela Fase 1, encontrado
  na pesquisa desta fase, antes de qualquer sintoma em produção):
  `carregarElegibilidadeDocumentalOperacaoEmLote`
  (`src/lib/operacoes/elegibilidade-documental.server.ts`) construía um
  `Map` de instâncias chaveado só por `${nota_fiscal_id}:${politica_requisito_id}`
  — como a Fase 1 passou a criar **várias** instâncias de
  `documento_requisito_instancias` para essa mesma chave (uma por parcela,
  para requisitos `por_parcela`), o `Map` colapsava silenciosamente para a
  última lida, avaliando a elegibilidade da NF inteira com base em só uma
  de suas parcelas, arbitrariamente. Corrigido agrupando em lista por chave
  em vez de sobrescrever, e adicionando `parcelaId` ao tipo
  `RequisitoElegibilidadeComDados`.
- `avaliarElegibilidadeDocumentalParaOperacao`
  (`src/lib/operacoes/elegibilidade-documental.ts`) ganha
  `parcelaIdsSelecionadas?: string[] | null`: um requisito `por_parcela`
  só bloqueia se a parcela dele estiver na lista selecionada; requisitos
  por NF inteira (`parcelaId: null`) sempre bloqueiam. Sem lista informada
  (ex.: a listagem antes de qualquer seleção), nenhum filtro é aplicado —
  equivalente a "todas selecionadas", consistente com o padrão de UI
  (todas as parcelas vêm marcadas por padrão).
- `solicitarAntecipacao` (`src/lib/actions/operacao.ts`) agora valida e
  agrupa as parcelas selecionadas por NF antes de chamar a elegibilidade em
  lote, garantindo exatamente a regra do ticket: "boleto obrigatório
  avaliado apenas nas parcelas selecionadas; selecionada sem boleto
  aprovado bloqueia; não selecionada sem boleto não bloqueia".

### Precificação

Sem qualquer mudança de fórmula: `calcularAntecipacaoEmLote`/
`calcular_memoria_financeira_nf` já eram agnósticos ao que o "id" de cada
item representa. `solicitarAntecipacao` agora monta os itens de cálculo
por parcela (quando a NF tem parcelas) ou por NF inteira (legado), somando
o VP de cada parcela pelo seu próprio vencimento — não mais o vencimento
agregado da NF. Confirmado ao vivo: 4 parcelas de R$ 27.540,00 com
vencimentos diferentes produzem 4 linhas de memória de cálculo com 4
vencimentos contratuais distintos (não colapsados no último).

### UI (Cedente — nova solicitação)

`nova-solicitacao-client.tsx`: NF com parcelas expande uma lista de
checkboxes (uma por parcela, todas marcadas por padrão ao marcar a NF),
com desmarcação individual — sempre mantendo ao menos uma selecionada. O
resumo da operação (valor bruto/líquido estimado) recalcula com base
apenas nas parcelas efetivamente selecionadas. `nova-solicitacao.server.ts`
busca as parcelas de todas as NFs candidatas da página em uma única query
batched (`.in('nota_fiscal_id', ids)`), sem N+1.

### Reprovação/cancelamento

`reprovarOperacao`/`cancelarOperacao` (`src/lib/actions/operacao.ts`) agora
também liberam as parcelas cedidas: revertem
`nota_fiscal_parcelas.status` para `disponivel` e **removem** (não apenas
preservam, ao contrário do legado `operacoes_nfs`) as linhas de
`operacoes_nf_parcelas` da operação — necessário porque
`operacoes_nf_parcelas` tem `UNIQUE(parcela_id)`: sem remover o vínculo, a
parcela nunca mais poderia entrar em nenhuma operação futura, violando a
própria decisão arquitetural desta fase. O rastro de auditoria da seleção
original permanece em `logs_auditoria` (evento `OPERACAO_SOLICITADA`, campo
`parcela_ids`).

## Downstream — CNAB/estoque/liquidação (Fase 3)

**Não implementado nesta entrega** — mesma decisão de checkpoint.
Diagnóstico completo (`TituloRemessa` chaveado por NF, matching/
conciliação chaveados por NF, `rlx_posicao_logistica_resultados` já sinaliza
o problema hoje) já documentado acima e pronto para orientar a próxima
rodada.

## Segurança

- Cedente só vê/registra parcelas e boletos das próprias NFs
  (`private.usuario_tem_acesso_cedente`/RLS herdada de `notas_fiscais`).
- Gestor só analisa boleto e registra parcelas de NF de Cedente vinculado
  a Fundo em que tem vínculo ativo (`private.gestor_tem_acesso_cedente`) —
  validado ao vivo (cross-fundo = DENY em ambos os fluxos).
- `analisar_documento_boleto_gestor` fecha, para o caminho de boleto
  especificamente, o gap conhecido de `analisar_documento_versao` (só
  checava papel, sem escopo de fundo) — sem alterar a RPC compartilhada
  usada por outros documentos de NF (fora de escopo, risco de regressão em
  fluxo não solicitado).
- Anon: `DENY` confirmado (leitura de `nota_fiscal_parcelas`).
- Beneficiário do boleto validado contra `cedente_estabelecimentos`
  (mesmo Cedente + status `aprovado`) — Filial pendente rejeitada ao vivo.
- Nenhum `GRANT` de escrita direta foi aberto; toda mutação passa por RPC
  `SECURITY DEFINER`.
- Fase 2: `operacoes_nf_parcelas` tem RLS espelhando exatamente o padrão de
  `nota_fiscal_parcelas` (cedente/consultor por `notas_fiscais.cedente_id`,
  gestor multifundo por `gestor_tem_acesso_cedente`) — sem `GRANT` de
  escrita para `authenticated` (só leitura; toda mutação é feita pelas RPCs
  `SECURITY DEFINER` de solicitação/reprovação/cancelamento). Validado ao
  vivo: gestor de outro fundo não enxerga linhas de operação fora do seu
  fundo.

## Testes / E2E

**Fase 1**: ver [`parcelas-nf-e2e.json`](parcelas-nf-e2e.json) — 5/5 testes
unitários do parser + 17/17 checks do E2E ao vivo em homologação (transação
revertida) + 14 testes de arquitetura.

**Fase 2**: `scripts/homologacao/fase2-selecao-elegibilidade-precificacao/e2e.mjs`
— **29/29 checks PASS** ao vivo em homologação (transação revertida, nada
ficou no banco), cobrindo exatamente a lista de testes obrigatórios da
fase:
- NF-78 (cenário real do ticket), 4 parcelas selecionadas → nominal
  R$ 110.160,00; 4 linhas de memória de cálculo (não 1), cada uma apontando
  para uma parcela distinta, com os 4 vencimentos contratuais reais (não o
  último repetido); soma agregada em `notas_fiscais.valor_antecipado`.
- Mesma NF com só 2 de 4 parcelas selecionadas → nominal R$ 55.080,00;
  exatamente 2 linhas de memória (não 4).
- Parcela já comprometida em outra operação → `DENY`.
- NF com parcelas sem informar seleção → `DENY`.
- Lote com 2 NFs de parcela onde uma fica sem nenhuma parcela selecionada
  → `DENY`.
- Parcelas não selecionadas em uma operação continuam disponíveis e são
  aceitas numa **segunda operação, futura e diferente** — a garantia
  central da decisão arquitetural desta fase.
- Simulação de rejeição (mesma lógica de `reprovarOperacao`): libera as
  parcelas e remove o vínculo em `operacoes_nf_parcelas`; as mesmas
  parcelas podem então ser selecionadas de novo numa operação seguinte sem
  violar o `UNIQUE(parcela_id)`.
- Regressão: NF sem parcelas (legado) e NF com exatamente 1 parcela
  continuam funcionando exatamente como antes.
- Segurança: gestor de outro fundo não enxerga linhas de
  `operacoes_nf_parcelas` de operação fora do seu fundo (RLS).

Mais 4 testes unitários novos em `elegibilidade-documental.test.ts`
cobrindo a regra pura de filtragem por parcela selecionada (17 testes no
arquivo, todos PASS). Suíte completa: 161 arquivos / 1153 testes passando,
1 skip de arquivo e 3 testes skip pré-existentes — nenhum teste removido.

## Qualidade

- `npx tsc --noEmit`: sem erros.
- `npx vitest run` (`npm test -- --run`): 161 arquivos / 1153 testes
  passando, 1 skip e 3 testes skip pré-existentes.
- `npm run lint`: 0 erros (6 warnings pré-existentes, não relacionados).
- `git diff --check`: sem marcadores de conflito (avisos de CRLF benignos).
- `npx next build --webpack`: build de produção concluído com sucesso.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- Varredura manual de segredos: nenhum encontrado.

## P0 — composição documental da NF com boleto por parcela

**Resultado: `PASS`.**

### Causa raiz

Diagnóstico feito lendo o estado real de homologação (não apenas o
código): existem hoje 2 NFs reais com parcelas persistidas (`nota_fiscal_parcelas`,
7 linhas no total) e ambas pertencem a políticas **com** boleto — o
fan-out de `instanciar_requisitos_nota` (Fase 1) está correto: `boleto`
só gera 1 instância por parcela quando a política realmente o exige, e
os documentos `por_nf` (`nf_xml`, `nf_danfe_pdf`, `cte`) sempre recebem
sua própria instância com `parcela_id IS NULL`, independentemente de a
NF ter parcelas. Confirmado ao vivo por query direta: as duas NFs reais
têm exatamente 1 instância de `nf_xml`/`nf_danfe_pdf`/`cte` (`parcela_id`
null) e N instâncias de `boleto` (uma por parcela) — sem nenhuma
instância `por_nf` perdida ou reatribuída à parcela errada. Isso descarta
`INSTANCE_FANOUT_REGRESSION`, `WRONG_PARCELA_ID` e
`QUERY_FILTER_REGRESSION`.

A causa raiz real tem duas partes, ambas confirmadas por leitura de
código (`src/lib/actions/parcelas-nf.ts` e as duas páginas de detalhe da
NF antes da correção):

1. **`UI_REPLACEMENT`**: `ChecklistCedente`/`ChecklistGestor` (documentos
   `por_nf`) e `ParcelasBoletosNota` (boleto por parcela) eram renderizados
   como **dois cards separados**, um abaixo do outro, nas páginas de
   detalhe da NF (`src/app/cedente/notas-fiscais/[id]/page.tsx` e o
   equivalente do gestor). O checklist de documentos normais continuava
   correto tecnicamente, mas o card de "Parcelas / Boletos" — maior, com
   uma linha por parcela repetindo vencimento/valor/status — dominava
   visualmente a tela, dando a impressão de que os documentos normais
   "desapareceram".
2. **`OUTRO` (bug real, não apenas visual)**: `listarParcelasBoletosDaNota`
   construía a lista de itens a partir de **todas as parcelas da NF**
   (`parcelasRows.map(...)`), não a partir das instâncias reais de
   requisito de boleto. Para qualquer NF com parcelas cuja política **não**
   exige boleto, a função ainda retornava N itens com status "Aguardando
   envio" — um boleto fictício, nunca exigido pela política, aparecendo
   como pendência. Isso viola diretamente a regra 2 do ticket ("política
   sem boleto → nenhum requisito deve ser criado e boleto não bloqueia") no
   nível de exibição: nada era bloqueado de fato (a elegibilidade real usa
   `documento_requisito_instancias`, que corretamente não tem nenhuma linha
   de boleto nesse caso), mas a tela mentia sobre haver uma pendência.
   Não reproduzido com os 2 NFs reais existentes (ambos têm boleto na
   política), mas confirmado por leitura direta do código e coberto por
   teste novo (`src/lib/actions/parcelas-nf.test.ts`).

### Correção

- `src/lib/actions/parcelas-nf.ts` — `listarParcelasBoletosDaNota` agora
  constrói os itens a partir de `documento_requisito_instancias` (as
  instâncias reais de boleto), não de `nota_fiscal_parcelas`. Uma NF com
  parcelas mas sem boleto na política retorna lista vazia. Adicionado
  `obrigatorio` ao retorno (usado no cabeçalho do item agrupado).
- `src/components/documentos-v2/ParcelasBoletosNota.tsx` — deixou de ser
  um `<section>` com header próprio (card independente) e passou a ser um
  `<article>` no mesmo estilo visual de `RequirementCard` (expansível,
  cabeçalho "Boleto | Obrigatório/Opcional | X/Y aprovados"), pronto para
  ser embutido como mais um item da lista de requisitos pré-cessão.
- `src/components/documentos-v2/ChecklistCedente.tsx` — o item de Boleto
  agora é renderizado **dentro** da seção "Documentos pré-cessão", logo
  após os `RequirementCard`s dos documentos `por_nf`, no mesmo `<div
  className="space-y-2">`. Como `ChecklistGestor` é um wrapper fino sobre
  este mesmo componente (`mode="gestor"`), a correção cobre os dois
  portais com uma única mudança.
- `src/app/cedente/notas-fiscais/[id]/page.tsx` e
  `src/app/gestor/notas-fiscais/[id]/page.tsx` — removida a renderização
  separada de `<ParcelasBoletosNota />` (e o import correspondente); o
  componente só é usado agora de dentro do checklist.
- A seção logística (`logisticaAntecipada`/`posCessao`/entrega) não foi
  tocada — continua separada, exatamente como pedido na regra 6.

### Comportamento resultante

- **Política sem boleto, NF com parcelas**: parcelas financeiras continuam
  existindo normalmente; nenhum item de boleto aparece no checklist (nem
  fictício); elegibilidade nunca é bloqueada por boleto.
- **Política com boleto obrigatório, NF com parcelas**: XML/DANFE/CT-e
  continuam aparecendo normalmente no mesmo card; um único item adicional
  "Boleto | Obrigatório | X/Y aprovados" aparece expansível, abrindo para
  as linhas por parcela (número, vencimento, valor, status, ações de
  envio/análise) — nada desaparece, nada duplica.
- **Política com boleto opcional**: mesmo comportamento, com o selo
  "Opcional" no cabeçalho do item; ausência não bloqueia.

### Testes

- `src/lib/actions/parcelas-nf.test.ts` (novo, 3 testes): NF com parcelas e
  política sem boleto → lista vazia (regressão do bug real corrigido); NF
  com parcelas e política com boleto → 1 item por parcela com dados
  corretos; NF sem parcelas → lista vazia sem consultar requisitos.
- `src/lib/documentos/parcelas-nf-boleto-architecture.test.ts` (3 testes
  novos): `ParcelasBoletosNota` não é mais renderizado como card
  independente nas páginas da NF; o item de Boleto é renderizado dentro do
  mesmo bloco "Documentos pré-cessão" do `ChecklistCedente`;
  `listarParcelasBoletosDaNota` constrói itens a partir das instâncias
  reais, não de todas as parcelas.
- **Regressões**: E2E Fase 1 reexecutado ao vivo em homologação — 17/17
  PASS; E2E Fase 2 reexecutado ao vivo — 29/29 PASS. Nenhuma das duas
  suítes foi alterada nem quebrou com esta correção (ambas testam a
  camada de banco/RPC, que não foi tocada neste P0 — a correção é
  inteiramente na camada de apresentação/carregamento). Suíte completa:
  162 arquivos / 1159 testes, 0 falhas, nenhum teste removido.

### Status final

`P0_CHECKLIST_NF_COM_BOLETO_POR_PARCELA = PASS`

## P0 — requisitos documentais não carregados

**Resultado: `PASS`.**

### Causa raiz confirmada

`ORDER_OF_OPERATIONS_BUG`, confirmado ao vivo em homologação (não apenas
por leitura de código): no fluxo real de upload de XML
(`src/lib/actions/nota-fiscal.ts`, `processarArquivo`), a sequência era:

1. cria a NF (`rascunho`);
2. `uploadDocumentoSeRequerido(nfId, 'nf_xml', ...)` — que chama
   `instanciarRequisitosDaNota` → RPC `instanciar_requisitos_nota` — **antes**
   de `nota_fiscal_parcelas` ter qualquer linha;
3. só então `registrar_parcelas_nota_fiscal`.

No passo 2, o fan-out do requisito `boleto` (cardinalidade `por_parcela`)
faz `JOIN public.nota_fiscal_parcelas` — como a tabela está vazia nesse
momento, **zero** instâncias de boleto são criadas, mesmo a política
exigindo boleto. Confirmado ao vivo com uma política idêntica à do print do
ticket (XML/DANFE/CT-e pré-cessão obrigatório, Comprovante de entrega
pós-cessão, Boleto pré-cessão obrigatório por parcela): a 1ª instanciação
cria XML=1/DANFE=1/CT-e=1/**Boleto=0**; depois de registrar as 4 parcelas,
o boleto continua ausente até que **alguém abra o checklist da NF** —
`carregarChecklist` (`documento-v2.ts`) chama `instanciarRequisitosDaNota`
de novo sempre que a NF não está vinculada a uma operação, o que
reconcilia e cria as 4 instâncias de boleto retroativamente, sem duplicar
XML/DANFE/CT-e.

Ou seja: XML/DANFE/CT-e (`por_nf`) **nunca estiveram de fato ausentes** —
são criados no passo 2 independente de parcelas. O requisito que realmente
fica ausente, e só se autocorrige na primeira leitura do checklist, é o
boleto. Isso expõe uma falha mais séria: leitores agregados que **nunca**
chamam `instanciarRequisitosDaNota` — como
`carregarResumoDocumentalDasNotas` (`src/lib/notas-fiscais/resumo-documental-gestor.server.ts`),
usado pelo gate de aprovação da NF pelo gestor (`aprovarNF`) — não
reconciliam nunca. Se o gestor tentasse aprovar uma NF recém-criada com
parcelas antes de qualquer abertura do checklist, o boleto simplesmente
não apareceria como pendência (nenhuma instância existe ainda), permitindo
aprovação sem o boleto ser rastreado. Esse é o cenário que mais bate com
"ao abrir/criar a NF, nenhum requisito está carregando" — o requisito
existe, mas só depois que **alguém** primeiro abre a tela do checklist.

Classificação por eliminação, confirmada ao vivo: `POLICY_RESOLUTION_FAILURE`,
`INSTANCE_FUNCTION_REGRESSION` e `QUERY_FILTER_BUG` foram descartados — a
resolução da política (`resolverPoliticaDocumentalPorContexto`) e a função
`instanciar_requisitos_nota` funcionam corretamente para o cenário exato do
print; o problema é puramente de **quando** a primeira chamada acontece.

### Correção (ponto raiz, mínima)

- `src/lib/actions/nota-fiscal.ts` (`processarArquivo`, ramo XML): a
  chamada a `registrar_parcelas_nota_fiscal` foi movida para **antes** de
  `uploadDocumentoSeRequerido('nf_xml', ...)`. Nova ordem: cria NF →
  registra parcelas → instancia/reconcilia requisitos (exatamente a ordem
  correta sugerida no ticket). Com isso, a **primeira** instanciação já
  encontra as parcelas e cria XML=1/DANFE=1/CT-e=1/Boleto=4 de uma vez —
  não depende mais de alguém abrir o checklist depois.
- **Efeito colateral identificado e corrigido**: com parcelas agora
  persistidas antes do upload do documento XML, uma falha nesse upload
  aciona `removerNotaFiscalParcial` com as parcelas já gravadas.
  `nota_fiscal_parcelas.nota_fiscal_id` é `ON DELETE RESTRICT` — remover a
  NF sem remover as parcelas primeiro violaria a FK. Corrigido adicionando
  a remoção de `nota_fiscal_parcelas` em `removerNotaFiscalParcial`, na
  posição correta (depois de `documento_requisito_instancias`, que
  referencia `parcela_id` com o mesmo tipo de FK; antes de `notas_fiscais`).
- NF sem `<dup>` (sem parcelas): comportamento inalterado — o bloco de
  registro de parcelas é pulado quando `parsed.parcelas.length === 0`.
- Nenhuma migration nova foi necessária; a correção é inteiramente na
  ordem de chamadas da Server Action.

### Segunda causa raiz (encontrada após validação do usuário) — checklist inteiro escondido

Depois da correção de ordem acima, o usuário reportou ao vivo que a NF 56
(uma das 2 NFs reais com parcelas, com XML/DANFE/CT-e e as 3 instâncias de
boleto já corretamente instanciadas — confirmado por query direta) **continuava
sem exibir o checklist**. Isso provou que a correção de ordem, embora real e
necessária, não era a causa completa.

Rastreando `resolverEstadoChecklistDocumental` (`checklist-state.ts`) até o
fim: essa função marca a **NF inteira** como `nao_instanciado` — escondendo
o card inteiro para o cedente — sempre que existe um requisito "aplicável"
sem **nenhuma** instância correspondente na lista recebida. O requisito de
boleto (cardinalidade `por_parcela`) é passado como "aplicável"
(`requisitosDaPolitica`, construído a partir de `politica_requisitos_documentais`,
sem considerar cardinalidade), mas suas instâncias reais são **deliberadamente
excluídas** da consulta usada para montar essa mesma lista de instâncias
(filtro `.is('parcela_id', null)`, decisão da Fase 1/do primeiro P0 de
checklist — o boleto tem sua própria seção). Resultado: **toda NF cuja
política exige boleto** ficava com o checklist inteiro escondido do
cedente, mesmo com XML/DANFE/CT-e e o próprio boleto 100% instanciados no
banco — confirmado ao vivo reproduzindo exatamente o `requisitosDaPolitica`
da política real da NF 56 (antes da correção continha `['nf_xml',
'nf_danfe_pdf', 'cte', 'boleto']` sem instância de boleto disponível;
depois, `['nf_xml', 'nf_danfe_pdf', 'cte']`, todos com instância).

Classificação: `QUERY_FILTER_BUG` — não no filtro em si (que está correto
para não duplicar boleto sem rótulo de parcela no checklist geral), mas na
lista de "requisitos aplicáveis" não ter sido ajustada para a mesma
exclusão.

**Correção**: `src/lib/actions/documento-v2.ts` — antes de montar
`requisitosDaPolitica`, uma nova consulta a `documento_tipos.cardinalidade`
(pelos códigos presentes na política) identifica quais códigos são
`por_parcela`; esses códigos são excluídos de `requisitosDaPolitica` nos
dois ramos de construção dessa lista (política resolvida e o *fallback* por
snapshot de instâncias). Resolução genérica por catálogo, não hardcoded
para `'boleto'` — qualquer tipo futuro `por_parcela` já fica coberto.
Nenhuma mudança em `checklist-state.ts` (função pura, comportamento correto
dado o input) nem no filtro original — o ajuste é inteiramente em qual
lista de requisitos é passada para ela.

### Backfill / NFs já afetadas

Nenhuma. As 2 NFs reais existentes em homologação com parcelas (NF 56 e
NF 78) já tinham XML/DANFE/CT-e e boleto completos (3 e 4 instâncias
respectivamente, batendo com suas parcelas) — o problema nunca foi ausência
de dado, e sim a segunda causa raiz (visibilidade do checklist). Nenhum
script de reparo/backfill foi necessário; a correção de exibição já resolve
essas NFs sem qualquer mutação de dado.

### Testes

- `scripts/homologacao/p0-requisitos-nao-carregam/e2e.mjs` — **10/10 PASS**
  ao vivo em homologação (transação revertida):
  - causa raiz reproduzida (ordem antiga: boleto=0 mesmo após registrar
    parcelas, sem reconciliação);
  - reconciliação recupera o boleto sem duplicar XML/DANFE/CT-e;
  - **Cenário 1** (ordem corrigida): 1ª instanciação já cria tudo de uma vez;
  - **Cenário 5** (reload): releituras repetidas não duplicam nada;
  - **Cenário 3**: NF sem parcelas continua funcionando (fluxo legado);
  - **Cenário 2**: política sem boleto + NF com parcelas → parcelas
    existem, boleto=0, XML/DANFE/CT-e presentes;
  - **Cenário 4**: boleto opcional gera as 4 instâncias com
    `obrigatorio=false`;
  - compensação: remoção de NF com parcelas já persistidas não viola a FK
    `ON DELETE RESTRICT` de `nota_fiscal_parcelas`.
- `src/lib/documentos/parcelas-nf-boleto-architecture.test.ts` — 4 testes
  novos no total: 2 confirmam por leitura de código que
  `registrar_parcelas_nota_fiscal` é chamado antes de
  `uploadDocumentoSeRequerido` e que `removerNotaFiscalParcial` remove
  `nota_fiscal_parcelas` antes de `notas_fiscais`; 2 confirmam que
  `requisitosDaPolitica` exclui códigos `por_parcela` (resolvidos via
  `documento_tipos.cardinalidade`, não hardcoded) nos dois ramos de
  construção da lista passada a `resolverEstadoChecklistDocumental`.
- **Verificação ao vivo contra o dado real que motivou o report**: reproduzida
  a política e as instâncias reais da NF 56 — antes da correção,
  `requisitosDaPolitica` continha `boleto` sem instância disponível
  (`nao_instanciado` garantido); depois, `boleto` é excluído e os 3
  requisitos restantes (`nf_xml`, `nf_danfe_pdf`, `cte`) todos têm
  instância — o checklist volta a renderizar para essa NF exata, sem
  qualquer mutação de dado.
- **Regressões reexecutadas ao vivo**: E2E Fase 1 (17/17 PASS), E2E Fase 2
  (29/29 PASS), E2E deste P0 (10/10 PASS). Suíte completa: 162 arquivos /
  1163 testes, 0 falhas, nenhum teste removido.

### Correção adicional (reportada na mesma validação): mensagem de pré-preenchimento incorreta em upload de XML

O mesmo teste do usuário mostrou, na tela da NF 56 (upload por XML), a
mensagem "Alguns campos foram pré-preenchidos automaticamente a partir do
PDF" — incorreta, já que o XML da NF-e é parseado com dados oficiais
(sem OCR/"chute" a revisar), diferente do fluxo real de PDF/DANFE. A
mensagem (`src/app/cedente/notas-fiscais/[id]/page.tsx`) era exibida para
qualquer rascunho com dados básicos preenchidos, sem checar a origem do
upload. Corrigido condicionando a mensagem a `!isUploadXml` (derivado da
extensão de `nf.arquivo_url`, já que não existe hoje uma coluna explícita
de origem do upload) — some para NFs vindas de XML e continua aparecendo
para PDF/manual, onde faz sentido.

### Status final

`P0_REQUISITOS_DOCUMENTAIS_NF_NAO_CARREGAM = PASS` (após as duas correções:
ordem de instanciação + visibilidade do checklist com boleto na política;
mais a correção da mensagem de pré-preenchimento incorreta em upload XML).

## P0 — gate logístico, status real e UX dos boletos

**Resultado: `PASS`.** Três problemas relacionados, corrigidos juntos.

### A. Gate logístico — submissão ≠ aprovação

**Causa raiz confirmada**: `classificarStatusLogisticoPreCessao`
(`src/lib/logistica/evidencias-logisticas.ts`) só considera evidências
**aprovadas** — correto para o rótulo de exibição ("Entrega comprovada" /
"Em trânsito") e para o gate de **aprovação** do gestor (que de fato exige
aprovado, via RPC `avaliar_gate_logistico_pre_cessao_nfs` →
`private.classificar_status_logistico_pre_cessao`, ambos inalterados). O bug:
`submeterNF` (cedente) reusava esse **mesmo** resultado
(`checklist.gateLogisticoPreCessao.status === 'INDETERMINADA'`) para
bloquear a submissão — exigindo aprovação onde deveria bastar qualquer
evidência vigente (enviada/em análise/aprovada).

**Correção**: nova função pura
`avaliarSubmissaoLogisticaPreCessao` (mesmo arquivo) — para cada família
alternativa (CT-e/DACTE OU Comprovante de Entrega), pega a versão **mais
recente por data de upload** (não por data de análise, para uma rejeição
antiga não bloquear um reenvio pendente) e permite se ela não estiver
rejeitada/cancelada/substituída. `documento-v2.ts` expõe o resultado como
`checklist.gateLogisticoPreCessao.permitidoSubmissao`, campo novo e
separado do `status` de exibição (que não foi alterado).
`submeterNF` passou a usar esse campo; mensagem atualizada para "A política
exige o envio de CT-e/DACTE ou Comprovante de Entrega antes da submissão."
Mensagem do gestor (aprovação) também ajustada para "A evidência logística
obrigatória ainda não foi aprovada." — mesma regra de negócio, mensagem só
mais direta.

### B. Boletos enviados continuam "Aguardando envio"

**Causa raiz confirmada** (`registrar_documento_upload`, SQL vigente): após
**qualquer** envio (novo ou reenvio), a função sempre grava
`documento_requisito_instancias.status = 'pendente'` — esse campo nunca
reflete "enviado, aguardando análise"; só é atualizado para `'satisfeito'`
na aprovação (`analisar_documento_versao`) ou de volta a `'pendente'` na
rejeição/ajuste. `listarParcelasBoletosDaNota` usava esse campo
diretamente como status exibido — por isso o card nunca saía de
"Aguardando envio" mesmo com o boleto enviado e em análise.
`RequirementCard`/`statusVisual` (documentos `por_nf`) já resolviam isso
corretamente lendo a versão mais recente; o boleto (por_parcela) não tinha
a mesma lógica. Classificação: `STATUS_DERIVATION_BUG`.

**Correção**: nova função `derivarStatusBoleto` (`src/lib/actions/parcelas-nf.ts`)
— estados terminais (`satisfeito`, `dispensado`, `cancelado`, `vencido`)
usam o status da instância diretamente; caso contrário deriva de
`documento_versoes.status` + `documento_analises.resultado` mais recentes:
sem versão → `pendente` (Aguardando envio); versão rejeitada ou análise
`rejeitado` → `rejeitado`; análise `requer_ajuste` → `requer_ajuste`
(distinto de rejeitado, confirmado ao vivo que a versão fica `em_analise`
nesse caso, não `rejeitado`); caso contrário → `em_analise` (Aguardando
análise). Nenhum estado novo criado no banco. `boletoStatusLabel`
(`ParcelasBoletosNota.tsx`) ganhou os rótulos `Rejeitado`/`Ajuste
solicitado`, antes ausentes.

### C. Card de Boleto compacto e recolhível

`ParcelasBoletosNota.tsx` continua **dentro** de "Documentos pré-cessão"
(sem card independente). Cabeçalho agora mostra obrigatoriedade, `X/Y
aprovados` e um status agregado (`Pendente` / `Aguardando análise` / `Com
pendências` / `Completo`, derivado — nenhum estado novo no banco). Começa
**recolhido**; abre automaticamente na primeira carga se houver parcela
rejeitada ou com ajuste solicitado. Expandido: cabeçalho de tabela
(Parcela | Vencimento | Valor | Status | Beneficiário | Documento | Ação)
no desktop; cards empilhados com rótulos no mobile, sem scroll horizontal.
Recolher/expandir passou a usar `hidden` (CSS) em vez de desmontar a
`<div>` condicionalmente — preserva a seleção de beneficiário/arquivo já
feita no formulário do cedente ao recolher e reabrir. Reaproveitado o
mesmo padrão de expand/collapse já usado por `RequirementCard`
(`ChecklistCedente.tsx`); nenhum componente `Accordion`/`Collapsible`
pronto existia no projeto para reaproveitar.

### D. Gate agregado de boleto por parcela — ponto crítico

**Causa raiz confirmada**: `avaliarElegibilidadeDocumentalDaNota`
(`src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts`), usada pelo gate
de aprovação da NF (`aprovarNF`/`aprovarNFsLote` via
`carregarResumoDocumentalDasNotas`), construía
`new Map(instancias.map(item => [item.requisitoId, item]))` — o mesmo
padrão de colapso já encontrado e corrigido duas vezes nesta sessão (Fase
2). Boleto tem uma instância por parcela, todas com o mesmo
`politica_requisito_id`: o `Map` colapsava para a **última** instância lida
(ordem arbitrária), aprovando a NF com base em só uma parcela em vez de
todas as 4.

**Correção**: agrupamento em `Map<string, Instancia[]>` (lista, não 1:1);
para requisitos com múltiplas instâncias, todas precisam estar aprovadas —
a pior satisfação entre elas representa o requisito no resumo (0/4, 1/4,
3/4 aprovados → requisito pendente → NF `DENY`; 4/4 → `ALLOW`; qualquer
rejeitada/em análise bloqueia). Requisitos `por_nf` (1 instância) reduzem
exatamente ao comportamento anterior — sem regressão. Boleto opcional
ausente não bloqueia; política sem boleto não participa (requisito nem
aparece na lista esperada) — ambos já garantidos pela lógica existente,
confirmados com testes novos.

**Segunda parte do achado**: `carregarResumoDocumentalDasNotas` só **lê**
`documento_requisito_instancias`, nunca reconcilia — o mesmo risco
registrado (mas não corrigido) no P0 anterior. Corrigido agora no ponto
transacional pedido pelo ticket: `aprovarNF` e `aprovarNFsLote` chamam
`instanciarRequisitosDaNota` **antes** de `carregarResumoDocumentalDasNotas`,
garantindo que uma NF cujo checklist nunca foi aberto tenha seus
requisitos (incluindo boleto por parcela) completos antes do gate avaliar
— eliminando o `ALLOW` silencioso para requisito obrigatório sem instância.
Confirmado ao vivo: uma NF nova, com parcelas e política de boleto, sem
nenhuma leitura de checklist prévia, tinha 0 instâncias; a chamada de
reconciliação adicionada cria as 5 esperadas (1 XML + 4 boleto) antes do
gate rodar.

### Testes

- `src/lib/logistica/evidencias-logisticas.test.ts` (9 testes novos):
  `avaliarSubmissaoLogisticaPreCessao` — DENY sem evidência, ALLOW com
  CT-e/comprovante enviado ou aprovado, DENY com rejeição sem reenvio,
  ALLOW com reenvio vigente após rejeição antiga (usa a mais recente por
  upload), DENY com cancelado/substituído, gate inativo sempre ALLOW,
  alternativa CT-e OU comprovante preservada.
- `src/lib/notas-fiscais/avaliacao-checklist-aprovacao.test.ts` (8 testes
  novos): 0/4, 1/4, 3/4 aprovados → `DENY`; 4/4 → `ALLOW`; qualquer parcela
  rejeitada bloqueia mesmo com as demais aprovadas; boleto opcional ausente
  não bloqueia; política sem boleto não participa; requisito `por_nf`
  (1 instância) sem regressão.
- `src/lib/actions/parcelas-nf.test.ts` (6 testes novos): status exibido
  reflete versão/análise real em cada estado (pendente, em análise,
  rejeitado, requer_ajuste, satisfeito, reenvio-após-rejeição usa a versão
  mais nova).
- `src/lib/documentos/parcelas-nf-boleto-architecture.test.ts` (12 testes
  novos): fiação do gate de submissão vs aprovação, ordem de reconciliação
  em `aprovarNF`/`aprovarNFsLote`, derivação de status no card, ausência do
  card independente, recolhido por padrão + auto-abertura em pendência,
  `hidden` (não desmontagem) preservando estado do formulário, colunas da
  tabela desktop + variante mobile.
- **Live E2E** — `scripts/homologacao/p0-gate-logistico-status-ui-boleto/e2e.mjs`,
  **9/9 PASS** ao vivo em homologação (transação revertida): upload real
  confirma instância `pendente` + versão `em_analise`; aprovação real vira
  `satisfeito`; rejeição real volta a `pendente` com versão `rejeitado` e
  análise `rejeitado`; reenvio real cria versão 2 mantendo a v1 no
  histórico; pedido de ajuste real confirma versão `em_analise` (não
  `rejeitado`) com análise `requer_ajuste` — distinção que valida a lógica
  de derivação; as 4 parcelas aprovadas ao final do fluxo real; e a
  reconciliação no gate de aprovação criando os 5 requisitos esperados
  para uma NF cujo checklist nunca foi aberto.
- **Regressões reexecutadas ao vivo**: E2E Fase 1 (17/17), E2E Fase 2
  (29/29), E2E do P0 de requisitos não carregados (10/10). Suíte completa:
  162 arquivos / 1198 testes, 0 falhas, nenhum teste removido.

### Segurança

Nenhuma das correções altera autorização: `submeterNF`/`aprovarNF`/
`aprovarNFsLote` continuam usando os mesmos `requireGestor`/
`requireAuthenticated`/`validarNfsNoFundoAtivo`; `instanciarRequisitosDaNota`
já fazia a validação cross-fundo/cross-cedente por si (reaproveitada, não
duplicada); nenhuma RPC nova foi criada; nenhum `GRANT` foi alterado.

### Status final

`P0_GATE_LOGISTICO_STATUS_UI_BOLETO = PASS`

## Riscos

1. **Fase 3 não implementada** — este relatório cobre as Fases 1 e 2. A
   Fase 3 toca 5 subsistemas financeiros de produção (CNAB, matching,
   liquidação, conciliação, exposição), hoje 100% chaveados por NF, e é,
   por si só, um esforço do tamanho de um ticket completo.
2. Beneficiário/pagador/valor/vencimento do boleto são garantidos **por
   construção** (derivados da parcela e da NF, sem re-digitação), não por
   confronto textual/OCR — não existe hoje um módulo de OCR de boleto
   neste sistema. Se a Gestora precisar de confronto textual real (como o
   módulo `duplicatas` faz para a Duplicata Mercantil), isso é um adicional
   de escopo, não implementado aqui.
3. `instanciar_requisitos_nota` já teve 7 redefinições ao longo do
   histórico de migrations antes desta — qualquer nova alteração futura
   nessa função precisa necessariamente ler a versão vigente em
   homologação (não a mais antiga encontrada na busca), exatamente como
   este ticket exigiu e como o erro ao vivo confirmou ser necessário.
4. **`operacoes_nfs` deixa de significar "a NF inteira" para NF com
   parcelas** — passa a significar "esta operação toca alguma parcela
   desta NF", podendo agora ter múltiplas linhas para a mesma NF (uma por
   operação parcial). Qualquer relatório/consulta futura que assuma
   implicitamente "no máximo 1 operação por NF em `operacoes_nfs`" precisa
   ser revisado antes da Fase 3 — nenhum consumidor existente hoje faz essa
   suposição (confirmado na pesquisa desta fase), mas é um ponto de atenção
   explícito para quem tocar CNAB/relatórios agregados na Fase 3.
5. `reprovarOperacao`/`cancelarOperacao` continuam sendo Server Actions em
   TypeScript puro (não RPC atômica) — a liberação de parcelas
   (`liberarParcelasDaOperacao`) roda como passos sequenciais no mesmo
   padrão pré-existente de `notas_fiscais.status`, sem uma transação
   atômica de banco cobrindo tudo. Este é o mesmo comportamento/risco já
   aceito no fluxo legado (não introduzido por esta fase); não foi
   ampliado nem corrigido aqui, por ser mudança de escopo maior (migrar
   essas duas Server Actions para RPC) não pedida no ticket.
6. **`carregarResumoDocumentalDasNotas` (`resumo-documental-gestor.server.ts`),
   usado pelo gate de aprovação da NF (`aprovarNF`), nunca chama
   `instanciarRequisitosDaNota`** — só lê o que já existe em
   `documento_requisito_instancias`. Com a ordem corrigida neste P0, isso
   deixa de causar boleto ausente em NFs novas (a 1ª instanciação, disparada
   pelo próprio upload do XML, já cria tudo). Mas continua sendo um ponto
   estruturalmente frágil: qualquer novo requisito `por_parcela`/`por_nf`
   cuja instanciação dependa de uma condição não satisfeita no momento do
   upload ficaria igualmente invisível para este gate agregado, sem nenhum
   sinal de erro. Não corrigido aqui (mudaria uma função central usada só
   para agregação em lote, fora do escopo "menor correção possível" deste
   ticket) — registrado para avaliação futura.
7. **Elegibilidade agregada do boleto no gate de aprovação
   (`avaliarElegibilidadeDocumentalDaNota`, via `carregarResumoDocumentalDasNotas`)
   não foi auditada quanto ao mesmo bug de colapso de `Map` corrigido na
   Fase 2** (`elegibilidade-documental.server.ts`). Como essa função agrega
   múltiplas instâncias de boleto (uma por parcela) sob o mesmo
   `politica_requisito_id`, sem filtrar por `parcela_id`, é um candidato a
   ter o mesmo tipo de bug se a lógica de matching requisito↔instância
   assumir 1:1. Não confirmado nem corrigido nesta entrega — fora do
   diagnóstico pedido pelo ticket (que era sobre o checklist de
   apresentação, não o gate de aprovação); fica como risco documentado.

## Pendências (próximo checkpoint, por decisão do usuário)

- Fase 3: título por parcela em CNAB, liquidação parcial por parcela,
  conciliação por parcela, sem duplicar a NF nos relatórios agregados.
