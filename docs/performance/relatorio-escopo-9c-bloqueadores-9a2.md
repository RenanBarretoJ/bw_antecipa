# Relatório do Escopo 9C — bloqueadores críticos do 9A.2

**Data:** 31/07/2026

**Ambiente:** homologação

**Projeto Supabase:** `fhgkmggthxikfpogrvaa`

**Branch:** `homolog`

**Commit-base:** `db4ef87`

**Parecer:** **APROVADO PARA RETOMAR O ESCOPO 9A**

> Este parecer não representa GO para produção. O Escopo 9C tratou somente os
> bloqueadores críticos encontrados no 9A.2.

## 1. Resumo executivo

O Escopo 9A.2 terminou em NO-GO por quatro bloqueadores: leitura cruzada de
arquivos privados, cursor inválido nas notificações, respostas 500 em telas do
cedente e consultor e uma corrida na resolução inicial do fundo ativo do gestor.

As quatro causas foram reproduzidas e corrigidas sem recriar ou limpar a massa
PERF9A, sem alterar regras financeiras e sem executar ações críticas mutáveis.
Após a correção:

- a matriz completa de Storage bloqueou todos os acessos cruzados e paths
  adversários;
- notificações paginaram nos quatro perfis sem `CursorPayload inválido` ou 500;
- as 26 rotas do smoke retornaram HTTP 200 e renderizaram com sucesso;
- o gestor carregou o dashboard sem cookie, com cookie inválido e com cookie de
  fundo não autorizado, sempre selecionando um fundo autorizado;
- RLS permaneceu aprovada em 50/50 e o Realtime permaneceu isolado;
- TypeScript, 451 testes, lint e build foram aprovados.

## 2. Pré-condições e preservação do ambiente

Foram confirmados:

| Item | Resultado |
|---|---|
| Ambiente | `homolog` |
| Projeto Supabase | `fhgkmggthxikfpogrvaa` |
| Branch | `homolog` |
| Massa PERF9A | preservada |
| RLS do Escopo 9B | 50/50 antes e depois |
| Cleanup | somente dry-run; nenhum dado removido |
| Credenciais | mantidas fora do Git |

Volumes ao final:

| Entidade | Volume |
|---|---:|
| usuários Auth | 20 |
| fundos | 2 |
| cedentes | 180 |
| vínculos cedente/fundo | 121 |
| políticas | 2 |
| operações | 250 |
| notas fiscais | 1.000 |
| documentos | 900 |
| contas escrow | 80 |
| movimentos escrow | 5.000 |
| notificações | 4.500 |
| auditoria | 1.000 |
| eventos de domínio | 200 |

## 3. Bloqueador 1 — Storage e URLs assinadas

### 3.1 Causa raiz

Todos os buckets analisados eram privados, portanto o problema não era bucket
público. O vazamento era causado pela combinação de policies permissivas de
`SELECT` em `storage.objects`:

- havia policies amplas baseadas apenas no papel, como acesso de qualquer
  gestor ao bucket `documentos-v2` e acesso amplo de gestor/consultor/sacado a
  outros buckets;
- policies permissivas do PostgreSQL são combinadas por `OR`; uma policy ampla
  anulava qualquer restrição mais específica;
- o cliente conseguia chamar `createSignedUrl` para um path conhecido e a
  autorização do Storage aprovava a leitura;
- algumas telas de NF recebiam o path consultado no navegador e assinavam o
  objeto diretamente, em vez de enviar somente o ID de domínio para uma action
  centralizada.

A URL assinada era apenas o meio de entrega. A falha real estava na autorização
anterior à assinatura.

### 3.2 Correção aplicada

A migration incremental
`20260731140710_escopo9c_storage_autorizacao_multifundo.sql`:

1. criou `private.usuario_pode_ler_objeto_storage(bucket, path)`;
2. usa `auth.uid()` internamente e não aceita `user_id` do cliente;
3. possui `SECURITY DEFINER`, `search_path` fixo e nenhum SQL dinâmico;
4. revoga `EXECUTE` de `PUBLIC` e concede somente a `authenticated`;
5. resolve o path exato em tabelas do domínio;
6. valida gestor por `usuario_fundos`, cedente pelo próprio cadastro,
   consultor pela carteira e sacado pelo CNPJ normalizado do destinatário;
