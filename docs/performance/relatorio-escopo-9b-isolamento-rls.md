# Relatório do Escopo 9B — Isolamento multifundo e carteira do consultor

**Projeto:** BW Antecipa
**Ambiente verificado:** homologação Supabase
**Escopo:** exclusivamente RLS, helpers de autorização, grants, regressão de
isolamento, evidências e documentação.
**Data da verificação:** 30/07/2026

## 1. Objetivo

Corrigir a exposição cruzada identificada no primeiro gate da rota de
performance. Policies antigas autorizavam qualquer linha quando o usuário
possuía apenas o papel gestor ou consultor; como policies permissivas são
combinadas por OR, as restrições posteriores não protegiam efetivamente o
fundo ou a carteira.

O Escopo 9B passou a exigir:

- gestor com vínculo ativo em usuario_fundos para o fundo da linha;
- operação resolvida por operacoes.cedente_fundo_id;
- NF com contexto coerente em fundo_id, cedente_fundo_id e cedente_id;
- consultor vinculado ao cedente por consultor_cedente;
- WITH CHECK para impedir mover uma linha autorizada de um fundo para outro;
- acesso autenticado sem exposição equivalente para anon.

Não foram alteradas telas, loaders, server actions, regras financeiras,
snapshots, eventos, autenticação/MFA ou RPCs de negócio.

## 2. Diagnóstico anterior

As policies verificadas antes da correção incluíam:

| Tabela | Policy problemática | Problema |
|---|---|---|
| fundos | fundos_gestor_all | permitia ALL por papel gestor |
| fundos | fundos_gestor_select | SELECT para public por papel gestor |
| usuario_fundos | usuario_fundos_gestor_manage | permitia ALL por papel gestor |
| cedente_fundos | cedente_fundos_gestor_all | permitia ALL por papel gestor |
| consultor_cedente | consultor_cedente_gestor_all | permitia ALL por papel gestor |
| notas_fiscais | notas_fiscais_gestor_all | ALL para public por papel gestor |
| notas_fiscais | notas_fiscais_consultor_select | leitura para public por papel consultor |
| operacoes | operacoes_gestor_all | ALL para public por papel gestor |
| operacoes_nfs | operacoes_nfs_gestor_all | ALL para public por papel gestor |
| operacoes_nfs | operacoes_nfs_consultor_select | leitura para public por papel consultor |

Esse desenho explicava os resultados NO-GO do Escopo 9A: usuários com sessão
AAL2 conseguiam consultar IDs pertencentes a outro fundo ou a outra carteira.

## 3. Arquitetura da correção

Antes:

    JWT
     ↓
    get_user_role() = gestor/consultor
     ↓
    Policy permissiva por papel
     ↓
    Linhas de todos os fundos/carteiras

Depois:

    JWT autenticado
     ↓
    auth.uid()
     ├─ gestor → usuario_fundos ativo → fundo
     └─ consultor → consultor_cedente → cedente
                             ↓
              vínculo operacional da linha
                             ↓
                       RLS + WITH CHECK

Operações usam o caminho canônico:

    operacoes.cedente_fundo_id
     → cedente_fundos.id
     → cedente_fundos.fundo_id

Notas fiscais usam fundo_id, cedente_fundo_id e cedente_id conjuntamente.

## 4. Migrations aplicadas

### 20260730190000_escopo9b_corrigir_isolamento_rls.sql

- valida as tabelas e colunas canônicas;
- habilita RLS em fundos, usuario_fundos, cedente_fundos,
  consultor_cedente, notas_fiscais, operacoes e operacoes_nfs;
- cria helpers no schema privado;
- remove policies role-only e recria policies explícitas para leitura e
  escrita;
- restringe as policies à role authenticated;
- revoga grants de anon e mantém CRUD para authenticated;
- notifica recarga do schema do PostgREST.

### 20260730194500_escopo9b_policies_explicitas.sql

Substitui os três grupos administrativos residuais em FOR ALL por policies
separadas de SELECT, INSERT, UPDATE e DELETE em usuario_fundos,
cedente_fundos e consultor_cedente. A separação torna o comando autorizado e
seu WITH CHECK auditáveis individualmente.

### 20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql

Corrige a recursão detectada na primeira execução da matriz: a policy de
operação do sacado consultava operacoes_nfs, que por sua vez consultava a
operação novamente. Os helpers privados
private.sacado_tem_acesso_operacao(uuid) e
private.sacado_tem_acesso_operacao_nf(uuid, uuid) concentram essa consulta
sob SECURITY DEFINER e eliminam o ciclo de avaliação.

O helper existente public.get_user_sacado_cnpj() retorna o CNPJ normalizado,
enquanto os dados históricos podem conter máscara. As policies do sacado e os
helpers passaram a comparar ambos os lados como 14 dígitos.

