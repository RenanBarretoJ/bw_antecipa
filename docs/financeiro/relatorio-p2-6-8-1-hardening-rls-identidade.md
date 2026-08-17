# P2.6.8.1 — Hardening RLS de Identidade

## Parecer executivo

O P2.6.8.1 foi concluído com **PASS** em homologação. A policy permissiva `profiles_gestor_all`, que transformava o papel operacional `gestor` em autorização global sobre `public.profiles`, foi removida. O contrato final permite que cada sessão autenticada leia somente o próprio perfil e os próprios papéis. Leitura de terceiros e mutações diretas de identidade permanecem negadas.

A correção foi aplicada exclusivamente ao projeto homolog autorizado `fhgkmggthxikfpogrvaa`. Produção não foi consultada nem alterada. Não houve `commit`, `push`, `reset`, `clean` ou `migration repair`.

Mesmo com a fase aprovada, o readiness global permanece **NO-GO** por bloqueadores independentes: smoke real login/senha/TOTP ainda não executado com ator QA controlado, performance do pipeline completo acima do alvo e smokes operacionais/concorrentes ainda pendentes. `credential_rotation_required` permanece `true`.

## 1. Objetivo e causa raiz

O P2.6.8 encerrou com `ZERO_RLX_STRUCTURAL=PASS`, porém a matriz autenticada encontrou `GESTOR_A -> profiles -> SELECT_OTHER = ALLOW`. A causa raiz era:

```text
profiles_gestor_all
PERMISSIVE
roles = PUBLIC
command = ALL
USING (get_user_role() = 'gestor')
```

Como policies permissivas são combinadas por `OR`, qualquer gestor satisfazia a condição global e passava a enxergar perfis de terceiros. Além do vazamento de leitura, o uso de `ALL` era estruturalmente excessivo mesmo quando ACLs impediam mutações específicas.

## 2. Baseline de entrada

- migrations locais/remotas: 126/126;
- schema parity: 0 diferenças materiais;
- Data API: 90/91, com uma falha de identidade;
- cross-fund: 39/39;
- Storage: 15/15;
- Golden V2: 384/384 e Security 5/5;
- ZERO_RLX_STRUCTURAL: PASS;
- testes: 1.028 aprovados e 3 ignorados;
- build: PASS;
- npm audit: 0 vulnerabilidades.

As contagens finais foram redescobertas pelos scripts; nenhuma contagem de baseline foi fixada como expectativa imutável.

## 3. Inventário de identidade antes da mutação

### `public.profiles`

- owner: `postgres`;
- RLS: habilitada;
- FORCE RLS: desabilitado;
- policies: `profiles_gestor_all`, `profiles_own_select` e `profiles_own_update`;
- triggers preservados: `profiles_proteger_papel_primario`, `profiles_sincronizar_papel_primario` e `profiles_updated_at`;
- helper da policy excessiva: `public.get_user_role()`, `STABLE`, `SECURITY DEFINER`, owner `postgres`, `search_path=public`.

### `public.usuario_papeis`

- owner: `postgres`;
- RLS: habilitada;
- FORCE RLS: desabilitado;
- policy: `usuario_papeis_select_own`;
- trigger preservado: `usuario_papeis_updated_at`;
- helpers administrativos revisados: `private.usuario_e_super_admin()`, `private.financeiro_usuario_e_super_admin()`, `private.usuario_possui_super_admin_ativo(uuid)` e `private.proteger_ultimo_super_admin(uuid)`.

### ACL antes

| Tabela | Papel | Privilégios relevantes |
|---|---|---|
| profiles | authenticated | SELECT, TRUNCATE, REFERENCES, TRIGGER |
| profiles | anon | nenhum |
| profiles | service_role | SELECT, INSERT, UPDATE, DELETE |
| usuario_papeis | authenticated | SELECT |
| usuario_papeis | anon | nenhum |
| usuario_papeis | service_role | privilégios administrativos existentes |

O gate de inventário terminou com `UNRESOLVED=0` antes da migration.

## 4. Runtime consumers e classificação

