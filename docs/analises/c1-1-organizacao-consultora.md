# C1.1 — Organização Consultora, usuários e autorização

Data da análise: 25/09/2026

## Resultado executivo

O modelo anterior associava Fundos e Cedentes diretamente ao usuário Consultor. O C1.1 substitui essa fonte de verdade por uma organização Consultora, dona da carteira, mantendo o usuário como ator individual e o Cedente como dono das NFs e operações.

A consulta agregada, somente leitura, do projeto de produção encontrou zero usuários Consultor e zero vínculos operacionais Consultor. Portanto, a estratégia adotada é migração direta, sem backfill, CNPJ fictício ou dual-read.

O código está validado localmente por clean-room completo, teste SQL de autorização, suíte Vitest, lint, TypeScript e build. Supabase Preview, Vercel Preview, smoke autenticado e homologação ainda não foram executados.

## Evidência de origem e preservação do C5

- `origin/main` usado como base: `1bdff6761ae7f26e7a0d377c2084f7c86067ffce`.
- SHA confirmado no deployment de produção: `1bdff6761ae7f26e7a0d377c2084f7c86067ffce`.
- Branch C1.1: `feature/c1-1-organizacao-consultora`.
- C5 preservado em `feature/c5-consultor-acompanhamento-operacoes`.
- Commit C5 preservado: `bc1ba63`.
- PR C5 preservado: `#55`, em draft.
- O C5 não foi mergeado, reescrito, apagado ou cherry-picked.

Partes do C5 candidatas a reaproveitamento após homologar o C1.1:

- listagem server-side;
- filtros;
- detalhe read-only;
- testes read-only;
- melhorias de desempenho.

As migrations e policies user-centric do C5 não devem ser reaproveitadas sem reescrita para a organização.

## Diagnóstico de produção

Consulta agregada sem exposição de PII:

| Medida | Total |
|---|---:|
| Usuários Consultor | 0 |
| Usuários Consultor ativos | 0 |
| Contas internas/QA identificadas no agregado | 0 |
| Candidatos externos identificados no agregado | 0 |
| Consultores com `usuario_fundos` | 0 |
| Vínculos ativos em `usuario_fundos` | 0 |
| Consultores com `consultor_cedente` | 0 |
| Vínculos ativos em `consultor_cedente` | 0 |

Decisão: `DIRECT`. Não há dado real a converter nem justificativa para manter fallback legado.

## Modelo implantável

As novas tabelas são criadas por `20260925144545_c1_1_organizacao_consultora_schema.sql`:

- `consultores`: identidade fiscal e ciclo de vida da organização;
- `consultor_usuarios`: membership individual com `OWNER`, `ADMIN`, `OPERADOR` ou `LEITOR`;
- `consultor_fundos`: Fundos concedidos à organização;
- `consultor_cedentes`: carteira da organização, com unicidade por organização e Cedente.

Garantias estruturais:

- CNPJ normalizado, válido, obrigatório e único;
- um usuário pertence a uma única organização Consultora nesta fase;
- no máximo um OWNER pendente/ativo por organização;
- nenhum cliente autenticado escreve diretamente nas tabelas organizacionais;
- desativação preserva carteira e histórico;
- o vínculo legado `consultor_cedente` fica congelado e acessível somente por `service_role`.

## Autorização

A migration `20260925144547_c1_1_autorizacao_organizacional.sql` centraliza os predicados:

- `private.consultor_usuario_pode_gerenciar_cedente` para C3;
- `private.consultor_usuario_pode_operar_cedente` para C2/C4;
- `private.consultor_usuario_tem_acesso_fundo` para o teto organizacional;
- `public.consultor_pode_operar_cedente` e `public.consultor_listar_cedente_ids_operacionais` como interfaces mínimas da aplicação.

Matriz aplicada:

| Papel | C2 | C3 | C4 |
|---|---:|---:|---:|
| OWNER | permitido | permitido | permitido |
| ADMIN | permitido | permitido | permitido |
| OPERADOR | permitido | permitido | permitido |
| LEITOR | negado | negado | negado |

O ator de auditoria continua sendo o `user_id` real. Quando suportado, o contexto também registra `consultor_id`, sem transferir propriedade de NF ou operação à Consultoria.

