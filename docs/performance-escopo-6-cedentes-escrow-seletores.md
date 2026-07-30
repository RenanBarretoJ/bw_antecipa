# Performance — Escopo 6: cedentes, escrow e seletores

## Objetivo e limites

Este escopo reduz cargas integrais nas áreas de cedentes e escrow, transforma
movimentos financeiros em feed incremental e introduz busca remota para os
seletores crescentes usados pelas telas migradas.

Foram alteradas exclusivamente as seguintes superfícies:

- `/gestor/cedentes`;
- coleções diretamente relacionadas no detalhe de cedente;
- `/gestor/escrow` e o detalhe da conta;
- `/consultor/escrow` e o detalhe da conta;
- `/cedente/extrato`;
- seleção de cedente e política usada por essas listagens;
- loaders, contratos, actions, componentes, RLS e RPC diretamente associados.

Não foram alteradas regras de saldo, movimentação financeira, conciliação,
liquidação, operações, notas fiscais, onboarding, documentos operacionais,
dashboards, relatórios, auditoria, notificações, CNAB, Portal FIDC, snapshots ou
políticas operacionais.

## Diagnóstico inicial

### Cedentes do gestor

A página [`/gestor/cedentes`](../src/app/gestor/cedentes/page.tsx) era um Client
Component. Na montagem, ela:

1. aguardava o contexto de fundo no navegador;
2. carregava todos os `cedente_id` de `cedente_fundos`;
3. carregava todos os cedentes desses IDs;
4. aplicava busca e status em memória;
5. exibia a coleção sem paginação nem `count`.

O fluxo criava duas leituras sequenciais, transferia a coleção integral e
mantinha a fonte de leitura duplicada entre React, Supabase no navegador e o
contexto de fundo.

### Detalhe do cedente

O detalhe permanece uma tela legada em Client Component, mas apresentava quatro
pontos diretamente relacionados ao escopo:

- `select("*")` no cadastro principal;
- representantes legais sem limite;
- todas as versões de documentos carregadas antecipadamente;
- faixas de taxa e acessos sem limite explícito.

As coleções com crescimento histórico eram as versões documentais. Representantes,
faixas de taxa e acessos são relações operacionais atuais, mas também não
possuíam proteção contra crescimento acidental.

### Escrow do gestor

A listagem do gestor repetia o padrão de duas consultas:

```text
todos os cedente_fundos do fundo ativo
  ↓
array de cedente_id no navegador
  ↓
todas as contas escrow desses cedentes
  ↓
busca e métricas no navegador
```

Não havia paginação. Os cards eram calculados sobre toda a coleção carregada,
e não existia distinção explícita entre total global, total filtrado e página.

### Escrow do consultor

A listagem do consultor carregava todas as contas visíveis pela RLS e fazia a
busca no navegador. O escopo da carteira não era expresso na consulta da tela;
dependia exclusivamente das policies então vigentes.

### Detalhes e extrato do cedente

Os três detalhes — gestor, consultor e cedente — possuíam implementações
independentes. Cada uma carregava todos os movimentos da conta e filtrava tipo e
período em memória.

No portal do cedente, a página também executava autenticação, resolução do
cedente, validação de habilitação, leitura da conta e leitura integral dos
movimentos em um `useEffect`.

### Seletores

As telas migradas precisavam selecionar:

- política no filtro de cedentes;
- cedente no filtro de contas escrow.

Sem um contrato remoto comum, a alternativa seria carregar os catálogos
integrais no componente. O seletor global de fundo ativo também foi auditado,
mas possui natureza diferente: ele representa o conjunto autorizado da sessão e
é fornecido pelo `FundoAtivoProvider`.

## Arquitetura antes e depois

### Listagens

Antes:

```text
Client Component
  ↓
useEffect
  ↓
coleções integrais
  ↓
joins, busca, filtro e métricas no navegador
```

Depois:

```text
Server Component
  ↓
autenticação e perfil
  ↓
fundo ativo ou carteira do consultor
  ↓
filtros + count + ordem estável + range no banco
  ↓
contrato compacto
  ↓
Client Component somente para navegação e interação
```

