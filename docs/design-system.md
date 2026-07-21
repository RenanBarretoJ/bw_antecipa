# Design System — BW Antecipa

## Fonte e direção visual

O sistema usa Inter, carregada em `src/app/layout.tsx` com `next/font/google`. A referência `design-reference/v0-bw-antecipa/` foi reinterpretada sobre os componentes reais do portal; nenhum componente ou dado da referência é importado em runtime.

A direção visual segue o V0: autenticação dividida entre painel institucional claro e formulário preto; portais internos dark-first, sidebar grafite, azul vivo para ações e item ativo, bordas discretas, cards compactos e estados comunicados por texto e ícone.

## Tokens

Os tokens ficam em `src/app/globals.css` e são consumidos pelos componentes shadcn existentes:

- Superfícies: `background`, `card`, `popover`, `muted`, `accent`.
- Texto: `foreground`, `card-foreground`, `muted-foreground`.
- Ações: `primary`, `secondary`, `destructive` e seus foregrounds.
- Feedback: `success`, `warning`, `info` e seus foregrounds.
- Estrutura: `border`, `input`, `ring`.
- Navegação: `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-accent`, `sidebar-border`.
- Gráficos: `chart-1` a `chart-5`.
- Raio: `--radius` com derivados `sm`, `md`, `lg`, `xl`, `2xl`, `3xl` e `4xl`.

As cores são OKLCH e o conjunto padrão da aplicação é dark-first. Login e cadastro usam superfícies de autenticação explícitas para reproduzir o painel claro pontilhado e o formulário preto do V0.

## Tipografia

- `text-3xl`/`text-2xl`: título de página e título principal.
- `text-lg`: título de seção.
- `text-sm`: corpo e dados de interface.
- `text-xs uppercase tracking-wide`: labels e cabeçalhos de tabela.
- `font-mono tabular-nums`: CNPJ, IDs, chaves e valores numéricos.

## Componentes estruturais

- `src/components/layout/portal-shell.tsx`: autenticação visual, resolução de perfil e composição do portal.
- `src/components/layout/portal-sidebar.tsx`: menu por role, estado ativo e drawer mobile.
- `src/components/layout/portal-header.tsx`: notificações, usuário, role, logout e menu mobile.
- `src/components/layout/page-container.tsx`: largura e espaçamento horizontal padrão.
- `src/components/layout/page-header.tsx`: título, descrição, breadcrumb opcional e ação primária.

## Primitivas de conteúdo

`src/components/data-display/primitives.tsx` contém `DetailSection`, `DetailField`, `FieldGrid`, `StatusBadge`, `MetricCard`, `FilterBar`, `DataTableContainer`, `EmptyState`, `LoadingState`, `ErrorState`, `DocumentRow` e `ResponsiveActions`.

Todos recebem dados/callbacks por props e não fazem consultas nem contêm dados mockados.

## Responsividade e acessibilidade

O shell usa sidebar fixa em desktop e drawer com overlay em mobile. Tabelas ficam em contêiner com rolagem horizontal localizada; ações permanecem visíveis; títulos e identificadores podem quebrar. Botões de ícone têm `aria-label`, estados têm texto e ícone, e o foco utiliza os tokens `ring`.

## Aplicação concreta da Fase 2.5B

A transformação visual foi aplicada nas telas reais do portal, sem importar a implementação estática de `design-reference/v0-bw-antecipa/` e sem alterar consultas, server actions ou regras de negócio.

- `src/app/gestor/dashboard/page.tsx`: alertas por severidade, quatro `MetricCard` com os dados já calculados, tabela de operações recentes com `StatusBadge`, estado vazio e acessos rápidos.
- `src/app/gestor/cedentes/page.tsx`: `FilterBar`, tabela dentro de `DataTableContainer`, status semântico, estado de carregamento e estado vazio contextual aos filtros.
- `src/app/gestor/cedentes/[id]/page.tsx`: cabeçalho de entidade com status, largura de detalhe, `DetailSection` para cadastro e documentos e `FieldGrid` para organizar as informações reais. Os blocos de análise, aprovação, taxas, alteração cadastral, acessos, fundo e contrato continuam usando os handlers originais.
- `src/app/gestor/fundos/page.tsx`: seção estruturada, `LoadingState`, `EmptyState` e `StatusBadge`, mantendo o formulário lateral e as ações de criação, edição e ativação.
- `src/app/gestor/politicas/page.tsx`: carregamento por estado do design system, mensagens semânticas, controles com foco visível, políticas selecionáveis e histórico de versões com hierarquia visual reforçada.

### Evidência e limite de inspeção visual

Não foi criado usuário fictício nem desativada a autenticação para obter screenshots. A validação disponível nesta execução é estrutural e de build: as rotas reais foram compiladas e `design-reference/` foi excluído do TypeScript/build. Screenshots autenticados em 1440, 768 e 375 px ainda dependem de uma sessão válida e de um navegador disponível no ambiente.

## Aplicação concreta da Fase 2.5C

- `src/app/layout.tsx` aplica `Inter` de forma centralizada no `body` com `font-sans`; a fonte computada foi verificada no navegador como `Inter, "Inter Fallback", ui-sans-serif, system-ui, sans-serif`.
- `src/app/globals.css` deixou de usar `--font-sans` circular e passou a declarar tokens dark-first para background, card, input, borda, sidebar e ação primária.
- `src/app/(auth)/login/page.tsx` e `src/app/(auth)/cadastro/page.tsx` reproduzem a composição V0: painel claro pontilhado, formulário sem card branco, fundo preto, campos escuros, ícones e botão branco.
- `src/components/layout/portal-sidebar.tsx`, `portal-header.tsx` e `portal-shell.tsx` consomem o tema escuro, preservando menus reais, role, notificações, usuário, logout e responsividade.
- `src/app/gestor/cedentes/[id]/page.tsx` passou a consumir os tokens escuros também nos estados de aprovação, validade, ações, acesso, fundo e contrato, mantendo os dados e handlers originais.

As capturas autenticadas do detalhe dependem de uma sessão real; não foram criados dados fictícios nem bypass de autenticação para produzi-las.
