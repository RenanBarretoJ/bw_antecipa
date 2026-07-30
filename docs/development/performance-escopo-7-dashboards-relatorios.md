# Escopo 7 — performance de dashboards e relatórios

## Objetivo

Este escopo remove das cinco rotas analíticas o carregamento integral de
operações, cedentes, notas fiscais, documentos, contas escrow e entregas usado
apenas para produzir indicadores. As fórmulas existentes foram preservadas e
movidas para agregações PostgreSQL com escopo derivado da sessão.

Rotas abrangidas:

- `/gestor/dashboard`;
- `/cedente/dashboard`;
- `/consultor/dashboard`;
- `/gestor/relatorios`;
- `/consultor/relatorios`.

Nenhuma série temporal ou exportação foi criada, pois essas funcionalidades não
existiam nas telas anteriores.

## Diagnóstico anterior

### Dashboard do gestor

Era um Client Component com `useEffect`. Carregava todos os vínculos ativos do
fundo, cedentes, documentos pendentes, operações, contas escrow e entregas.
Somente a contagem de NFs usava `head: true`. Os cards eram calculados com
`filter` e `reduce`; as oito operações recentes eram obtidas com `slice(0, 8)`
depois da leitura integral.

### Dashboard do cedente

Carregava todas as NFs, operações e versões do repositório documental legado.
Reduzia as versões de documentos no navegador e aplicava `slice(0, 5)` às
operações. A resolução operacional não estava explícita no loader da página.

### Dashboard do consultor

Carregava a carteira completa e apenas dez operações. Os próprios cards eram
calculados sobre essas dez operações, o que podia truncar volume, quantidade e
comissão. A comissão fazia uma busca linear na carteira para cada operação.

### Relatório do gestor

Carregava todos os vínculos, todas as operações e todos os cedentes do fundo.
Para cada cedente, filtrava novamente todas as operações, caracterizando
complexidade O(N × M). Mês, agrupamentos, totais e ordenação eram calculados no
navegador. Não havia paginação.

### Relatório do consultor

Carregava carteira e operações completas. Para cada vínculo da carteira,
filtrava todas as operações do mês e todas as operações acumuladas. A tabela era
ordenada integralmente no navegador e não possuía paginação.

## Arquitetura

Antes:

```text
Client Component
  → várias consultas pelo navegador
  → coleções completas
  → filter/reduce/map cruzado
  → cards + slice de recentes + tabela completa
```

Depois:

```text
Server Component
  → autenticação e perfil
  → fundo/vínculo/carteira resolvido no servidor
  → RPC específica SECURITY INVOKER
      → validação auth.uid()
      → agregações SQL
      → GROUP BY por cedente
      → LIMIT real para recentes
      → LIMIT/OFFSET para tabela
  → contrato compacto
  → Client Component somente para filtros e paginação na URL
```

As cinco RPCs têm `search_path` vazio, execução revogada de `PUBLIC` e concessão
apenas a `authenticated`. Nenhuma leitura usa `service_role`.

## Definições preservadas

### Gestor

| Indicador | Origem e definição |
|---|---|
| Cedentes | vínculos `cedente_fundos` ativos do fundo; ativos por `cedentes.status = ativo` |
| Documentos pendentes | repositório legado `documentos` em `enviado` ou `em_analise` |
| Operações ativas | `operacoes.status = em_andamento` |
| Prontas para análise | `solicitada/em_analise` com aceite não exigido, dispensado ou aceito |
| Inadimplência | `status = inadimplente` |
| Volume ativo | soma do valor líquido das operações em andamento |
| Volume mensal | soma bruta no mês UTC, excluindo canceladas e reprovadas |
| Saldo escrow | disponível + bloqueado das contas dos cedentes do fundo |
| NFs pendentes | `submetida` ou `em_analise` no fundo |
| Entregas em acompanhamento | `em_transito` ou `aguardando_validacao` |

No relatório, receita permanece `valor_bruto_total -
valor_liquido_desembolso`. A taxa média permanece média aritmética simples,
sem ponderação por valor.

### Cedente

