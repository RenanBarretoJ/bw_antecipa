# Correção da recursão RLS entre `cedente_fundos` e `fundos`

## Resumo executivo

O onboarding de cedentes falhava com `infinite recursion detected in policy for relation "cedente_fundos"`. A causa não estava nos dados PERF9A: a policy de `INSERT` em `cedente_fundos` consultava `fundos`, e as policies de leitura de `fundos` consultavam novamente `cedente_fundos`.

A correção remove essa dependência circular e mantém a autorização no banco. As consultas necessárias foram encapsuladas em helpers booleanos no schema `private`, com identidade derivada exclusivamente de `auth.uid()`, `SECURITY DEFINER`, `search_path` vazio e `EXECUTE` concedido apenas a `authenticated`.

Nenhuma tabela, constraint, dado, auditoria, action ou regra de MFA foi alterada. A migration foi validada em uma transação real contra homologação e integralmente revertida ao final.

## Reprodução e causa-raiz

Fluxo anterior:

```text
INSERT public.cedente_fundos
  -> cedente_fundos_gestor_insert
  -> SELECT public.fundos
  -> fundos_cedente_vinculado_select / fundos_consultor_vinculado_select
  -> SELECT public.cedente_fundos
  -> reavalia as policies de cedente_fundos
  -> infinite recursion detected
```

A recursão também estava presente no `WITH CHECK` de `UPDATE`, pois ele repetia a leitura direta de `fundos`. `SELECT` e `DELETE` de `cedente_fundos` não possuíam esse caminho direto, mas as policies de `fundos` continuavam estruturalmente dependentes de `cedente_fundos` e precisavam ser isoladas para impedir nova reentrada.

## Estado efetivo do banco antes da correção

A inspeção de `pg_policies`, `pg_class`, `pg_namespace`, `information_schema.role_table_grants`, `pg_proc`, `pg_indexes` e `pg_constraint` em homologação confirmou:

- `fundos` e `cedente_fundos` com RLS habilitada;
- `FORCE ROW LEVEL SECURITY` desabilitado nas duas tabelas, preservado pela correção;
- tabelas e helpers existentes pertencentes a `postgres`;
- todas as policies envolvidas como `PERMISSIVE` e destinadas a `authenticated`;
- `cedente_fundos_gestor_insert` e `cedente_fundos_gestor_update` consultando `fundos` diretamente;
- `fundos_cedente_vinculado_select` e `fundos_consultor_vinculado_select` consultando `cedente_fundos` diretamente;
- `private.usuario_tem_acesso_fundo(uuid)` já existente como `SECURITY DEFINER`, mas sem validar `profiles.status`;
- grants de tabela existentes para `authenticated` e `service_role`; não foram ampliados;
- `anon` sem privilégios em `fundos` e `cedente_fundos`;
- unicidade ativa do par preservada pelo índice parcial `uq_cedente_fundos_par_ativo`;
- índices adequados já existentes para `cedente_fundos(fundo_id, status)`, `cedente_fundos(cedente_id, status)`, `usuario_fundos(usuario_id, status)` e `usuario_fundos(fundo_id, status)`.

As migrations posteriores ao Escopo 9B foram revisadas. A migration `20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql` trata outro ciclo, entre operações e relações operação–NF, e não substitui as policies deste fluxo.

## Arquitetura corrigida

Fluxo administrativo:

```text
policy de cedente_fundos
  -> private.usuario_tem_acesso_fundo
  -> profiles + usuario_fundos
  -> fim

policy de INSERT/novo estado do UPDATE
  -> private.usuario_pode_administrar_fundo_ativo
  -> usuario_tem_acesso_fundo + fundos
  -> fim
```

Fluxo do cedente:

```text
policy de fundos
  -> private.cedente_tem_acesso_fundo
  -> profiles + get_user_cedente_id + cedente_fundos
  -> fim (leitura controlada, sem reavaliar RLS)
```

Fluxo do consultor:

```text
policy de fundos
  -> private.consultor_tem_acesso_fundo
  -> profiles + consultor_cedente + cedente_fundos
  -> fim (leitura controlada, sem reavaliar RLS)
```

Nenhum caminho retorna à policy que iniciou a decisão.

## Helpers e segurança

### `private.usuario_tem_acesso_fundo(uuid)`

Foi endurecido para exigir simultaneamente:

- `auth.uid()` presente;
- perfil com papel `gestor`;
- perfil com status `ativo`;
- vínculo ativo em `usuario_fundos` para o fundo informado.

Consulta somente `profiles` e `usuario_fundos`.

### `private.usuario_pode_administrar_fundo_ativo(uuid)`

