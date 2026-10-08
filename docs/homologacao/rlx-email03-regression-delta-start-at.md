# RLX-EMAIL-03 — regressão de recorte temporal na descoberta delta

Status: diagnóstico confirmado no Preview em 01/10/2026; correção R3 autorizada
posteriormente pelo usuário e em certificação. A contenção descrita abaixo foi
concluída antes dessa autorização. Consulte `rlx-email03-r3-certification.md`.
Bloqueia o smoke real e a promoção do RLX-EMAIL-04. Produção e homolog inalterados.

## Evidência

- Commit executado: `a4a404d831e5d2e161dea3077eb573e2ff0cae16`.
- Preview Supabase: `bwqpyphsmokzufeuxtim`; branch `validation/rlx-email04-linux`.
- Deploy Vercel: `dpl_4Nc86W7PX5uahDR3AKic7DpTjh6e`.
- Object ID fornecido foi validado com Graph: acesso por ID e por endereço
  retornaram a mesma pasta Inbox. Nenhuma permissão adicional foi concedida.
- Criação e renovação da assinatura Graph passaram, usando o callback público
  do Preview e persistindo o estado cifrado pelo mecanismo existente.
- Recorte inicial: `2026-10-01T16:33:55.572Z` (13:33:55, São Paulo).
- A primeira página delta retornou 10 mensagens, todas anteriores ao recorte,
  com 20 metadados de anexos. A consulta comum com o mesmo filtro retornou zero.
- O comportamento foi reproduzido em leitura direta no Graph, sem chamar o
  worker. Variar a codificação de `$` e dos espaços não corrigiu o resultado.
- O delta retornou `nextLink`; o smoke inicial também precisava acompanhar
  paginação, pois `COMPLETED` no job significa uma página persistida, não o fim
  de todo o ciclo. A paginação é distinta do defeito de recorte temporal.

## Causa no BW e limite do diagnóstico

`src/lib/email-intake/discovery.ts` filtra apenas mensagens removidas. Confia
no filtro remoto e lista os anexos antes de persistir mensagens. A RPC
`email_intake_commit_page` também não exclui mensagens anteriores a `start_at`.
Consequentemente, uma resposta fora do recorte alimenta a fila compartilhada.

Há validação posterior de data em `email_intake_get_attachment_claim` e no ator
fiscal. Entretanto, a seleção inicial de anexos em `email_intake_claim_attachment`
não contém o mesmo predicado. Não executar workers para contornar essa diferença:
isso pode causar claims inutilizáveis, retries e indicadores de backlog indevidos.

A origem do comportamento do serviço Microsoft não foi estabelecida. A
[documentação Graph](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
documenta suporte a `receivedDateTime ge`; o BW precisa validar o recorte localmente
mesmo quando o provedor retorna dados fora dele.

## Contenção concluída

- Integração e automação deste teste desabilitadas.
- Assinatura criada pelo smoke identificada pelo recurso e callbacks exatos,
  excluída no Graph e confirmada ausente por GET 404.
- Nenhum scheduler ativado. Nenhuma mensagem enviada pela ferramenta.
- Postflight: zero NFs, operações, objetos Storage, anexos com tentativa de
  processamento ou integrações habilitadas.
- Quatro usuários, fundo e dois cedentes de QA permanecem no Preview para a
  retomada. As credenciais ficam em arquivo local protegido; não neste relatório.
- Metadados e evidência do teste preservados, sem conteúdo de e-mails/anexos.

## Correção isolada proposta no diagnóstico inicial

1. Validar `startAt` no serviço compartilhado e excluir mensagens anteriores ao
   limite antes de listar anexos ou persistir a página; manter a inclusão na
   igualdade, a semântica de tombstones e o avanço atômico do cursor.
2. Testar páginas mistas, somente mensagens antigas, igualdade do limite,
   timestamps com offset, paginação e reconciliação. Verificar que nenhum anexo
   de mensagem excluída é consultado e que o cursor continua durável.
3. Revisar a necessidade de uma migration incremental para alinhar seleção de
   anexos ao limite já imposto na obtenção do claim e tratar metadados fora do
   recorte. Não editar migrations aplicadas nem apagar histórico operacional.
4. Corrigir o smoke para acompanhar páginas até o deltaLink; rodar os testes
   relevantes do 03/04 e a certificação antes de reativar a integração de QA.
5. Retomar criação/renovação, evento real, watchdog, reconciliação e saúde no
   Preview. Homolog continua condicionado a Preview aprovado.

O item 0 do plano RLX-EMAIL-04 determina: “Se for necessária alteração nessas
áreas: PARAR e abrir regressão específica do 03.” Por isso este registro não
altera o serviço compartilhado e a automação permanece suspensa.

## Evidências locais (ignoradas pelo Git)

- `rehearsal/reports/email04-mailbox-preflight.json`
- `rehearsal/reports/email04-graph-env.json`
- `rehearsal/reports/email04-provision-automation.json`
- `rehearsal/reports/email04-live-transport-smoke.json`
- `rehearsal/reports/email04-delta-date-probe.json`
- `rehearsal/reports/email04-suspended-postflight.json`

`RLX_EMAIL_04_SUBSCRIPTION_CREATE = PASS`

`RLX_EMAIL_04_SUBSCRIPTION_RENEW = PASS`

`RLX_EMAIL_04_PREVIEW = FAIL`

`RLX_EMAIL_03_REGRESSION = FAIL` (regressão real de descoberta temporal;
testes anteriores continuam registrados separadamente)

`RLX_EMAIL_04_HOMOLOG_READY = NO`

`RLX_EMAIL_PRODUCTION_CHANGED = NO`
