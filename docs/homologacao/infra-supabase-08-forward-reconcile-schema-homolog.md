# INFRA-SUPABASE-08 — reconciliação forward-only do schema de homologação

Data de referência: 22/09/2026

Branch: `fix/supabase-forward-reconcile-homolog-drift`

Base canônica: `5b1aa3593cd60a575e5eeab172ca310eba5dc2f4` (PR #38)

Migration: `20260922161558_reconcile_runtime_policies_reset_functions_grants.sql`

## Conclusão executiva

Foi criada uma única migration forward-only, atômica, idempotente e orientada pelo estado dos objetos. No rehearsal local ela convergiu a fixture equivalente ao estado atual de homologação para o estado canônico, permaneceu materialmente no-op sobre o clean-room já canônico, corrigiu um estado parcial e falhou de forma fechada diante de assinatura inesperada.

O banco real de homologação foi consultado somente em modo leitura durante o diagnóstico. A migration **não foi aplicada** em homologação; migration history, produção, C2 e P13 permaneceram intocados. Este ticket termina no hold point anterior à aplicação remota.

## Diff estrutural classificado

O snapshot cobriu tabelas, colunas, tipos, constraints, índices, funções e atributos, triggers, RLS, policies, grants, sequences, views e customizações relevantes de Auth/Storage.

| Classe | Resultado |
|---|---:|
| Snapshot canônico | 4.920 linhas |
| Snapshot homologação | 4.562 linhas |
| Diff bruto | 176 |
| UNKNOWN | 0 |
| Policies materialmente divergentes | 7 |
| Funções de reset não canônicas | 4 |
| ACLs de runtime divergentes | 2 |
| Outro drift material | 1 função remota sem Git |

Das 153 diferenças iniciais de fingerprint de funções, a normalização LF/CRLF eliminou 143. As cinco restantes eram exclusivamente comentários no corpo, sem mudança semântica nem de atributos. Também foram excluídos do escopo material os grants gerenciados pelo Supabase em `storage` e o comentário ausente de `public.consultor_cedente`.

As sete divergências de policy correspondem a quatro policies legadas extras e três policies canônicas com role/expressão divergente:

- `public.cedente_acessos.ca_gestor_all` — extra;
- `public.notificacoes.notificacoes_gestor_all` — extra;
- `public.sacados.sacados_gestor_all` — extra;
- `public.testemunhas.testemunhas_gestor_all` — extra;
- `public.notificacoes.notificacoes_own_select` — divergente;
- `public.notificacoes.notificacoes_own_update` — divergente;
- `public.sacados.sacados_own_select` — divergente.

O estado canônico das policies `own_*` é `PERMISSIVE`, role `authenticated`, com `auth.uid()` em subselect escalar. RLS permanece habilitada e não forçada nas quatro tabelas-alvo.

Os grants canônicos são:

- `authenticated` em `public.sacados`: somente `SELECT`;
- `authenticated` em `public.notificacoes`: somente `SELECT, UPDATE`;
- `anon`/`PUBLIC`: nenhum grant direto nessas tabelas;
- `service_role`: `SELECT, INSERT, UPDATE, DELETE`, preservados.

## Mapa dos 9 TRUE_LOCAL_GAPS

| Local version | Filename | Object(s) | Homolog state | Canonical state | Forward fix | Risk | Test | Status |
|---|---|---|---|---|---|---|---|---|
| `20260827183411` | `bridge_consultor_cedentes_para_consultor_cedente.sql` | `public.consultor_cedente` | Estrutura canônica; comentário ausente | Estrutura canônica com comentário | Nenhuma; metadata não material fora do conteúdo permitido | Baixo | Diff estrutural normalizado | NO-OP |
| `20260827184403` | `bridge_documentos_representante_legado.sql` | Paths/versões de documentos e trigger legado | 0 paths não resolvidos, 0 grupos duplicados, trigger habilitado | Mesmo estado material | Nenhuma | Baixo | Consultas de pós-condição | NO-OP |
| `20260827185557` | `bridge_remover_policies_legadas_gestor_global.sql` | Quatro policies `*_gestor_all` | Presentes | Ausentes | `DROP POLICY IF EXISTS` nas quatro policies conhecidas | Médio | Homolog fixture, parcial e snapshot final | CORRIGIDO |
| `20260827203000` | `p2_runtime_compatibilidade_sacado_admin.sql` | `sacados_own_select`; ACL `authenticated` de `sacados` | Policy pública/direct `auth.uid()` e ACL residual | Policy para `authenticated` com subselect; somente `SELECT` | Recriar somente se divergente; revogar ACL residual e conceder `SELECT` | Alto | RLS cross-tenant e ACL por role | CORRIGIDO |
| `20260827204000` | `p2_runtime_notificacoes_authenticated.sql` | `notificacoes_own_select`, `notificacoes_own_update`; ACL | Policies públicas/direct `auth.uid()` e ACL residual | Policies para `authenticated` com subselect; `SELECT, UPDATE` | Recriar somente se divergente; grants explícitos | Alto | SELECT/UPDATE own-row e cross-tenant | CORRIGIDO |
| `20260827205000` | `p2_runtime_restaurar_trigger_profile_auth.sql` | `on_auth_user_created`; `handle_new_user()` | Já canônico | Um trigger AFTER INSERT habilitado; `SECURITY DEFINER`; `search_path=public` | Nenhuma mutação; pre/postcheck obrigatório | Alto | Assert de trigger e atributos Auth | NO-OP VERIFICADO |
| `20260827213304` | `p3_1_vincular_cedentes_dlz.sql` | Patch de dados DLZ | Âncoras de dados não aplicáveis/ausentes | Sem drift estrutural relacionado | Nenhuma; data patch proibido neste ticket | Médio | Diff estrutural e escopo da migration | NO-OP |
| `20260829170408` | `p5_2_neutralizar_resets_homolog_producao.sql` | Quatro overloads de `reset_operacional_fundo_homolog*` | Presentes | Ausentes | Validar assinaturas/dependências, revogar EXECUTE e remover com `RESTRICT` | Alto | Homolog fixture, segunda aplicação e overload inesperado | CORRIGIDO |
| `20260916140000` | `corrigir_overlay_exposicao_parcelas.sql` | Função de overlay/exposição | Corpo e atributos já canônicos | Mesmo estado | Nenhuma | Médio | Fingerprint normalizado | NO-OP VERIFICADO |

## TRUE_REMOTE_GAP

| Campo | Evidência |
|---|---|
| Remote version | `20260827150923` |
| Name | `corrigir_ambiguidade_excluir_usuarios_homolog` |
| Git presence | `NONE` no repositório atual e em busca histórica por conteúdo/nome |
| Evidence sources | `supabase_migrations.schema_migrations`, SQL recuperado de evidência local INFRA-07, catálogo `pg_proc`/`pg_depend`, grants, busca de chamadas no app e histórico Git |
| Suspected affected objects | `private.excluir_usuarios_homolog(uuid[])` |
| Current homolog effect | Exatamente uma função `SECURITY INVOKER`, owner `postgres`, sem `search_path` configurado, sem grants para roles da aplicação e sem dependentes/call sites |
| Canonical effect | Função ausente |
| Safe future history action | `KEEP` — preservar o registro remoto; reconciliar somente o schema agora e decidir metadata em ticket posterior |
| Confidence | `PROVEN` |

A migration remove o efeito material órfão com `RESTRICT`, mas não altera nem marca como reverted o registro `20260827150923`.

## Segurança da migration

- Transação única, com advisory lock, `lock_timeout` e `statement_timeout` locais.
- Sem branch por project ref ou identidade de ambiente.
- Sem DML de dados operacionais e sem alteração em `supabase_migrations.schema_migrations`.
- Prechecks de schemas, tabelas, roles, RLS, assinaturas e dependências.
- Estado inesperado resulta em `RAISE EXCEPTION` e rollback integral.
- Policies são recriadas apenas quando divergentes.
- Grants são explícitos; não há `GRANT ALL`.
- Funções não canônicas são removidas com `RESTRICT`, nunca `CASCADE`.
- Postchecks validam policies, RLS, ACLs, ausência de overloads/helpers e integridade do trigger Auth.

## Rehearsal e hashes

O executor `rehearsal/scripts/infra-supabase-08-forward-reconcile.mjs` exige um container local explícito e rejeita execução sem esse guard.

| Cenário | Hash antes | Hash depois | Resultado |
|---|---|---|---|
| Clean-room canônico | `617d7b0f7ca1958cfe40bf0f8455db4625b25ea2ac39b5bdcb69cd67ac80daf7` | `617d7b0f7ca1958cfe40bf0f8455db4625b25ea2ac39b5bdcb69cd67ac80daf7` | PASS / no-op |
| Fixture homolog-current | `a296640b42d54836032df68ecdd9e803e618333b913985c163a506e181e3e57c` | `617d7b0f7ca1958cfe40bf0f8455db4625b25ea2ac39b5bdcb69cd67ac80daf7` | PASS |
| Segunda aplicação | canônico | `617d7b0f7ca1958cfe40bf0f8455db4625b25ea2ac39b5bdcb69cd67ac80daf7` | PASS / idempotente |
| Estado parcial | `18fa3ff366e4d7e66061ee0258e7c20673d04f7d80a70f8e57e493b43bdf9856` | `617d7b0f7ca1958cfe40bf0f8455db4625b25ea2ac39b5bdcb69cd67ac80daf7` | PASS |
| Overload inesperado | conflitante | migration abortada; fixture preservada | PASS / fail-closed |

O snapshot estrutural completo do clean-room permaneceu byte a byte igual antes/depois da migration (`0a6ec7f5cf5329b080b9849c966be9a54a7854687033bc8fffe84c6b1f5ce764`). O rebuild completo executou 208/208 migrations com sucesso.

O teste de segurança criou quatro identidades somente dentro de transação local (`gestor`, `cedente`, `consultor`, `super_admin`), comprovou own-row e bloqueio cross-tenant em `sacados`/`notificacoes`, validou ACLs de `anon`, `authenticated` e `service_role`, e executou rollback ao final.

## Validações de aplicação

| Validação | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS, com 3 warnings preexistentes |
| `npm test` | PASS — 256 arquivos, 2 skipped; 2.185 testes, 11 skipped |
| Teste estático específico da migration | PASS — 6/6 |
| Rehearsal dinâmico/RLS/Auth/ACL | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

O comando legado `npm run rehearsal:test` tem 13 falhas no SHA-base e as mesmas 13 falhas nesta branch. A causa é o manifesto P5.2 congelado: ele cobre 200 migrations, enquanto o SHA-base já contém 207 (sete arquivos posteriores não inventariados). A branch passa a ter 208 e altera apenas o valor observado de `upgrade_count` de 184 para 185; nomes, quantidade e causa das 13 falhas permanecem idênticos. O manifesto antigo de produção não foi atualizado, pois isso promoveria migrations alheias ao escopo e violaria o freeze. Assim, a regressão diferencial desta mudança é PASS, mantendo o débito preexistente explicitamente registrado.

## Supabase Preview

A listagem de branches Preview retornou falta de permissão. Nenhuma branch paga foi criada e nenhuma Preview ativa foi apagada. Resultado: `NOT_EXECUTED`.

## Hold point

O pacote está pronto para revisão em PR separado. **Não executar neste ticket**:

- `supabase db push` ou migration up em homologação;
- SQL manual de escrita em homologação;
- `migration repair`;
- merge em `homolog`/`main`;
- qualquer ação em produção, C2 ou P13.

O próximo ticket deve aplicar a migration forward em homologação, provar novamente a equivalência canônica e somente depois tratar metadata do histórico.

```ini
FORWARD_DIFF_UNKNOWN = 0
TRUE_LOCAL_GAPS_MAPPED = 9/9

CANONICAL_POLICIES_DIFF = 7
CANONICAL_RESET_FUNCTIONS_DIFF = 4
CANONICAL_RUNTIME_GRANTS_DIFF = 2
CANONICAL_OTHER_MATERIAL_DIFF = 1

TRUE_REMOTE_GAP_EFFECT_RESOLVED = YES
TRUE_REMOTE_GAP_SAFE_ACTION = KEEP

FORWARD_MIGRATION_CREATED = YES
FORWARD_MIGRATION_IDEMPOTENT = PASS
FORWARD_MIGRATION_HOMOLOG_REHEARSAL = PASS
FORWARD_MIGRATION_CANONICAL_NOOP = PASS
FORWARD_MIGRATION_SECURITY = PASS
FORWARD_MIGRATION_APP_REGRESSION = PASS

CLEAN_ROOM_MIGRATIONS = 208
CLEAN_ROOM_FORWARD_REBUILD = PASS

SUPABASE_PREVIEW_FORWARD = NOT_EXECUTED

FORWARD_RECONCILIATION_PR_READY = YES

HOMOLOG_CHANGED = NO
REMOTE_MIGRATION_HISTORY_REPAIR_EXECUTED = NO
PRODUCTION_CHANGED = NO
C2_CHANGED = NO
P13_CHANGED = NO

HOMOLOG_SCHEMA_RECONCILIATION_READY = YES
C2_READY_TO_RESUME = NO
```
