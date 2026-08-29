# Paginação, busca, ordenação e cursores

## Diagnóstico anterior ao Escopo 0

O projeto possuía contratos independentes:

- a listagem de NFs do cedente já limitava páginas a 10, 20 ou 40 itens, calculava o intervalo para `.range()` e mantinha uma allowlist de ordenação em `src/lib/notas-fiscais/listagem.ts`;
- o onboarding possuía paginação específica da rota, com limites e componente próprios;
- o histórico operacional utilizava carregamento incremental e um cursor local baseado somente em data;
- normalização de página, busca e direção de ordenação aparecia em diferentes actions e páginas;
- `OnboardingPagination` e o carregamento incremental do histórico são componentes de domínio, não bases reutilizáveis.

O risco de substituir esses contratos de uma só vez seria alterar queries, URLs ou estados operacionais. Por isso, o Escopo 0 cria apenas uma base pura. A única compatibilidade aplicada foi fazer os helpers já públicos da listagem de NFs delegarem à base nova, sem alterar assinatura ou resultado.

## Contrato padrão

O módulo `src/lib/pagination` não depende de React, Next.js, Supabase ou APIs exclusivas do Node.js. Ele pode ser importado por Server Components, Client Components e testes.

- `AllowedPageSize`: `10 | 20 | 40`;
- página padrão: `1`;
- tamanho padrão: `10`;
- maior página aceita por parâmetro: `1.000.000`;
- busca: no máximo `120` caracteres após `trim` e colapso de espaços;
- ordenação: campo validado por allowlist e direção `asc` ou `desc`;
- desempate estável: sempre `id`;
- cursor: `{ createdAt, id }`, codificado em base64url.

`parsePaginationParams` aceita:

- `URLSearchParams`;
- objeto compatível com `searchParams` de Server Components;
- `Record<string, string | string[] | undefined>`.

Quando um parâmetro aparece mais de uma vez, o primeiro valor é usado de forma determinística. Valores vazios, decimais, negativos, excessivos ou fora da allowlist usam o default.

## Offset e convenções de índices

Use offset em listagens navegáveis nas quais o total e o acesso direto a uma página são relevantes.

```ts
const pagination = parsePaginationParams(searchParams)
const range = buildOffsetRange(pagination)

query.range(range.from, range.to)
```

As convenções não devem ser misturadas:

- banco/Supabase: `from` e `to` são 0-based e inclusivos;
- metadata de UI: `from` e `to` são 1-based;
- resultado vazio: `from = 0`, `to = 0` e `totalPages = 0`.

Quando a página solicitada fica fora do intervalo, `buildPaginationMeta` a limita à última página válida e informa:

- `requestedPage`: página originalmente solicitada;
- `wasPageAdjusted`: indica que a listagem deve atualizar a URL ou refazer a consulta;
- `from = 0` e `to = 0` quando a consulta atual voltou vazia, inclusive após uma exclusão.

## Cursor composto

Use cursor em feeds, timelines e carregamento incremental, especialmente quando registros podem ser inseridos entre requisições.

```ts
const cursor = parseCursor(searchParams.cursor)

if (cursor) {
  // Semântica para created_at DESC, id DESC:
  // created_at < cursor.createdAt
  // OU
  // created_at = cursor.createdAt E id < cursor.id
}
```

O timestamp é validado como ISO 8601 com timezone e normalizado para UTC com seis casas decimais. O ID deve ser UUID. JSON malformado, base64 inválido, campos ausentes ou extras retornam `null`, sem exceção não tratada.

O cursor:

- contém todos os campos da ordenação estável;
- não contém dados sensíveis;
- não substitui filtros de autorização, RLS ou validação de contexto;
- deve ser tratado apenas como posição de leitura, nunca como prova de acesso.

## Busca

`normalizarBusca` apenas prepara texto:

```ts
const busca = normalizarBusca(searchParams.q)
```

Ela preserva acentos, pontuação de CPF/CNPJ e caracteres de chaves de acesso. Escape de filtros, montagem de SQL ou sintaxe específica do Supabase pertencem ao caso de uso que aplica a busca.

## Ordenação segura

Cada listagem registra seus próprios campos:

```ts
const ordenacao = parseSortParams({
  sort: searchParams.sort,
  direction: searchParams.direction,
  allowedFields: ['created_at', 'valor_bruto'] as const,
  defaultField: 'created_at',
  defaultDirection: 'desc',
})
```

Somente `ordenacao.field` e `ordenacao.direction`, já validados, podem ser aplicados à query. A listagem deve aplicar também `id` na mesma direção como desempate.

## Parâmetros de URL

`buildListParams`, `buildListQuery` e `buildListUrl`:

- preservam filtros existentes e valores repetidos;
- removem valores vazios;
- não dependem de `useRouter`;
- voltam para a página 1 ao alterar busca, filtro, ordenação ou tamanho da página;
- aceitam outro nome de parâmetro de página por `pageParam`.

```ts
const href = buildListUrl('/gestor/exemplo', currentParams, {
  status: 'rascunho',
  pageSize: 20,
})
```

O componente que consome a URL permanece responsável pela navegação.

## Componentes compartilhados

- `ListPagination`: recebe metadata e callbacks; não mantém uma cópia da página em estado local.
- `LoadMoreButton`: representa `hasMore`, loading, erro e repetição; não está conectado a histórico ou rota operacional.

Os componentes usam o design system atual e não são integrados automaticamente às páginas.

## Integração de uma nova listagem

1. Defina a allowlist de ordenação do caso de uso.
2. Faça o parsing dos parâmetros no limite da rota.
3. Normalize a busca sem montar SQL na camada comum.
4. Aplique filtros e autorização antes da paginação.
5. Use `buildOffsetRange` ou o cursor composto, nunca ambos na mesma consulta.
6. Consulte somente as colunas necessárias.
7. Monte `PaginationMeta` usando o total e a quantidade realmente retornada.
8. Preserve filtros com os helpers de URL.
9. Trate `wasPageAdjusted` com redirect ou nova consulta quando necessário.
10. Adicione testes específicos da query e da autorização da rota.

## Testes

Os testes unitários da base estão em `src/lib/pagination/pagination.test.ts`:

```bash
npm test -- --run src/lib/pagination/pagination.test.ts
```

Eles cobrem parâmetros inválidos, índices, metadata, busca, allowlist, cursor composto e preservação da URL.

## Antipadrões

- buscar todos os registros e paginar no cliente;
- executar uma Server Action ou query por linha;
- usar `Promise.all` de consultas individuais para montar uma listagem;
- usar cursor somente com `created_at`;
- usar `select('*')` em listagens;
- aplicar filtros somente no cliente;
- encaminhar uma coluna de ordenação diretamente da URL;
- manter a paginação apenas em `useState`;
- usar cursor como autorização;
- incluir SQL ou detalhes de Supabase na base compartilhada.