Combina a autorização administrativa anterior com a existência do fundo em estado ativo. É usado somente no `INSERT` e no novo estado do `UPDATE`, preservando a regra anterior de que novos vínculos e alterações não apontem para fundo inativo.

### `private.cedente_tem_acesso_fundo(uuid)`

Exige perfil ativo com papel `cedente` e vínculo ativo do cedente canônico retornado por `get_user_cedente_id()` com o fundo informado. Não retorna IDs nem linhas.

### `private.consultor_tem_acesso_fundo(uuid)`

Exige perfil ativo com papel `consultor` e carteira em `consultor_cedente` ligada a um `cedente_fundos` ativo no fundo informado. Não amplia a carteira existente.

### Controles comuns

Todos os helpers novos ou ajustados:

- são `STABLE`;
- usam `SECURITY DEFINER` porque precisam terminar o grafo de RLS;
- pertencem a `postgres`, conforme o padrão atual;
- usam `SET search_path = ''`;
- qualificam explicitamente `auth`, `public` e `private`;
- derivam o usuário de `auth.uid()`;
- não aceitam `user_id`, papel ou tenant fornecido pelo cliente;
- não usam SQL dinâmico;
- retornam somente booleano;
- têm `EXECUTE` revogado de `PUBLIC`, `anon`, `authenticated` e `service_role` antes do grant final;
- concedem `EXECUTE` somente a `authenticated`.

O uso de `SECURITY DEFINER` segue a recomendação do Supabase para lookups internos de RLS, mantendo a função fora do schema exposto e com privilégios mínimos.

## Policies alteradas

### `cedente_fundos_gestor_insert`

- ator: gestor autenticado e ativo;
- autorização: vínculo ativo em `usuario_fundos` com o fundo de destino;
- estado: fundo deve estar ativo;
- não consulta mais `fundos` diretamente na policy.

### `cedente_fundos_gestor_update`

- `USING`: gestor administra o fundo original;
- `WITH CHECK`: gestor administra o fundo final e o fundo final está ativo;
- impede mover a linha para fundo não autorizado.

### `fundos_cedente_vinculado_select`

- cedente vê somente fundos com vínculo ativo de seu cedente canônico;
- usa helper privado e não consulta mais `cedente_fundos` diretamente.

### `fundos_consultor_vinculado_select`

- consultor vê somente fundos alcançados por sua carteira atual;
- usa helper privado e não consulta mais `cedente_fundos` diretamente.

As policies de `SELECT` e `DELETE` administrativo em `cedente_fundos`, bem como as policies próprias de cedente e consultor nessa tabela, foram preservadas porque já não formavam o ciclo identificado.

## Matriz de autorização validada

A migration foi aplicada dentro de uma transação PostgreSQL real, com `SET LOCAL ROLE` e claims de sessão compatíveis com `authenticated`/`anon`, e revertida ao final. Resultado: 20/20 verificações aprovadas.

| Cenário | Resultado |
|---|---|
| Gestor de A cria vínculo em A | permitido |
| Gestor multifundo vincula cedente já vinculado a B também em A | permitido |
| Gestor de B cria em A | negado (`42501`) |
| Usuário sem vínculo cria | negado (`42501`) |
| Cedente cria vínculo | negado (`42501`) |
| Consultor cria vínculo | negado (`42501`) |
| Anônimo cria vínculo | negado (`42501`) |
| Gestor com perfil inativo cria | negado (`42501`) |
| Gestor cria em fundo inativo | negado (`42501`) |
| Cedente inexistente | integridade preservada (`23503`) |
| Mesmo par ativo novamente | unicidade preservada (`23505`) |
| Gestor atualiza vínculo autorizado | permitido |
| Gestor move vínculo para fundo não autorizado | negado (`42501`) |
| Gestor remove vínculo autorizado | permitido |
| Gestor lista seus fundos | isolado |
| Gestor multifundo lista A e B | permitido |
| Cedente lista fundos vinculados | isolado |
| Cedente lista `cedente_fundos` próprios | isolado |
| Consultor lista fundos da carteira | isolado |
| Catálogo final | sem ciclo, helpers restritos e RLS ativa |

Nenhum caso retornou `infinite recursion detected in policy`.

## Regressão do Escopo 9B e JWT real

A suíte autenticada existente foi executada contra o estado permanente atual de homologação com sessões Supabase reais elevadas a AAL2:

- 50/50 cenários aprovados;
- gestores A, B e multifundo;
- consultores A e B;
- cedente e sacado;
- leituras positivas e negativas;
- bloqueio de updates cruzados;
- RPCs de dashboard, relatórios e onboarding isoladas.

