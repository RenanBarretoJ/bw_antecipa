# Rehearsal local de upgrade: producao para homologacao

Este diretório mantém um stack Supabase local isolado para restaurar o baseline atual de produção antes de ensaiar migrations. O P0 **não aplica nenhuma migration de upgrade**.

## Guardas de segurança

- Produção é aceita somente pela rotina de exportação read-only.
- Restore, destroy e reset aceitam somente `127.0.0.1:55322` e o projeto local `bw-antecipa-prod-rehearsal`.
- O workdir tem migrations e seed desativados; as migrations de `supabase/migrations` não são executadas.
- Senhas, tokens, sessões e fatores MFA de Auth não são exportados. Usuários e identidades são recriados com IDs e metadados sanitizados, sem credencial utilizável.
- Binários de Storage não são copiados neste P0; somente `storage.buckets` e `storage.objects`.
- A exportação de Storage usa apenas a interseção compatível com o stack local. Campos gerenciados de versionamento/arquivamento presentes somente em produção são inventariados no manifesto, mas não restaurados.
- Tabelas públicas cujo nome indique credencial, segredo, senha, token ou chave têm os dados excluídos do dump e são registradas no manifesto.
- `snapshots/`, `reports/`, `tmp/` e `.env.rehearsal*` estão ignorados pelo Git.

Nunca execute `supabase db reset --linked`, `supabase db push` ou scripts de homologação a partir deste fluxo.

## Pré-requisitos

- Docker Desktop em execução, com pelo menos 7 GB disponíveis.
- Node.js compatível com o projeto.
- Dependências instaladas (`npm ci`).
- Acesso PostgreSQL **somente para leitura/exportação** à produção.
- Supabase CLI pinada pelo projeto (`npx supabase --version`).

O stack usa Postgres 17 e portas exclusivas:

- API: `55321`
- Postgres: `55322`
- Studio: `55323`
- Mailpit: `55324`
- Analytics: `55327`

Analytics/log shipping permanece desativado: não é necessário para validar Auth, Storage, API, RLS e banco, e evita dependência da API TCP do Docker Desktop no coletor Vector.

## 1. Configuração local não versionada

Crie `.env.rehearsal.local` na raiz, sem versioná-lo:

```dotenv
REHEARSAL_PRODUCTION_PROJECT_REF=wwsndnuvnjuabpbjwlck
REHEARSAL_PRODUCTION_DB_URL=postgresql://USUARIO:SENHA@HOST:5432/postgres
REHEARSAL_CONFIRM_EXPORT=EXPORTAR_SOMENTE_LEITURA_wwsndnuvnjuabpbjwlck
```

A URL precisa identificar o mesmo project ref no host direto (`db.<ref>.supabase.co`) ou no usuário do pooler (`postgres.<ref>`). O script ativa `default_transaction_read_only=on` e aborta se não conseguir confirmá-lo.

Não use a URL de homologação. Não reutilize `.env.homolog`.

## 2. Iniciar e parar o stack

```powershell
npm run rehearsal:start
npm run rehearsal:stop
```

Para remover apenas os volumes do projeto local dedicado:

```powershell
npm run rehearsal:destroy
```

Os wrappers capturam a saída do CLI para não imprimir chaves locais ou URLs com senha.

## 3. Exportar produção em modo read-only

```powershell
npm run rehearsal:export:production
```

Artefatos gerados em `rehearsal/snapshots/current/`:

- `production-public.dump`: schema, RLS, funções, triggers, ACLs e dados de `public` em formato custom;
- `production-auth-sanitized.sql`: usuários/identidades sem senhas, tokens, sessões ou MFA;
- `production-storage-metadata.sql`: buckets e metadados de objetos, sem binários;
- `production-migration-history.sql`: baseline de `supabase_migrations.schema_migrations`;
- `manifest.json`: versão, escopo, exclusões e checksums.

Schemas gerenciados (`auth` e `storage`) não têm seu DDL sobrescrito. O DDL local é fornecido pelo stack Supabase compatível; somente os dados estritamente necessários são repostos.

## 4. Restaurar e validar o baseline

```powershell
npm run rehearsal:restore
npm run rehearsal:baseline
```

O relatório `rehearsal/reports/baseline-current.json` contém contagens, status, IDs, vínculos, hashes agregados, tabelas e migration history. O arquivo contém identificadores reais e não deve sair do diretório ignorado.

O baseline compara automaticamente os números auditados anteriormente:

- 12 cedentes;
- 45 operações;
- 903 NFs;
- 123 documentos;
- 1.635 objetos de Storage;
- 26 operações com remessa/retorno legado.

Divergências são reportadas, nunca corrigidas automaticamente.

## 5. Rebuild e prova de determinismo

Um ciclo completo destrói o volume local, sobe o stack vazio, restaura o mesmo snapshot e gera novo baseline:

```powershell
npm run rehearsal:rebuild
```

Dois ciclos consecutivos e comparação do hash lógico:

```powershell
npm run rehearsal:verify-determinism
```

O ticket passa somente quando o comando terminar com:

```text
RESTORE_PRODUCAO_LOCAL = DETERMINISTICO
```

## Validações dos scripts

```powershell
npm run rehearsal:test
git diff --check
```

## Limitações intencionais do P0

- Os comandos de restore e baseline não aplicam migrations pendentes.
- Bridges são executadas somente pelo runner explícito do P1.
- Objetos físicos dos buckets não são copiados.
- Credenciais de integrações não são restauradas.
- Login dos usuários clonados permanece desabilitado porque hashes e tokens não são exportados.

O P1 abaixo usa esse baseline determinístico, mede invariantes pré/pós e para no primeiro erro, sem tocar produção.

## P1: upgrade controlado e determinismo

Depois de `rehearsal:verify-determinism`, execute:

```powershell
npm run rehearsal:upgrade
```

O executor congela `PRE_UPGRADE.json`, aplica uma migration por vez no container local, registra cada sucesso no histórico local, revalida as contagens centrais e para na primeira falha. Cada arquivo roda em transação única e com o `search_path` do executor remoto `postgres`, embora o clone local use `supabase_admin` para compatibilidade de ownership do restore.

Antes da cadeia histórica, o runner aplica e registra estas bridges promovíveis:

1. `bridge_consultor_cedentes_para_consultor_cedente`;
2. `bridge_documentos_representante_legado`;
3. `bridge_remover_policies_legadas_gestor_global`.

Essa ordem é obrigatória porque as incompatibilidades existem no baseline real de produção e precisam ser reconciliadas antes das migrations que assumem o schema canônico. As migrations dedicadas à RPC destrutiva `reset_operacional_fundo_homolog` são bloqueadas explicitamente.

Depois de uma cadeia completa, gere e valide o snapshot pós-upgrade:

```powershell
npm run rehearsal:post-upgrade
```

Para executar dois ciclos completos independentes — destroy, restore do dump original, baseline, bridges, migrations e `POST_UPGRADE` — use:

```powershell
npm run rehearsal:verify-upgrade
```

O gate final exige:

```text
UPGRADE_REHEARSAL = DETERMINISTICO
```

Os relatórios ficam somente em `rehearsal/reports/`, ignorado pelo Git. Eles contêm hashes dos identificadores preservados, contagens, integridade referencial, backfills, fingerprints do schema, matriz RLS executada em transações com rollback e pré-condições de cutover.

Com o clone já migrado, a idempotência das bridges pode ser revalidada por:

```powershell
npm run rehearsal:test-bridges
```