As três migrations foram aplicadas em homologação de forma transacional pelo
driver PostgreSQL configurado em .env.homolog. Nenhuma migration existente
foi editada.

## 5. Helpers de autorização

### private.usuario_tem_acesso_fundo(uuid)

Retorna verdadeiro somente quando o papel resolvido no servidor é gestor,
auth.uid() possui linha em usuario_fundos, o fundo_id coincide e o vínculo
está com status ativo.

### private.consultor_tem_acesso_cedente(uuid)

Retorna verdadeiro somente quando o papel é consultor, auth.uid() aparece em
consultor_cedente.consultor_id e o cedente da linha coincide.

### private.sacado_tem_acesso_operacao(uuid)

Resolve o acesso do sacado por meio das NFs vinculadas à operação e compara o
CNPJ normalizado do destinatário com get_user_sacado_cnpj(). Existe para evitar
recursão entre as policies de operacoes e operacoes_nfs.

Todos os helpers:

- usam auth.uid() internamente;
- não recebem user_id vindo da aplicação;
- não usam SQL dinâmico;
- são STABLE;
- usam SECURITY DEFINER somente para consultar tabelas protegidas sem
  recursão;
- fixam search_path = pg_catalog, public;
- ficam no schema private;
- não possuem execução para PUBLIC, somente para authenticated.

## 6. Policies resultantes

| Tabela | Leitura de gestor | Leitura de consultor | Escrita relevante |
|---|---|---|---|
| fundos | vínculo ativo em usuario_fundos | cedente vinculado ao consultor | INSERT bootstrap separado; UPDATE/DELETE no fundo autorizado |
| usuario_fundos | próprio vínculo ou fundo autorizado | não concedida | gestor somente em fundo que possui |
| cedente_fundos | fundo autorizado | cedente da carteira | USING e WITH CHECK no fundo autorizado |
| consultor_cedente | cedente presente em fundo autorizado | próprio vínculo | gestor somente em carteira administrável |
| notas_fiscais | fundo autorizado e contexto NF coerente | cedente da carteira | update exige contexto coerente; sem INSERT direto de gestor |
| operacoes | cedente_fundo_id resolve fundo autorizado | cedente_id da carteira | update exige vínculo de destino autorizado |
| operacoes_nfs | operação pai autorizada | operação pai cujo cedente está na carteira | inserção fica no fluxo existente do cedente/RPC |

As policies de cedente e sacado continuam existindo, mas foram restringidas a
authenticated. O CNPJ do sacado é comparado normalizado, sem ampliar o escopo
para raiz de CNPJ ou grupo econômico.

### Exceção de bootstrap

fundos_gestor_bootstrap_insert mantém o INSERT inicial por gestor porque,
durante a criação, ainda não existe a linha correspondente em usuario_fundos.
Essa exceção é isolada no comando INSERT; SELECT, UPDATE e DELETE continuam
exigindo vínculo ativo.

## 7. Segurança e grants

Após a aplicação:

- RLS está habilitado nas sete tabelas;
- anon não possui grant de SELECT nas sete tabelas;
- authenticated possui os grants necessários para a Data API, ficando
  limitado pelas policies;
- as policies críticas não possuem TO public;
- os helpers privados possuem prosecdef = true e
  search_path=pg_catalog, public;
- a autorização usa contexto servidor e não IDs de usuário enviados pelo
  cliente;
- updates de operação e NF têm WITH CHECK, impedindo troca de fundo no
  destino.

## 8. Testes autenticados AAL2

Foi executado:

    npm run perf9b:verify -- --env-file .env.homolog

O verificador reutiliza a massa PERF9A existente e autentica os usuários reais
de homologação com senha e TOTP. A sessão é elevada e confirmada com
getAuthenticatorAssuranceLevel(), exigindo aal2 antes dos casos.

Resultado da execução de 30/07/2026:

| Tipo | Casos | Resultado |
|---|---:|---|
| SELECT | 40 | 40 aprovados |
| Escritas | 5 | 5 bloqueadas conforme esperado |
| RPCs | 5 | 5 sem dados cruzados/erro de autorização |
| **Total** | **50** | **50 aprovados, 0 falhas** |

Cobertura da matriz:

- gestor A: fundo/operação/NF/vínculo A visíveis; B oculto;
- gestor B: fundo/operação/NF B visíveis; A oculto;
- gestor multi: A e B visíveis;
- consultor A: carteira A visível; carteira B oculta;
- consultor B: carteira B visível; carteira A oculta;
- cedente: própria NF visível e NF de outro cedente oculta;
- sacado: NF do próprio CNPJ visível e CNPJ diferente oculto;
- tentativa de atualização de operação e NF para outro fundo bloqueada;
- consultor não altera NF nem carteira de outro consultor;
- dashboards, relatório analítico e onboarding rejeitam fundo não autorizado.