| Fluxo | Arquivos principais | Classificação | Decisão |
|---|---|---|---|
| Login, middleware, MFA e resolução de portal | `src/lib/auth/identity-query.ts`, `src/lib/auth/platform-access.ts`, `src/lib/auth/authorization.ts`, `src/lib/auth/mfa.ts`, `src/lib/supabase/middleware.ts`, `src/app/actions/auth.ts` | OWN_PROFILE | Mantida leitura own-row pela sessão autenticada. |
| Shell do portal e hook de perfil | `src/components/layout/portal-shell.tsx`, `src/hooks/useProfile.ts` | OWN_PROFILE | Mantida leitura do próprio perfil e dos próprios papéis. |
| Administração `/admin/usuarios` | `src/app/admin/**`, `src/lib/admin/**` | ADMIN_RPC | Mantidas RPCs/ações controladas de Super Admin; não foi criada leitura global para gestor. |
| Usuários vinculados ao cedente | `src/app/gestor/cedentes/[id]/page.tsx`, `src/lib/actions/gestor.ts` | FUND_SCOPED_OPERATIONAL | A sessão valida `cedente_acessos` sob RLS e a Server Action resolve somente os IDs autorizados. |
| Auditoria | `src/lib/auditoria/listagem.server.ts` | ADMIN_SERVER_SIDE | Removido join cross-profile; usa o snapshot histórico `ator_identificador`/`ator_tipo`. |
| Notificações e comunicações internas | `src/lib/actions/notificacao.ts`, `src/lib/comunicacoes/motor.server.ts` | ADMIN_SERVER_SIDE | Resolução interna de destinatário no servidor, sem diretório global no browser. |
| Checklist documental | `src/lib/actions/documento-v2.ts` | ADMIN_SERVER_SIDE | Enriquecimento de nomes ocorre no contexto server-side já autorizado. |

### Resposta obrigatória

**Um gestor operacional não precisa ler `profiles` de outros usuários diretamente pela Data API.** Os usos legítimos encontrados são administração da plataforma, resolução interna server-side ou leitura operacional limitada por vínculo concreto. Nenhum consumidor justificou `GLOBAL_READ_REQUIRED`.

## 5. Administração, gestor, Super Admin e híbrido

- Administração de usuários permanece separada da operação de carteira e utiliza contrato SA0–SA4 por RPC/server-side.
- Gestor operacional lê apenas a própria identidade via Data API.
- Super Admin puro não recebe SELECT global direto por policy de `profiles`; capacidades administrativas continuam nos contratos oficiais.
- O ator híbrido `SUPER_ADMIN_GESTOR_A` não ganha acesso adicional por composição permissiva de policies.
- A operação multifundo permaneceu isolada: gestor A acessa fundo A e nega fundo B; gestor B acessa fundo B e nega fundo A.

## 6. Decisão e migration incremental

Migration criada:

`supabase/migrations/20260817204159_p2_6_8_1_hardening_rls_identidade_profiles.sql`

Ela:

1. valida a presença das tabelas canônicas, RLS e formato exato da policy problemática;
2. valida os contratos `profiles_own_select` e `usuario_papeis_select_own`;
3. remove `profiles_gestor_all`;
4. remove `profiles_own_update`, classificada como `LEGACY_UNUSED` por não possuir consumidor runtime legítimo;
5. revoga privilégios excessivos de `PUBLIC`, `anon` e `authenticated`;
6. concede somente `SELECT` a `authenticated` nas duas tabelas;
7. executa postconditions que impedem policy `ALL` global de gestor, perda dos contratos own-row e ACL excessiva.

Nenhum dado de `auth.users`, `profiles`, `usuario_papeis` ou `usuario_fundos` foi alterado.

## 7. Estado pós-migração em homolog

### Policies

```text
profiles
└─ profiles_own_select
   role: authenticated
   command: SELECT
   using: id = auth.uid()

usuario_papeis
└─ usuario_papeis_select_own
   role: authenticated
   command: SELECT
   using: usuario_id = auth.uid()
```

### ACL

- `authenticated`: apenas `SELECT` em `profiles` e `usuario_papeis`;
- `anon`: nenhum grant nas duas tabelas;
- `service_role`: grants administrativos preexistentes preservados para rotinas internas autorizadas;
- nenhuma policy `USING (true)` foi introduzida;
- nenhuma policy baseada apenas em papel global gestor foi introduzida.

## 8. Clean-room técnico antes de homolog

O primeiro ciclo técnico sofreu falha transitória de infraestrutura Docker: o container temporário deixou de existir. O artefato registrou `FAIL` com `homolog_mutated=false` e cleanup concluído. A execução foi repetida integralmente, sem reaproveitar schema parcial, e passou:

- Node v22.23.1 isolado;
- bootstrap canônico;
- 127/127 migrations;
- matriz P0 de identidade PASS;
- testes, lint, TypeScript, diff check e build PASS;
- ambiente descartável removido ao final.

