# P2.6 — Gate de Risco, Decisão Operacional e Central Consolidada

## 1. Objetivo

O P2.6 transforma a exposição produzida pelo P2.5 em uma decisão operacional auditável antes da aprovação de cada operação. O fluxo deixa de depender apenas da simulação exibida no navegador: o servidor atualiza os snapshots canônicos, projeta a operação candidata, classifica o risco e exige que a mesma decisão ainda seja válida dentro da RPC transacional de aprovação.

Arquivos principais: `src/lib/financeiro/risco/processor.server.ts`, `src/lib/financeiro/risco/classificador.ts`, `src/lib/actions/operacao.ts` e `supabase/migrations/20260814230000_p2_6_gate_risco_decisao_operacional.sql`.

## 2. Arquitetura

```text
P2.3 matching/conciliação
        ↓
P2.4 posição logística
        ↓
P2.5 exposição + PL D-2 + overlay
        ↓
P2.6 classificador puro GATE_RISCO_V1
        ↓
execução + motivos + eventual revisão
        ↓
RPC atômica de aprovação
```

O processador orquestra as camadas existentes sem reingerir provedores externos. A regra de decisão está isolada como função pura, enquanto SQL persiste snapshots, protege concorrência e autoriza a mutação final.

## 3. Regras aprovadas

As decisões válidas são `APTO`, `REVISAO_MANUAL` e `BLOQUEADO`. Todos os motivos encontrados são preservados; a decisão final usa a precedência `BLOQUEADO > REVISAO_MANUAL > APTO`. Quando o controle está inativo, a execução é registrada como não aplicável, sem simular uma decisão fictícia.

## 4. Política

A configuração pertence a `politica_operacional_versoes`. Foram adicionados `gate_risco_ativo`, `limite_inclusivo` e tratamentos explícitos para PL ausente, exposição indeterminada, posição sem match, operação não incorporada e liquidação parcial. Os tratamentos V1 são fixados por constraint para impedir combinações ainda não suportadas pelo motor.

## 5. Limite inclusivo

O limite é inclusivo: uma projeção exatamente igual ao limite gera o motivo informativo `NO_LIMITE`, mas continua apta caso não exista outro motivo mais severo. Somente percentual estritamente maior gera `EXPOSICAO_ACIMA_LIMITE` e bloqueio. O cálculo usa `decimal.js` e colunas `numeric`, sem `float`.

## 6. PL ausente

Sem PL D-2, a avaliação é bloqueada com `PL_D2_INDISPONIVEL`. Não existe fallback para outro dia, PL estimado ou zero. A ausência é tratada como dado material indisponível.

## 7. Indeterminada

Exposição indeterminada positiva ou quantidade indeterminada maior que zero gera `EXPOSICAO_INDETERMINADA` com severidade de revisão. A avaliação só permanece em revisão quando nenhum motivo de bloqueio também estiver presente.

## 8. Sem match

Qualquer posição sem match, por quantidade ou valor positivo, gera `POSICAO_SEM_MATCH` com severidade de bloqueio. Um percentual conhecido abaixo do limite não neutraliza esse motivo.

## 9. Não incorporada

Operação econômica anterior ainda não incorporada ao estoque gera `OPERACAO_NAO_INCORPORADA_ESTOQUE` e bloqueia. A regra evita aprovar nova exposição enquanto o estoque canônico não incorporou eventos anteriores.

## 10. Liquidação parcial

`LIQUIDACAO_PARCIAL_PRESENTE` é informativo na V1. O motivo é persistido para contexto operacional, mas isoladamente não muda `APTO` para revisão ou bloqueio.

## 11. Precedência

O classificador acumula motivos antes de decidir. Se houver simultaneamente `POSICAO_SEM_MATCH` e `EXPOSICAO_INDETERMINADA`, ambos permanecem no histórico e a decisão é `BLOQUEADO`, pois bloqueio prevalece sobre revisão.

## 12. Gate do fundo

A Central de Risco executa o gate no escopo `FUNDO`, sem operação candidata. Ela resolve a política padrão vigente do fundo e usa o snapshot P2.5 atualizado para fornecer uma visão consolidada da situação corrente.

## 13. Gate da operação