Como a nova migration foi deliberadamente revertida e não aplicada em homologação, o smoke da policy nova pela Data API com JWT assinado só pode ser executado depois da aplicação autorizada. A matriz transacional validou a policy nova com o papel PostgreSQL real `authenticated` e claims derivados de sessão; a suíte 9B validou separadamente os JWTs assinados/AAL2 e a regressão multifundo do ambiente.

## Performance e índices

Nenhum índice foi criado, pois os índices necessários já existem e cobrem os predicados dos helpers. Uma leitura autorizada de fundo, após aplicar a migration dentro da transação, produziu:

- plano raiz: `Index Only Scan`;
- planejamento: aproximadamente `0,143 ms`;
- execução: aproximadamente `0,487 ms`;
- uma linha retornada.

Os helpers são `STABLE`, e as policies os invocam por subquery `SELECT`, permitindo `initPlan` quando aplicável.

## Migration e arquivos

Migration incremental:

- `supabase/migrations/20260804171538_corrigir_recursao_rls_cedente_fundos.sql`

Validador comportamental:

- `scripts/perf9a/verify-recursao-rls-cedente-fundos-homolog.mjs`

Teste automatizado:

- `src/lib/performance/recursao-rls-cedente-fundos.test.ts`

Aplicação:

- nenhuma action ou serviço TypeScript foi alterado;
- o onboarding continua usando o cliente autenticado em `context.supabase`;
- nenhum `service_role` foi introduzido no INSERT operacional.

## Estado do banco

A validação executou:

```text
BEGIN
  -> aplica corpo da migration
  -> executa matriz RLS e EXPLAIN
  -> inspeciona pg_policies, funções, grants e RLS
ROLLBACK
```

Após o rollback:

- homologação continuou com a policy anterior, ainda recursiva;
- nenhum vínculo de teste foi persistido;
- nenhuma função ou policy nova permaneceu instalada;
- produção não foi acessada;
- nenhum `migration repair` foi executado.

## Ordem de aplicação em homologação

1. Registrar backup/estado de `pg_policies`, funções e grants atuais.
2. Aplicar `20260804171538_corrigir_recursao_rls_cedente_fundos.sql`.
3. Confirmar a entrada no histórico de migrations.
4. Recarregar o schema cache; a migration já envia `NOTIFY pgrst, 'reload schema'`.
5. Reexecutar o validador transacional sem a etapa de aplicação temporária, se adaptado.
6. Reexecutar `npm run perf9b:verify -- --env-file .env.homolog`.
7. Executar smoke real do onboarding com gestor autorizado.
8. Testar gestor não autorizado, cedente, consultor e anônimo.
9. Inspecionar `pg_policies`, grants e logs de erro.
10. Monitorar onboarding e listagens de fundos após o deploy.

## Rollback de emergência

O rollback deve ser uma nova migration corretiva e nunca uma edição da migration aplicada. A migration de emergência deverá:

1. remover as quatro policies recriadas;
2. restaurar as definições capturadas antes da aplicação;
3. remover os três helpers novos somente depois de remover seus dependentes;
4. restaurar a definição e os grants anteriores de `private.usuario_tem_acesso_fundo(uuid)`;
5. enviar `NOTIFY pgrst, 'reload schema'`.

Restaurar literalmente as policies anteriores reintroduzirá a recursão e deve ser usado apenas para recuperação emergencial acompanhada de bloqueio temporário do onboarding. O rollback não deve apagar vínculos, logs ou auditorias criados após a correção.

## Riscos residuais

- A migration ainda não está aplicada permanentemente em homologação.
- O smoke da policy nova via Data API/JWT assinado depende dessa aplicação autorizada.
- `FORCE ROW LEVEL SECURITY` permanece desabilitado porque esse é o estado vigente; habilitá-lo seria outro escopo.
- Existem grants e helpers públicos históricos mais amplos em outras tabelas (`profiles`, `cedentes`, `get_user_role`, `get_user_cedente_id`) que não foram alterados para manter o diff focado.
- A tentativa de gerar a migration pelo Supabase CLI 2.111.0 falhou com `LegacyMigrationNewWriteError` ao encontrar o diretório de migrations já existente; o arquivo incremental foi criado manualmente após essa falha, sem alterar o histórico remoto.

## Parecer

A correção remove estruturalmente o ciclo conhecido sem desabilitar RLS, sem usar `service_role`, sem exceções de dados e sem ampliar a visibilidade entre fundos. A matriz transacional demonstra o caminho feliz do onboarding e os principais bloqueios de autorização. O código está pronto para aplicação controlada em homologação, seguida obrigatoriamente pelo smoke via aplicação e pela inspeção final do catálogo permanente.
