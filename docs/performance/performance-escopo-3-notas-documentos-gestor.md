# Escopo 3 de performance — Notas fiscais e documentos do gestor

## Objetivo e limite do escopo

Este escopo migra exclusivamente as listagens `/gestor/notas-fiscais` e
`/gestor/documentos` para leitura paginada no servidor e elimina o N+1
documental da aprovação de NFs em lote. As regras de satisfação documental,
reconciliação XML/DANFE, status, auditoria, eventos e notificações foram
preservadas.

Não foram migradas telas de operações, onboarding, dashboards, relatórios,
fundos, políticas, logística, CNAB, Portal FIDC ou portais externos ao gestor.

## Diagnóstico inicial

### Notas fiscais

A rota era um Client Component que:

- carregava a coleção integral de NFs do fundo;
- repetia a mesma consulta na carga inicial e em `reloadNfs`;
- filtrava, ordenava e calculava cards no navegador;
- recarregava novamente a coleção depois das ações;
- não possuía `count` nem `range` no banco.

### Documentos

A rota também era um Client Component. A carga inicial e `loadDocs` repetiam:

1. leitura de todos os vínculos do fundo;
2. leitura de todos os documentos desses cedentes.

Busca, filtro, ordenação e cards eram processados em memória. O contrato
incluía o path do arquivo e a interface gerava URL assinada diretamente no
cliente.

### Aprovação em lote

O lote usava `Promise.all(nfs.map(...))` sobre `listarChecklistDaNota(nf.id)`.
Isso somente paralelizava o N+1: para cada NF eram repetidas autenticação,
resolução de política, requisitos, instâncias, versões e análises. O custo de
leitura crescia proporcionalmente ao número de NFs.

## Arquitetura antes e depois

Antes:

```text
Client Component
  -> carga integral
  -> filtro/ordenação/cards no navegador
  -> ação
  -> segunda carga integral
```

Depois:

```text
Server Component
  -> autenticação do gestor
  -> fundo ativo autorizado
  -> filtros/searchParams
  -> count + order estável + range no banco
  -> hidratação mínima em lote da página
  -> contrato compacto
  -> Client Component somente para interação
```

Aprovação em lote:

```text
IDs normalizados e deduplicados
  -> autenticação e fundo ativo uma vez
  -> uma leitura das NFs
  -> resumo documental em lote
  -> regra pura em memória
  -> mutação em lote
  -> revalidação das rotas afetadas
```

## Implementação

### Paginação e filtros

As duas rotas reutilizam `src/lib/pagination`, com:

- página inicial 1;
- tamanho inicial 10;
- tamanhos permitidos 10, 20 e 40;
- `count: exact`;
- filtros aplicados antes de `range`;
- ordenação com allowlist;
- desempate estável por `id`;
- normalização de página fora do intervalo.

Alterações de busca, filtro, ordenação e tamanho retornam à página 1. O estado
fica na URL e o detalhe da NF recebe `returnTo`.

### Contratos compactos

A listagem de NFs recebe somente os campos visíveis, vínculo operacional e
resumo documental. Não recebe XML, DANFE, arquivos, URLs, histórico, eventos,
política integral ou versões completas.

A listagem de documentos não recebe path, URL assinada, conteúdo ou histórico.
O path é lido e a URL de dez minutos é gerada somente após o gestor solicitar
a abertura, com nova validação de perfil, fundo e vínculo do cedente.

### Resumo documental

`carregarResumoDocumentalDasNotas()` recebe somente os IDs da página ou do
lote. Ele consolida:

- instâncias pré-cessão por `nota_fiscal_id IN (...)`;
- metadados mínimos dos requisitos;
- versão relevante por documento;
- última análise relevante;
- nomes do catálogo.

O resultado é avaliado por `avaliarChecklistDaNotaComDados()`, função pura que
reutiliza `resolverSatisfacaoRequisitoParaAprovacao()`. Requisitos opcionais
sem bloqueio e requisitos pós-cessão não bloqueiam a aprovação.