### Movimentos

Antes:

```text
conta
  ↓
todos os movimentos
  ↓
filtros e totais no navegador
```

Depois:

```text
conta autorizada
  ↓
filtros no banco
  ↓
ORDER BY created_at DESC, id DESC
  ↓
LIMIT 21
  ↓
20 itens + cursor composto
  ↓
Carregar mais
```

### Seletores

```text
abrir seletor ou alterar termo
  ↓
debounce de 300 ms
  ↓
action autenticada
  ↓
contexto derivado da sessão
  ↓
até 20 opções compactas
  ↓
respostas antigas ignoradas
```

## Listagem de cedentes

A rota [`src/app/gestor/cedentes/page.tsx`](../src/app/gestor/cedentes/page.tsx)
passou a ser um Server Component fino. Ela normaliza os `searchParams`, chama o
loader e entrega o resultado ao componente interativo.

O contrato e a normalização estão em
[`src/lib/cedentes/gestor-listagem.ts`](../src/lib/cedentes/gestor-listagem.ts):

- página inicial `1`;
- tamanhos permitidos `10`, `20` e `40`;
- busca normalizada;
- status em allowlist;
- política validada como UUID;
- ordenação limitada a `created_at`, `razao_social` e `status`;
- direção limitada a `asc` ou `desc`.

O loader
[`carregarCedentesGestorPaginados`](../src/lib/cedentes/gestor-listagem.server.ts)
usa `cedente_fundos` como fonte de verdade e:

1. exige gestor;
2. resolve o fundo ativo autorizado;
3. restringe vínculos a `ativo` ou `suspenso`;
4. aplica busca, status e política antes do `range`;
5. solicita `count: exact`;
6. ordena com desempate por `id`;
7. corrige página fora do intervalo;
8. retorna somente os campos exibidos.

O contrato entregue ao cliente contém identificação do cedente, vínculo,
CNPJ, razão social, status, cadastro e política ativa resumida. Não contém
representantes, documentos, acessos, taxas, snapshots, arquivos ou históricos.

O componente
[`CedentesGestorListagem`](../src/components/cedentes/CedentesGestorListagem.tsx)
mantém filtros e paginação na URL. Busca e alteração de filtros voltam para a
página 1, e o link de detalhe preserva o endereço de retorno completo.

## Detalhe do cedente

O detalhe não foi redesenhado. As mudanças foram limitadas às coleções
diretamente relacionadas em
[`src/app/gestor/cedentes/[id]/page.tsx`](../src/app/gestor/cedentes/%5Bid%5D/page.tsx):

- o cadastro principal passou de `select("*")` para campos explícitos;
- representantes legais foram limitados a 20;
- faixas de taxa foram limitadas a 40;
- acessos vinculados foram limitados a 50;
- documentos atuais passaram a ser lidos pela RPC
  `listar_documentos_atuais_cedente`.

A RPC criada em
[`20260730143000_performance_escopo6_escrow_rls.sql`](../supabase/migrations/20260730143000_performance_escopo6_escrow_rls.sql)
usa `DISTINCT ON (tipo, representante_id)` e ordenação por versão, data e ID
decrescentes. Assim, a tela recebe somente a versão atual de cada documento e
representante, sem antecipar o histórico completo.

A função é `STABLE`, `SECURITY INVOKER`, possui `search_path` explícito, revoga
execução de `PUBLIC` e concede acesso somente a `authenticated`. Ela continua
dependendo da RLS da tabela `documentos`.

## Listagens de escrow

As rotas
[`/gestor/escrow`](../src/app/gestor/escrow/page.tsx) e
[`/consultor/escrow`](../src/app/consultor/escrow/page.tsx) passaram a usar o
mesmo componente e o mesmo domínio de paginação.

O contrato em
[`src/lib/escrow/listagem.ts`](../src/lib/escrow/listagem.ts) expõe somente:

