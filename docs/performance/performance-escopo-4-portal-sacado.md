# Performance — Escopo 4: Portal do Sacado

## Objetivo e escopo

Este escopo substitui a carga ampla compartilhada do portal do sacado por
casos de uso específicos para:

- `/sacado/dashboard`;
- `/sacado/notas-fiscais`;
- `/sacado/aprovacao`;
- `/sacado/pagamentos`.

Notificações, auditoria, históricos compartilhados e os portais de gestor,
cedente e consultor não foram migrados.

## Diagnóstico inicial

### Carregador anterior

`carregarPortalSacado()` executava sempre a mesma sequência:

```text
Sessão
  ↓
Sacado por user_id
  ↓
Todas as NFs cujo destinatário possui o CNPJ do sacado
  ↓
Todos os vínculos operacoes_nfs dessas NFs
  ↓
Todas as operações relacionadas, cedentes e contas escrow
  ↓
Junção em memória
  ↓
Filtro, ordenação e agregação no navegador
```

O resultado possuía três coleções integrais: NFs vinculadas a operações,
NFs recebidas e operações. As quatro rotas repetiam a chamada durante a
montagem do Client Component.

### Dados desperdiçados por rota

| Rota | Dados carregados antes | Dados efetivamente usados |
|---|---|---|
| Dashboard | Todas as NFs, vínculos e operações | Indicadores, vencimentos e agrupamento por cedente |
| NFs | Todas as NFs, vínculos e operações | Linhas filtradas e contexto operacional resumido |
| Aprovação | Todas as NFs, vínculos e operações | Somente NFs abertas para aceite |
| Pagamentos | Todas as NFs, vínculos e operações | Somente operações pagáveis/liquidadas/inadimplentes |

Além do payload excedente, Dashboard, NFs e Pagamentos realizavam agregações,
busca, filtros e ordenação no navegador. Aprovação e Pagamentos podiam carregar
novamente todo o portal após uma ação. Em desenvolvimento, a montagem por
`useEffect` também ficava sujeita à repetição de efeitos pelo Strict Mode.

## Arquitetura implementada

```text
Server Component da rota
  ↓
resolverContextoSacado()
  ↓
Loader específico
  ↓
filtros + count + ordenação + range/agregação no Postgres
  ↓
contrato compacto
  ↓
Client Component apenas para URL, modal e ações
```

Casos de uso:

- `carregarDashboardSacado()`;
- `carregarNotasFiscaisSacado()`;
- `carregarAprovacoesSacado()`;
- `carregarPagamentosSacado()`.

`carregarPortalSacado()` foi mantido temporariamente para consumidores fora do
Escopo 4, marcado como legado e removido das quatro rotas migradas. Mesmo o
legado passou a reutilizar `resolverContextoSacado()`.

## Contexto, autorização e semântica multifundo

`resolverContextoSacado()` deriva toda a identidade da sessão:

1. exige sessão com perfil `sacado`;
2. exige perfil ativo;
3. consulta o cadastro por `sacados.user_id = auth.uid()`;
4. normaliza e valida o CNPJ canônico com 14 dígitos;
5. devolve somente cliente autenticado, ID, CNPJ e razão social.

As telas não enviam `sacadoId`, CNPJ ou fundo como fonte de autorização. IDs
de NF e operação recebidos por actions são reconsultados e comparados ao
destinatário autenticado. As leituras usam o cliente autenticado e preservam
RLS; `service_role` não é utilizado.

O modelo atual do portal do sacado:

- não possui seletor de fundo ativo;
- não possui `tenant_id` no cadastro de sacado ou nas NFs;
- consolida a visão pelo CNPJ do destinatário;
- permite que NFs sem operação apareçam na listagem de recebidas;
- limita operações às relacionadas às NFs autorizadas.