### Aprovação individual e em lote

A aprovação individual e a aprovação em lote usam o mesmo loader e a mesma
regra pura. O lote:

- rejeita lista vazia;
- deduplica IDs;
- rejeita NF ausente, de outro fundo ou com status incompatível;
- preserva a semântica atômica existente;
- retorna resultado estruturado por NF;
- não chama action ou checklist por linha.

Eventos, auditoria e notificações existentes foram mantidos. Aprovação,
reprovação, solicitação de ajuste e análise documental revalidam somente as
listagens e detalhes relacionados.

## Autorização e RLS

As leituras usam o cliente autenticado, nunca `service_role`. O fluxo valida:

- sessão;
- perfil gestor ativo;
- cookie HttpOnly de fundo ativo;
- autorização ativa em `usuario_fundos`;
- fundo ativo;
- vínculo ativo em `cedente_fundos`;
- pertencimento das NFs/documentos ao fundo.

Os IDs enviados pelo cliente são novamente consultados e autorizados no
servidor. A RLS continua ativa como camada adicional.

## Métricas estruturais

| Fluxo | Antes | Depois |
|---|---|---|
| NFs na listagem | coleção integral | no máximo 10, 20 ou 40 linhas |
| Documentos na listagem | coleção integral | no máximo 10, 20 ou 40 linhas |
| Filtro/ordenação | navegador | banco |
| Carga inicial | implementação duplicada com reload | uma fonte server-side |
| URL de documentos | path na coleção e assinatura no cliente | action sob demanda |
| Checklist no lote | N checklists completos | conjunto constante de consultas em lote |
| Autenticação do lote | repetida pelos checklists | uma vez no caso de uso |

Não foi afirmado ganho temporal porque não houve acesso ao banco de homologação
para medir tempo, buffers, payload real ou `EXPLAIN (ANALYZE, BUFFERS)`.

## Índices

Foram encontrados índices existentes para:

- `notas_fiscais(cedente_fundo_id, status)`;
- `documento_requisito_instancias(nota_fiscal_id, status)`;
- `documento_versoes(documento_id, status, numero_versao DESC)`;
- `documento_analises(documento_versao_id, analisado_em DESC)`.

Não foi criada migration. Candidatos adicionais para ordenações das listagens
devem ser avaliados somente com `EXPLAIN (ANALYZE, BUFFERS)` em homologação,
considerando seletividade e custo de escrita.

## Validação e riscos residuais

Testes unitários cobrem parsing seguro, paginação, métricas de página, contratos
compactos, ausência de consulta por linha, requisito opcional, requisito
pós-cessão, documento rejeitado e checklist ausente.

Riscos que exigem homologação:

- medição real de latência, payload, linhas e buffers;
- confirmação das policies RLS com usuários de fundos diferentes;
- concorrência entre validação documental e mutação do lote;
- comportamento com grandes volumes e termos de busca pouco seletivos.

A atualização em lote permanece uma única mutação, como no fluxo anterior.
Não foi criada RPC transacional nova neste escopo.

## Arquivos principais

- `src/app/gestor/notas-fiscais/page.tsx`
- `src/app/gestor/documentos/page.tsx`
- `src/components/notas-fiscais/NotasFiscaisGestorListagem.tsx`
- `src/components/documentos/DocumentosGestorListagem.tsx`
- `src/lib/notas-fiscais/gestor-listagem.ts`
- `src/lib/notas-fiscais/gestor-listagem.server.ts`
- `src/lib/notas-fiscais/resumo-documental-gestor.server.ts`
- `src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts`
- `src/lib/documentos/gestor-listagem.ts`
- `src/lib/documentos/gestor-listagem.server.ts`
- `src/lib/gestor/contexto-fundo.server.ts`
- `src/lib/actions/nota-fiscal.ts`
- `src/lib/actions/documento-v2.ts`
- `src/lib/actions/gestor.ts`

O Escopo 3 termina aqui. O Escopo 4 não foi iniciado.