- conta e cedente;
- identificador;
- saldos disponível e bloqueado;
- status;
- data de criação;
- nome e CNPJ do cedente.

Não são retornados movimentos, dados bancários completos, credenciais, CNAB,
conciliações ou payloads externos.

O loader
[`carregarEscrowPaginado`](../src/lib/escrow/listagem.server.ts):

- exige o perfil recebido pela rota;
- resolve o fundo ativo no perfil gestor;
- deriva o consultor de `auth.uid()` no perfil consultor;
- aplica status, cedente, busca, ordenação e `range` no servidor;
- solicita `count: exact`;
- usa `id` como desempate;
- nunca recebe `consultorId`, `cedenteIds` ou `fundoId` do frontend.

Para busca textual, a resolução de cedentes é limitada a 200 identificadores
antes da consulta final paginada. Esse limite evita catálogo ilimitado, mas é
uma aproximação consciente: buscas extremamente amplas podem não contemplar
mais de 200 cedentes correspondentes. A consulta final sempre reaplica o escopo
autorizado.

As métricas exibidas são rotuladas de forma explícita:

- `Total no filtro`: `count` do conjunto filtrado;
- `Ativas na página`: itens ativos da página;
- `Disponível na página`: soma da página;
- `Bloqueado na página`: soma da página.

Nenhum desses valores é apresentado como saldo consolidado do fundo.

## Movimentos incrementais e extrato

O domínio compartilhado está em
[`src/lib/escrow/movimentos.ts`](../src/lib/escrow/movimentos.ts), e a leitura
autorizada em
[`src/lib/escrow/movimentos.server.ts`](../src/lib/escrow/movimentos.server.ts).

O cursor contém:

```ts
{
  createdAt: string
  id: string
}
```

A próxima página usa o predicado comum do Escopo 0:

```text
created_at < cursor.createdAt
OR
(created_at = cursor.createdAt AND id < cursor.id)
```

Os filtros de tipo e período são normalizados e aplicados antes do cursor.
Cada leitura consulta 21 linhas, entrega 20 e constrói o próximo cursor com o
último item visível.

A autorização é refeita em toda leitura, inclusive no botão “Carregar mais”:

- gestor: perfil gestor, fundo ativo e `cedente_fundos` ativo ou suspenso;
- consultor: perfil consultor e vínculo em `consultor_cedente`;
- cedente: perfil cedente e conta pertencente ao próprio cadastro.

A action
[`carregarMaisMovimentosEscrow`](../src/lib/actions/escrow.ts) não confia no
perfil informado para ampliar acesso. O loader chama `requireRole(perfil)` e
valida novamente a conta e o vínculo.

O componente
[`EscrowDetalhe`](../src/components/escrow/EscrowDetalhe.tsx) é compartilhado
pelos três portais. Os saldos atual, disponível e bloqueado vêm da conta
persistida; eles não são recalculados pelos 20 movimentos.

Os cards “Créditos carregados” e “Débitos carregados” somam somente os itens já
carregados e são rotulados dessa forma. Eles não representam totais globais ou
totais exatos do período.

A rota [`/cedente/extrato`](../src/app/cedente/extrato/page.tsx) agora faz a
carga inicial no servidor, confirma que escrow está habilitado, resolve a conta
do próprio cedente e entrega a primeira página ao componente compartilhado.

## Seletores remotos

O componente
[`RemoteEntitySelector`](../src/components/selectors/RemoteEntitySelector.tsx)
é usado para:

- política na listagem de cedentes;
- cedente nas listagens de escrow.

Comportamento:

- debounce de 300 ms;
- indicador de carregamento;
- limite de 20 opções;
- busca por nome/código para política;
- busca por razão social/CNPJ para cedente;
- preservação da opção selecionada;
- descarte de respostas antigas por identificador sequencial de request;
- nenhuma consulta em cada render;
- nenhum polling.

A action
[`buscarOpcoesEscopo`](../src/lib/actions/selectors.ts):

