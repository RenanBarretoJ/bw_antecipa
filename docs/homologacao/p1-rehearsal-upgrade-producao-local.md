# P1 — Rehearsal real de upgrade da produção em Docker local

## Resultado executivo

`P1_REHEARSAL_UPGRADE_PRODUCAO_LOCAL = PASS`

O dump real de produção foi restaurado em um projeto Supabase Docker isolado e a cadeia atual foi aplicada integralmente em dois ciclos independentes. Os dois ciclos produziram o mesmo hash lógico:

```text
bf358cc35783faa265f3a18ff67156fbc2e9a62fbb94c3e715ce6e9fef3a8d5b
```

Produção foi acessada apenas durante a exportação read-only do P0. Todo restore, DDL, DML, reconciliação, RLS e teste de idempotência deste P1 ocorreu exclusivamente em `127.0.0.1:55322`, no projeto Docker `bw-antecipa-prod-rehearsal`.

## Baseline preservado

| Invariante | PRE_UPGRADE | POST_UPGRADE | Resultado |
|---|---:|---:|---|
| Fundos | 2 | 2 | Preservado |
| Cedentes | 12 | 12 | Preservado |
| Operações | 45 | 45 | Preservado |
| Notas fiscais | 903 | 903 | Preservado |
| Documentos legados | 123 | 123 | Preservado |
| Objetos de Storage | 1.635 | 1.635 | Preservado |
| Usuários Auth | 23 | 23 | Preservado |
| Profiles | 23 | 23 | Preservado |
| Operações com remessa Fromtis legada | 26 | 26 | Preservado |

Além das contagens, foram comparados os hashes ordenados dos IDs de fundos, operações, NFs, documentos, Auth users e profiles, bem como os caminhos de Storage. Não houve divergência.

## Cadeia executada

- 14 migrations já faziam parte do baseline de produção (`003` a `016`);
- 3 bridges novas foram aplicadas antes da cadeia histórica;
- 172 migrations pendentes foram aplicadas, uma a uma e em ordem lexical de versão;
- 189 versões ficaram registradas no histórico local ao final;
- 5 migrations destrutivas exclusivas de homologação foram bloqueadas;
- cada arquivo foi executado com `ON_ERROR_STOP`, transação única e `search_path` equivalente ao papel remoto `postgres`;
- o runner parou em cada incompatibilidade real e o ambiente foi reconstruído a partir do dump original após cada correção.

A ordem completa fica documentada em [p1-rehearsal-ordem-migrations.md](p1-rehearsal-ordem-migrations.md) e é reproduzida por `rehearsal/scripts/upgrade-local.mjs`.

## Incompatibilidades encontradas

### 1. `consultor_cedentes` × `consultor_cedente`

- Primeira falha: `20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql`.
- SQLSTATE: `42P01`.
- Causa: produção possuía `public.consultor_cedentes`; a cadeia atual usa `public.consultor_cedente`.
- Correção: `20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql`.
- Estratégia: renomear a tabela, constraints e policies preservando OID, linhas, FKs, grants e RLS.
- Dados afetados no baseline: zero linhas; estrutura e autorização preservadas.

### 2. Execução sem transação única

- Sintoma: `tmp_politicas_catalogo_dedup` desaparecia dentro de `20260727151731_politicas_catalogo_fundo.sql`.
- Causa: o runner inicial usava autocommit, enquanto a migration declara tabela temporária `ON COMMIT DROP`.
- Correção: executar cada arquivo com `psql --single-transaction`.
- Migration histórica não foi editada.

### 3. `search_path` diferente do executor remoto

- Sintoma: pré-condição falsa em `20260817204159_p2_6_8_1_hardening_rls_identidade_profiles.sql`.
- SQLSTATE: `P0001`.
- Causa: `supabase_admin` local inclui `auth` no `search_path` e decompõe a policy como `uid()`; o papel remoto `postgres` a representa como `auth.uid()`.
- Correção: o runner mantém o papel local necessário ao ownership do restore, mas fixa o `search_path` equivalente ao executor remoto.
- Schema e migration histórica não foram alterados.

### 4. Versões documentais legadas duplicadas

- Falha: `20260818194455_p0_upload_documentos_cedente_permission_denied.sql`.
- SQLSTATE: `23505` ao criar `documentos_versao_contexto_unique`.
- Causa: documentos de representantes tinham `representante_id = NULL`; após recriação cadastral, registros antigos e novos também podiam permanecer como `v1`.
- Correção: `20260827184403_bridge_documentos_representante_legado.sql`.
- Resolução comprovável: UUID no caminho do Storage → snapshot aprovado de alteração cadastral → CPF normalizado → representante atual do mesmo cedente.
- Reconciliação: 11 vínculos preenchidos; somente contextos ainda colidentes foram reordenados por `created_at` e `id`.
- Preservação: nenhum documento, arquivo, status, análise ou ID foi removido; 123 documentos permaneceram presentes.