O incidente não foi classificado como falha de produto porque ocorreu antes de qualquer mutação remota e não se repetiu no rerun completo.

## 9. Aplicação em homolog e histórico

- destino validado: `fhgkmggthxikfpogrvaa`;
- aplicação: fluxo normal `supabase db push`;
- SQL Editor manual: não usado;
- migration repair: não usado;
- local: 127 migrations;
- remote: 127 migrations;
- missing: 0;
- remote-only: 0;
- order mismatch: 0;
- `db push --dry-run`: nenhuma migration pendente.

## 10. Clean-room final e schema parity

O ambiente final foi reconstruído do zero após a aplicação em homolog:

- bootstrap: PASS;
- migrations: 127/127;
- migration history remote: 127/127;
- schema parity homolog × clean-room: PASS;
- diferenças materiais: 0;
- diferenças ambientais permitidas: 49, todas relacionadas a objetos internos do Supabase Storage local;
- cleanup: PASS.

Evidência: `docs/financeiro/clean-room-e2e-p2-6-8-1.json`.

## 11. Matriz de identidade e Data API

A matriz final possui 118 verificações, todas aprovadas.

| Ator | Próprio profile | Outro profile | Próprios papéis | Papéis de outro |
|---|---:|---:|---:|---:|
| GESTOR_A | ALLOW | DENY | ALLOW | DENY |
| CEDENTE_A | ALLOW | DENY | ALLOW | DENY |
| CONSULTOR_A | ALLOW | DENY | ALLOW | DENY |
| SACADO_A | ALLOW | DENY | ALLOW | DENY |
| SUPER_ADMIN_PURO | ALLOW | DENY | ALLOW | DENY |
| SUPER_ADMIN_GESTOR_A | ALLOW | DENY | ALLOW | DENY |
| ANON | DENY | DENY | DENY | DENY |

### Mutações

- gestor INSERT profile arbitrário: DENY;
- gestor UPDATE profile de terceiro: DENY;
- gestor DELETE profile de terceiro: DENY;
- gestor UPDATE do próprio profile pela Data API: DENY;
- browser autenticado INSERT/UPDATE/DELETE em `usuario_papeis`: DENY.

O controle positivo foi preservado: own profile e own roles continuam ALLOW com JWT real do clean-room.

## 12. Regressões multifundo, Storage e fluxo operacional

- cross-fund: 39/39 PASS, `zero_leak=true`;
- Storage: 15/15 PASS;
- approval bypass: tentativa direta de pular o estado solicitado permaneceu negada e o estado original foi preservado;
- cron canônico: HTTP 200;
- alias legado: HTTP 200;
- cron sem autorização: HTTP 401;
- aplicação local: `/login` HTTP 200 e nenhum runtime 500 nos checks controlados.

## 13. Golden e domínios P2.2–P2.6

- Golden V1: PASS, 37 fixtures determinísticas;
- Golden V2: 384/384 PASS;
- Golden Security: 5/5 PASS;
- P2.2 ingestão versionada: PASS dentro do E2E V2;
- P2.3 matching e reconciliação: PASS dentro do E2E V2;
- P2.4 posição logística: 13 verificações funcionais e 27 de segurança, PASS;
- P2.5 PL/exposição: 19 verificações funcionais e 16 de segurança, PASS;
- P2.6 gate de risco: 8 verificações funcionais e 25 de segurança, PASS.

O P2.6.8.1 não recriou objetos RLX. `ZERO_RLX_STRUCTURAL=PASS`, com zero objetos residuais e zero referências runtime ativas.

## 14. Login e MFA

### Evidência executada

- own profile com JWT autenticado: ALLOW;
- own roles com JWT autenticado: ALLOW;
- rota `/login`: HTTP 200;
- bootstrap de identidade no clean-room: PASS.

### Smoke real senha → AAL1 → TOTP → AAL2

Não executado. Não havia credencial QA/TOTP controlada disponibilizada para este trabalho e nenhum segredo foi criado ou persistido. Por isso:

- não foi criado artefato falso de MFA;
- `AUTHENTICATED_SMOKE_LOGIN_MFA` permanece `PENDENTE` e bloqueador;
- não há alegação de validação manual do TOTP real.

## 15. Dependências, qualidade e segurança