Na aprovação, o escopo é `OPERACAO`. A política é resolvida pelo snapshot `politica_operacional_versao_id` já congelado na operação, e o fundo é validado pelo vínculo `cedente_fundos`. Isso evita usar política de outro fundo ou uma configuração posterior indevidamente.

## 14. Simulação

`simular_memoria_financeira_operacao` calcula, via funções financeiras existentes, o valor de aquisição candidato por NF sem alterar a operação. Em seguida, o processador classifica logisticamente as NFs para separar valor em trânsito, indeterminado e indisponível. A operação candidata não passa por novo matching P2.3 porque ainda não compõe a carteira adquirida.

## 15. JIT

`aprovarOperacao` executa o gate imediatamente antes da RPC de aprovação. O servidor atualiza matching, conciliação, posição logística e exposição com os dados já disponíveis no sistema, gera a projeção candidata e persiste a decisão. O browser não envia nem escolhe a decisão.

## 16. Transação

A mutação final ocorre em `aprovar_operacao_com_risco_atomica`. A RPC bloqueia a operação, valida fundo, assinatura, taxa e `updated_at`, rejeita bloqueios e exige revisão liberada quando aplicável. Só então delega ao motor financeiro transacional já existente e grava o snapshot de risco na operação.

## 17. Execuções

`risco_execucoes` armazena escopo, origem, regra, política, exposição P2.5, datas de corte, valores atual/projetado, contadores, decisão, assinatura, correlação e ator. O registro é imutável e nunca representa um estado mutável da tela.

## 18. Motivos

`risco_motivos` guarda todos os fundamentos da decisão com código canônico, severidade, quantidade, valor e detalhes. A unicidade por execução e código evita duplicidade, sem eliminar motivos diferentes da mesma avaliação.

## 19. Revisão manual

`risco_revisoes` é criada somente para execução de operação classificada como `REVISAO_MANUAL`. Estados válidos: `PENDENTE`, `LIBERADA`, `RECUSADA` e `EXPIRADA`. A decisão original continua imutável; a revisão é uma autorização adicional e rastreável.

## 20. MFA

A revisão exige a ação sensível `revisar_risco_operacao`, sessão MFA válida e confirmação TOTP fresca. A autorização é consumida pela RPC. Um Super Admin puro não pode decidir risco; um usuário híbrido só pode fazê-lo quando também possui papel de gestor e acesso ao fundo.

## 21. Stale

Uma revisão é expirada se já existir execução de risco mais recente para a operação. Além disso, a aprovação compara a assinatura recebida, o `updated_at` da operação e a taxa congelada. Qualquer alteração exige nova avaliação.

## 22. Aprovação

`APTO` autoriza a aprovação. `REVISAO_MANUAL` somente autoriza após revisão `LIBERADA` da mesma execução e assinatura. Controle não aplicável segue o fluxo legado, mas registra `NAO_APLICAVEL`. A operação guarda `risco_execucao_id`, eventual `risco_revisao_id`, decisão, assinatura e data da avaliação.

## 23. Bloqueio

`BLOQUEADO` não possui override na V1. A própria RPC transacional recusa a operação, mesmo que a interface seja contornada ou uma chamada direta seja tentada.

## 24. Central de Risco

A rota existente `/gestor/conciliacao?tab=risco` concentra situação do fundo, execução mais recente, exposição atual e projetada, PL D-2, limite, motivos, histórico e fila de revisões. Ela reaproveita o contexto de fundo ativo.

## 25. UI

A subaba Risco apresenta cards de exposição em trânsito, posições indeterminadas, posições sem match, operações não incorporadas, revisões pendentes e operações bloqueadas. A consulta possui filtros por decisão, motivo, operação, cedente/CNPJ, versão da política e período, além de execução manual do gate, histórico paginado e modal de revisão com justificativa e TOTP. O modal exibe a operação, a decisão automática, a exposição projetada e todos os motivos antes da decisão humana. Links levam à operação relacionada. Códigos técnicos são exibidos como evidência, não como controles editáveis.

## 26. RLS

As três tabelas possuem RLS. `authenticated` recebe somente `SELECT`, condicionado a `private.financeiro_gestor_tem_acesso_fundo(fundo_id)`. `anon` não recebe acesso. Escritas são reservadas ao `service_role`, exceto a transição controlada de revisão feita exclusivamente pela RPC autorizada.