7. removeu todas as policies amplas de leitura;
8. criou uma única policy de leitura autenticada baseada no helper privado;
9. manteve os buckets privados e as policies de escrita existentes;
10. adicionou índices para a resolução dos objetos registrados.

Para o arquivo original da NF foi criada a action
`obterUrlArquivoNotaFiscal(notaFiscalId)`. Ela:

- recebe somente o ID da NF;
- autoriza o ator por `requireNotaFiscalAccess`;
- resolve `arquivo_url` no servidor;
- só então utiliza service role para assinar o objeto privado;
- retorna mensagem genérica quando o ator não tem acesso;
- não registra path, URL assinada, token ou segredo em log.

As telas do gestor, cedente e sacado passaram a usar essa action. Não há geração
em lote nas listagens.

### 3.3 Matriz homologada

| Cenário | Esperado | Resultado |
|---|---|---|
| Gestor A → documento A | permitir | PASS |
| Gestor A → documento B | negar | PASS |
| Gestor B → documento B | permitir | PASS |
| Gestor B → documento A | negar | PASS |
| Gestor Multi → A e B | permitir | PASS |
| Cedente A → próprio documento | permitir | PASS |
| Cedente A → documento B | negar | PASS |
| Consultor A → carteira A | permitir | PASS |
| Consultor A → carteira B | negar | PASS |
| Sacado A → NF do próprio CNPJ | permitir | PASS |
| Sacado A → NF de outro CNPJ | negar | PASS |
| Anônimo → objeto privado | negar | PASS |
| path manipulado | negar | PASS |
| `../` | negar | PASS |
| traversal codificado | negar | PASS |
| prefixo semelhante | negar | PASS |
| objeto inexistente | negar | PASS |
| URL após expiração | negar | PASS |
| nova assinatura após expiração | permitir | PASS |
| ID de NF de fundo adversário na página | não expor | PASS |

O teste verificou criação de URL, download HTTP efetivo, visibilidade na
listagem e expiração. Evidência local restrita:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\storage-escopo9c-fhgkmggthxikfpogrvaa-2026-07-31T14-47-21.958Z.json
```

## 4. Bloqueador 2 — cursor das notificações

### 4.1 Causa raiz

O cursor usa o contrato canônico `{ createdAt, id }`, com ordenação
`created_at DESC, id DESC`. O problema não estava no base64url nem no timestamp
com microssegundos.

A validação do `id` exigia bits de versão e variante de UUID RFC. A massa PERF9A
gera IDs UUID deterministicamente a partir de hash; eles são aceitos pelo tipo
`uuid` do PostgreSQL, mas não necessariamente contêm esses bits. Em homolog,
3.941 notificações tinham UUID sintaticamente válido para PostgreSQL e eram
rejeitadas pelo regex anterior. O erro ocorria ao codificar o próximo cursor e
virava 500 em páginas/actions.

### 4.2 Correção

- o helper compartilhado passou a validar o formato sintático do tipo UUID do
  PostgreSQL, sem impor versão/variante RFC;
- a action de marcar notificação recebeu o mesmo contrato de UUID;
- cursor de entrada inválido não lança 500: é ignorado de forma controlada e o
  feed reinicia na primeira página;
- microssegundos continuam preservados;
- o filtro keyset continua determinístico por `created_at` e `id`.

Testes cobrem UUID PostgreSQL sem bits RFC, microssegundos, payload/base64
inválido e filtro composto. O smoke carregou e paginou notificações como gestor,
cedente, consultor e sacado sem erro de cursor ou 500.

## 5. Bloqueador 3 — respostas 500 do cedente e consultor

Os stack traces restritos do 9A.2 apontavam para:

```text
encodeCursor
→ carregarNotificacoesUsuario
→ página/action de notificações e sino
→ TypeError: CursorPayload inválido
```

Isso afetava os quatro perfis, mas aparecia com maior frequência nas páginas do
cedente e consultor. Não foi encontrada uma segunda causa de banco/RLS para os
500 reproduzidos.

Após corrigir o cursor:

- o smoke direcionado aprovou notificações dos quatro perfis;
- o smoke completo aprovou 26/26 rotas com HTTP 200 e renderização de sucesso;
- não houve `CursorPayload inválido`, `Internal Server Error` ou resposta 500;
- 12 requests `ERR_ABORTED` ocorreram durante navegação/prefetch, sem falha de
  renderização e sem status 500; foram mantidos na evidência, não ocultados.

Evidências restritas:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\smoke-escopo9c-fhgkmggthxikfpogrvaa-2026-07-31T14-27-20.347Z.json
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\smoke-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T14-30-00.605Z.json
```

