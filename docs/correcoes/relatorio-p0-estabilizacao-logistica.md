# P0 — Estabilização logística

Data da execução: 07/08/2026
Ambiente validado: homologação (`fhgkmggthxikfpogrvaa`)
Fundo de referência: `QA CENTRAL LOGISTICA FIDC`
Parecer atual: **correção pronta e validada por rollback; aplicação permanente e smoke visual QA pendentes**.

## 1. Causa do `entrega_em_validacao`

A função `public.avaliar_conclusao_entrega(uuid)` possui uma transição legítima para
`aguardando_validacao` quando existe ao menos um documento aprovado, mas ainda há
requisitos obrigatórios pendentes. Nessa transição ela registra o evento
`entrega_em_validacao`.

O defeito era contratual: migrations posteriores reconstruíram
`eventos_entrega_tipo_check` sem manter esse valor. Assim, a função e o schema
passaram a discordar e o `INSERT` do evento era rejeitado.

Fontes:

- função: `supabase/migrations/20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql`;
- último CHECK anterior: `supabase/migrations/20260731171219_postergacao_upload_canhoto.sql`;
- catálogo TypeScript anterior: `src/lib/types/domain.ts`.

## 2. Função e constraint envolvidas

- Função: `public.avaliar_conclusao_entrega(uuid)`.
- Registro de evento: `public.registrar_evento_entrega(...)`.
- Tabela: `public.eventos_entrega`.
- Constraint: `eventos_entrega_tipo_check`.
- Estado físico resultante: `nota_fiscal_entregas.status_entrega = 'aguardando_validacao'`.

A inspeção read-only de homolog confirmou que a função instalada emitia
`entrega_em_validacao`, enquanto o CHECK instalado aceitava somente os 16 eventos
anteriores.

## 3. Decisão canônica

Foi adotado o cenário em que `entrega_em_validacao` é um evento de domínio válido.
Ele representa a passagem da entrega para análise parcial e não é equivalente a
`documento_entrega_enviado`, que registra o upload documental.

Não foram alterados:

- estados físicos da entrega;
- critérios de conclusão;
- função `avaliar_conclusao_entrega`;
- classificação da Central;
- RLS, grants, triggers ou dados operacionais.

## 4. Correção implementada

1. Inclusão de `entrega_em_validacao` no CHECK de `eventos_entrega`.
2. Inclusão do mesmo evento em `DELIVERY_EVENT_TYPES`.
3. Teste de contrato garantindo que função, schema e domínio tipado permaneçam
   sincronizados.

Arquivos:

- `supabase/migrations/20260807132532_corrigir_evento_entrega_em_validacao.sql`;
- `src/lib/types/domain.ts`;
- `src/lib/logistica/evento-entrega-em-validacao.migration.test.ts`.

## 5. Migration e estado do banco

A migration é incremental, transacional e reaplicável: remove somente a constraint
homônima e a recria com os 16 valores anteriores mais `entrega_em_validacao`.

### Validação com rollback

Executada com sucesso em homologação:

1. `BEGIN`;
2. aplicação do corpo da migration;
3. preparação reversível de uma entrega sintética QA com documento aprovado e
   requisito obrigatório pendente;
4. execução da função real `avaliar_conclusao_entrega`;
5. confirmação do retorno `aguardando_validacao`;
6. confirmação do evento `entrega_em_validacao`;
7. `ROLLBACK` integral.

### Aplicação permanente

**Não aplicada.** O `supabase db push --dry-run` acionou o gate de segurança porque
o histórico remoto não reconhece diversas migrations locais antigas e exigiria
`--include-all`. Em conformidade com o escopo, a execução foi interrompida e não foi
feito `migration repair`.

Consequência: o banco de homologação continua com o CHECK anterior até aplicação
controlada da migration por um processo que preserve corretamente o histórico.

## 6. Testes automatizados

