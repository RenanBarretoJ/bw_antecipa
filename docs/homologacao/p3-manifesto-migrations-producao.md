# P3 — Manifesto canônico de migrations de produção

## Fonte canônica

O manifesto executável e versionável está em `rehearsal/manifests/production-migrations.json`.

- hash do manifesto P5.2: `04b3aced455f39ab033b3261c4d079f175b071ea9231e6d0d51a2494d1b92d0e`;
- baseline já registrado em produção: 14 migrations;
- bridges pré-upgrade: 3;
- migrations promovíveis após o baseline: 176, incluindo a forward P5.2;
- migrations destrutivas exclusivas de homologação: 5, formalmente excluídas.

Cada entrada contém o nome do arquivo e o SHA-256 do SQL. A validação falha se um arquivo for alterado, omitido, duplicado, reordenado ou incluído indevidamente.

## Bridges obrigatórias

1. `20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql`
2. `20260827184403_bridge_documentos_representante_legado.sql`
3. `20260827185557_bridge_remover_policies_legadas_gestor_global.sql`

## Correções P2 requeridas em produção

1. `20260827203000_p2_runtime_compatibilidade_sacado_admin.sql`
2. `20260827204000_p2_runtime_notificacoes_authenticated.sql`
3. `20260827205000_p2_runtime_restaurar_trigger_profile_auth.sql`

## Exclusões obrigatórias

As migrations abaixo não pertencem ao caminho de produção:

1. `20260723182639_reset_operacional_fundo_homolog_rpc.sql`
2. `20260728153646_reset_operacional_eventos_dominio.sql`
3. `20260804103235_corrigir_reset_postergacoes_canhoto.sql`
4. `20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql`
5. `20260823125731_corrigir_reset_dependencias_risco.sql`

Elas implementam ou corrigem resets destrutivos de homologação. Sua presença no diretório não autoriza aplicação em produção.

## Histórico real após o incidente P5.2

As cinco migrations bloqueadas foram aplicadas automaticamente em produção antes
da desativação de **Deploy to production**. Elas permanecem no histórico com o
estado `APPLIED_HISTORICALLY_BUT_NEUTRALIZED`; não se usa `migration repair` e
nenhuma linha do histórico é removida.

A migration promovível
`20260829170408_p5_2_neutralizar_resets_homolog_producao.sql` remove somente os
artefatos executáveis de reset. Em produção existente, ela é a única migration
aplicada manualmente nesta correção. Em upgrade limpo, as cinco migrations acima
são omitidas e a P5.2 executa como no-op idempotente.

## Classificação das correções P2

| Ajuste | Classificação | Vai para produção? | Evidência |
|---|---|---:|---|
| Grants/RLS do Sacado | `PRODUCTION_REQUIRED` | Sim | Migration `20260827203000`; policy isolada e grant mínimo de leitura |
| Campos usados pelas RPCs SA1 | `PRODUCTION_REQUIRED` | Sim | Migration `20260827203000`; compatibilidade do schema administrativo |
| Grants de notificações | `PRODUCTION_REQUIRED` | Sim | Migration `20260827204000`; `SELECT/UPDATE` protegidos por `auth.uid()` |
| Trigger `handle_new_user` | `PRODUCTION_REQUIRED` | Sim | Migration `20260827205000`; profile criado após inserção em `auth.users` |
| Estado explícito sem configuração operacional | `PRODUCTION_REQUIRED` | Sim | Página do Cedente e helper de domínio; evita erro de runtime |
| Origem WebSocket derivada no CSP | `SAFE_ENV_GUARDED` | Sim | Origem calculada da URL Supabase do ambiente, sem wildcard |
| Normalização de tokens nulos do clone | `REHEARSAL_ONLY` | Não | Executada somente por `prepare-runtime-local.mjs` contra loopback |
| Mailpit e `local_smtp` | `REHEARSAL_ONLY` | Não | Configuração existe apenas em `rehearsal/supabase/config.toml` |
| Exceção SMTP sem TLS local | `SAFE_ENV_GUARDED` | Código inerte em produção | Exige simultaneamente `rehearsal/local`, loopback e opt-in explícito |
| Origem `localhost` dos convites locais | `REHEARSAL_ONLY` | Não | Definida somente pelo ambiente sanitizado do runtime local |

## Validação

```bash
npm run rehearsal:release:manifest:validate
npm run rehearsal:test
```

Não executar `supabase db push` cego. A janela de produção deve consumir exatamente a ordem e os hashes deste manifesto após revisão de quatro olhos.