### 5. Policies legadas de gestor global

- Descoberta no teste funcional pós-upgrade: um gestor temporariamente limitado a um fundo ainda via os dois fundos.
- Causa: policies de produção com nomes legados em português não eram conhecidas pelos `DROP POLICY` das migrations multifundo.
- Correção: `20260827185557_bridge_remover_policies_legadas_gestor_global.sql`.
- Remoções: policies globais residuais em fundos, devedores, taxas e policies amplas inertes de cedente_acessos, notificações, sacados e testemunhas.
- Resultado: as policies canônicas por `usuario_fundos`/`cedente_fundos` permaneceram como fonte de autorização.

## Integridade e backfills

Validações pós-upgrade:

- 45/45 operações possuem `cedente_fundo_id` válido e compatível com o cedente;
- 903/903 NFs possuem `cedente_fundo_id` e `fundo_id` coerentes;
- zero vínculos operação × NF órfãos;
- zero FKs públicas não validadas;
- zero versões documentais duplicadas no contexto canônico;
- zero documentos legados sem metadado correspondente em `storage.objects`;
- 10 vínculos `cedente_fundos` foram reconstruídos para os cedentes operacionais;
- 8 vínculos `usuario_fundos` foram reconstruídos para os quatro gestores e dois fundos;
- 12/12 cedentes possuem estabelecimento matriz;
- 12 contas bancárias estruturadas foram reconstruídas;
- 13 acessos ADMIN canônicos foram preservados;
- as 45 operações históricas permanecem marcadas como contexto legado, sem política ou snapshot inventado.

## RLS e identidade

Os testes foram executados com JWT local simulado e mutações preparatórias dentro de transações revertidas:

- gestor limitado temporariamente a um fundo viu somente esse fundo, seus vínculos e suas NFs;
- owner legado resolveu o próprio cedente e viu uma única organização;
- ADMIN canônico resolveu o cedente e foi reconhecido como administrador;
- o mesmo vínculo alterado temporariamente para OPERACIONAL continuou resolvendo a organização, mas perdeu a capacidade administrativa;
- nenhuma policy global legada conhecida permaneceu no schema final.

## Storage, Auth e integrações

- `storage.objects` permaneceu com 1.635 linhas: 251 em `contratos`, 134 em `documentos-cedentes` e 1.250 em `notas-fiscais`;
- nenhuma migration moveu ou apagou metadados de objetos;
- binários não foram copiados, conforme o escopo do rehearsal;
- 23 Auth users e 23 profiles mantiveram os mesmos IDs;
- senhas, tokens, sessões e fatores MFA reais não foram exportados nem resetados;
- as 26 remessas Fromtis históricas permaneceram nas operações;
- nenhum secret ou configuração de integração fictícia foi criado.

## Pré-condições de cutover

Estas condições não representam perda de dados, mas exigem decisão/configuração antes da promoção:

1. dois cedentes não possuem `cedente_fundos`; o vínculo deve ser definido operacionalmente;
2. NFs legadas não possuem granularidade de parcelas, pois o baseline não guarda `nDup`/`vDup` suficientes para um backfill confiável;
3. operações legadas não receberam política ou snapshot retroativo fictício;
4. não existem configurações versionadas de integração/CNAB/templates no baseline; devem ser configuradas antes de habilitar os fluxos correspondentes.

## Migrations bloqueadas

Não foram executadas porque são destrutivas e exclusivas de homologação:

- `20260723182639_reset_operacional_fundo_homolog_rpc.sql`;
- `20260728153646_reset_operacional_eventos_dominio.sql`;
- `20260804103235_corrigir_reset_postergacoes_canhoto.sql`;
- `20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql`;
- `20260823125731_corrigir_reset_dependencias_risco.sql`.

## Reprodutibilidade

```powershell
npm run rehearsal:verify-determinism
npm run rehearsal:verify-upgrade
npm run rehearsal:test-bridges
```

O segundo comando executa duas vezes: destroy local, stack limpa, restore do dump original, baseline, bridges, 172 migrations e `POST_UPGRADE`. As três bridges também foram reaplicadas duas vezes sobre o estado final; o hash permaneceu inalterado.

## Parecer final

```text
P1_REHEARSAL_UPGRADE_PRODUCAO_LOCAL = PASS
PRODUCAO_REAL_PERMANECE_READ_ONLY = CONFIRMADO
DADOS_BASELINE_PRESERVADOS = CONFIRMADO
OPERACOES_45_PRESERVADAS = CONFIRMADO
NFS_903_PRESERVADAS = CONFIRMADO
USUARIOS_PRESERVADOS = CONFIRMADO
UPGRADE_REHEARSAL = DETERMINISTICO
```

As três bridges são necessárias para tornar o caminho real de produção promovível. A promoção ainda deve respeitar as pré-condições de cutover acima e não deve incluir as migrations exclusivas de reset de homologação.