Evidência restrita, fora do repositório:

    %LOCALAPPDATA%/BWAntecipa/perf9a/evidence/rls-escopo9b-fhgkmggthxikfpogrvaa-2026-07-30T20-29-45.319Z.json

Não são armazenados tokens, senhas, segredos ou códigos TOTP nessa evidência.

## 9. EXPLAIN autenticado

Foi executado:

    npm run perf9b:explain -- --env-file .env.homolog

O script abre sessão PostgreSQL como `authenticated`, define claims
`request.jwt.claim.sub` para o usuário de teste e executa
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` em leituras negadas de fundo,
operação, NF e carteira. Os cinco planos concluíram sem erro:

| Leitura | Planejamento | Execução | Índice raiz |
|---|---:|---:|---|
| gestor A / fundo B | 0,783 ms | 7,284 ms | `fundos_pkey` |
| gestor A / operação B | 0,722 ms | 3,294 ms | `operacoes_pkey` |
| gestor A / NF B | 0,334 ms | 1,344 ms | `notas_fiscais_pkey` |
| consultor A / cedente B | 0,847 ms | 0,269 ms | `cedentes_pkey` |
| consultor A / NF B | 0,273 ms | 0,788 ms | `notas_fiscais_pkey` |

As leituras negadas retornaram zero linhas. O verificador de listagens sem
filtro continua sendo a referência para a análise de volume e foi registrado
separadamente durante o diagnóstico.

Evidência restrita:

    %LOCALAPPDATA%/BWAntecipa/perf9a/evidence/explain-escopo9b-fhgkmggthxikfpogrvaa-2026-07-30T20-31-20.535Z.json

Nenhum índice novo foi criado neste escopo.

## 10. Validações de código

Executadas durante esta entrega:

| Comando | Resultado |
|---|---|
| node --check scripts/perf9a/verify-escopo9b-homolog.mjs | Aprovado |
| node --check scripts/perf9a/explain-escopo9b-homolog.mjs | Aprovado |
| npx vitest run src/lib/performance/escopo9b.test.ts | Aprovado: 5 testes |
| git diff --check | Aprovado |
| npm run perf9b:verify -- --env-file .env.homolog | Aprovado: 50/50 |
| npm run perf9b:explain -- --env-file .env.homolog | Aprovado |

As validações gerais `npx tsc --noEmit`, `npm test -- --run`, `npm run lint`
e `npx next build --webpack` também foram executadas e aprovadas nesta
entrega. O lint manteve apenas seis warnings preexistentes.

## 11. Riscos e limitações residuais

- A evidência foi executada na massa PERF9A de homologação; não substitui
  teste com dados reais de produção.
- O INSERT bootstrap de fundo é uma exceção deliberada e deve ser preservado
  somente para a criação inicial.
- Linhas legadas sem cedente_fundo_id ou fundo_id não são expostas pelas
  policies de gestor/consultor. Isso é seguro para isolamento, mas exige
  reconciliação antes de qualquer migração de dados legados.
- O teste de RPC verifica autorização e ausência de identificadores cruzados,
  mas não substitui os testes funcionais financeiros da rota 9A.
- Realtime, Storage, browser, React Profiler, golden financeiro e demais
  cenários de performance permanecem fora deste escopo.
- O relatório não autoriza produção nem conclui o Escopo 9A.

## 12. Rollback e operação

Não há rollback automático que restaure as policies role-only anteriores,
porque isso reintroduziria o bloqueador crítico. Em caso de falha em
homologação:

1. interromper a promoção;
2. preservar as policies restritivas;
3. investigar a policy/caso que falhou;
4. aplicar nova migration incremental;
5. repetir a matriz AAL2.

As migrations são incrementais e transacionais. A aplicação manual foi
necessária porque o binário da Supabase CLI não estava disponível neste
ambiente; o conteúdo executado foi exatamente o arquivo versionado.

## 13. Parecer

**Escopo 9B: APROVADO PARA RETOMAR O ESCOPO 9A.**

O isolamento multifundo e a carteira do consultor passaram na matriz
autenticada: acessos permitidos funcionaram, acessos cruzados foram ocultados,
escritas cruzadas foram bloqueadas e as RPCs testadas respeitaram o contexto.

Este parecer não é um GO para produção. O Escopo 9A deve ser retomado somente
para executar seus gates ainda pendentes e, ao final, produzir parecer próprio
sobre performance, Realtime, rotas, documentos, golden financeiro e operação.
