# P4.4 — evidências de infraestrutura e Release Candidate final

Data da inspeção: 28/08/2026

Produção: integralmente `READ-ONLY`

## Resultado executivo

```text
P4_4_INFRA_E_RC_FINAL = FAIL

RELEASE_HASH_SCOPE = PASS
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH = 52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50
RC_MATERIAL_STATE = UNCHANGED

VERCEL_PROJECT_IDENTIFIED = PASS
VERCEL_CURRENT_DEPLOYMENT = PASS
VERCEL_PROD_ENV_READY = FAIL
APP_URL_PROD_READY = FAIL
SINQIA_TERRA_ENV_READY = FAIL

AUTH_SITE_URL_READY = FAIL
AUTH_REDIRECTS_READY = FAIL
AUTH_MFA_READY = FAIL
SUPABASE_AUTH_SMTP_READY = FAIL
APP_SMTP_READY = FAIL

BACKUP_READY = PASS
PITR_READY = FAIL
RESTORE_CAPABILITY_READY = FAIL
RTO_EVIDENCE = NAO_COMPROVADO
APP_ROLLBACK_READY = PASS
DB_ROLLBACK_READY = FAIL

PRODUCTION_BASELINE = STABLE
DLZ_CUTOVER_CONFIG_READY = PASS
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO

CUTOVER_PRODUCAO = NO_GO
```

Os acessos locais à Vercel e ao Supabase foram validados. O escopo de hash do release foi corrigido e a baseline de produção permanece estável. O cutover continua bloqueado porque as variáveis Production não estão completas/comprovadas, as configurações hospedadas de Auth e SMTP não receberam revisão de quatro olhos, o PITR está desativado e não existe restore alternativo testado com RTO aceito.

## 1. Identidade canônica do release

O arquivo [release-scopes.json](../../rehearsal/manifests/release-scopes.json) contém listas explícitas e hashes SHA-256 por arquivo. A geração e verificação estão em `rehearsal/scripts/release-scopes.mjs`.

### APP_RELEASE_HASH

Cobre 724 arquivos que podem alterar comportamento implantado ou schema promovível:

- runtime em `src/**` e `public/**`, excluindo testes, specs e stories;
- `package.json`, lockfile e configurações relevantes de build;
- migrations enumeradas pelos grupos canônicos do manifesto de produção.

Não inclui relatórios, evidências, testes ou tooling de rehearsal.

### CUTOVER_BUNDLE_HASH

Cobre 20 artefatos operacionais explicitamente necessários à janela:

- manifestos de migrations e DLZ;
- preflight e postflight SQL;
- executor/configuração segura DLZ;
- validadores e scripts da janela;
- runbooks de cutover e rollback.

Relatórios posteriores não alteram o `APP_RELEASE_HASH`.

## 2. Mudança material desde P3.1/P4.2

O aumento anterior de 982 para 988 arquivos veio de artefatos P4.2/P4.3 indevidamente incluídos no hash amplo. A classificação do delta é:

| Arquivos | Classe | Impacto na certificação |
|---|---|---|
| Configuração/manifesto DLZ, configurador, resolvedor e dry-run P4.2 | CUTOVER_ONLY | Cobertos pelo bundle de cutover já certificado |
| Testes P4.2/P4.3/P4.4 | TEST_ONLY | Não alteram runtime |
| Relatórios P4.3/P4.4 | DOC_ONLY | Não alteram runtime |
| Script e manifesto de escopos P4.4 | CUTOVER_ONLY | Tornam os hashes reproduzíveis |

Não foi identificada nova diferença `RUNTIME_MATERIAL` ou `MIGRATION_MATERIAL` após o conjunto certificado. Portanto `RC_MATERIAL_STATE = UNCHANGED` e `RC_RECERTIFICATION_REQUIRED = NO`.

## 3. Vercel Production

Inspeção autenticada e somente leitura:

| Item | Evidência |
|---|---|
| Team | `renanbarretoj` (`team_UMQZzH6dda2EN0TLeAeUSXOJ`) |
| Projeto | `bw-antecipa` (`prj_nKt7FiU3FWHrmRyf0mbDudM0AVIF`) |
| Deployment atual | `dpl_udB8Ser8sQE7JUiA3KjXbQR782WT`, READY, Production |
| SHA/branch | `7a3087870cc8a80ab020676f1db33600804e5825`, `main` |
| Criado em | `2026-08-24T17:37:02.996Z` |
| Deployment anterior | `dpl_HrE6BU7smnf95tCpwgFqrGmYDLjW`, READY, SHA `b3ec79e3fe57b481a722a83b1f3bc99542012dc4` |
| Permissão | Usuário autenticado é owner do team |

Somente os nomes, targets e tipos das variáveis foram inspecionados; nenhum valor sensível foi lido ou salvo.

Presentes no target Production: credenciais Supabase, `APP_BASE_URL`, conjunto `FROMTIS_*`, conjunto SMTP, `EMAIL_FROM`, cron, escrow e Chromium. Ausentes: `NEXT_PUBLIC_APP_ENV` e `INTEGRATION_RUNTIME_ENV`. O resolvedor de integrações exige um ambiente explícito em produção; por isso os gates de ambiente e Sinqia/Terra falham. A presença dos nomes SMTP não comprova host, porta e TLS, então `APP_SMTP_READY` permanece `FAIL`.

## 4. Supabase Auth e SMTP

