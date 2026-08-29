# P5.2 — Neutralização forward das migrations de homologação em produção

## Escopo e contenção

O workflow de integração GitHub/Supabase `1c235dd7a6544b5fa9f67d022425b444`
aplicou migrations da branch `main` no projeto de produção
`wwsndnuvnjuabpbjwlck`. A opção **Deploy to production** foi desativada no
Dashboard e permaneceu desligada após atualização da página, conforme validação
operacional em 29/08/2026.

Antes da migration forward, o `EXECUTE` da função destrutiva principal foi
revogado de `service_role`. `anon` e `authenticated` já não possuíam acesso. Não
houve chamada da RPC de reset durante a contenção e nenhuma operação de reset
foi executada.

## Auditoria das cinco migrations

| Migration | Objetos criados | Objetos alterados | Grants | Policies | Triggers | Dados alterados na aplicação? | Efeito final / classificação |
|---|---|---|---|---|---|---|---|
| `20260723182639_reset_operacional_fundo_homolog_rpc.sql` | Função `public.reset_operacional_fundo_homolog(uuid,text,boolean,text,text)` | Remove eventual overload antigo com quatro argumentos | Revoga `PUBLIC`; concede `EXECUTE` a `service_role` | Nenhuma | Nenhum criado. O corpo da função contém manipulação de triggers somente se a RPC for chamada | Não. O DML está dentro do corpo PL/pgSQL e a migration não chama a função | `HOMOLOG_ARTIFACT_TO_REMOVE` |
| `20260728153646_reset_operacional_eventos_dominio.sql` | Mesmo objeto e mesmo conteúdo binário da migration anterior | Substitui a mesma função | Mesmo grant para `service_role` | Nenhuma | Nenhum criado | Não | `NO_NET_EFFECT` em relação à anterior e `HOMOLOG_ARTIFACT_TO_REMOVE` para a função resultante |
| `20260804103235_corrigir_reset_postergacoes_canhoto.sql` | Helper `reset_operacional_fundo_homolog_sem_postergacoes(...)` e novo wrapper principal | Renomeia a implementação anterior ou remove wrapper já existente | Helpers sem acesso; wrapper com `EXECUTE` para `service_role` | Nenhuma | Nenhum criado. Alterações de trigger existem apenas no corpo não executado | Não | `HOMOLOG_ARTIFACT_TO_REMOVE` |
| `20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql` | Helper `reset_operacional_fundo_homolog_sem_dependencias_recentes(...)` e novo wrapper principal | Renomeia/substitui a cadeia anterior | Helpers sem acesso; wrapper com `EXECUTE` para `service_role` | Nenhuma | Nenhum criado. Alterações de trigger existem apenas no corpo não executado | Não | `HOMOLOG_ARTIFACT_TO_REMOVE` |
| `20260823125731_corrigir_reset_dependencias_risco.sql` | Helper cujo nome efetivo é truncado pelo PostgreSQL para `reset_operacional_fundo_homolog_sem_dependencias_logisticas_dup(...)` e novo wrapper principal | Substitui a implementação final da cadeia de reset | Helpers sem acesso; wrapper com `EXECUTE` para `service_role` | Nenhuma | Nenhum criado. Alterações de trigger existem apenas no corpo não executado | Não | `HOMOLOG_ARTIFACT_TO_REMOVE` |

O patch `20260827213304_p3_1_vincular_cedentes_dlz.sql` também foi aplicado no
mesmo evento automático, porém é um `LEGITIMATE_PRODUCTION_OBJECT` e deve ser
preservado.

As consultas de catálogo não encontraram dependências de runtime para as quatro
funções finais. A busca no repositório encontrou consumidores apenas nos scripts
e manuais de reset de homologação, sem chamada no runtime da aplicação. Logs das
últimas 24 horas não registraram invocação da RPC.

## Modelo de correção