## Administração e convites

A migration `20260925144549_c1_1_admin_consultorias_convites.sql` e a área `/admin/consultorias` implementam:

- cadastro de CNPJ, Razão Social e Nome Fantasia;
- concessão inicial de Fundos ativos;
- convite do primeiro usuário como OWNER;
- convite de ADMIN, OPERADOR e LEITOR;
- ativação/desativação da organização;
- ativação/desativação e alteração de papel de membros;
- concessão/revogação de Fundos;
- TOTP fresco para toda mutação administrativa;
- compensação de falha de persistência ou envio de e-mail.

O OWNER não é transferível nesta fase. Convites adicionais e Fundos permanecem sob Super Admin, o menor escopo compatível com a infraestrutura de autorização já existente. Autogestão por OWNER/ADMIN foi deliberadamente adiada.

O convite não recebe senha do administrador: o usuário define a própria senha, ativa a membership e configura MFA antes de entrar no portal.

## Evidência de validação local

- `supabase db reset`: PASS, todas as migrations aplicadas do zero.
- `supabase test db`: PASS.
  - mesma carteira para OWNER e OPERADOR sem duplicação;
  - LEITOR negado em C2/C3/C4;
  - usuário inativo negado;
  - organização inativa negada;
  - cross-organization negado;
  - Fundo não autorizado negado;
  - remoção de Fundo revoga acesso sem apagar vínculos;
  - reativação restaura acesso conforme vínculos intactos.
- Vitest: 267 arquivos aprovados, 3 ignorados; 2.252 testes aprovados, 12 ignorados.
- TypeScript: PASS.
- ESLint: PASS, com um warning preexistente em `src/lib/actions/liquidacao.ts`.
- `next build`: PASS, incluindo `/admin/consultorias` e `/convite/consultor`.
- `git diff --check`: PASS.

## Status obrigatório

```text
C1_1_DIAGNOSIS_COMPLETE = YES
C1_1_REAL_CONSULTANTS_IN_PROD = 0
C1_1_LEGACY_BACKFILL_REQUIRED = NO
C1_1_TRANSITION_STRATEGY = DIRECT

C1_1_ORGANIZATION_MODEL = PASS
C1_1_USER_MEMBERSHIP = PASS
C1_1_FUND_SCOPE = PASS
C1_1_CEDENTE_SCOPE = PASS
C1_1_INTERNAL_ROLES = PASS
C1_1_CNPJ_UNIQUENESS = PASS
C1_1_AUDIT_ACTOR_PRESERVED = PASS

C1_1_CAN_MANAGE = PASS
C1_1_CAN_OPERATE = PASS
C1_1_CROSS_ORG = PASS
C1_1_INACTIVE_USER = PASS
C1_1_INACTIVE_ORG = PASS
C1_1_FUND_REMOVAL = PASS

C1_1_C2_REGRESSION = PASS
C1_1_C3_REGRESSION = PASS
C1_1_C4_REGRESSION = PASS
C1_1_P9_REGRESSION = PASS
C1_1_P14_REGRESSION = PASS
C1_1_CEDENTE_REGRESSION = PASS
C1_1_GESTOR_REGRESSION = PASS

C1_1_FEATURE_TESTS = PASS
C1_1_FEATURE_CI = FAIL (não executado)
C1_1_SUPABASE_PREVIEW = FAIL (não executado)
C1_1_VERCEL_PREVIEW = FAIL (não executado)
C1_1_AUTHENTICATED_PREVIEW = FAIL (não executado)
C1_1_READY_FOR_HOMOLOG = NO

C1_1_HOMOLOG_E2E = NOT_EXECUTED
C1_1_HOMOLOG_CLEANUP = NOT_EXECUTED
C1_1_HOMOLOG_READY = NO

C1_1_PRODUCTION = NOT_EXECUTED

C5_PR55_MERGED = NO
C5_PR55_PRESERVED = YES
```

## Próximo gate

Criar commit e PR do C1.1 somente após autorização explícita. Depois, executar Supabase Preview e Vercel Preview, com smoke autenticado da organização com múltiplos usuários. Homologação só pode receber o escopo após esses gates passarem; produção permanece fora deste ticket.
