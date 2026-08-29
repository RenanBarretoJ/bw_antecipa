# P4.6 — Final Production Go Gate

Status: `CONCLUÍDO_COM_NO_GO`

Correlation ID: `bcd55625-d3b5-456a-b195-7da00b20c574`

Execução: 28/08/2026

Projeto Supabase de produção: `wwsndnuvnjuabpbjwlck`

Este relatório é sanitizado. Nenhum token, senha, service role, credencial SMTP, credencial Fromtis ou connection string foi impresso ou persistido.

## 1. Decisão executiva

```text
P4_6_FINAL_GO_GATE = FAIL
CUTOVER_PRODUCAO = NO_GO
```

Os gates técnicos read-only continuam estáveis, mas três aprovações obrigatórias permanecem ausentes:

1. credencial segura para o Custom SMTP do Supabase Auth;
2. owner operacional do restore;
3. aceite formal do RPO/RTO e da alternativa de backup + restore, ou aprovação comercial para PITR.

O gate foi mantido fail-closed. Nenhuma migration, configuração DLZ, dado operacional, deploy, chamada Sinqia/Terra, envio CNAB, commit ou push foi executado.

## 2. Flags finais

```text
SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_EMAIL_DELIVERY_TEST = NA

PITR_READY = FAIL
RESTORE_OWNER = MISSING
RPO_EVIDENCE = NAO_COMPROVADO
RTO_EVIDENCE = NAO_COMPROVADO
RESTORE_CAPABILITY_READY = PASS
DB_ROLLBACK_READY = FAIL
APP_ROLLBACK_READY = PASS

PRODUCTION_BASELINE = STABLE
APP_RELEASE_HASH_READY = PASS
CUTOVER_BUNDLE_HASH_READY = PASS
DLZ_CUTOVER_CONFIG_READY = PASS
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

`PITR_READY = FAIL` não indica erro da plataforma. PITR está desabilitado e não houve aprovação comercial para ativá-lo. A alternativa permitida pelo P4.6 também não pode receber o estado `NAO_DISPONIVEL_BACKUP_ALTERNATIVO_APROVADO`, pois faltam owner e aceite formal de RPO/RTO.

## 3. Supabase Auth Custom SMTP

A configuração hospedada foi reconsultada por API administrativa e permanece sem Custom SMTP:

- host: ausente;
- usuário: ausente;
- senha: ausente;
- remetente administrativo: ausente;
- sender name: ausente.

As credenciais SMTP da aplicação estão armazenadas como Secrets na Vercel, mas não podem ser copiadas por inferência. O escopo proíbe reutilizá-las sem uma fonte segura e explicitamente associada ao Auth de produção.

Como nenhuma credencial segura foi fornecida, nenhuma alteração foi feita no Supabase Auth.

```text
SUPABASE_AUTH_SMTP_READY = PENDENTE_SECRET
AUTH_EMAIL_DELIVERY_TEST = NA
```

O teste controlado de recovery/convite não foi executado porque depende do Custom SMTP aprovado. Nenhum e-mail ou token foi gerado.

## 4. PITR, backup e alternativa de restore

### 4.1 Estado hospedado

- região: `us-east-1`;
- WAL-G: habilitado;
- sete backups físicos diários observados;
- todos os backups listados com status `COMPLETED`;
- backup mais recente observado: `2026-08-27T05:04:46.167Z`;
- PITR: desabilitado.

PITR pode implicar contratação de add-on. Como não houve aprovação comercial explícita, não foi habilitado.

### 4.2 Restore lógico isolado certificado

O exercício fresco executado no P4.5 continua válido e não precisou ser repetido:

- export read-only sanitizado: `32,828 s`;
- restore bem-sucedido em ambiente Docker limpo: `4,058 s`;
- tempo técnico export + restore: aproximadamente `36,886 s`;
- timestamp da baseline restaurada: `2026-08-28T02:35:44.130Z`;
- hash determinístico: `7678a7c1a5d9de92bc3d6752eb66ef5191212ae445509692241868d4782d55d6`;
- divergências: zero.

Volume restaurado e validado:

| Métrica | Quantidade |
|---|---:|
| Cedentes | 12 |
| Operações | 45 |
| Notas fiscais | 903 |
| Documentos metadata | 123 |
| Storage metadata | 1.635 |
| Auth users | 23 |
| Profiles | 23 |
| Histórico Fromtis | 26 |

Limitações conhecidas:

- o exercício comprova restore lógico/local, não PITR hospedado;
- valida metadata do Storage, não restauração integral dos objetos binários;
- o RPO corresponde ao instante do export, não a uma janela contínua;
- o tempo observado não inclui decisão do incidente, provisionamento humano ou recuperação dos binários;
- não existe owner de restore nomeado;
- não existe aceite formal do RPO/RTO.

O agente não pode autoaprovar risco operacional em nome da organização. Portanto:

```text
RESTORE_OWNER = MISSING
RPO_EVIDENCE = NAO_COMPROVADO
RTO_EVIDENCE = NAO_COMPROVADO
RESTORE_CAPABILITY_READY = PASS
DB_ROLLBACK_READY = FAIL
```

## 5. Rollback da aplicação

Revalidação concluída:

- usuário Vercel autenticado e com acesso ao projeto;
- deployment atual: `READY`;
- SHA atual conhecida: `7a3087870cc8a80ab020676f1db33600804e5825`;
- deployment anterior certificado: `READY`;
- SHA anterior conhecida: `b3ec79e3fe57b481a722a83b1f3bc99542012dc4`;
- domínio canônico respondeu HTTP `200`;
- nenhum rollback foi executado.

Procedimento permanece documentado em `docs/homologacao/p3-runbook-rollback-producao.md`.

```text
APP_ROLLBACK_READY = PASS
```

## 6. Baseline final de produção

Preflight executado no projeto de produção em transação explicitamente read-only em `2026-08-28T02:56:40Z`:

| Métrica | Esperado | Atual | Resultado |
|---|---:|---:|---|
| Fundos | 2 | 2 | PASS |
| Cedentes | 12 | 12 | PASS |
| Operações | 45 | 45 | PASS |
| Notas fiscais | 903 | 903 | PASS |
| Documentos | 123 | 123 | PASS |
| Storage metadata | 1.635 | 1.635 | PASS |
| Auth users | 23 | 23 | PASS |
| Profiles | 23 | 23 | PASS |
| Histórico Fromtis | 26 | 26 | PASS |

Os dois Cedentes do patch P3.1 permanecem presentes, com CNPJ e estado esperados, sem operação ou NF. As oito verificações de integridade retornaram zero falhas, incluindo relações órfãs e pares Auth/Profile.

```text
PRODUCTION_BASELINE = STABLE
```

## 7. Hashes canônicos

Os quatro artefatos foram recalculados e validados:

```text
APP_RELEASE_HASH = 60e7f5e82b7de28601839ce60325ba92365de3b515aacb269543e1fced0a4666
CUTOVER_BUNDLE_HASH = 52e9b35f126ba3ad7c34609fb45d9173400c2656828a67558eba6821bbb5bb50
MIGRATION_MANIFEST_HASH = cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318
DLZ_CONFIG_MANIFEST_HASH = 886a8346426ecda2f473dc2d768aacd6d62b1cca47663eac3fff1aa38e51e749
```

Nenhuma diferença material foi detectada.

## 8. Freeze plan do RC

`rehearsal/manifests/release-scopes.json` é a lista canônica exata e reproduzível:

- APP_RELEASE: 724 arquivos, cada um com SHA-256;
- CUTOVER_BUNDLE: 20 arquivos, cada um com SHA-256.

No working tree atual existem exatamente 20 arquivos materiais alterados que deverão compor o commit imutável autorizado: 15 da aplicação e 5 do cutover.

### 8.1 APP_RELEASE — arquivos materiais alterados

```text
next.config.ts
package.json
src/app/cedente/operacoes/nova/page.tsx
src/lib/email.ts
src/lib/integracoes/legacy-env.ts
src/lib/integracoes/resolver.server.ts
src/lib/operacoes/nova-solicitacao-block.ts
src/lib/portal-fidc/integracao.ts
supabase/migrations/20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql
supabase/migrations/20260827184403_bridge_documentos_representante_legado.sql
supabase/migrations/20260827185557_bridge_remover_policies_legadas_gestor_global.sql
supabase/migrations/20260827203000_p2_runtime_compatibilidade_sacado_admin.sql
supabase/migrations/20260827204000_p2_runtime_notificacoes_authenticated.sql
supabase/migrations/20260827205000_p2_runtime_restaurar_trigger_profile_auth.sql
supabase/migrations/20260827213304_p3_1_vincular_cedentes_dlz.sql
```

### 8.2 CUTOVER_BUNDLE — arquivos materiais alterados

```text
docs/homologacao/p3-checklist-configuracoes-secrets.md
docs/homologacao/p3-manifesto-migrations-producao.md
docs/homologacao/p3-runbook-cutover-producao.md
docs/homologacao/p3-runbook-rollback-producao.md
docs/homologacao/p4-preflight-final-producao-dlz-health.md
```

### 8.3 Exclusões obrigatórias do commit imutável

Relatórios P1–P4.6, testes de certificação, `.gitignore`, evidências financeiras e toda a árvore `rehearsal/` que não integra o CUTOVER_BUNDLE não devem ser misturados ao commit material do RC. Esses artefatos devem permanecer em entrega de evidências separada, se posteriormente autorizada.

O working tree é compatível com os hashes canônicos. O staging futuro deve usar apenas as listas acima e deve repetir `release-scopes.mjs --verify` antes do commit.

```text
RC_FREEZE_PLAN = READY
RC_IMMUTABLE_COMMIT = PENDENTE_AUTORIZACAO
```

## 9. Checklist final

| Gate | Estado |
|---|---|
| Vercel Production env | PASS |
| APP URL | PASS |
| Sinqia/Terra env | PASS |
| Auth URL/redirects | PASS |
| MFA/TOTP | PASS_WITH_ROLLOUT |
| Supabase Auth Custom SMTP | PENDENTE_SECRET |
| SMTP da aplicação | PASS |
| Backup recente | PASS |
| PITR ou alternativa formalmente aprovada | FAIL |
| Restore técnico isolado | PASS |
| Owner/RPO/RTO | FAIL |
| Rollback da aplicação | PASS |
| Rollback do banco | FAIL |
| Baseline | STABLE |
| APP_RELEASE hash | PASS |
| CUTOVER_BUNDLE hash | PASS |
| Configurador DLZ | PASS |
| Manifesto de migrations | PASS |
| RC freeze plan | READY |

## 10. Ações necessárias para reabrir o gate

1. fornecer a credencial de Custom SMTP do Supabase Auth por canal seguro e explicitamente vinculada à produção;
2. configurar o SMTP sem expor o segredo e executar um único teste controlado de recovery ou convite;
3. escolher formalmente entre PITR e backup + restore;
4. para PITR, obter aprovação comercial antes da ativação;
5. para a alternativa, definir owner e aprovar explicitamente RPO/RTO, incluindo a estratégia para objetos binários do Storage;
6. após esses itens, repetir somente os gates afetados, baseline read-only e hashes;
7. solicitar autorização explícita para o commit imutável.

Até lá:

```text
P4_6_FINAL_GO_GATE = FAIL
CUTOVER_PRODUCAO = NO_GO
```

