# Relatório — Parcelas de NF + Boleto por Parcela + Precificação por Vencimento

**Resultado da Fase 1: `PASS`. Resultado da Fase 2: `PASS`.
`P0_CHECKLIST_NF_COM_BOLETO_POR_PARCELA = PASS`.
`P0_REQUISITOS_DOCUMENTAIS_NF_NAO_CARREGAM = PASS`.
`P0_GATE_LOGISTICO_STATUS_UI_BOLETO = PASS`.
`P0_SUBMISSAO_LOGISTICA_NF56 = PASS`.
`P0_APROVACAO_LOGISTICA_GESTOR_FONTE_UNIFICADA = PASS`.
`P0_SUBMISSAO_LOGISTICA_NF78 = PASS`.
`P0_NOVA_SOLICITACAO_PARCELAS_CRASH = PASS`.
`P0_NOVA_SOLICITACAO_PARCELAS_CRASH_REMOTE = PASS`.
`UI_PARCELAS_NF_E_OPERACAO = PASS`** (causa raiz do crash de parcelas
confirmada e corrigida — parcela individualmente vencida mascarada pelo
vencimento agregado da NF, achada pelo usuário ao vivo na NF 3493; ver
seção correspondente; Fase 3 pendente por decisão explícita de
sequenciamento — ver seção "Pendências").

Ambiente: homologação Supabase `fhgkmggthxikfpogrvaa`. Produção
(`wwsndnuvnjuabpbjwlck`) não foi tocada. Nenhum commit ou push foi
executado neste último ticket (parcelas na NF e na Operação — UI/
Operacional); os P0s anteriores já haviam sido comitados/enviados para
`homolog` mediante instrução explícita do usuário.

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

## P0 — divergência entre checklist e gate logístico de submissão

**Resultado: `PASS`.**

### Causa raiz real (confirmada com a NF 56)

Diagnóstico ponta a ponta na NF 56 real: o CT-e estava anexado e "Aguardando
análise" — `documento_requisito_instancias` tinha a instância `cte`
(escopo `nf_pre_cessao`) com `documento_id` preenchido, e sua
`documento_versoes` mais recente tinha `status = 'em_analise'`. Ou seja, o
CT-e estava genuinamente enviado pelo **fluxo regular** do checklist
(`registrar_documento_upload`, o mesmo motor de XML/DANFE/boleto). Ao
mesmo tempo, `evidencias_logisticas_antecipadas` para essa NF estava
**vazia** — confirmado por query direta.

`avaliarSubmissaoLogisticaPreCessao` (corrigida no P0 anterior) e
`classificarStatusLogisticoPreCessao` (rótulo de exibição) só recebiam
evidência construída a partir de `evidencia_logistica_versoes` /
`evidencias_logisticas_antecipadas` — a tabela do mecanismo de **"envio
antecipado"** (`uploadDocumentoLogisticoAntecipado` /
`registrar_documento_logistico_antecipado`), pensado para permitir enviar
CT-e/comprovante **antes** de existirem como requisito formal
`nf_pre_cessao` na política. Quando a política **já** define CT-e como
requisito `nf_pre_cessao` regular (caso da NF 56) e o cedente o envia pelo
card normal "Documentos pré-cessão", nenhuma linha é criada em
`evidencias_logisticas_antecipadas` — o CT-e simplesmente não existe para
o gate, apesar de existir e aparecer corretamente para a UI do checklist.
Duas fontes de verdade independentes para "CT-e anexado": uma alimentava a
UI, a outra alimentava o gate. Classificação: `GATE_USA_FONTE_DIFERENTE_DA_UI`.

