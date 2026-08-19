# Reuso documental da Matriz (onboarding → checklist cadastral)

## Contexto

O onboarding do Cedente grava documentos cadastrais na tabela legada
`documentos` (enum `documento_tipo`). O checklist cadastral de
Estabelecimento (Matriz/Filial), introduzido pela migration multi-CNPJ, usa
o sistema mais novo `documentos_repositorio` + `documento_versoes` +
`documento_vinculos` + `documento_analises`. São dois sistemas de
armazenamento documental distintos e nunca foram ligados: ao configurar um
requisito cadastral na Matriz, o Cedente era obrigado a reenviar um
documento que já havia enviado e tido aprovado no onboarding.

## Equivalência canônica

Mapeamento fixo por código (não por rótulo/label), definido em
`listar_requisitos_estabelecimento` (migration
`20260819170000_evolucao_estabelecimentos_reuso_documental.sql`):

| `documento_tipos.codigo` (novo, domínio `cadastro`) | `documentos.tipo` (legado, enum `documento_tipo`) |
|---|---|
| `estabelecimento_cartao_cnpj` | `cartao_cnpj` |
| `estabelecimento_comprovante_endereco` | `comprovante_endereco` |
| `estabelecimento_contrato_social` | `contrato_social` |
| `estabelecimento_comprovante_faturamento` | `extrato_bancario` |

`extrato_bancario` é o código legado real do "Comprovante de Faturamento"
(confirmado em `src/lib/actions/gestor.ts`, mapa `tipoLabelsDoc`, e em
`src/lib/documentos/gestor-listagem.server.ts`) — não existe um tipo legado
chamado literalmente "comprovante_faturamento".

## Regras de reuso

1. **Só a Matriz reusa.** A condição `v_estab.tipo = 'matriz'` na CTE
   `legado` impede qualquer Filial de herdar documento do onboarding — a
   Filial sempre precisa de upload próprio, como especificado.
2. **Só reusa quando não há upload próprio do Estabelecimento.** A busca
   pelo documento legado só executa quando a busca pela versão mais recente
   em `documento_vinculos`/`documento_versoes` (para aquele
   `estabelecimento_id` + `documento_tipo_id`) não encontrou nada
   (`dv.id IS NULL`). Um upload feito diretamente no fluxo de estabelecimento
   sempre tem prioridade sobre o reuso do onboarding.
3. **Só reusa documento com status `aprovado`, sem `representante_id`** (os
   quatro tipos equivalentes são documentos da empresa, nunca de
   representante) e usa a versão mais recente (`ORDER BY d.versao DESC`).
4. **Zero duplicação.** Não há INSERT em `documentos_repositorio`,
   `documento_versoes` nem cópia de objeto no Storage. A equivalência é
   **computada em tempo de consulta** via `LEFT JOIN LATERAL` — se o
   documento legado for reprovado ou substituído depois, o próximo `SELECT`
   já reflete o estado atual, sem qualquer sincronização manual.

## Contrato de exibição

`listar_requisitos_estabelecimento(p_estabelecimento_id)` retorna, por
requisito ativo:

- `status`: `'aprovado'` quando satisfeito (por upload próprio ou reuso).
- `origem`: `'estabelecimento'` (upload próprio) | `'cadastro_inicial'`
  (reuso do onboarding) | `null` (pendente).
- `documento_versao_id` (upload próprio) ou `documento_legado_id` (reuso) —
  usados por `obterUrlDocumentoRequisito` para gerar a URL assinada de
  "Ver documento" a partir do bucket/Storage correto em cada caso
  (`documentos-v2` vs `documentos-cedentes`).

A UI (Cedente e Gestor) exibe "Aprovado — Origem: Cadastro inicial" quando
`origem === 'cadastro_inicial'`, sem nenhum botão de reenvio.

## Validação ao vivo (homolog)

`scripts/homologacao/evolucao-estabelecimentos/e2e.mjs` cria um documento
`cartao_cnpj` aprovado na tabela legada, configura o requisito equivalente
na Matriz e confirma: status `aprovado`, origem `cadastro_inicial`,
`documento_versao_id` nulo (nenhuma versão nova criada). Em paralelo,
configura um requisito sem equivalente legado aprovado
(`estabelecimento_comprovante_faturamento`) e confirma que fica `pendente`
— prova de que o reuso é seletivo por tipo, não um "aprova tudo da Matriz".
