# Escopo 9D — schema diff homologação versus base limpa

## Resultado

**Diff não concluído.** A base limpa não foi criada, portanto não existe lado B confiável para comparação.

## Lado A — homologação

Catálogo coletado dentro de transação PostgreSQL `READ ONLY` no projeto `fhgkmggthxikfpogrvaa`:

| Categoria | Quantidade |
| --- | --- |
| Relações | 64 |
| Colunas | 873 |
| Enums | 11 |
| Constraints | 388 |
| Índices | 231 |
| Funções | 89 |
| Triggers | 51 |
| Policies | 154 |
| Buckets | 6 |

## Lado B — base criada do zero

- Status: indisponível.
- Primeira tentativa: Supabase CLI 2.88.1 falhou ainda em `supabase start`, antes de executar qualquer migration.
- Erro registrado: failed to start docker container "": Error response from daemon: unable to find user supabase: no matching entries in passwd file.
- Tentativa complementar com CLI 2.111.0: o Docker Desktop apresentou armazenamento interno somente leitura/erro de I/O durante o pull da imagem PostgreSQL. Nenhuma migration foi executada.
- Mutação remota: nenhuma.

## Diferenças que podem ser afirmadas sem lado B

Há 86 objetos remotos candidatos sem origem local identificada após excluir índices implícitos de PK/UNIQUE e reconhecer DDL dentro de blocos dinâmicos:

| Tipo | Quantidade |
| --- | --- |
| table | 16 |
| enum | 10 |
| index | 23 |
| function | 1 |
| trigger | 8 |
| policy | 28 |

Os 16 objetos-base de tabela e 10 enums-base são bloqueadores estruturais: o diretório local começa em `003_storage_buckets_env.sql` e não contém migrations `001`/`002` que criem esse núcleo.

## Classificação do diff

| Classe | Parecer |
|---|---|
| Segurança / RLS | 9B aprovado em 50/50 e 9C em 19/19 no schema materializado; equivalência com instalação limpa não comprovada. |
| Funcional / financeira | Não comparável sem base limpa. |
| Estrutural | Crítico: baseline de tabelas/enums não está versionado no diretório de migrations. |
| Storage | Estado material 9C equivalente; bootstrap limpo não comprovado. |
| Índices / performance | 23 índices remotos candidatos sem origem local; parte acompanha o schema-base ausente. |
| Cosmética / dados de ambiente | Excluídos do escopo do diff. |

## Próxima evidência necessária

1. Restaurar a saúde do Docker local ou usar projeto QA descartável explicitamente autorizado.
2. Reexecutar `npm run perf9d:clean-room -- --confirm DISPOSABLE_LOCAL_ONLY`.
3. A base deve aplicar as 73 migrations em ordem e gerar dump normalizado.
4. Somente então comparar tabelas, tipos, constraints, funções, grants, RLS e Storage com homologação.