O projeto `bw-antecipa` (`wwsndnuvnjuabpbjwlck`) está `ACTIVE_HEALTHY`. O runtime exige AAL2 e implementa setup TOTP no primeiro acesso, mas a CLI/MCP disponível não expõe Site URL, redirects, flag TOTP, SMTP hospedado ou templates.

Produção contém 23 usuários e zero fatores TOTP. Isso poderia ser aceito como rollout no primeiro acesso somente após confirmar TOTP habilitado e aprovar suporte/recuperação. Até a revisão de quatro olhos no Dashboard, todos os gates Auth permanecem `FAIL`. O checklist está em [p4-3-checklist-manual-infra-producao.md](./p4-3-checklist-manual-infra-producao.md).

## 5. Backup, PITR, restore e rollback

O comando read-only `supabase backups list` retornou:

- região `us-east-1`;
- WAL-G habilitado;
- PITR desativado;
- sete backups físicos diários com status `COMPLETED`;
- backup mais recente em `2026-08-27T05:04:46.167Z`.

Isso comprova backup recente, mas não rollback de banco. Não há restore isolado documentado com owner, duração medida, RPO/RTO aceitos. Consequentemente PITR, restore, RTO e rollback de banco falham.

O rollback da aplicação está operacionalmente preparado: existe deployment anterior READY e o usuário autenticado é owner. O comando está documentado no checklist e não foi executado.

## 6. Baseline de produção

Preflight executado dentro de transação PostgreSQL `READ ONLY`, encerrada com rollback, em `2026-08-28T01:48:51.276871Z`:

| Métrica | P4/P4.1 | P4.4 | Delta |
|---|---:|---:|---:|
| Fundos | 2 | 2 | 0 |
| Cedentes | 12 | 12 | 0 |
| Operações | 45 | 45 | 0 |
| Notas fiscais | 903 | 903 | 0 |
| Documentos | 123 | 123 | 0 |
| Objetos no Storage | 1.635 | 1.635 | 0 |
| Usuários Auth | 23 | 23 | 0 |
| Profiles | 23 | 23 | 0 |
| Histórico Fromtis | 26 | 26 | 0 |

Os dois cedentes do patch P3.1 continuam presentes, sem fundo legado, operações ou NFs. Também permanecem zeradas as órfãs verificadas entre NF/cedente, operação/cedente e Auth/profile. Não houve delta material; não foi necessário repetir dump ou rehearsal.

## 7. Identificadores da janela

```text
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH = 52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50
MIGRATION_MANIFEST_HASH = cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318
DLZ_CONFIG_MANIFEST_HASH = 886a8346426ecda2f473dc2d768aacd6d62b1cca47663eac3fff1aa38e51e749
```

Os quatro identificadores devem ser reconfirmados imediatamente antes da janela real.

## 8. Arquivos materiais pendentes de commit imutável

O `APP_RELEASE_HASH` ainda não corresponde integralmente a um commit. Estes são os 15 arquivos materiais modificados ou não rastreados que precisam compor o release autorizado:

1. `next.config.ts`
2. `package.json`
3. `src/app/cedente/operacoes/nova/page.tsx`
4. `src/lib/email.ts`
5. `src/lib/integracoes/resolver.server.ts`
6. `src/lib/portal-fidc/integracao.ts`
7. `src/lib/integracoes/legacy-env.ts`
8. `src/lib/operacoes/nova-solicitacao-block.ts`
9. `supabase/migrations/20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql`
10. `supabase/migrations/20260827184403_bridge_documentos_representante_legado.sql`
11. `supabase/migrations/20260827185557_bridge_remover_policies_legadas_gestor_global.sql`
12. `supabase/migrations/20260827203000_p2_runtime_compatibilidade_sacado_admin.sql`
13. `supabase/migrations/20260827204000_p2_runtime_notificacoes_authenticated.sql`
14. `supabase/migrations/20260827205000_p2_runtime_restaurar_trigger_profile_auth.sql`
15. `supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql`

Nenhum commit ou push foi executado.

## 9. Recertificação executada

| Validação | Resultado |
|---|---|
| Verificação dos escopos/hashes canônicos | PASS |
| Manifesto de migrations de produção | PASS — 14 baseline, 3 bridges, 175 upgrade e 5 bloqueadas |
| Testes focados P4.2/P4.4 | PASS — 20/20 |
| Suíte `rehearsal:test` | PASS — 28/28 |
| Secret scan dos novos artefatos | PASS |
| UTF-8 replacement check | PASS |
| `git diff --check` | PASS; apenas avisos de normalização LF/CRLF |

O build não foi repetido porque `RC_MATERIAL_STATE = UNCHANGED`; o P4.4 determina build somente quando houver alteração material de runtime.

## 10. Parecer

O release agora possui identidade reproduzível e a aplicação não sofreu mudança material desde a certificação. Projeto/deployment Vercel, backup, rollback da aplicação, baseline e configuração DLZ estão comprovados. Isso não é suficiente para produção: ambiente Vercel incompleto, Auth/SMTP sem evidência administrativa e ausência de PITR ou restore alternativo testado impedem rollback seguro do banco.

```text
P4_4_INFRA_E_RC_FINAL = FAIL
CUTOVER_PRODUCAO = NO_GO
```

Produção permaneceu integralmente `READ-ONLY`: não houve migration, configuração de env/Auth/SMTP/DLZ, deploy, backup, restore, rollback, chamada à Sinqia/Terra, commit ou push.
