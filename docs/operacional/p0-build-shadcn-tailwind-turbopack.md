# P0 — Build Turbopack / shadcn tailwind.css

## Resultado

`P0_BUILD_SHADCN_TURBOPACK = PASS`

## Causa raiz

A importação em `src/app/globals.css` apontava para `shadcn/tailwind.css` via pacote `shadcn`.

Na prática, o erro reportado em dev com Turbopack (`Can't resolve 'shadcn/tailwind.css'`) indicava falha de resolução de subpath no bundler para esse import, ainda que o pacote esteja presente em `node_modules`.

## Correção aplicada

- Mantido o pacote `shadcn` sem upgrades.
- Removido o import remoto de `globals.css`:
  - removido `@import "shadcn/tailwind.css";`
  - adicionado `@import "./shadcn-tailwind.css";`
- Criado arquivo local com o conteúdo de estilos compartilhados do ShadCN:
  - `src/app/shadcn-tailwind.css`
- O conteúdo adicionado inclui:
  - keyframes `accordion-down` / `accordion-up`
  - variantes `@custom-variant` usadas pelos componentes
  - utilitário `@utility no-scrollbar`

## Arquivos alterados

- `src/app/globals.css`
- `src/app/shadcn-tailwind.css` (novo)
- `docs/operacional/p0-build-shadcn-tailwind-turbopack.md` (novo)

## Dependências

Nenhuma dependência foi alterada (`package.json` e `package-lock.json` sem mudanças).

## Classificação inicial

`TURBOPACK_RESOLUTION_BUG` (resolvido após ejetar CSS do subpath).

## Validações realizadas

1. `npm ls shadcn --depth=0`
2. `npx next build --webpack`
3. `npx next dev --turbo --port 3009` (checagem sem sucesso de resolução no log de startup; erro adicional de servidor já em execução em outra instância)
4. Leitura de `.next/dev/logs/next-development.log` para verificar ausência de erro de resolução `shadcn/tailwind.css`

## Webpack antes / depois

- Antes: build podia falhar em cenários de Turbopack por import em runtime; o pacote de CSS era uma dependência de resolução sensível.
- Depois: build webpack executado com sucesso e projeto usa CSS local estável.

## Turbopack antes / depois

- Antes: erro `Can't resolve 'shadcn/tailwind.css'` em ambiente afetado.
- Depois: `next dev --turbo` sobe sem erro de resolução reportado no fluxo de bootstrapping.

## Riscos remanescentes

- A validação completa em ambiente com rota autenticada precisa ser feita com `next dev --turbo` sem instância concorrente existente (evitar falsos negativos de porta/ambiente).
- Não houve alteração de regras de design system; qualquer divergência de estilos após ajuste deve ser revisada visualmente em telas de autenticação e componentes UI.