## 6. Bloqueador 4 — inicialização do fundo ativo

### 6.1 Causa raiz

`resolverContextoFundoGestor` exigia o cookie `bw_fundo_ativo_id` antes de
consultar os fundos autorizados. Na primeira carga, o provider client-side ainda
não tinha persistido a preferência, enquanto Server Components e RPCs já eram
executados. Isso produzia `Selecione um fundo ativo para continuar.`.

### 6.2 Correção

O servidor agora:

1. consulta todos os vínculos ativos de `usuario_fundos` do usuário;
2. remove fundos inativos;
3. trata o cookie apenas como preferência;
4. usa o cookie somente se ele estiver na coleção autorizada;
5. quando ausente, inválido ou não autorizado, escolhe o fundo principal ou o
   primeiro fundo ativo autorizado;
6. falha apenas quando o gestor realmente não possui fundo ativo autorizado.

Não há gravação de cookie durante a renderização de Server Component e nenhum
fundo não autorizado é selecionado automaticamente.

Foram aprovados em navegador: sem cookie, cookie inválido, cookie do Fundo B
não autorizado e cookie válido do Fundo A. A lógica pura existente também cobre
gestor multi-fundo e prioridade do fundo principal.

## 7. CSP e Realtime

`next.config.ts` não foi alterado no Escopo 9C. A diretiva permanece restrita a:

```text
connect-src 'self' <origem Supabase> https://*.supabase.co wss://*.supabase.co
```

Não foram adicionados `ws:`, `wss://*` ou wildcard mais amplo. O teste direto
com duas sessões confirmou entrega ao usuário A e ausência para o usuário B.

Evidência restrita:

```text
%LOCALAPPDATA%\BWAntecipa\perf9a\evidence\realtime-escopo9a2-fhgkmggthxikfpogrvaa-2026-07-31T14-30-35.617Z.json
```

## 8. Migration e estado do banco

Migration criada e aplicada em homolog:

```text
supabase/migrations/20260731140710_escopo9c_storage_autorizacao_multifundo.sql
```

A aplicação foi feita pelo executor PostgreSQL homologado do projeto porque o
conector MCP disponível estava em modo somente leitura. A estrutura efetiva foi
verificada após a aplicação: uma policy autenticada de leitura, helper privado
com grants restritos e seis índices presentes.

O histórico `supabase_migrations` deste projeto registra apenas parte das
migrations aplicadas manualmente. A migration 9C é reexecutável de forma segura,
mas a conciliação do histórico deve ocorrer no processo de promoção de ambiente.

Os advisors do Supabase não apontaram nova falha de segurança relacionada à
mudança. Quatro índices recém-criados apareceram como `unused_index` em nível
informativo, resultado esperado imediatamente após a criação e com baixa
utilização dos respectivos buckets. Permanecem advisors preexistentes fora do
escopo.

Referência geral do linter:
[Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter).

## 9. Testes e gates executados

| Gate | Resultado |
|---|---|
| `node --check scripts/perf9a/*.mjs` | PASS — 16/16 |
| `npx tsc --noEmit` | PASS |
| `npm test -- --run` | PASS — 68 arquivos, 451 testes |
| `npm run lint` | PASS — 0 erros; 6 warnings preexistentes |
| `git diff --check` | PASS |
| `npx next build --webpack` | PASS — 62 páginas; warnings preexistentes de Handlebars |
| `npm run perf9a:status -- --env-file .env.homolog` | PASS; massa preservada |
| `npm run perf9b:verify -- --env-file .env.homolog` | PASS — 50/50 |
| `npm run perf9a:cleanup -- --env-file .env.homolog` | PASS — dry-run, zero removidos |
| `npm run perf9c:storage` | PASS — matriz completa |
| `npm run perf9c:smoke` | PASS — 9 cenários direcionados |
| smoke completo | PASS — 26/26, sem 500 |
| Realtime isolado | PASS |
| varredura de segredos | PASS — 18 arquivos, zero achados |