| Validação | Resultado |
|---|---:|
| Teste focado P0 + logística/Central | 22/22 aprovados |
| Suíte completa Vitest | 659/659 aprovados em 87 arquivos |
| `npx tsc --noEmit` | aprovado |
| `npm run lint` | aprovado, 0 erros e 6 avisos preexistentes |
| `git diff --check` | aprovado; apenas aviso de normalização LF/CRLF |
| `npx next build --webpack` | aprovado |

O build manteve avisos preexistentes do Handlebars sobre `require.extensions`.
Nenhum aviso foi introduzido pelo P0.

## 7. Massa QA e visão geral

O comando `npm run homolog:logistica:verify -- --expected-project-ref
fhgkmggthxikfpogrvaa` foi aprovado.

| Indicador | Observado |
|---|---:|
| NFs acompanhadas | 60 |
| Valor total | R$ 7.003.767,64 |
| Entregues | 22 |
| Em trânsito | 18 |
| Indeterminadas | 20 |
| Pendências vencidas | 9 |
| Aguardando análise | 28 |
| Rejeitados | 14 |
| Envios antecipados | 29 (48,3%) |
| CT-es | 33 |
| CT-es compartilhados | 4 |
| Comprovantes/canhotos | 26 |
| Postergações | 7 |

O verify também aprovou as invariantes de vínculo, ausência de duplicidades,
memórias logísticas e todas as seis views rápidas com resultado não vazio.

## 8. Divergência 20/20/20

A referência original era aproximadamente 20 entregues, 20 em trânsito e 20
indeterminadas. Foram observadas duas evoluções legítimas do estado atual:

- `QA000028`: esperado originalmente `EM_TRANSITO`, observado `ENTREGUE`;
- `QA000055`: esperado originalmente `EM_TRANSITO`, observado `ENTREGUE`.

Ambas possuem comprovante de entrega aprovado e análise aprovada. Portanto, a
classificação atual em `ENTREGUE` é coerente com a regra vigente. A mesma evolução
explica a redução aproximada das pendências vencidas de 11 para 9. A divergência é
drift da massa após processamento, não erro de agregação da Central.

## 9. Notas Fiscais, filtros e paginação

Os testes de domínio da Central cobriram parsing, normalização, busca, filtros
combinados e classificação. A suíte completa também validou paginação compartilhada.

O smoke visual específico do QA não foi concluído: um gestor sintético AAL2 foi
vinculado temporariamente ao fundo, mas o contexto server-side permaneceu no fundo
principal apesar do cookie QA. O vínculo temporário foi removido em `finally` e uma
consulta posterior confirmou zero registros residuais.

Assim, página 1/2, page sizes 20/50/100 e as amostras `QA000001`, `QA000006` e
`QA000012` permanecem **pendentes de confirmação visual autenticada** após a
aplicação da migration e com um gestor já autorizado ao fundo QA.

## 10. Pendências e postergações

- Views de atenção, aguardando gestor e demais recortes retornaram registros no
  verify read-only.
- Foram encontradas 9 pendências vencidas e 7 postergações.
- Testes de domínio e migration de postergação passaram.
- Nenhuma nova postergação foi criada durante o P0.
- O vínculo temporário usado na tentativa de smoke não alterou NFs, entregas,
  requisitos ou postergações.

## 11. CT-es compartilhados

O verify confirmou:

- 33 CT-es no fundo QA;
- 4 CT-es lógicos compartilhados;
- inexistência de vínculo cruzado entre fundo, cedente e `cedente_fundo`;
- inexistência de duplicidades nas memórias e requisitos;
- agregação N:N sem duplicar o valor por NF, conforme testes de domínio da Central.

## 12. Status histórico e momento documental

As memórias de criação e aprovação permaneceram íntegras e sem duplicidades. O
verify encontrou cenários de criação `ENTREGUE`, `EM_TRANSITO` e `INDETERMINADA`,
além de envios antecipados e pós-cessão para CT-e e comprovante.

