# P2.6.8 — Saneamento Estrutural Final / Remoção do Legado RLX

## Parecer executivo

O saneamento estrutural RLX foi concluído: `private.rlx_gestor_tem_acesso_fundo(uuid)` foi classificada como `DEAD_LEGACY`, removida em homologação por migration incremental e não possui consumidores ativos. O banco e o runtime terminaram com zero objetos/referências estruturais RLX, portanto `ZERO_RLX_STRUCTURAL=PASS`.

O resultado consolidado da fase, contudo, é **P2.6.8=FAIL**. O clean-room final reproduziu uma regressão de autorização preexistente: `GESTOR_A` conseguiu ler o perfil de outro usuário. A causa é a policy permissiva `profiles_gestor_all`, que concede `ALL` a gestores e se soma à policy correta `profiles_own_select`. O contrato obrigatório da fase exige `other user profile=DENY`; por isso o gate falhou automaticamente.

A policy não foi alterada nesta fase. O escopo permite mutações exclusivamente em `private.rlx_gestor_tem_acesso_fundo(uuid)` e consumidores diretos e também determina que findings de RLS não relacionados fiquem fora do escopo. A recomendação global permanece **NO-GO**.

## 1. Escopo e ambiente

- Ambiente autorizado e alterado: homologação.
- Project ref: `fhgkmggthxikfpogrvaa`.
- Branch de código: `homolog`.
- Produção consultada ou alterada: não.
- Migration repair, reset ou clean: não.
- Commit ou push: não.
- Runtime de validação: Node `v22.23.2`, npm `10.9.8`.
- `credential_rotation_required=true` foi preservado.

## 2. Baseline e inventário estrutural

O inventário read-only consultou `pg_class`, `pg_proc`, `pg_trigger`, `pg_policy`/`pg_policies`, `pg_constraint`, `pg_indexes` e `information_schema`, nos schemas `public` e `private`.

Antes da migration havia exatamente um objeto estrutural ativo com prefixo RLX:

```text
private.rlx_gestor_tem_acesso_fundo(uuid)
```

Propriedades capturadas:

- linguagem: SQL;
- volatilidade: `STABLE`;
- segurança: `SECURITY DEFINER`;
- `search_path`: vazio;
- owner: `postgres`;
- grants de execução: `authenticated` e `service_role` permitidos; `PUBLIC` e `anon` não permitidos;
- implementação: delegação direta para `private.gestor_tem_acesso_fundo_operacional(uuid)`.

## 3. Proveniência, dependências e consumidores

```text
20260813191143 (P2.2)
  cria rlx_gestor_tem_acesso_fundo e consumidores financeiros
    ↓
20260814220000 (P2.5.1)
  generaliza consumidores para financeiro_gestor_tem_acesso_fundo
    ↓
20260817171442 (P2.6.6)
  mantém o nome RLX somente como wrapper de compatibilidade
    ↓
20260817200014 (P2.6.8)
  remove o wrapper após prova de ausência de consumidores
```

Antes do `DROP`, não foram encontrados:

- dependentes em `pg_depend`;
- policies consumidoras;
- rotinas consumidoras, excluído o próprio alvo;
- views ou materialized views consumidoras;
- triggers consumidoras;
- referências no runtime ativo em `src/`.

Referências em migrations, testes, scripts de QA e documentação foram classificadas como históricas, não como consumidores de runtime. `UNRESOLVED=0`.

## 4. Comparação dos helpers e classificação

O helper residual não possuía comportamento próprio. Ele delegava ao helper operacional canônico, enquanto o domínio financeiro vigente usa `private.financeiro_gestor_tem_acesso_fundo(uuid)`, que preserva a cadeia canônica de autorização.

Contrato canônico preservado:

```text
auth.uid() válido
  + perfil ativo
  + papel operacional gestor ativo
  + usuario_fundos ativo no fundo-alvo
  + fundo ativo
```

Super Admin puro não recebe carteira operacional implicitamente. Um perfil híbrido precisa do papel gestor e do vínculo ativo com o fundo. Como nenhum consumidor ainda chamava o wrapper e sua semântica já estava integralmente coberta pelos helpers canônicos, a classificação foi `DEAD_LEGACY`.

## 5. Migration e aplicação em homologação

A migration criada foi:

`supabase/migrations/20260817200014_p2_6_8_remover_legado_estrutural_rlx.sql`

Ela:

1. valida a assinatura e a forma esperada do alvo;
2. confirma a presença dos helpers canônicos;
3. aborta se detectar dependentes ou consumidores ativos;
4. revoga grants de `PUBLIC`, `anon`, `authenticated` e `service_role`;
5. executa `DROP FUNCTION` sem `CASCADE`;
6. confirma a ausência do alvo e a permanência dos helpers canônicos;
7. não altera tabelas nem dados de negócio.

O clean-room técnico anterior à homologação passou. A migration foi aplicada pelo fluxo normal da Supabase CLI no projeto autorizado. O histórico terminou com `126` migrations locais e `126` remotas, `missing=0`, `remote-only=0` e `order mismatch=0`. O `db push --dry-run` posterior ficou sem migrations pendentes.

## 6. Scan estrutural e runtime após a migration

Resultados finais do saneamento:

- `private.rlx_gestor_tem_acesso_fundo(uuid)`: ausente;
- objetos estruturais DB `rlx_*`: `0`;
- consumidores ativos do alvo no banco: `0`;
- referências estruturais ativas em `src/`: `0`;
- helpers canônicos operacional e financeiro: presentes;
- `ZERO_RLX_STRUCTURAL=PASS`.

O artefato canônico é `zero-rlx-structural-p2-6-8.json`; o inventário detalhado está em `structural-runtime-scan-p2-6-8.json`.

## 7. Allowlist histórica preservada

Foram preservados deliberadamente:

- datasets `RLX_GOLDEN_V1` e `RLX_GOLDEN_V2`;
- versões históricas `RLX_MATCH_V1`, `RLX_RECON_V1`, `RLX_LOGISTICA_V1` e `RLX_EXPOSICAO_V1`;
- migrations, fixtures, testes e relatórios históricos;
- fallbacks `RLX_MAX_PARSE_MS`, `RLX_MAX_IMPORT_ROWS` e `RLX_PROVIDER_TIMEOUT_MS`;
- alias `/api/cron/rlx-financeiro`.

Esses itens representam contratos congelados, trilha histórica ou compatibilidade deliberada e não são drift estrutural de banco.

## 8. Clean-room final e schema parity

Após a aplicação em homologação, um novo clean-room foi criado do zero, separado do ambiente técnico anterior. O ambiente aplicou bootstrap e as `126/126` migrations e foi destruído ao final.

Etapas concluídas antes do gate de identidade:

- migration history: `PASS`;
- schema parity: `0` diferenças materiais;
- diferenças ambientais permitidas: `49`, identificadas dinamicamente como objetos internos do Storage local;
- bootstrap e seed: `PASS`;
- Golden V1: `PASS`;
- Golden V2: `384/384 PASS`;
- Golden Security: `5/5 PASS`;
- P2.4: `13` funcionais + `27` segurança, `PASS`;
- P2.5: `19` funcionais + `16` segurança, `PASS`;
- P2.6: `8` funcionais + `25` segurança, `PASS`.

O clean-room final foi encerrado como `FAIL` quando a matriz autenticada detectou acesso cruzado em `public.profiles`. O cleanup do ambiente descartável passou.

## 9. Regressão de identidade encontrada

A matriz foi ampliada para executar explicitamente o contrato exigido pelo P2.6.8:

- perfil próprio: `ALLOW`;
- papel próprio: `ALLOW`;
- perfil de outro usuário: `DENY`;
- papel de outro usuário: `DENY`;
- anônimo em perfis e papéis: `DENY`.

Resultado: `90/91`, com uma falha crítica:

```text
ator: GESTOR_A
recurso: profiles
ação: SELECT_OTHER
esperado: DENY
obtido: ALLOW
HTTP: 200
```

O inventário read-only em homologação confirmou as policies relevantes:

```text
profiles_gestor_all  PERMISSIVE  PUBLIC         ALL     get_user_role() = 'gestor'
profiles_own_select PERMISSIVE  authenticated  SELECT  id = auth.uid()
```

Como policies permissivas são combinadas por `OR`, `profiles_gestor_all` torna verdadeira a leitura de qualquer perfil para um gestor. A policy correta de leitura própria não consegue restringir a policy ampla.

Essa policy já existe no baseline (`supabase/schema.sql` e `supabase/homolog_setup.sql`) e não depende do helper RLX removido. Portanto:

- a remoção RLX não causou a regressão;
- a falha é reproduzível em homologação e clean-room;
- corrigi-la exige uma fase incremental específica de identidade/RLS;
- nenhuma mutação fora do escopo foi aplicada durante o P2.6.8.

## 10. Data API, cross-fund, Storage e approval bypass

A execução final da Data API parou com `90 PASS / 1 FAIL`. Uma execução completa anterior, sobre o mesmo schema P2.6.8 mas antes da inclusão explícita dos cinco asserts de identidade, havia aprovado os contratos existentes, incluindo:

- cross-fund: `39/39`, `zero_leak=true`;
- Storage: `15/15`;
- approval bypass: `status_before=solicitada`, tentativa `aprovada`, resultado `DENY`, `status_after=solicitada`.

Esses resultados não anulam o finding de identidade. O gate agregado de RLS permanece `FAIL` até uma nova execução completa após a correção da policy.

## 11. Login, MFA e cron

- `/login`: `200` no smoke local executado;
- cron sem autorização: `401`;
- `/api/cron/financeiro`: `200`;
- `/api/cron/rlx-financeiro`: `200`;
- providers externos chamados: nenhum.

O fluxo MFA real com usuário QA controlado não foi executado. `AUTHENTICATED_SMOKE_LOGIN_MFA` permanece pendente; não houve promoção baseada em relato textual.

## 12. Dependências, qualidade e segurança

Resultados executados no baseline da mudança:

- `npm audit --omit=dev`: zero vulnerabilidades;
- `npx tsc --noEmit`: `PASS`;
- `npm test -- --run`: `143` arquivos aprovados + `1` skipped; `1028` testes aprovados + `3` skipped;
- `npm run lint`: `PASS`, zero erros e seis warnings preexistentes;
- `git diff --check`: `PASS`;
- `npx next build --webpack`: `PASS`, Next `16.3.1`;
- secret scan: zero achados.

Os Supabase Advisors permaneceram inalterados: `103` findings de segurança e `343` de performance, nenhum relacionado ao objeto removido. O backlog não foi corrigido por estar fora do escopo.

## 13. Readiness consolidado

O readiness atualizado registra:

- `ZERO_RLX_STRUCTURAL=PASS`;
- `CLEAN_ROOM_SEED_E2E=FAIL` pela matriz autenticada incompleta;
- `RLS_HOMOLOG=FAIL` pela policy `profiles_gestor_all`;
- `RLS_CLEAN_ROOM=FAIL` pelo acesso cruzado reproduzido;
- `PERFORMANCE_FULL_PIPELINE=FAIL` preexistente;
- recomendação: `NO-GO`;
- `credential_rotation_required=true`.

Placar consolidado: `33 PASS / 4 FAIL / 10 PENDENTE / 1 N/A`.

Continuam pendentes, além da correção de identidade:

- login/MFA real controlado;
- smoke visual da central;
- aprovações e cenários operacionais autenticados;
- concorrência E2E/TOCTOU/stale review;
- performance do pipeline completo;
- homologação de providers externos quando aplicável.

## 14. Arquivos alterados

- migration incremental de remoção do wrapper RLX;
- runner da matriz autenticada, ampliado com os asserts de identidade obrigatórios;
- artefatos técnico e final do clean-room P2.6.8;
- artefatos Golden, Data API, cross-fund e Storage;
- inventários estrutural e runtime;
- readiness e secret scan regenerados;
- este relatório.

O working tree foi preservado. Não houve commit, push, reset ou clean.

## 15. Riscos e próxima ação necessária

O risco residual crítico é a leitura cruzada de `public.profiles` por gestores. A próxima ação deve ser uma migration específica, fora do P2.6.8, que inventarie os consumidores legítimos de leitura de perfis, remova ou restrinja `profiles_gestor_all` e preserve apenas acessos mínimos comprovados. Depois, deve-se repetir integralmente a matriz de identidade, Data API, cross-fund, Storage e clean-room final.

## Conclusão

O objetivo estrutural foi atingido com segurança e evidência reproduzível: o legado RLX de banco foi removido sem `CASCADE`, sem perda de dados e sem consumidores órfãos. Entretanto, o critério de aceite da fase é composto e exige regressão de identidade aprovada. Como esse gate falhou, o parecer formal é:

```text
ZERO_RLX_STRUCTURAL = PASS
P2.6.8 = FAIL
READINESS = NO-GO
```

Produção permaneceu intocada, nenhuma credencial foi persistida e `credential_rotation_required=true` continua vigente.