Os seis warnings de lint estão em arquivos não alterados pelo Escopo 9C. O
build mantém warnings conhecidos de `handlebars/lib/index.js` sobre
`require.extensions`.

## 10. Arquivos criados ou alterados

### Banco e homologação

- `supabase/migrations/20260731140710_escopo9c_storage_autorizacao_multifundo.sql`;
- `scripts/perf9a/storage-escopo9c-homolog.mjs`;
- `scripts/perf9a/smoke-escopo9c-browser.mjs`;
- `package.json` — comandos `perf9c:storage` e `perf9c:smoke`.

### Aplicação

- `src/lib/actions/arquivo-nota-fiscal.ts`;
- `src/lib/actions/sacado-portal.ts`;
- `src/app/gestor/notas-fiscais/[id]/page.tsx`;
- `src/app/cedente/notas-fiscais/[id]/page.tsx`;
- `src/lib/pagination/cursor.ts`;
- `src/lib/notificacoes/listagem.server.ts`;
- `src/lib/actions/notificacoes-listagem.ts`;
- `src/lib/gestor/contexto-fundo.server.ts`.

### Testes

- `src/lib/storage-authorization-escopo9c.test.ts`;
- `src/lib/pagination/cursor.test.ts`;
- `src/lib/gestor/contexto-fundo.server.test.ts`;
- `src/lib/sacado/portal-listagens.test.ts`.

### Documentação

- este relatório;
- referência acrescentada ao relatório histórico 9A.2.

O arquivo local não rastreado `testar_smtp_ionos.py` pertence ao usuário e não
foi lido, alterado ou incluído no escopo.

## 11. Rollback seguro

### Aplicação

É possível reverter a action compartilhada, as alterações de cursor e o
fallback do fundo ativo pelos arquivos listados. Contudo, reverter o cursor ou
o fundo ativo reintroduz os bloqueadores reproduzidos.

### Banco

Não é seguro restaurar as policies amplas antigas: isso reabre o vazamento
crítico. Se a migration precisar ser revertida operacionalmente, o procedimento
seguro é:

1. bloquear temporariamente a leitura dos buckets privados;
2. substituir a policy 9C por outra policy equivalente e validada;
3. somente depois remover
   `storage_private_objects_select_authorized` e o helper privado;
4. remover os seis índices apenas após confirmar que nenhuma policy/helper os
   utiliza.

Uma reversão que simplesmente recrie as policies anteriores não é aceita.

## 12. Riscos residuais e pendências

- o histórico de migrations aplicado manualmente deve ser reconciliado antes da
  promoção para produção;
- os advisors preexistentes de segurança e performance continuam exigindo uma
  fase própria; não foram ampliados neste escopo;
- os quatro índices recém-criados e ainda não utilizados devem ser reavaliados
  após tráfego representativo, não removidos apenas pelo aviso inicial;
- ações críticas mutáveis, batch/N+1 completo, React Profiler e otimização geral
  de TTFB não pertenciam ao Escopo 9C e continuam para a retomada do 9A;
- o teste visual completo de Realtime em múltiplas janelas continua sendo um
  gate do 9A, embora o backend isolado e a CSP estejam aprovados;
- a massa PERF9A deve permanecer em homologação para os próximos gates.

## 13. Parecer final

**APROVADO PARA RETOMAR O ESCOPO 9A.**

Critérios atendidos:

- Storage isolado por fundo/entidade;
- URL assinada adversária bloqueada;
- path arbitrário, traversal, prefixo e objeto inexistente bloqueados;
- cursor aprovado e sem 500 nos quatro perfis;
- nenhum 500 nas 26 rotas do smoke;
- inicialização do fundo ativo aprovada;
- Realtime continua funcionando;
- RLS continua 50/50;
- testes, lint e build aprovados.

Este parecer não é GO para produção. Ele remove os bloqueadores do 9A.2 e
autoriza somente a retomada dos gates restantes do Escopo 9A.

Não foi executado commit ou push.

## Continuidade — Escopo 9A.3

O parecer final posterior está em
[`relatorio-homologacao-escopo-9a-final.md`](./relatorio-homologacao-escopo-9a-final.md).