## 27. Auditoria

São registrados `RISCO_AVALIADO`, `RISCO_BLOQUEADO`, `RISCO_REVISAO_SOLICITADA`, `RISCO_REVISAO_LIBERADA`, `RISCO_REVISAO_RECUSADA` e `RISCO_REVISAO_EXPIRADA`. Os eventos carregam fundo, operação/revisão, execução e `correlation_id`, sem credenciais.

## 28. Idempotência

A assinatura SHA-256 é construída por serialização determinística dos inputs: versão da regra, fundo, operação, `updated_at`, taxa, política, execução P2.5, assinatura da exposição, candidato e classificação. O índice único e o advisory lock devolvem a execução existente para inputs iguais.

## 29. Concorrência

A persistência serializa por fundo/escopo com advisory lock. A aprovação serializa por operação, executa `FOR UPDATE` e valida os snapshots antes da mutação. Mudança concorrente da operação ou taxa invalida a avaliação.

## 30. Performance

As consultas centrais usam índices por fundo/data/decisão e por operação. Motivos usam índice por fundo/código. O processador aplica timeout operacional configurável por `RISK_GATE_TIMEOUT_MS`, com padrão de 45 segundos e faixa aceita de 5 a 120 segundos. Em falha ou timeout, a aprovação permanece fechada com `AVALIACAO_RISCO_INDISPONIVEL`.

O benchmark em `scripts/homologacao/financeiro/risco/benchmark.mjs` executa o pipeline real sobre uma operação candidata sintética, registra cinco amostras e mede cada estágio. No projeto de homologação `fhgkmggthxikfpogrvaa`, a operação `80bd0bec-88eb-fb5e-b585-7cc7e6ac8ce0` concluiu todas as cinco execuções com decisão `BLOQUEADO`, aquisição candidata de R$ 10.043,64 e exposição indeterminada de R$ 10.043,64, sem erro técnico.

| Estágio | p50 | p95/máximo |
| --- | ---: | ---: |
| Matching | 649 ms | 1.257 ms |
| Reconciliação | 1.031 ms | 1.209 ms |
| Logística | 1.281 ms | 1.510 ms |
| Exposição P2.5 | 2.021 ms | 2.130 ms |
| Simulação candidata | 500 ms | 518 ms |
| Classificação | 0 ms | 1 ms |
| Persistência | 319 ms | 336 ms |
| Pipeline total | 6.500 ms | 7.356 ms |

O maior custo observado está nas recomputações canônicas P2.3–P2.5, não na classificação pura. O resultado permanece abaixo do timeout padrão, mas deve ser acompanhado conforme o volume real crescer.

## 31. Golden

`expected-risk-gate.json` é independente dos demais expected files. A massa atual define PL D-2 de R$ 50 milhões, limite de 40%, exposição conhecida de 0%, 12 posições indeterminadas (R$ 147.803,45) e 3 sem match (R$ 1.021.648,91). O resultado esperado é `BLOQUEADO`, preservando `POSICAO_SEM_MATCH` e `EXPOSICAO_INDETERMINADA`.

Além das dez operações D0 já usadas pelos contratos P2.3–P2.5, o Golden V2 possui uma operação candidata exclusiva do benchmark de risco. Ela permanece `solicitada`, não entra no ciclo logístico legado e permite exercitar a projeção JIT sem alterar os expected files das fases anteriores. O cleanup isolado remove primeiro execuções, motivos, revisões e overlays P2.5/P2.6 desses fundos, evitando referências históricas órfãs durante reexecuções da massa.

## 32. Testes

Os testes do classificador cobrem controle inativo, limite 25/37/39,8/40/42, PL ausente/inválido, sem match, indeterminada, operação não incorporada, valores ausentes, liquidação parcial, múltiplos motivos e Golden. Testes arquiteturais verificam nomenclatura genérica, grants, RLS, imutabilidade, MFA, proibição de override, revogação do motor antigo e proteção TOCTOU.

Evidências executadas:

- suíte Vitest: 138 arquivos e 1.012 testes aprovados;
- verificador funcional P2.6: 8 verificações aprovadas;
- verificador de segurança P2.6: 25 verificações aprovadas, com mutações de teste revertidas;
- TypeScript, lint, `git diff --check` e build Next.js aprovados;
- lint sem erros e com seis avisos preexistentes fora do escopo;
- build com avisos preexistentes do Handlebars, sem falha.

## 33. Regressões

O P2.6 não modifica os arquivos expected do P2.2 ao P2.5. A aprovação continua delegando o cálculo e a gravação financeira à RPC P2.1 existente. Os testes de política e contrato da migration financeira foram atualizados para exigir a nova RPC sem duplicar o motor anterior.

As regressões read-only executadas em homologação foram aprovadas: P2.2 com 44 verificações, P2.3 com 28 verificações e duas ressalvas de massa/contrato já documentadas, P2.4 com 13 verificações, P2.5 com 19 verificações, Golden V1 aprovado, Golden V2 com 384/384 verificações e generalização sem objetos estruturais residuais.

## 34. Limitações

A V1 fixa os tratamentos e não oferece override para bloqueios. A revisão manual trata apenas exposição indeterminada sem bloqueios concorrentes. O motor depende da disponibilidade e consistência das camadas P2.3–P2.5 e não busca dados externos durante a aprovação. O benchmark confirma o custo do pipeline com a massa Golden, mas ainda não substitui teste de carga com cardinalidade e concorrência equivalentes à produção.

## 35. Riscos

A migration foi validada transacionalmente e aplicada exclusivamente no projeto de homologação `fhgkmggthxikfpogrvaa`. RLS, grants, isolamento por ator e fundo, bloqueio de Super Admin puro, chamadas diretas e ausência de override para bloqueios foram verificados pela suíte de segurança. Permanecem como riscos residuais antes de produção: smoke manual com credenciais reais de QA, confirmação TOTP na interface, concorrência com aprovações simultâneas e homologação operacional assistida. Falha técnica permanece fail-closed com `AVALIACAO_RISCO_INDISPONIVEL`.

## 36. Próximos passos

Executar o smoke manual da Central de Risco e da aprovação com um gestor de QA autorizado, incluindo os caminhos `APTO`, `REVISAO_MANUAL`, liberação/recusa com TOTP e `BLOQUEADO`. Depois, exercitar duas aprovações concorrentes da mesma operação e registrar a evidência antes de promover qualquer migration para produção.

## 37. Parecer

A arquitetura está preparada para impedir aprovações sem decisão de risco válida, preservar os fundamentos históricos e operar em múltiplos fundos sem nomes RLX no domínio persistido. A implementação, a migration e as verificações automatizadas estão concluídas em homologação. A liberação para produção continua condicionada ao smoke manual autenticado, ao teste explícito de concorrência e à homologação operacional assistida; nenhuma alteração foi aplicada em produção.

## Comandos de homologação

Todos os comandos exigem `.env.homolog`, referência explícita do projeto e bloqueiam produção.

```bash
npm run homolog:financeiro:risco:validate-migration -- --expected-project-ref <REF_HOMOLOG>
npm run homolog:financeiro:risco:apply-migration -- --expected-project-ref <REF_HOMOLOG>
npm run homolog:financeiro:risco:apply-migration -- --execute --expected-project-ref <REF_HOMOLOG> --confirm APPLY_P26_RLX_GOLDEN_HOMOLOG_<REF_HOMOLOG>
npm run homolog:financeiro:risco:configure-golden -- --execute --expected-project-ref <REF_HOMOLOG> --confirm CONFIGURE_P26_GOLDEN_RLX_GOLDEN_HOMOLOG_<REF_HOMOLOG>
npm run homolog:financeiro:risco:run -- --execute --expected-project-ref <REF_HOMOLOG> --confirm RUN_P26_RLX_GOLDEN_HOMOLOG_<REF_HOMOLOG>
npm run homolog:financeiro:risco:verify -- --expected-project-ref <REF_HOMOLOG>
npm run homolog:financeiro:risco:verify-security -- --expected-project-ref <REF_HOMOLOG>
npm run homolog:financeiro:risco:benchmark -- --execute --expected-project-ref <REF_HOMOLOG> --confirm BENCHMARK_P26_RLX_GOLDEN_HOMOLOG_<REF_HOMOLOG>
```