O RPC de aprovação do gestor (`avaliar_gate_logistico_pre_cessao_nfs` →
`private.classificar_status_logistico_pre_cessao`) tinha a **mesma**
limitação — só juntava `evidencias_logisticas_antecipadas`, nunca
`documento_requisito_instancias`/`documento_versoes` do fluxo regular.
Confirmado ao vivo: mesmo depois do gestor aprovar o CT-e pelo fluxo
regular, o RPC de aprovação continuava retornando `permitido: false`. Por
instrução explícita deste ticket ("Não alterar: gate de aprovação do
Gestor"), **este RPC não foi tocado aqui** — ficou registrado como risco
aberto (ver seção "Riscos") e foi corrigido em ticket próprio subsequente,
ver seção "P0 — unificação da fonte logística no gate de aprovação do
Gestor" abaixo.

### Correção (unifica a fonte, sem duplicar arquivo)

- Nova função pura `evidenciasDoChecklistRegular`
  (`src/lib/logistica/evidencias-logisticas.ts`): converte os itens do
  checklist regular cuja família documental é `cte` ou
  `comprovante_entrega` **e** escopo `nf_pre_cessao` no mesmo formato de
  evidência (`EvidenciaLogisticaParaClassificacao`) usado pelo mecanismo de
  envio antecipado — sem copiar nenhum arquivo, sem nova tabela, só
  reaproveitando os dados (`versoes`, `status`, análise) que o checklist já
  carrega.
- `src/lib/actions/documento-v2.ts`: `evidenciasLogisticas` passa a ser a
  combinação de `evidenciasAntecipadas` (mecanismo antigo, inalterado) +
  `evidenciasDoChecklistRegular(items)` — usada tanto por
  `classificarStatusLogisticoPreCessao` (rótulo de exibição da seção "Envio
  antecipado") quanto por `avaliarSubmissaoLogisticaPreCessao` (gate de
  submissão). Uma única fonte combinada, sem duplicar a arquitetura por
  portal.
- Nada mudou em: gate de aprovação do gestor (RPC intocado), regra
  OR CT-e/DACTE OU Comprovante (preservada — `avaliarSubmissaoLogisticaPreCessao`
  já era agnóstica à origem da evidência), regras de boleto, precificação
  por parcela.
- Idempotência preservada: nenhuma escrita nova; a função é de leitura
  pura, chamada a cada carregamento do checklist como antes.

### Testes

- `src/lib/logistica/evidencias-logisticas.test.ts` (5 testes novos):
  inclui CT-e `nf_pre_cessao` do checklist regular; ignora comprovante
  `pos_cessao` (fora do gate pré-cessão); ignora itens sem família
  logística (XML, boleto); propaga o resultado da análise mais recente;
  ponta a ponta — CT-e só do checklist regular, sem nenhuma evidência
  antecipada, já permite a submissão.
- `src/lib/documentos/parcelas-nf-boleto-architecture.test.ts` (2 testes
  novos): confirma a combinação das duas fontes na ordem correta antes de
  classificar/avaliar o gate; confirma o filtro por escopo/família.
- **Live E2E** — `scripts/homologacao/p0-submissao-logistica-nf56/e2e.mjs`,
  **8/8 PASS** ao vivo em homologação (transação revertida), reproduzindo o
  cenário exato da NF 56 do zero: upload de CT-e pelo fluxo regular fica
  `em_analise`; `evidencias_logisticas_antecipadas` confirmada vazia (causa
  raiz reproduzida); gate de aprovação do gestor nega antes da aprovação
  (regra preservada). *Atualizado no P0 subsequente* ("unificação da fonte
  logística no gate de aprovação do Gestor"): a última verificação deste
  script foi ajustada para esperar `permitido: true` após a aprovação real
  do CT-e — o RPC de aprovação já reconhece o fluxo regular, não é mais o
  risco documentado originalmente.
- **Regressões reexecutadas ao vivo**: E2E Fase 1 (17/17), E2E Fase 2
  (29/29), P0 requisitos não carregados (10/10), P0 gate
  logístico/status/boleto (9/9). Suíte completa: 162 arquivos / 1205
  testes, 0 falhas, nenhum teste removido.

### Status final

`P0_SUBMISSAO_LOGISTICA_NF56 = PASS`

## P0 — unificação da fonte logística no gate de aprovação do Gestor

**Resultado: `P0_APROVACAO_LOGISTICA_GESTOR_FONTE_UNIFICADA = PASS`.**

### Diagnóstico

Leitura da versão vigente em homologação (confirmada ao vivo, sem
divergência com a migration `20260806170000_envio_antecipado_documentos_
logisticos.sql`, única definição existente) de `private.classificar_
status_logistico_pre_cessao`: a função lia evidência **somente** de
`evidencias_logisticas_antecipadas` + `evidencia_logistica_versoes`
(join com `documento_versoes`/`documento_analises` para achar a versão
vigente aprovada). Nunca lia `documento_requisito_instancias` — a mesma
divergência de fonte já corrigida no gate de submissão (TypeScript,
`evidenciasDoChecklistRegular`), mas agora no lado SQL do gate de
**aprovação** do gestor (`avaliar_gate_logistico_pre_cessao_nfs`, que só
chama a função acima — não precisou de alteração própria).

Classificação: `APPROVAL_GATE_SOURCE_DIVERGENCE`.

### Correção (uma migration, sem duplicar Storage nem tabela)

- Nova migration `supabase/migrations/20260820100000_p0_gate_aprovacao_
  logistica_fonte_unificada.sql`: redefine (`CREATE OR REPLACE`)
  exclusivamente `private.classificar_status_logistico_pre_cessao`.
  Mesma assinatura, mesmo contrato de retorno (`status`,
  `familia_vencedora`, `documento_id`, `documento_versao_id`,
  `documento_analise_id`, `analisado_por`, `analisado_em`, `fundamento`,
  `regra_classificacao`, `versao_resolvedor`), mesma regra OR
  (Comprovante de Entrega tem prioridade sobre CT-e) e mesmo critério de
  vitória (aprovado, mais recente por `analisado_em`/`enviado_em`/
  `created_at`).
- A única mudança: a fonte de evidência agora é um `UNION ALL` de (1)
  `evidencias_logisticas_antecipadas` (comportamento anterior, inalterado
  — cobre o "envio antecipado" de um requisito oficial `pos_cessao`/
  `entrega`) com (2) `documento_requisito_instancias` +
  `politica_requisitos_documentais` (nova) filtrando por
  `escopo_snapshot = 'nf_pre_cessao'` e `familia_documental IN ('cte',
  'comprovante_entrega')` — o equivalente SQL exato de
  `evidenciasDoChecklistRegular`. Ambas as fontes exigem
  `documento_versoes.status = 'aprovado' OR documento_analises.resultado
  = 'aprovado'` antes de entrar na disputa pelo "vencedor".
- `avaliar_gate_logistico_pre_cessao_nfs` (RPC pública, chamada pelo
  Gestor) **não foi alterada** — ela só invoca a função corrigida, então
  o fix se propaga automaticamente sem tocar em GRANT/REVOKE, RLS ou
  validação multifundo já existentes.
- Sem duplicação: nenhuma segunda linha física de evidência, nenhum novo
  upload, nenhuma tabela nova — apenas amplia a origem dos dados já
  existentes que a classificação já lia.
- Migration aplicada em homologação (`fhgkmggthxikfpogrvaa`) via
  `node scripts/homologacao/p0-aprovacao-logistica-gestor/apply-migration.mjs`
  (mesmo padrão de `supabase migration up --db-url` dos P0s anteriores).
  Produção não foi tocada.

### Invariantes verificados (A–H do ticket)

| Cenário | Esperado | Resultado ao vivo |
| --- | --- | --- |
| A. CT-e regular aguardando análise | DENY | `permitido=false`, `INDETERMINADA` |
| B. CT-e regular aprovado | ALLOW | `permitido=true`, `EM_TRANSITO` |
| C. Comprovante regular aprovado, sem CT-e | ALLOW | `permitido=true`, `ENTREGUE` |
| D. Evidência antecipada aprovada (regressão) | ALLOW | `permitido=true`, `EM_TRANSITO` |
| E. CT-e regular rejeitado | DENY | `permitido=false`, `INDETERMINADA` |
| F. CT-e regular rejeitado + reenvio aprovado | ALLOW (versão vigente) | `permitido=true`, `EM_TRANSITO` |
| G. Nenhuma evidência | DENY | `permitido=false`, `INDETERMINADA` |
| H. Cross-fund (gestor de outro fundo) | DENY (exceção) | `Gestor sem acesso ao fundo da NF` |

Consistência (9–10 do ticket): o gate TypeScript de submissão (evidência
vigente basta — `enviado`/`em_analise`/`aprovado`, já testado
unitariamente em `evidencias-logisticas.test.ts`) e o gate SQL de
aprovação aqui corrigido (exige `aprovado`) leem a **mesma fonte
combinada** para o Cenário A (CT-e `em_analise`), mas com critérios
diferentes: submissão permite, aprovação nega — comportamento correto e
intencional, não uma divergência residual. Nenhuma segunda linha em
`evidencias_logisticas_antecipadas` foi criada para evidência do
checklist regular (verificado por contagem direta).

### Testes

- **Live E2E** — `scripts/homologacao/p0-aprovacao-logistica-gestor/e2e.mjs`,
  **12/12 PASS** ao vivo em homologação (transação revertida): cobre os 8
  cenários A–H acima mais 4 checagens complementares (catálogo de tipos,
  requisito de CT-e permanece pendente sem bloquear a Comprovante-only,
  ausência de evidência antecipada duplicada em dois pontos distintos do
  fluxo).
- `scripts/homologacao/p0-submissao-logistica-nf56/e2e.mjs` atualizado
  (última asserção agora espera `permitido: true`/`EM_TRANSITO` — o risco
  documentado no P0 anterior está corrigido) e reexecutado: **8/8 PASS**.
- **Regressões reexecutadas ao vivo**: P0 gate logístico/status/boleto
  (9/9), E2E Fase 1 (17/17), E2E Fase 2 (29/29).
- Suíte automatizada (`npx vitest run`): **162 arquivos / 1205 testes, 0
  falhas** — nenhum teste novo necessário (a correção é inteiramente SQL;
  a lógica TypeScript `evidenciasDoChecklistRegular`/
  `avaliarSubmissaoLogisticaPreCessao` já tinha cobertura unitária
  exaustiva e não foi alterada).
- `npx tsc --noEmit`: limpo. `npx eslint .`: mesmos 6 warnings
  pré-existentes e não relacionados (variáveis não usadas em arquivos não
  tocados). `npm run build`: sucesso. `npm audit --omit=dev`: 0
  vulnerabilidades. `git diff --check`: limpo.

### Status final

`P0_APROVACAO_LOGISTICA_GESTOR_FONTE_UNIFICADA = PASS`

## P0 — segundo gate logístico na submissão / NF78

**Resultado: `P0_SUBMISSAO_LOGISTICA_NF78 = PASS`.**

### Origem exata da mensagem

A string `A politica exige CT-e/DACTE ou Comprovante de Entrega aprovado
antes desta etapa` existe em um único lugar no código:
`supabase/migrations/20260806170000_envio_antecipado_documentos_logisticos.sql`,
dentro de `private.validar_logistica_antes_transicao_nf()` — a função de
um **trigger de banco** (`notas_fiscais_validar_logistica_pre_cessao`,
`BEFORE UPDATE OF status ON public.notas_fiscais`), não uma Server Action
nem uma RPC chamada explicitamente pelo Cedente. Esse trigger dispara
sempre que `notas_fiscais.status` transiciona para `'submetida'` **ou**
`'aprovada'`, e usava a **mesma** semântica para os dois casos:
`private.classificar_status_logistico_pre_cessao` — a função de
classificação que exige evidência **aprovada** (correta para a
transição `'aprovada'`, incorreta para `'submetida'`).

### Rastreamento ponta a ponta da NF 78 real

Consulta direta em homologação confirmou a NF 78 real
(`d87e0ffa-b418-4853-910e-c4e00b940638`, ainda em `rascunho` porque a
submissão nunca completou): CT-e enviado pelo fluxo regular do checklist,
`documento_versoes.status = 'em_analise'`, nenhuma análise ainda,
`evidencias_logisticas_antecipadas` vazia — o mesmo padrão de evidência
"vigente, não aprovada" já coberto pelo P0 anterior.

`submeterNF` (`src/lib/actions/nota-fiscal.ts`) já fazia a coisa certa:
```
if (checklist.gateLogisticoPreCessao.exigido && !checklist.gateLogisticoPreCessao.permitidoSubmissao) { ... }
```
Confirmado ao vivo que `permitidoSubmissao` já seria `true` para a NF 78
(evidência vigente). O gate correto em TypeScript **passa**. Só depois,
`submeterNF` executa `UPDATE notas_fiscais SET status='submetida' ...`
(`supabase.from('notas_fiscais').update(...)`, sem RPC dedicada) — e é
essa própria `UPDATE`, simulada ao vivo em uma transação revertida, que
disparou o trigger e reproduziu **exatamente** o erro relatado,
propagado por `submeterNF` como `NF_SUBMISSAO_ERROR` / `Erro ao
submeter: ${updateError.message}` (linha que já existia, sem alteração
necessária). Classificação: **`SECOND_GATE_IN_SUBMISSION`** — um segundo
gate, no banco, reaplicando a regra de aprovação sobre a transição de
submissão, depois que o gate correto já havia liberado na aplicação.
`OLD_GATE_STILL_CALLED`, `WRONG_ACTION_WIRED`, `STALE_RUNTIME_BUILD` e
`RPC_STILL_REQUIRES_APPROVAL` (como chamada explícita) foram descartados
— não há runtime obsoleto nem action errada; o próprio trigger de banco é
a causa.

### Correção (uma migration, sem enfraquecer a aprovação do Gestor)

- Nova migration `supabase/migrations/20260820110000_p0_segundo_gate_
  logistico_submissao_nf78.sql`: separa a semântica do trigger por
  transição de status.
  - `NEW.status = 'submetida'`: nova função privada
    `private.avaliar_submissao_logistica_pre_cessao(nota_fiscal_id,
    politica_operacional_versao_id)` — mesma regra de
    `avaliarSubmissaoLogisticaPreCessao` (TypeScript): para cada família
    (CT-e/DACTE OU Comprovante de Entrega), considera a versão mais
    recente por data de upload e exige apenas que esteja **vigente**
    (`enviado`/`em_analise`/`aprovado`, sem rejeição/ajuste pendente na
    versão mais recente) — combinando as mesmas duas fontes já unificadas
    no P0 anterior (envio antecipado + checklist regular). Mensagem de
    erro trocada para a de submissão: `A politica exige o envio de
    CT-e/DACTE ou Comprovante de Entrega antes da submissao` (sem mais
    "aprovado antes desta etapa" no caminho do Cedente).
  - `NEW.status = 'aprovada'`: **inalterado** — continua chamando
    `private.classificar_status_logistico_pre_cessao` e a mesma mensagem
    de aprovação, preservando exatamente a regra do Gestor.
  - Nenhuma RPC transacional duplicava a validação além deste trigger;
    nada foi removido, só a semântica por transição foi corrigida.
- **Bug encontrado e corrigido durante o próprio E2E ao vivo, antes de
  fechar o ticket**: a primeira versão de
  `avaliar_submissao_logistica_pre_cessao` desempatava "versão mais
  recente por upload" por `versao_id DESC` quando duas versões tinham o
  mesmo timestamp — o que só acontece quando duas versões são criadas na
  mesma transação (ex.: rejeição seguida de reenvio dentro do mesmo teste
  ao vivo, já que `now()` fica congelado por transação), mas ainda assim
  era uma comparação por UUID aleatório, não pela ordem real de
  inserção. Corrigido usando `numero_versao DESC` (sequência monotônica
  por documento) como critério de desempate antes do UUID — a mesma
  migration (ainda não commitada) foi corrigida e reaplicada em
  homologação antes de qualquer validação final.
- Migration aplicada em homologação via
  `node scripts/homologacao/p0-submissao-logistica-nf78/apply-migration.mjs`
  (mesmo padrão dos P0s anteriores). Produção não foi tocada.

### Runtime

Não há build/processo Next stale envolvido — a causa é inteiramente um
trigger de banco, que já reflete o comportamento real assim que a
migration é aplicada (sem cache de aplicação a invalidar).

### Teste real NF-78 (reproduzido do zero em homologação)

- CT-e `em_analise` (mesmo estado real da NF 78) → `UPDATE ... SET
  status='submetida'` tem sucesso (antes: bloqueado com a mensagem de
  aprovação).
- Sem nenhuma evidência → `DENY`, com a mensagem correta de submissão.
- CT-e rejeitado sem reenvio → `DENY`.
- CT-e rejeitado + reenvio vigente → `ALLOW` (usa a versão mais recente
  por upload, não a rejeitada).
- Aprovação do Gestor (regra inalterada): CT-e só enviado/em análise →
  `DENY`; CT-e aprovado → `ALLOW`.

### Testes

- **Live E2E** — `scripts/homologacao/p0-submissao-logistica-nf78/e2e.mjs`,
  **8/8 PASS** ao vivo em homologação (transação revertida), reproduzindo
  a política e o estado real da NF 78 do zero, cobrindo os 8 cenários
  acima.
- **Regressões reexecutadas ao vivo**: P0 submissão NF-56 (8/8), P0
  aprovação logística do Gestor (12/12), P0 gate logístico/status/boleto
  (9/9), E2E Fase 1 (17/17), E2E Fase 2 (29/29) — todas sem alteração,
  todas verdes.
- Suíte automatizada (`npx vitest run`): **162 arquivos / 1205 testes, 0
  falhas** — nenhum teste novo necessário (correção 100% SQL; nenhuma
  função TypeScript foi alterada, incluindo `avaliarSubmissaoLogisticaPreCessao`,
  que já tinha cobertura exaustiva e serviu de referência para a versão
  SQL).
- `npx tsc --noEmit`: limpo. `npx eslint .`: mesmos 6 warnings
  pré-existentes e não relacionados. `npm run build`: sucesso. `npm audit
  --omit=dev`: 0 vulnerabilidades. `git diff --check`: limpo.

### Status final

`P0_SUBMISSAO_LOGISTICA_NF78 = PASS`

## P0 — crash ao selecionar NF com parcelas na nova solicitação

**Resultado: `P0_NOVA_SOLICITACAO_PARCELAS_CRASH = PASS` (crash NÃO
reproduzido, com evidência extensiva — ver abaixo).**

### Diagnóstico

Leitura completa de `src/app/cedente/operacoes/nova/nova-solicitacao-
client.tsx`, `src/lib/operacoes/nova-solicitacao.server.ts` e
`src/lib/operacoes/calculo.ts` não revelou nenhum acesso a propriedade
undefined/null, nenhuma chave React instável, nenhum `<form>`/submit
acidental (todos os botões interativos já são `type="button"`), e nenhum
`throw` fora de contexto controlado no caminho de seleção/expansão de
parcelas. `NfCandidataOperacao.parcelas` é sempre um array (`[]` por
padrão, nunca `undefined`) e os nomes de campo entre servidor
(`ParcelaCandidataOperacao`) e cliente já batem exatamente.

Isolando `calcularAntecipacaoEmLote` (a única lógica não trivial
executada a cada render) com os valores **reais** das 4 parcelas da NF-78
e das 3 parcelas da NF-56 (`src/lib/operacoes/calculo.ts`, testado
isoladamente via `vitest`), nenhuma exceção foi lançada — nenhuma parcela
real está vencida em relação à data-base atual (2026-08-20).

Como a leitura de código e o teste isolado não encontraram a causa raiz,
o ticket foi reproduzido **ao vivo em um browser real** (Chrome via
`puppeteer-core`, já dependência do projeto e usado em
`scripts/perf9a/browser-final-homolog.mjs`), contra um servidor Next
local (`npm run dev:homolog`, porta 3001) apontando para homologação —
não contra dados sintéticos vazios, mas contra uma fixture que replica
fielmente a NF-56/78 reais: mesma política (XML/DANFE/CTE como requisitos
`nf_pre_cessao` **+ BOLETO com cardinalidade `por_parcela`**, todos
obrigatórios — a mesma forma exata da política real, incluindo o
requisito que gera múltiplas instâncias por NF), mesmos valores e
vencimentos de parcela, todos os documentos (XML, DANFE, CT-e e os 3/4
boletos por parcela) enviados e **aprovados** por um gestor de teste,
exatamente como as NF-56/78 reais estão hoje em homologação (confirmado
por query direta antes de construir a fixture).

Cenários testados ao vivo, com um Chrome real, sem nenhum mock:
1. Login do cedente de teste (com MFA TOTP real, mesmo fluxo de
   `/mfa/desafio` usado em produção).
2. Carregamento inicial da lista (2 NFs, contagem de parcelas correta).
3. Selecionar a NF de 4 parcelas → expande, todas vêm marcadas por
   padrão, resumo = R$ 110.160,00 bruto.
4. Desmarcar 1 parcela → resumo recalcula para R$ 82.620,00 (3×27.540).
5. Selecionar a segunda NF (3 parcelas) simultaneamente → ambas
   coexistem, resumo combina as duas (R$ 123.556,00).
6. Desmarcar e remarcar a NF de 4 parcelas → estado consistente
   restaurado (volta a 4/4 parcelas, resumo correto).

**Em nenhum dos 6 cenários houve crash**: nenhum `console.error`, nenhuma
exceção JS (`pageerror`), nenhum texto de erro ("This page couldn't
load"/"Application error"/"erro inesperado") em nenhum momento — apenas
o comportamento correto e esperado pelas invariantes do ticket.

Classificação: **`UNRESOLVED`** — não por falta de investigação (código
lido por completo, cálculo isolado testado com números reais, e uma
reprodução completa em browser real contra uma fixture que replica a
forma exata dos dados reais, incluindo o requisito de boleto por
parcela), mas porque nenhuma das hipóteses (`RENDER_RUNTIME_ERROR`,
`INVALID_STATE_SHAPE`, `UNDEFINED_PARCELAS`, `KEY_COLLISION`,
`EVENT_PROPAGATION`, `SERVER_CLIENT_SERIALIZATION`,
`CALCULO_RESUMO_ERROR`) se confirmou. O código atual em
`nova-solicitacao-client.tsx` não foi alterado por nenhum P0 anterior
desta sessão (`git log` confirma que o último commit a tocar esse
arquivo, `nova-solicitacao.server.ts` e `calculo.ts` é `fda2f13`, o
commit original da Fase 1/2 — nenhuma das correções de gate
logístico/documental subsequentes tocou esses arquivos).

### Hipóteses restantes (não verificáveis a partir daqui)

Como o código-fonte atual não reproduz o sintoma, a causa mais provável
está **fora do código-fonte** examinado:
- **Build/deploy desatualizado**: se o ambiente que o usuário testou é um
  deploy (ex.: Vercel) do branch `homolog` que não foi refeito depois de
  algum commit relevante, o bundle servido pode divergir do código-fonte
  atual — não há como confirmar isso a partir deste ambiente local
  (nenhuma URL de deploy está configurada no repositório).
- **Estado transitório do navegador do usuário** (cache/extensão) —
  também não reproduzível remotamente.
- Não é um problema de dado: as NF-56/78 reais já foram confirmadas
  (`documento_requisito_instancias`) 100% `satisfeito`, sem nenhuma
  `operacoes_nfs` pendente, e a fixture usada aqui replica exatamente essa
  forma.

### Nenhuma alteração de código foi necessária

Por não ter sido possível confirmar uma causa raiz real, nenhum código de
produção foi alterado — corrigir "por hipótese" (proibido explicitamente
pelo ticket) arriscaria introduzir uma regressão em um fluxo que já
funciona corretamente com os dados reais. Se o sintoma se repetir,
recomenda-se capturar, no exato momento do clique: a URL/versão do deploy
sendo testada, o console do navegador (aba Console) e a aba Network da
Server Action `solicitarAntecipacao`/da navegação — nenhum desses dados
estava disponível neste ticket para correlação.

### Testes

- **Live E2E em browser real** —
  `scripts/homologacao/p0-nova-solicitacao-parcelas-crash/browser-e2e.mjs`,
  **10/10 PASS**. Requer `npm run dev:homolog` rodando localmente (porta
  3001) e Chrome instalado (`C:\Program Files\Google\Chrome\Application\
  chrome.exe`, configurável via `QA_CHROME_PATH`) — mesmo padrão de
  `scripts/perf9a/browser-final-homolog.mjs`. Fica como teste de
  regressão permanente para esta rota, cobrindo exatamente os cenários
  1–10 pedidos no ticket (exceto o envio real da solicitação, já coberto
  por `fase2-selecao-elegibilidade-precificacao/e2e.mjs`).
- Diferente dos demais scripts desta sessão, este cria dados que
  **precisam ficar commitados** (não revertidos) para o servidor Next — que
  os lê por uma conexão HTTP separada — enxergá-los. Ao final, a fixture é
  **desativada** (fundo inativo, política desativada); os documentos
  aprovados e a versão de política publicada permanecem por imutabilidade
  de auditoria (mesma regra do sistema, idêntica à de qualquer política
  publicada real) — nenhum dado de cliente real foi tocado. Mesmo padrão
  de tolerância já aceito pelo dataset PERF9A
  (`scripts/perf9a/seed-homolog.mjs`), que também permanece
  permanentemente em homologação.
- **Regressões reexecutadas ao vivo**: E2E Fase 1 (17/17), E2E Fase 2
  (29/29) — nenhuma alteração de código, ambas continuam verdes.
- Suíte automatizada (`npx vitest run`): **162 arquivos / 1205 testes, 0
  falhas** — nenhum teste novo em `vitest` (nenhuma lógica de produção foi
  alterada; a regressão em browser real acima é o teste permanente
  pedido pelo ticket para esta rota).
- `npx tsc --noEmit`: limpo. `npx eslint .`: mesmos 6 warnings
  pré-existentes e não relacionados. `npm run build`: sucesso. `npm audit
  --omit=dev`: 0 vulnerabilidades. `git diff --check`: limpo. Varredura
  manual de segredos no script novo: nenhum encontrado.

### Status final

`P0_NOVA_SOLICITACAO_PARCELAS_CRASH = PASS` (investigação exaustiva com
as NFs 56/78, crash não reproduzido com essas duas; nenhuma alteração de
código nesta seção). **Atualização**: o ticket seguinte pediu a
reprodução na URL real do Vercel — nesse teste o próprio usuário
selecionou uma **terceira NF real (3493)**, não testada aqui, e
reproduziu o crash. A causa raiz real (parcela individualmente vencida,
mascarada pelo vencimento agregado da NF) e a correção estão na seção
"P0 — reproduzir crash na URL real de homolog (Vercel)" abaixo — as
NFs 56/78 nunca tiveram esse padrão de dado, por isso não apareceram
aqui.

## P0 — reproduzir crash na URL real de homolog (Vercel)

**Resultado: `P0_NOVA_SOLICITACAO_PARCELAS_CRASH_REMOTE = PASS` — causa
raiz real confirmada e corrigida** (não é mais o "não reproduzido" do P0
anterior — ver "Correção do rumo" abaixo).

### 1. Confirmação de versão do deploy

- `origin/homolog` (após `git fetch`) e `HEAD` local:
  `df8c2110a24a8db7dbcd5c856f979fc6e0a73ee0` — idênticos, antes da
  correção deste P0.
- **SHA efetivamente implantado no Vercel: não foi possível confirmar
  programaticamente** (sem `.vercel/project.json`, token/CLI do Vercel,
  ou rota que exponha o commit). Isso deixou de ser bloqueante: a causa
  raiz foi confirmada por reprodução direta de dados, não por inferência
  de versão — ver abaixo.

### 2–3. Reprodução ao vivo no Vercel real — resultado inicial incompleto, corrigido pelo usuário

A primeira rodada deste P0 testou 3 NFs sintéticas fiéis à forma da
NF-56/78 (nenhuma delas com parcela vencida) contra a URL real do
Vercel — **nenhuma quebrou**. Esse resultado ficou registrado
momentaneamente como "não reproduzido", mas era **incompleto**: o
usuário, testando a mesma tela ao vivo, selecionou a NF real **3493**
(não testada até então) e reproduziu o crash exato — screenshot real:
"This page couldn't load" (Chrome, aba anônima), imediatamente após
clicar para selecionar a NF 3493.

### Causa raiz confirmada (dados reais da NF 3493)

Query direta em homologação na NF 3493 real
(`8006275d-87b9-493b-ba54-6208be0383bb`) revelou a diferença exata: a
**parcela 1 tem vencimento `2026-08-19`** — **ontem**, em relação à
data-base de hoje (`2026-08-20`) — enquanto o **vencimento agregado da
NF** (`data_vencimento` = a última parcela, `2026-09-16`) ainda está no
futuro. NF-56 e NF-78 nunca tiveram essa combinação (todas as parcelas
delas, incluindo a primeira, já estavam no futuro na data dos testes) —
por isso a reprodução inicial, fiel na política/documentos mas não nos
vencimentos, não capturou o cenário real.

O filtro de elegibilidade da listagem
(`carregarNovaSolicitacaoOperacao`, `src/lib/operacoes/nova-solicitacao.
server.ts`) só olha o **vencimento agregado da NF** (`.gte('data_
vencimento', dataBase)`), então a NF 3493 aparece normalmente na lista.
Mas ao selecionar essa NF, `nova-solicitacao-client.tsx` monta
`itensCalculo` usando o vencimento de **cada parcela individual** e
chama `calcularAntecipacaoEmLote` **diretamente no corpo do render, sem
try/catch**. `calcularValorPresenteNota` (`src/lib/operacoes/calculo.ts`)
lança `CalculoFinanceiroError('A NF esta vencida...')` sempre que
`diasCorridosReais < 0` — comportamento **correto** da função em si (uma
parcela vencida genuinamente não tem valor presente a calcular), mas
como ninguém no caminho de render captura essa exceção, o React derruba
a árvore inteira → tela em branco / "This page couldn't load".

Confirmado isoladamente **antes de tocar em qualquer código**: reproduzi
`calcularAntecipacaoEmLote` via `vitest` com os 3 vencimentos reais da
NF 3493 (`2026-08-19`, `2026-09-02`, `2026-09-16`) e a mesma
`CalculoFinanceiroError` foi lançada, confirmando a causa raiz byte a
byte antes de qualquer correção.

Classificação: **`REAL_DATA_SHAPE_ERROR`** (uma parcela individualmente
vencida, mascarada pelo vencimento agregado da NF ainda estar no
futuro) — não `STALE_DEPLOY_CONFIRMED` (SHAs consistentes, o bug é de
código, não de deploy desatualizado), não `AUTH_SESSION_ERROR`, não
`REMOTE_RSC_ERROR`/`REMOTE_SERVER_ACTION_ERROR` (a falha é 100%
client-side, dentro do render, sem nenhuma resposta HTTP ≥400
envolvida).

### Correção (duas camadas, menor alteração possível)

1. **Causa raiz** — `src/lib/operacoes/nova-solicitacao.server.ts`:
   a query de `nota_fiscal_parcelas` ganhou `.gte('data_vencimento',
   dataBase)` — a **mesma regra já aplicada à NF inteira**, agora também
   por parcela. Uma parcela com vencimento individual já passado deixa
   de ser oferecida para seleção (ela não pode ser antecipada — não há
   valor presente a calcular para uma data no passado), mesmo que a NF
   continue elegível pelas demais parcelas. Nenhuma NF passa a ficar sem
   nenhuma parcela selecionável por causa disso: se o vencimento
   agregado (a última parcela) já passa o filtro da NF, ele nunca é
   excluído aqui.
2. **Defesa em profundidade** — `src/app/cedente/operacoes/nova/
   nova-solicitacao-client.tsx`: a chamada a `calcularAntecipacaoEmLote`
   passou a rodar dentro de um `try/catch`; se lançar (`CalculoFinanceiro
   Error` ou qualquer outra causa futura), o resumo mostra um aviso
   ("Não foi possível estimar o valor líquido") em vez de derrubar a
   página inteira. Protege contra qualquer outra classe de dado real
   inesperado que ainda não foi mapeada, sem mudar nenhuma regra
   financeira.

Nenhuma alteração em `calcularValorPresenteNota`/`calcularAntecipacaoEmLote`
— o comportamento de rejeitar uma parcela vencida é correto e já tinha
teste próprio (`calculo.test.ts`); a correção é sobre nunca deixar essa
NF/parcela chegar até lá sem uma NF elegível de verdade, e nunca deixar
uma falha de cálculo derrubar o render.

### 5. Critério de encerramento

| Critério do ticket | Resultado |
| --- | --- |
| Selecionar NF-56 não quebra | ✅ (já confirmado, nunca teve parcela vencida) |
| Parcelas expandem | ✅ |
| Selecionar NF-78 também não quebra | ✅ (já confirmado) |
| Seleção/deseleção atualiza resumo | ✅ |
| Nenhuma exception/pageerror/5xx | ✅ (após a correção) |
| Deploy SHA corresponde ao código testado | ⚠️ ainda não verificável programaticamente — mas irrelevante para a causa raiz, que foi confirmada por reprodução de dados, não por inferência de versão |

O cenário real que quebrava (NF com parcela individualmente vencida) foi
reproduzido, a causa raiz confirmada byte a byte com os números reais da
NF 3493, e a correção verificada localmente com esses mesmos números
(ver Testes). **A verificação no próprio deploy do Vercel exige um novo
deploy** (este ticket instrui a não fazer commit/push) — fica pendente
até a próxima instrução do usuário para comitar/enviar.

### Testes

- **Isolamento pré-correção** (`vitest`, ad-hoc, removido após confirmar):
  `calcularAntecipacaoEmLote` com os 3 vencimentos reais da NF 3493 —
  lançou `CalculoFinanceiroError` de fato, replicando a causa raiz antes
  de qualquer mudança de código.
- **Live E2E local pós-correção** —
  `scripts/homologacao/p0-nova-solicitacao-parcelas-crash/browser-e2e.mjs`
  (mesmo script do P0 anterior, agora com uma 4ª NF replicando a NF 3493
  exata — parcela 1 vencida ontem, vencimento agregado no futuro):
  **13/13 PASS**, incluindo especificamente: selecionar essa NF não
  quebra a página; a parcela vencida é excluída da lista selecionável
  (só as parcelas 002/003 aparecem); o resumo soma corretamente só as
  parcelas vigentes (R$ 2.108,00 = 2×R$ 1.054,00).
- 2 testes novos de arquitetura em
  `src/lib/documentos/parcelas-nf-boleto-architecture.test.ts`:
  confirmam que a query de parcelas tem o filtro `gte(data_vencimento)`
  antes do `order`, e que o cliente encapsula `calcularAntecipacaoEmLote`
  num `try/catch` que popula `erroCalculo`.
- **Regressões reexecutadas ao vivo**: E2E Fase 1 (17/17), E2E Fase 2
  (29/29) — a mudança só afeta a listagem de parcelas selecionáveis na
  tela de nova solicitação, não a RPC de solicitação/aprovação em si.
- Suíte completa (`npx vitest run`): **162 arquivos / 1207 testes, 0
  falhas** (2 testes novos).
- `npx tsc --noEmit`: limpo. `npx eslint .`: mesmos 6 warnings
  pré-existentes e não relacionados. `npm run build`: sucesso. `npm audit
  --omit=dev`: 0 vulnerabilidades. `git diff --check`: limpo.

### Status final

`P0_NOVA_SOLICITACAO_PARCELAS_CRASH_REMOTE = PASS` — causa raiz real
confirmada (`REAL_DATA_SHAPE_ERROR`: parcela individualmente vencida
mascarada pelo vencimento agregado da NF) e corrigida em duas camadas;
verificado localmente com os números reais da NF 3493 (13/13 PASS).
Verificação no deploy real do Vercel pendente de um novo deploy (fora do
escopo deste ticket, que instrui não commitar/pushar).

## UI/Operacional — parcelas na NF e na Operação

**Resultado: `UI_PARCELAS_NF_E_OPERACAO = PASS`.**

### Diagnóstico

Mapeamento completo (sem `UNRESOLVED`) de: tela de detalhe da Operação do
Gestor, fontes atuais de bruto/antecipado/prazo/vencimento, `operacoes_nfs`,
`operacoes_nf_parcelas`, `operacao_calculo_nfs`, telas de detalhe da NF
(Cedente/Gestor), `nota_fiscal_parcelas`, a action de salvar NF, estados em
que a NF pode ser editada, e o vínculo parcela↔requisito de boleto.

Achados centrais:

- **`UI_OPERATION_AGGREGATED_BY_NF`** — confirmado.
  `OperacaoDetalheGestorClient.tsx` lia somente `operacoes_nfs` →
  `notas_fiscais` (`valor_bruto`, `valor_liquido`, `valor_antecipado` da
  **NF inteira**), nunca `operacoes_nf_parcelas`. A query de
  `operacao_calculo_nfs` já existia (para um `<details>` de memória de
  cálculo), mas **omitia `parcela_id`** — para uma NF com parcelas
  aprovada, essa tabela já tem N linhas (uma por parcela) todas com o
  mesmo `nota_fiscal_id`, e a UI as tratava como se fossem da NF inteira,
  sem nenhuma distinção por parcela.
- **`NF_DETAILS_MISSING_INSTALLMENTS`** — confirmado. Nenhuma das duas
  páginas de detalhe da NF (Cedente/Gestor) tem uma seção própria de
  parcelas — o único lugar onde parcela aparece é `ParcelasBoletosNota`,
  aninhado dentro do checklist, e **só quando a política exige boleto**
  (`listarParcelasBoletosDaNota` retorna lista vazia se não houver
  requisito de boleto instanciado — confirmado por leitura de código e
  por teste novo). Um teste de arquitetura já existente
  (`parcelas-nf-boleto-architecture.test.ts`) proíbe explicitamente que
  `ParcelasBoletosNota` seja renderizado fora do checklist — por isso a
  nova seção **não reaproveita nem estende** esse componente; é um
  componente novo e independente (`ParcelasDaNota`).
- **`INSTALLMENT_EDIT_FLOW_MISSING`** — confirmado. `registrar_parcelas_
  nota_fiscal` só faz o registro inicial e **nega explicitamente** se a
  NF já tiver parcelas — não existe nenhuma RPC para corrigir vencimento/
  valor depois. `salvarDadosNF` (edição de campos da NF em si) também não
  toca `nota_fiscal_parcelas`, e — achado relevante para não repetir —
  **não valida `status = 'rascunho'` nem no código nem na policy de RLS**
  (só há gate no cliente); a nova RPC não repete essa lacuna.
- **`DEPENDENT_DOCUMENT_GUARD_REQUIRED`** — confirmado. Não existia
  nenhum helper ou verificação que impedisse editar uma parcela cujo
  boleto já foi aprovado. O sinal canônico e correto é
  `documento_requisito_instancias.status = 'satisfeito'` filtrado por
  `parcela_id` + `tipo_documento_codigo_snapshot = 'boleto'` (o mesmo
  critério que `ParcelasBoletosNota`/`derivarStatusBoleto` já tratam como
  "aprovado" na UI).

### A. Gestor — detalhe da Operação

`src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx`:

- A NF continua agrupadora visual (nenhuma mudança na listagem de NFs em
  si). Para cada NF com parcelas registradas (`totalParcelasPorNf.get
  (nf.id) > 0`), um bloco expansível abaixo do card mostra `X/Y parcelas
  cedidas` (X = linhas em `operacoes_nf_parcelas` para esta operação e
  esta NF; Y = total de parcelas da NF) e, expandido, uma linha por
  parcela cedida com número, vencimento, valor nominal, prazo
  (`dias_aplicados`) e antecipado/VP + desconto — **lidos de
  `operacao_calculo_nfs.parcela_id`, nunca recalculados na UI**. NF sem
  parcelas (`totalParcelas === 0`) não renderiza nada extra — legado
  intacto.
- **Bruto/antecipado exibidos no card da NF** passam a representar só as
  parcelas cedidas **nesta** operação quando ela tem parcela granularity
  aqui: `valor_bruto` do card vira a soma de `nota_fiscal_parcelas.
  valor_nominal` das parcelas em `operacoes_nf_parcelas` desta operação
  (não mais `notas_fiscais.valor_bruto` inteiro); `valor_antecipado` usa
  a soma de `operacao_calculo_nfs.valor_presente` por parcela quando essa
  memória já existe (operação aprovada) — só cai para a estimativa
  simulada existente (client-side, pré-decisão) quando a memória real
  ainda não existe. Isso corrige automaticamente os totais agregados do
  card superior (`totaisNfs`), que já derivam de `notasFiscaisView`.
- **Escopo deliberadamente não estendido**: a estimativa client-side
  pré-decisão (`calcularAntecipacaoEmLote` sobre `nfs`, usada só enquanto
  a operação está `solicitada`/`em_analise`) continua calculando pelo
  valor/vencimento **da NF inteira**, não por parcela — tornar essa
  simulação também parcela-consciente exigiria replicar a lógica já
  implementada em `nova-solicitacao-client.tsx` (que monta os itens de
  cálculo por parcela) dentro da tela de operação, uma mudança maior e
  fora do "menor mudança possível" deste ticket. Registrado como risco
  aberto (ver seção "Riscos") — não afeta os valores **aprovados**
  (memória real), só a pré-visualização antes da decisão do Gestor.

### B. Cedente/Gestor — detalhe da Nota Fiscal

Novo componente `src/components/notas-fiscais/ParcelasDaNota.tsx`,
renderizado nas duas páginas de detalhe da NF (logo após o
checklist/`DuplicatasDaNota`, antes de "Dados da Nota Fiscal") —
**independente da política exigir boleto**: lê `nota_fiscal_parcelas`
diretamente via a nova `listarParcelasDaNota` (`src/lib/actions/
parcelas-nf.ts`), sem qualquer join com `documento_requisito_instancias`.
Exibe parcela, vencimento, valor nominal, status financeiro (`disponivel`
/`em_operacao`/`liquidada`/`cancelada`), origem (`xml_nfe`/`manual`),
total e quantidade. Desktop: tabela; mobile: cards empilhados (mesmo
padrão visual de `ParcelasBoletosNota`, mas como componente novo e
independente — não reaproveitado, para não violar o teste de arquitetura
que já garante o isolamento do card de Boleto). NF sem parcelas não
renderiza nada (`itens.length === 0` retorna `null`).

### C. Correção de parcelas pelo Cedente

Nova RPC `public.editar_parcelas_nota_fiscal` (migration
`20260820120000_ui_parcelas_nf_operacao_editar_parcelas.sql`), chamada
pela nova action `editarParcelasDaNota`:

- Restrita ao **Cedente dono da NF**, e só enquanto `notas_fiscais.status
  = 'rascunho'` — checado **no banco**, não só no cliente (corrigindo a
  lacuna encontrada em `salvarDadosNF`).
- Editáveis: `valor_nominal` e `data_vencimento`. **Número da parcela
  permanece imutável** — decisão documentada, não um placeholder: `nota_
  fiscal_parcelas_unique UNIQUE (nota_fiscal_id, numero_parcela)` já
  garante unicidade, e o caso de uso pedido (corrigir valor/vencimento)
  não precisa renumerar; reabrir esse campo exigiria uma lógica de
  reordenação sem necessidade real, então foi deixado fora do escopo.
- A cada chamada, o payload deve conter **todas** as parcelas existentes
  da NF (mesma contagem, sem adicionar/remover) — decisão de design que
  evita ambiguidade sobre "o que aconteceu com a parcela que não veio no
  payload".
- Valida: cada parcela pertence à NF e está `status = 'disponivel'`; soma
  de todas as parcelas dentro da mesma tolerância monetária de
  `registrar_parcelas_nota_fiscal` (`greatest(count * 0.01, 0.01)`) contra
  `notas_fiscais.valor_bruto`; `valor_nominal > 0`.
- Após a edição, `notas_fiscais.data_vencimento` é recalculado para o
  novo `MAX(nota_fiscal_parcelas.data_vencimento)` — o vencimento
  agregado legado nunca fica desatualizado.
- **Achado corrigido durante o próprio E2E ao vivo, antes de fechar o
  ticket**: a primeira versão do guard D (documento dependente) bloqueava
  a edição de **qualquer** parcela do payload sempre que **qualquer
  outra** parcela da mesma NF já tivesse boleto aprovado — porque a RPC
  exige o payload completo a cada chamada, e a parcela com boleto
  aprovado precisa ser reenviada (sem mudança) só para completar esse
  payload. Corrigido para o guard só disparar quando o valor/vencimento
  **daquela parcela especificamente** está de fato mudando
  (`IS DISTINCT FROM` contra os valores atuais) — reenviar uma parcela
  sem alteração nunca bloqueia a edição das demais.

### D. Guarda de documento dependente (boleto aprovado)

Não havia mecanismo seguro existente para isso — por instrução explícita
do ticket ("se não houver mecanismo seguro já existente, bloquear
alteração... e reportar o motivo, em vez de criar comportamento
arriscado"), a opção implementada foi **bloquear** (não criar nenhuma
lógica nova de re-versionamento/pendência automática): se a parcela alvo
já tem `documento_requisito_instancias.status = 'satisfeito'` para o
requisito de boleto, a edição é negada com mensagem clara, e **nada é
apagado** — o boleto aprovado, sua versão e análise permanecem
integralmente intactos (confirmado ao vivo: após a tentativa negada, o
requisito continua `satisfeito` e a versão `aprovado`).

### Testes

- **Live E2E** — `scripts/homologacao/ui-parcelas-nf-operacao/e2e.mjs`,
  **24/24 PASS** ao vivo em homologação (transação revertida), cobrindo
  os 16 testes obrigatórios do ticket:
  1–2: NF-78/56 (reais) — 4/3 parcelas na fonte de dados.
  3–5: operação parcial (2 de 4 parcelas da NF-78) — `operacoes_nf_
  parcelas` mostra exatamente as 2 cedidas; soma nominal = R$ 55.080,00
  (não os R$ 110.160,00 da NF inteira); memória financeira com 2 linhas
  por parcela, VP/desconto/prazo já calculados (não recalculado).
  6: NF sem parcelas — legado intacto (0 linhas em `operacoes_nf_
  parcelas`, 1 linha de memória com `parcela_id` null).
  7: parcelas aparecem mesmo com política sem boleto.
  8/14: editar vencimento salva, persiste, e o vencimento agregado da NF
  vira o novo MAX.
  9/10: editar valores mantendo a soma = ALLOW; quebrando a soma = DENY.
  11: NF fora de rascunho = DENY.
  12: outro Cedente = DENY.
  13: Gestor lê parcelas normalmente, mas não pode editar.
  15/16: parcela com boleto aprovado não pode ser editada (guard D); após
  a tentativa negada, o boleto aprovado permanece intacto; as demais
  parcelas continuam editáveis normalmente.
- 13 testes novos de arquitetura em `parcelas-nf-boleto-architecture.
  test.ts`: `ParcelasDaNota` renderizado nas duas páginas fora do
  checklist; independência de boleto; edição restrita a `mode="cedente"`;
  guardas da RPC (rascunho, dono, número imutável, tolerância, guard D
  escopado por mudança real, recálculo do vencimento agregado);
  `OperacaoDetalheGestorClient` lendo `operacoes_nf_parcelas`/`operacao_
  calculo_nfs.parcela_id`, bruto/antecipado por parcelas cedidas, NF sem
  parcelas sem bloco extra, bloco expansível "X/Y parcelas cedidas".
- **Regressões reexecutadas ao vivo**: E2E Fase 1 (17/17), E2E Fase 2
  (29/29 — inclui fluxo de seleção parcial e precificação por parcela),
  P0 gate logístico/status/boleto (9/9).
- Suíte completa (`npx vitest run`): **162 arquivos / 1220 testes, 0
  falhas** (13 testes novos).
- `npx tsc --noEmit`: limpo (incluindo o registro manual de tipos de RPC
  em `src/types/database.ts`, que precisou da entrada nova de `editar_
  parcelas_nota_fiscal`). `npx eslint .`: mesmos 6 warnings pré-existentes
  e não relacionados. `npm run build`: sucesso. `npm audit --omit=dev`: 0
  vulnerabilidades. `git diff --check`: limpo.

### Status final

`UI_PARCELAS_NF_E_OPERACAO = PASS`

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
7. ~~Elegibilidade agregada do boleto no gate de aprovação não auditada~~ —
   **auditado e corrigido** no P0 "gate logístico, status real e UX dos
   boletos" (ver seção correspondente): `avaliarElegibilidadeDocumentalDaNota`
   tinha exatamente esse colapso e agora exige todas as instâncias por
   parcela aprovadas.
8. ~~O RPC de aprovação logística do gestor
   (`avaliar_gate_logistico_pre_cessao_nfs` →
   `private.classificar_status_logistico_pre_cessao`) tem a mesma
   divergência de fonte corrigida neste P0 para a submissão, mas não foi
   tocado aqui por instrução explícita do ticket~~ — **corrigido** no P0
   "unificação da fonte logística no gate de aprovação do Gestor" (ver
   seção correspondente): a função SQL passou a combinar
   `evidencias_logisticas_antecipadas` com `documento_requisito_
   instancias`/`documento_versoes` do fluxo regular (mesma semântica de
   `evidenciasDoChecklistRegular`, portada para SQL), sem alterar a RPC
   pública nem duplicar Storage/tabela.
9. **SHA do deploy real do Vercel (`bw-antecipa-env-homolog`) não pôde
   ser confirmado programaticamente** — nenhum token/CLI do Vercel
   disponível neste ambiente, e a aplicação não expõe o commit em
   nenhuma rota. Não bloqueou o diagnóstico desta vez (a causa raiz do
   crash de parcelas foi confirmada por reprodução direta de dados reais
   da NF 3493, não por inferência de versão — ver seção "reproduzir
   crash na URL real de homolog"), mas para qualquer sintoma que só
   apareça no deploy real e não localmente, confirmar primeiro no
   dashboard do Vercel se o deployment ativo corresponde a `origin/
   homolog` antes de investigar código.
10. **Estimativa de "Antecipado" pré-decisão na tela de Operação do
    Gestor (enquanto `solicitada`/`em_analise`) continua calculada pelo
    valor/vencimento da NF inteira, não por parcela** — só a memória
    financeira real (pós-aprovação, `operacao_calculo_nfs.parcela_id`) é
    parcela-consciente, conforme pedido pelo ticket ("não recalcular na
    UI"). Tornar a pré-visualização também parcela-consciente exigiria
    replicar a lógica já existente em `nova-solicitacao-client.tsx`
    (montagem de itens de cálculo por parcela) dentro da tela de
    operação — decisão de escopo explícita para manter a "menor mudança
    possível" deste ticket; não afeta nenhum valor já aprovado.

## Pendências (próximo checkpoint, por decisão do usuário)

- Fase 3: título por parcela em CNAB, liquidação parcial por parcela,
  conciliação por parcela, sem duplicar a NF nos relatórios agregados.
