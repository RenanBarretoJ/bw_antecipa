# Relatório — Parcelas de NF + Boleto por Parcela + Precificação por Vencimento

**Resultado da Fase 1: `PASS`. Resultado da Fase 2: `PASS`** (Fase 3 pendente
por decisão explícita de sequenciamento — ver seção "Pendências").

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

## Pendências (próximo checkpoint, por decisão do usuário)

- Fase 3: título por parcela em CNAB, liquidação parcial por parcela,
  conciliação por parcela, sem duplicar a NF nos relatórios agregados.