- autentica novamente;
- deriva perfil e usuário da sessão;
- para gestor, resolve o fundo ativo;
- para consultor, usa `consultor_cedente`;
- para cedente, usa o próprio cadastro;
- retorna somente `value`, `label` e `description`;
- não usa `select("*")` nem `service_role`.

### Seletor global de fundo

O seletor global de fundo ativo não foi convertido para busca remota. Ele
continua recebendo do
[`FundoAtivoProvider`](../src/components/fundos/fundo-ativo-provider.tsx) todos
os fundos autorizados do usuário consultados em `usuario_fundos`, pois essa
coleção também sustenta a escolha inicial e a troca do contexto global.

Essa decisão não altera a segurança: o ID selecionado continua sendo
revalidado pela action, e o cookie de fundo é HttpOnly. Entretanto, o catálogo
autorizado permanece integral no cliente e deve ser migrado em escopo próprio
caso a quantidade de fundos por usuário passe a ser alta.

O seletor de fundo operacional do cedente também permaneceu fora da alteração:
ele carrega apenas os vínculos ativos do próprio cedente. Não foi criada uma
segunda implementação remota para esse catálogo sem evidência de crescimento.

## Autorização, RLS e multifundo

A migration incremental
[`20260730143000_performance_escopo6_escrow_rls.sql`](../supabase/migrations/20260730143000_performance_escopo6_escrow_rls.sql)
contém:

- RLS habilitada e grants explícitos em `consultor_cedente`;
- leitura do consultor limitada à própria carteira;
- leitura de cedentes do consultor baseada em `consultor_cedente`;
- acesso do gestor a contas e movimentos condicionado a `usuario_fundos` ativo
  e `cedente_fundos` ativo ou suspenso;
- acesso do consultor a contas e movimentos condicionado à própria carteira;
- RPC `listar_documentos_atuais_cedente` como `SECURITY INVOKER`.

As consultas operacionais usam o cliente autenticado. Não foi introduzido
`service_role`.

As camadas são:

```text
rota e componente
  ↓
requireRole/requireGestor
  ↓
fundo ativo, cedente próprio ou carteira
  ↓
filtro explícito da consulta
  ↓
RLS
```

A migration ainda precisa ser aplicada e validada em homologação. Até essa
aplicação, as novas garantias de RLS e a RPC não existem no banco remoto.

## Requests duplicados eliminados

Foram removidos das listagens migradas:

- `useEffect` para carga principal;
- consulta inicial seguida de filtragem integral no navegador;
- leitura de vínculos seguida de segunda coleção completa no gestor;
- três implementações separadas de detalhe de escrow;
- carregamento integral de movimentos;
- histórico completo de versões documentais no detalhe do cedente.

Os Client Components agora cuidam de filtros, navegação, seleção remota e
“Carregar mais”. A autorização, os joins e a leitura das coleções permanecem no
servidor.

## Métricas estruturais antes e depois

As métricas abaixo descrevem limites de linhas e formato das consultas. Não
representam ganho de tempo medido em homologação.

| Fluxo | Antes | Depois |
|---|---|---|
| Cedentes do gestor | todos os vínculos + todos os cedentes | uma consulta paginada com `count` e até 10/20/40 linhas |
| Filtro de cedentes | navegador | banco, antes do `range` |
| Documentos no detalhe | todas as versões | uma versão atual por tipo e representante |
| Representantes | sem limite | até 20 |
| Faixas de taxa | sem limite | até 40 |
| Acessos vinculados | sem limite | até 50 |
| Escrow do gestor | todos os vínculos + todas as contas | consulta paginada com `count` e até 10/20/40 linhas |
| Escrow do consultor | todas as contas visíveis | consulta paginada da carteira com `count` |
| Movimentos | coleção integral | até 21 linhas por leitura, 20 exibidas |
| Seletores de cedente/política | risco de catálogo local integral | até 20 opções por busca |
| Detalhes de escrow | três implementações | um componente e um loader compartilhados |

Não foram medidos payload, tempo server-side, tempo de interação ou buffers,
pois o banco de homologação não estava conectado nesta execução.