```text
Histórico real (198 migrations)
  ├─ 5 migrations de homologação presentes
  ├─ patch P3.1 legítimo presente
  └─ artefatos de reset instalados
                ↓
20260829170408_p5_2_neutralizar_resets_homolog_producao.sql
                ↓
Histórico preservado (199 migrations)
  ├─ 5 migrations = APPLIED_HISTORICALLY_BUT_NEUTRALIZED
  ├─ patch P3.1 preservado
  └─ nenhuma função reset_operacional_fundo_homolog% ativa
```

A forward é transacional, idempotente e sem DML operacional. Ela revoga os
grants e remove, com `DROP FUNCTION ... RESTRICT`, todas as funções públicas com
o prefixo exclusivo de homologação. Uma dependência inesperada aborta a
transação; não há `CASCADE`. Ao final, uma asserção de catálogo falha caso algum
artefato permaneça.

O arquivo canônico é
`20260829170408_p5_2_neutralizar_resets_homolog_producao.sql`. A aplicação
manual pela API de migrations do Supabase registrou a versão operacional
`20260829173938` com o nome `p5_2_neutralizar_resets_homolog_producao`. Esse
mapeamento é preservado no manifesto e no postflight; a tabela de histórico não
foi editada manualmente.

Em instalação limpa, as cinco migrations continuam excluídas do caminho
promovível e a forward é aplicada como no-op seguro. O histórico das migrations
já executadas em produção não é apagado, reparado, renumerado ou adulterado.

## Baseline protegida

| Métrica | Esperado antes e depois |
|---|---:|
| Fundos | 2 |
| Cedentes | 12 |
| Operações | 46 |
| Notas fiscais | 910 |
| Documentos | 123 |
| Storage metadata | 1.644 |
| Auth users / profiles | 23 / 23 |
| Operações Fromtis históricas | 26 |
| Órfãos / FKs inválidas | 0 |
| DLZ readiness | `READY` |

## Gates

| Gate | Estado |
|---|---|
| `SUPABASE_AUTO_MIGRATION_MAIN` | `DISABLED` |
| `BLOCKED_MIGRATIONS_EFFECT_AUDIT` | `PASS` |
| `NO_OPERATIONAL_DATA_CHANGE` | `CONFIRMED` |
| `SERVICE_ROLE_DESTRUCTIVE_RESET` | `BLOCKED` |
| `FORWARD_MIGRATION` | `CERTIFIED` |
| `P5_2_FORWARD_FIX_REHEARSAL` | `DETERMINISTICO` |
| `P5_2_CLONE_SMOKE` | `PASS` |
| `P5_2_PRODUCTION_FORWARD_MIGRATION` | `PASS` |
| `P5_2_PRODUCTION_POSTFLIGHT` | `PASS` |
| `OPERATION_FREEZE_RELEASED` | `NAO` |

O freeze permanece ativo até todos os gates de produção e o smoke real serem
concluídos. Esta etapa não autoriza chamadas Sinqia/Terra, envio externo de CNAB,
alteração de IMPULSE ou habilitação de risco/financeiro.

## Evidências do clone

O clone foi reconstruído integralmente duas vezes a partir do snapshot
sanitizado. Em cada ciclo, a cadeia chegou primeiro a 192 migrations, depois
reproduziu as cinco migrations bloqueadas e o patch P3.1, totalizando 198. A
forward foi aplicada e registrada como a migration 199; uma segunda execução da
mesma SQL foi no-op.

Os dois ciclos produziram o mesmo hash semântico:

`4ac33649dbfe43ec9a7e7430efdb8a5a957c52d07519362ec0a7b18c6d579e13`

O smoke local validou:

- Super Admin/Gestor, Cedente e Sacado autenticados com MFA local: 3/3;
- segurança da sessão autenticada: válida nos três contextos;
- 46/46 detalhes de operações históricas carregáveis;
- 910/910 NFs preservadas;
- 3/3 buckets de Storage compatíveis;
- DLZ readiness: `PASS`;
- operação controlada criada pelo Cedente e aprovada localmente pelo Gestor;
- saídas externas removidas do ambiente;
- serializador/golden CNAB: 9/9 testes.

Os relatórios gerados localmente ficam em `rehearsal/reports/` e são ignorados
pelo Git por conterem evidências de execução do clone.