- `npm audit --omit=dev`: 0 vulnerabilidades;
- TypeScript: PASS;
- testes: 144 arquivos aprovados, 1 ignorado; 1.031 testes aprovados, 3 ignorados;
- lint: PASS, 0 erros e 6 warnings preexistentes;
- `git diff --check`: PASS, apenas avisos de normalização LF/CRLF;
- Next 16.3.1 com webpack: PASS, 78 rotas;
- secret scan: PASS, 1.063 arquivos de texto, 0 achados;
- advisors Supabase pós-DDL: 103 avisos de segurança e 335 de performance no backlog geral; nenhum achado de segurança relacionado a `profiles` ou `usuario_papeis`.

Os advisors gerais não foram corrigidos por estarem fora do escopo. Referência de remediação do linter: <https://supabase.com/docs/guides/database/database-linter>.

## 16. Readiness e bloqueadores restantes

Foram promovidos para PASS, com evidência própria:

- `CLEAN_ROOM_SEED_E2E`;
- `RLS_HOMOLOG`;
- `RLS_CLEAN_ROOM`.

Permanece PASS:

- `ZERO_RLX_STRUCTURAL`.

Não foram promovidos:

- `AUTHENTICATED_SMOKE_LOGIN_MFA`;
- `CENTRAL_VISUAL_SMOKE`;
- `SMOKE_APTO_APPROVAL`;
- `SMOKE_NO_LIMITE_40`;
- `SMOKE_REVISAO_MANUAL`;
- `DOUBLE_OPERATION_APPROVAL`;
- `TOCTOU_OPERATION`;
- `STALE_REVIEW`.

`PERFORMANCE_FULL_PIPELINE` permanece FAIL com a evidência vigente de p95/max em 7.390 ms. Esses itens mantêm a recomendação geral em `NO-GO`.

## 17. Credenciais e imutabilidade de produção

- nenhum segredo foi adicionado ao repositório ou aos artefatos;
- a connection string usada pelo fluxo normal não foi documentada;
- `credential_rotation_required=true` permanece até evidência formal de rotação;
- produção não foi consultada nem alterada;
- projeto remoto utilizado: somente homolog `fhgkmggthxikfpogrvaa`.

## 18. Arquivos alterados

### Código e migration

- `supabase/migrations/20260817204159_p2_6_8_1_hardening_rls_identidade_profiles.sql`
- `scripts/homologacao/financeiro/readiness/p2-6-5-api-worker.mjs`
- `src/lib/auth/identity-rls-hardening-p2-6-8-1.test.ts`
- `src/lib/actions/gestor.ts`
- `src/app/gestor/cedentes/[id]/page.tsx`
- `src/lib/actions/notificacao.ts`
- `src/lib/auditoria/listagem.server.ts`

### Evidências

- `docs/financeiro/identity-rls-hardening-p2-6-8-1.json`
- `docs/financeiro/api-auth-matrix-p2-6-8-1.json`
- `docs/financeiro/cross-fund-api-p2-6-8-1.json`
- `docs/financeiro/storage-api-p2-6-8-1.json`
- `docs/financeiro/golden-clean-room-p2-6-8-1.json`
- `docs/financeiro/clean-room-e2e-p2-6-8-1.json`
- `docs/financeiro/zero-rlx-structural-p2-6-8-1.json`
- `docs/financeiro/production-readiness-p2-6-1.json`
- `docs/financeiro/secret-scan-p2-6-1.json`

Artefatos com sufixo `-technical` preservam a execução técnica anterior à aplicação remota.

## 19. Riscos residuais

1. O smoke real de MFA ainda precisa comprovar senha, AAL1, TOTP, AAL2 e redirect com ator QA descartável.
2. A performance do pipeline completo permanece acima do alvo vigente.
3. Smokes visuais, de aprovação e de concorrência listados no readiness ainda não possuem evidência autenticada suficiente.
4. Há backlog geral de advisors Supabase não relacionado a esta mudança.
5. A rotação da credencial operacional ainda precisa de evidência formal.

## 20. Conclusão

**P2.6.8.1 = PASS.** A falha específica de identidade foi eliminada sem bloquear o bootstrap own-row, sem ampliar poderes de Super Admin ou gestor, sem regressão multifundo, sem regressão de Storage, sem divergência de schema e sem reintroduzir legado RLX.

**Readiness global = NO-GO.** O hardening RLS está concluído, mas os bloqueadores independentes documentados precisam ser resolvidos antes de produção. A próxima fase não deve ser iniciada automaticamente; este relatório encerra o escopo.