O schema atual também declara o CNPJ do sacado como único globalmente. Portanto,
dois cadastros do mesmo CNPJ em tenants diferentes não são representáveis hoje.
O Escopo 4 preserva essa semântica e não introduz um fundo ativo artificial.
Uma futura segregação real por tenant exigirá evolução de modelagem e RLS.

## Dashboard

`/sacado/dashboard` é Server Component e usa
`carregar_dashboard_sacado()`, uma função `SECURITY INVOKER`.

A função produz no banco:

- total devido e quantidade de NFs ativas;
- vencidas e valor vencido;
- vencimentos do dia;
- próximos sete dias;
- até oito vencimentos mais próximos;
- até oito agrupamentos por cedente.

Somente NFs ligadas a operações em `aprovada`, `em_andamento` ou
`inadimplente` entram nos valores em aberto, preservando a regra anterior.
Nenhuma coleção integral é retornada para calcular cards.

## Notas fiscais recebidas

`/sacado/notas-fiscais` usa offset com:

- `page=1`;
- `pageSize=10`, aceitando 10, 20 ou 40;
- count exato;
- busca, status e ordenação na URL;
- allowlist de ordenação;
- `id` como desempate.

Após obter somente a página atual:

1. coleta os IDs das NFs da página;
2. consulta `operacoes_nfs` com `nota_fiscal_id IN (...)`;
3. consulta somente as operações vinculadas;
4. monta um contexto operacional compacto.

Não existe query por linha. NF sem operação permanece no resultado com
`operacao: null`.

Os cards de NFs representam o universo autorizado do sacado, e não apenas a
página. São calculados por uma agregação compacta no servidor, incluindo a
compatibilidade em que uma NF é liquidada pelo status da operação ou da própria
NF. A listagem retorna apenas `possuiArquivo`; a URL assinada é criada por
action somente quando o usuário solicita a visualização.

## Aprovação de cessão

`/sacado/aprovacao` consulta apenas NFs no estado aceito pelo RPC transacional:

- NF em `em_antecipacao`;
- operação em `solicitada` ou `em_analise`;
- aceite exigido;
- aceite pendente.

Busca, cedente, vencimento, faixa de valor, ordenação e paginação são aplicados
antes do range. O aceite individual e em lote continua usando
`processar_aceite_sacado`, preservando locks, atomicidade, eventos,
notificações e auditoria.

Antes do RPC, a action revalida em lote:

- existência e titularidade das NFs;
- status atual;
- vínculo operacional único;
- existência e estado das operações;
- obrigatoriedade e pendência do aceite.

IDs repetidos são deduplicados e nenhuma action individual é executada em loop.

## Pagamentos

A entidade efetivamente exibida é `operacoes`, limitada aos estados:

- `em_andamento`;
- `liquidada`;
- `inadimplente`.

Foi mantida navegação por páginas, filtros e total; por isso a estratégia é
offset, não cursor. O volume é uma listagem operacional moderada e o usuário
precisa navegar por página.

O relacionamento com NFs é usado somente para:

- provar que a operação pertence a NF destinada ao CNPJ autenticado;
- obter nome e CNPJ compactos do cedente.

Os três indicadores dessa tela são calculados sobre a página atual e estão
explicitamente identificados como tal na interface. Nenhum dado bancário,
CNAB, arquivo ou payload de conciliação é retornado.

## URL, Client Components e revalidação

Filtros, página, tamanho e ordenação são persistidos na URL com os helpers de
`src/lib/pagination`. Parâmetros inválidos voltam aos defaults. Alterar busca,
filtro ou ordenação volta para a página 1.

Os Client Components cuidam somente de:

- transição de URL;
- debounce da busca;
- paginação;
- modal de visualização;
- aceite, contestação e confirmação de pagamento;
- feedback por toast.

Não há `useEffect` para a carga principal. Após ações, `router.refresh()` apenas
solicita a nova renderização server-side; não há uma segunda chamada manual ao
loader amplo.

Revalidações:

- aceite/contestação: Dashboard, NFs e Aprovação do sacado;
- pagamento: Pagamentos e Dashboard do sacado.