## Índices

As consultas finais tornam relevante o seguinte candidato:

```sql
CREATE INDEX ... ON public.movimentos_escrow
  (conta_escrow_id, created_at DESC, id DESC);
```

O índice não foi criado. Não houve acesso ao banco de homologação para executar
`EXPLAIN (ANALYZE, BUFFERS)`, comparar índices equivalentes, medir seletividade
ou avaliar custo de escrita.

A migration deste escopo contém somente RLS e a RPC documental. A validação de
índice deve seguir:

1. aplicar a migration em homologação;
2. usar volume representativo;
3. medir o plano do feed de movimentos com e sem filtros;
4. verificar índices existentes;
5. criar migration incremental apenas se o plano comprovar necessidade;
6. repetir o `EXPLAIN` após a criação.

## Testes adicionados

Foram adicionados testes unitários para:

- normalização de página, limite, busca, status e ordenação de cedentes;
- allowlists e política em UUID;
- rejeição de filtros inválidos de escrow;
- métricas calculadas exclusivamente sobre a página;
- cursor composto com timestamp em microssegundos;
- rejeição de cursor, data e tipo inválidos;
- consulta lógica de 21 movimentos, entrega de 20 e cursor no último visível;
- preservação e não duplicação da opção atual do seletor remoto.

Arquivos:

- [`src/lib/cedentes/gestor-listagem.test.ts`](../src/lib/cedentes/gestor-listagem.test.ts);
- [`src/lib/escrow/listagem.test.ts`](../src/lib/escrow/listagem.test.ts);
- [`src/lib/escrow/movimentos.test.ts`](../src/lib/escrow/movimentos.test.ts);
- [`src/lib/selectors/remote.test.ts`](../src/lib/selectors/remote.test.ts).

## Validações técnicas executadas

Durante a implementação:

- `npx tsc --noEmit`: aprovado;
- `npm test -- --run`: 61 arquivos e 409 testes aprovados;
- testes focados do Escopo 6: 4 arquivos e 9 testes aprovados;
- `npm run lint`: zero erros e 8 avisos preexistentes fora do escopo;
- `git diff --check`: aprovado;
- `npx next build --webpack`: aprovado;
- build com avisos já existentes de `require.extensions` originados por
  Handlebars.

Não foram executados:

- aplicação da migration no banco de homologação;
- testes reais de RLS com gestor, consultores distintos e cedentes distintos;
- `EXPLAIN (ANALYZE, BUFFERS)`;
- medição temporal e de payload;
- roteiro manual completo em navegador.

## Arquivos principais

### Páginas

- [`src/app/gestor/cedentes/page.tsx`](../src/app/gestor/cedentes/page.tsx)
- [`src/app/gestor/cedentes/[id]/page.tsx`](../src/app/gestor/cedentes/%5Bid%5D/page.tsx)
- [`src/app/gestor/escrow/page.tsx`](../src/app/gestor/escrow/page.tsx)
- [`src/app/gestor/escrow/[id]/page.tsx`](../src/app/gestor/escrow/%5Bid%5D/page.tsx)
- [`src/app/consultor/escrow/page.tsx`](../src/app/consultor/escrow/page.tsx)
- [`src/app/consultor/escrow/[id]/page.tsx`](../src/app/consultor/escrow/%5Bid%5D/page.tsx)
- [`src/app/cedente/extrato/page.tsx`](../src/app/cedente/extrato/page.tsx)

### Componentes

- [`src/components/cedentes/CedentesGestorListagem.tsx`](../src/components/cedentes/CedentesGestorListagem.tsx)
- [`src/components/escrow/EscrowListagem.tsx`](../src/components/escrow/EscrowListagem.tsx)
- [`src/components/escrow/EscrowDetalhe.tsx`](../src/components/escrow/EscrowDetalhe.tsx)
- [`src/components/selectors/RemoteEntitySelector.tsx`](../src/components/selectors/RemoteEntitySelector.tsx)

### Domínio, loaders e actions