O escopo é o `cedente_fundo` ativo selecionado. NFs e operações são contadas
somente nesse vínculo. A conta escrow continua sendo a primeira conta de forma
determinística por data de criação e ID. Documentos reprovados continuam sendo
a versão mais recente de cada combinação tipo/representante.

### Consultor

O escopo é derivado exclusivamente de `consultor_cedente` e `auth.uid()`.
Operações ativas mantêm os status `em_andamento`, `solicitada` e `em_analise`.
O volume mensal é bruto e exclui canceladas/reprovadas. Comissão estimada usa o
valor líquido de operações em andamento multiplicado pelo percentual do
vínculo.

No relatório do consultor, foi preservada uma inconsistência preexistente:

- card mensal: volume bruto;
- linha mensal por cedente: volume líquido;
- acumulado: volume bruto;
- comissão: volume líquido × percentual.

Ela está explícita na interface e não foi alterada sem autorização.

## Relatórios, filtros e paginação

A URL é a fonte de verdade:

```text
?mes=2026-07
&page=1
&pageSize=10
&q=...
&status=...
&cedente=...
&dataInicial=...
&dataFinal=...
&sort=volume_total
&direction=desc
```

Parâmetros inválidos recebem defaults. Tamanhos permitidos: 10, 20 e 40.
Busca, status, cedente e período total são aplicados antes do `LIMIT/OFFSET`.
Quando um status é escolhido explicitamente, a tabela representa esse status
inclusive para canceladas/reprovadas; sem filtro, mantém a exclusão histórica
desses dois estados nos volumes e quantidades.
Os cards são calculados independentemente da página e preservam a semântica
global/mensal anterior.

## Autorização e RLS

- Gestor: papel `gestor`, cookie HttpOnly de fundo ativo e vínculo ativo em
  `usuario_fundos`, revalidados antes da RPC e dentro dela.
- Cedente: usuário proprietário, vínculo `cedente_fundo` ativo e fundo ativo,
  resolvidos pelo domínio existente.
- Consultor: papel `consultor` e carteira derivada de `consultor_cedente`.

A migration restringe a policy de leitura de `operacoes` do consultor à própria
carteira. A policy anterior verificava apenas o papel e permitia leitura cruzada.

## Índices e medição

Nenhum índice foi criado. Não havia conexão de homologação utilizada para
executar `EXPLAIN (ANALYZE, BUFFERS)` com dados representativos; criar índice
sem essa evidência violaria o padrão do projeto. Depois de aplicar a migration,
devem ser medidos especialmente:

- operações por `cedente_fundo_id`, `created_at` e `status`;
- vínculos por `fundo_id` e `status`;
- carteira por `consultor_id`;
- NFs por `fundo_id`/`cedente_fundo_id` e `status`;
- entregas por `nota_fiscal_id` e `status_entrega`.

Não há alegação de ganho de tempo ou payload sem medição em homologação.
Estruturalmente, foram removidas cinco cargas client-side, dois loops O(N × M),
os `slice` após carga integral e a tabela analítica sem paginação.

## Homologação necessária

- aplicar a migration incremental;
- atualizar o schema cache do PostgREST;
- comparar os cards com dados conhecidos nos três perfis;
- testar isolamento entre dois fundos e dois consultores;
- testar relatórios vazios e com mais de 40 cedentes;
- testar páginas 1, 2 e fora do intervalo;
- testar filtros, mês, datas e ordenação;
- comparar centavos, taxa média simples e comissão com o cálculo anterior;
- capturar payload, duração e planos com `EXPLAIN (ANALYZE, BUFFERS)`;
- avaliar índices somente após os planos reais.

## Riscos remanescentes

- As RPCs precisam ser aplicadas no banco antes do deploy da aplicação.
- Os testes locais validam contratos, normalização e estrutura; isolamento RLS,
  planos e equivalência financeira completa dependem de testes integrados em
  homologação.
- Valores `numeric` seguem a conversão para `number` já usada pela aplicação.
  O banco preserva a soma decimal, mas a apresentação continua submetida à
  estratégia numérica legada do frontend.
- O filtro de período total afeta as métricas da tabela, enquanto os cards
  mensais continuam independentes. Essa separação é informada na tela.
