# P16 — reutilização de NF de operação cancelada

## Diagnóstico

Base: `origin/main` em `83ece9c676a4f39ff130a8885847735c8b1da17d`.
Classificação: `KNOWN_GAP_NOW_MATERIALIZED`. A migration P14
`20260922182301` documenta explicitamente a manutenção de `cancelada` como
reservante. A função privada `operacao_status_reserva_nf` mantém essa regra
em produção e homologação. Não é uma regressão introduzida pelo P15.1.

As duas sobrecargas de `solicitar_operacao_antecipacao_atomica` usam o mesmo
predicado. A versão de 16 argumentos vem do P14; a de 17 argumentos foi
atualizada pelo C1.1 (`20260925144547`) e atende Cedente/Consultor, com e sem
parcelas. Ambas mantêm locks antes da checagem de reserva. O fluxo com
parcelas também mantém sua verificação de disponibilidade por parcela.

`src/lib/actions/operacao.ts`, função `cancelarOperacao`, valida o Cedente e
o estado solicitada/em_analise, cancela a operação, restaura a NF para
aprovada, libera parcelas e registra log/evento. Essas escritas existentes
são separadas; P16 não altera esse fluxo porque a restauração foi observada
no caso real. `operacoes_nfs` permanece como histórico.

`src/lib/operacoes/nova-solicitacao.server.ts` seleciona NFs aprovadas do
contexto ativo, dentro do vencimento e com elegibilidade documental. A UI
apresentava as NFs restauradas, mas o submit rejeitava seu histórico cancelado.

## Caso real e baseline de produção

Projeto confirmado: `wwsndnuvnjuabpbjwlck` (`bw-antecipa`). O usuário confirmou
a operação `8cbb79f2-7829-462e-b350-518b459092d6`. Consulta somente leitura:
cancelada, 20 vínculos históricos, 20 NFs aprovadas, nenhum outro vínculo de
operação para essas NFs. A situação deve ser conferida novamente antes da
migration e do smoke produtivo.

| Status | Baseline medido: reserva | P16 esperado: reserva |
| --- | --- | --- |
| solicitada | sim | sim |
| em_analise | sim | sim |
| aprovada | sim | sim |
| em_andamento | sim | sim |
| liquidada | sim | sim |
| inadimplente | sim | sim |
| reprovada | não | não |
| cancelada | sim | não |

MD5 de `pg_get_functiondef`, iguais em produção/homolog antes do P16:

- predicado: `90cbdcc13789bfe14907f403903a5cac`;
- RPC 16 argumentos: `3e8de55f12866ef332af984fde40c102`;
- RPC 17 argumentos: `bf0ba6dfc83993afd4106c46408edb05`.

## Correção

Migration incremental `20260928185439_p16_liberar_nf_de_operacao_cancelada.sql`.
Altera somente a função privada compartilhada: remove `cancelada` da lista
reservante. Preserva assinatura, volatilidade, search_path e ACL restrita.
Nenhum DML, exclusão de histórico, mudança de RPC público, RLS, grant
operacional, app, taxa, template ou integração.

Referências consultadas: [funções Supabase](https://supabase.com/docs/guides/database/functions)
e [CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html).

## Validação local

- Suíte: 2284 testes aprovados, 12 ignorados; TypeScript aprovado.
- Lint: zero erros; aviso preexistente em `src/lib/actions/liquidacao.ts`.
- Build Webpack aprovado.
- Banco isolado `bw-antecipa-p16-clean-room`, portas 563xx, sem tocar os
  outros stacks locais. Inicialização e reset completo até P16 aprovados.
- `node scripts/homologacao/p16/verify-local.mjs --concurrency`: 16 checks
  aprovados, com SQL real sob role authenticated e claims sintéticos.
  Cobre cancelamento/reuso/histórico/auditoria, oito estados, múltiplo
  histórico, C2, LEITOR, cross-org, cross-Cedente e concorrência.
- Concorrência: segunda transação observada esperando lock; exatamente um
  sucesso, uma negação, uma reserva ativa e um log de solicitação do vencedor.
- O teste reutiliza fixtures C1.1. O modo concorrente deixa apenas dados
  sintéticos no clean-room, removidos por reset local ao concluir.

Limitação legada encontrada: chamada SQL direta com 16 argumentos é ambígua
porque a sobrecarga de 17 tem DEFAULT NULL. Para verificar o corpo legado,
o teste renomeia temporariamente a sobrecarga atual dentro de uma transação
local e desfaz com rollback. Nenhuma alteração equivalente é proposta nos
ambientes remotos. O app usa a assinatura atual com `p_parcela_ids` explícito.

## Rollback e promoção

Rollback da mudança: nova migration restaurando a definição anterior do
predicado, com `cancelada` reservante. Não desfaz operações legítimas criadas
após o hotfix nem remove vínculos históricos. Antes de qualquer rollback,
reavaliar reservas ativas; preservar todas as operações e seus documentos.

Promoção pendente dos gates Preview/Homolog, CI, aplicação explícita e
smoke produtivo. Não executar db push. Conferir hash, aplicar só P16 em
transação com parada em erro, registrar a versão exata e comparar definições.

`P16_PRODUCTION_READY = NO` até o encerramento desses gates.
Outras frentes C2.1-R2, C5-R2, CERC e RLX Email permanecem sem alterações.