Nenhuma rota de gestor, cedente ou consultor é revalidada por estas actions.

## Índices

O schema base possui chave primária de `operacoes_nfs` em
`(operacao_id, nota_fiscal_id)`. A listagem de NFs consulta a direção inversa,
portanto o candidato técnico é:

```sql
operacoes_nfs (nota_fiscal_id, operacao_id)
```

Nenhum índice foi criado neste escopo. Não houve execução de
`EXPLAIN (ANALYZE, BUFFERS)` em homologação que comprovasse scan inadequado,
seletividade suficiente e benefício superior ao custo de escrita.

A migration criada contém apenas as agregações funcionais do Dashboard e a
lista compacta de cedentes da Aprovação. Ela não contém índice especulativo.

## Métricas estruturais

### Antes

- 1 loader amplo compartilhado;
- 3 coleções integrais por rota: NFs, vínculos e operações;
- filtros e agregações no navegador;
- carga inicial por efeito;
- reload amplo após ações.

### Depois

- 1 caso de uso específico por rota;
- Dashboard: 1 payload agregado e limitado;
- NFs: 1 página + 2 consultas batched de relacionamento + 1 agregação compacta;
- Aprovação: 1 página já elegível + 1 lista compacta de cedentes;
- Pagamentos: 1 página de operações relacionadas;
- zero query por linha;
- zero URL assinada em massa;
- zero coleção integral nas quatro rotas.

Não foi afirmado ganho temporal, pois esta entrega não executou medição com
dados reais de homologação.

## Testes e validação

Os testes automatizados cobrem:

- defaults e allowlists;
- page sizes 10, 20 e 40;
- cenário de 25 NFs em três páginas;
- busca e filtros;
- datas e valores inválidos;
- NF sem operação;
- contrato sem arquivo/documentos/eventos;
- indicadores de pagamento identificados por página;
- quatro Server Components sem loader legado;
- range, batch e ausência de `select("*")`;
- contexto derivado da sessão;
- URL assinada sob demanda;
- revalidações restritas;
- lote deduplicado e RPC transacional;
- `SECURITY INVOKER` e ausência de índice especulativo.

Validações manuais em homologação ainda devem confirmar RLS com usuários reais,
paginação com volume representativo, aceite/contestação, confirmação de
pagamento e preservação visual.

## Arquivos principais

- `src/lib/sacado/contexto.server.ts`;
- `src/lib/sacado/portal-listagens.ts`;
- `src/lib/sacado/portal-loaders.server.ts`;
- `src/components/sacado/NotasFiscaisSacadoListagem.tsx`;
- `src/components/sacado/AprovacoesSacadoListagem.tsx`;
- `src/components/sacado/PagamentosSacadoListagem.tsx`;
- `src/app/sacado/dashboard/page.tsx`;
- `src/app/sacado/notas-fiscais/page.tsx`;
- `src/app/sacado/aprovacao/page.tsx`;
- `src/app/sacado/pagamentos/page.tsx`;
- `src/lib/actions/sacado.ts`;
- `src/lib/actions/sacado-portal.ts`;
- `supabase/migrations/20260729203749_performance_portal_sacado_dashboard.sql`;
- `src/lib/sacado/portal-listagens.test.ts`.

## Riscos remanescentes

- A migration precisa ser aplicada em homologação antes de abrir Dashboard ou
  Aprovação.
- A segregação por tenant não existe no modelo atual do sacado/NF; a garantia
  vigente é o CNPJ global único somado à RLS.
- A necessidade do índice reverso deve ser reavaliada com EXPLAIN e volume real.
- Tempos, payload em bytes e redução de latência dependem de medição em
  homologação.
- Os cenários de RLS, mesmo CNPJ, múltiplos fundos e concorrência do aceite
  precisam de homologação integrada com dados reais.

O Escopo 4 termina aqui. Notificações e áreas externas não foram migradas.