- [`src/lib/cedentes/gestor-listagem.ts`](../src/lib/cedentes/gestor-listagem.ts)
- [`src/lib/cedentes/gestor-listagem.server.ts`](../src/lib/cedentes/gestor-listagem.server.ts)
- [`src/lib/escrow/listagem.ts`](../src/lib/escrow/listagem.ts)
- [`src/lib/escrow/listagem.server.ts`](../src/lib/escrow/listagem.server.ts)
- [`src/lib/escrow/movimentos.ts`](../src/lib/escrow/movimentos.ts)
- [`src/lib/escrow/movimentos.server.ts`](../src/lib/escrow/movimentos.server.ts)
- [`src/lib/actions/escrow.ts`](../src/lib/actions/escrow.ts)
- [`src/lib/actions/selectors.ts`](../src/lib/actions/selectors.ts)
- [`src/lib/selectors/remote.ts`](../src/lib/selectors/remote.ts)
- [`src/types/database.ts`](../src/types/database.ts)

### Persistência

- [`supabase/migrations/20260730143000_performance_escopo6_escrow_rls.sql`](../supabase/migrations/20260730143000_performance_escopo6_escrow_rls.sql)

## Riscos e pendências

- A migration precisa ser aplicada antes de homologar as telas.
- A RPC documental precisa ser confirmada no schema cache do PostgREST após a
  migration.
- As policies precisam de testes reais de isolamento entre fundos e entre
  carteiras de consultores.
- O seletor global de fundo ativo e o seletor de fundo do cedente ainda mantêm
  seus catálogos autorizados no cliente.
- A busca ampla de escrow limita a resolução intermediária a 200 cedentes.
- Os totais de crédito e débito no extrato representam movimentos carregados,
  não todo o período filtrado.
- O detalhe do cedente continua sendo um Client Component legado; este escopo
  apenas reduziu suas coleções diretamente relacionadas.
- Não há evidência de plano para criar novo índice.
- Testes de domínio não substituem integração SQL, RLS nem validação manual.

## Checklist de homologação

- [ ] Aplicar `20260730143000_performance_escopo6_escrow_rls.sql`.
- [ ] Confirmar a RPC `listar_documentos_atuais_cedente` no PostgREST.
- [ ] Validar `/gestor/cedentes` com 0, 10, 20, 25 e mais de 40 registros.
- [ ] Validar busca, status, política, ordenação e retorno do detalhe.
- [ ] Confirmar que cedentes de outro fundo não aparecem.
- [ ] Validar escrow com gestor autorizado e não autorizado.
- [ ] Validar dois consultores com carteiras diferentes.
- [ ] Validar o cedente contra tentativa de abrir conta de outro cedente.
- [ ] Validar timestamps iguais entre duas páginas de movimentos.
- [ ] Validar filtros de tipo e período antes e depois de “Carregar mais”.
- [ ] Confirmar que o saldo não muda conforme novas páginas são carregadas.
- [ ] Digitar rapidamente nos seletores e confirmar que resposta antiga não
  substitui a busca atual.
- [ ] Confirmar que política de outro fundo não aparece.
- [ ] Inspecionar Network para confirmar o limite de 20 opções.
- [ ] Executar `EXPLAIN (ANALYZE, BUFFERS)` no feed de movimentos.
- [ ] Medir linhas, payload e latência com volume representativo.

## Conclusão

O Escopo 6 remove a carga integral das listagens de cedentes e escrow, cria um
feed incremental compartilhado para movimentos e extrato, reduz o contrato do
detalhe de cedente e centraliza a seleção remota de cedentes e políticas.

O fundo ativo, a carteira do consultor e o cedente autenticado são derivados da
sessão e revalidados no servidor. Saldos continuam vindo da conta persistida, e
nenhuma regra financeira foi alterada.

A implementação de aplicação e os testes automatizados estão aprovados. A
conclusão operacional depende da aplicação da migration e da homologação real
de RLS, PostgREST, planos de consulta e isolamento multifundo. O Escopo 7 não
foi iniciado.