O cálculo continua usando `primeiro_upload_em`; a migration P0 não toca nessa regra
nem recalcula snapshots históricos.

## 13. CSV

O contrato estático confirmou que a rota reutiliza `carregarCentralLogistica` sem
paginação e não define UUIDs internos como colunas. No smoke autenticado inicial, a
rota respondeu CSV sem UUID, hash, token ou path de Storage; porém o fundo QA não
estava ativo nessa tentativa.

Portanto, as exportações específicas do QA sem filtro e por Entregue, Em trânsito,
cedente e envio antecipado ainda requerem repetição visual/autenticada.

## 14. Troca de fundo e segurança

O PERF9B/AAL2 foi aprovado em 50 cenários, incluindo:

- gestor autorizado e não autorizado;
- gestor multifundo;
- consultor dentro e fora da carteira;
- cedente próprio e cruzado;
- sacado próprio e cruzado;
- bloqueio de updates cruzados;
- bloqueio de RPCs de dashboard, relatório e onboarding para fundo adversário.

A tentativa de smoke confirmou que a massa QA não apareceu quando outro fundo ficou
ativo. O retorno visual ao QA não pôde ser confirmado pelo problema de seleção do
vínculo temporário descrito acima.

## 15. Storage 9C

O gate Storage 9C foi aprovado em 19 cenários:

- gestores A/B e multifundo;
- cedente, consultor e sacado;
- anônimo;
- caminho manipulado;
- path traversal simples e codificado;
- prefixo semelhante;
- objeto inexistente;
- expiração de URL assinada.

## 16. Regressões

Não houve alteração de código nos fluxos de upload antecipado, análise documental,
CT-e compartilhado, comprovante, reconciliação, postergação, painel da operação,
gate, snapshots, Storage, MFA, financeiro, CNAB ou Portal FIDC.

A suíte completa e os gates remotos não identificaram regressão nesses contratos.

## 17. Smoke

Status do smoke:

- banco/verify QA: **aprovado**;
- função P0 em transação revertida: **aprovada**;
- PERF9B/AAL2: **aprovado**;
- Storage 9C: **aprovado**;
- build da rota `/gestor/logistica`: **aprovado**;
- navegação autenticada específica no fundo QA: **inconclusiva**;
- aplicação permanente da migration: **não realizada pelo gate do histórico**.

## 18. Riscos residuais

1. Homologação ainda rejeita `entrega_em_validacao` enquanto a nova migration não
   for aplicada.
2. O histórico remoto de migrations diverge do catálogo local; usar `--include-all`
   sem reconciliação seria inseguro.
3. O smoke visual QA precisa ser repetido com gestor previamente autorizado, sem
   vínculo temporário.
4. CSV e paginação específicos do QA foram validados por domínio/verify, mas não
   integralmente por navegador.
5. A massa QA evoluiu de 20/20/20 para 22/18/20; isso é coerente com os documentos
   aprovados, mas deve ser considerado nos próximos asserts de homologação.

## 19. Próximas ações operacionais

1. Reconciliar o histórico de migrations de homologação sem `migration repair`
   automático e sem `--include-all` indiscriminado.
2. Aplicar somente
   `20260807132532_corrigir_evento_entrega_em_validacao.sql` por processo aprovado.
3. Reexecutar a prova funcional sem rollback e confirmar o CHECK instalado.
4. Executar o smoke visual completo com gestor já vinculado ao fundo QA.
5. Revalidar CSV e troca de fundo pelo navegador.

## 20. Parecer

A causa raiz está comprovada e a correção é mínima, coerente e sem mudança de regra
de negócio. Código, testes, build, verify QA, isolamento AAL2 e Storage estão
aprovados. Contudo, o P0 não deve ser considerado encerrado no ambiente enquanto a
migration não for aplicada de modo controlado e o smoke visual QA não for concluído.

**Parecer de código:** aprovado.
**Parecer para aplicação em produção:** não aplicar.
**Parecer de homologação:** pendente pelos dois gates residuais acima.
