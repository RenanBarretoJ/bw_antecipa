# RLX-EMAIL-03-R3 — admissão temporal e retomada delta

Escopo autorizado: Local, CI e Preview. Homolog e produção proibidos.
Stop point: `RLX_EMAIL_03_R3_PREVIEW_READY`. O R3 não certifica o EMAIL-04 inteiro.

## Correção

O Graph retornou mensagens anteriores ao filtro solicitado. A descoberta agora
aplica `evaluateEmailMessageAdmission` antes de listar anexos. O helper compara
instantes, admite igualdade e preserva milissegundos/offset. Timestamp inválido
de mensagem desconhecida é descartado com contagem sanitizada. O checkpoint
continua sendo persistido mesmo quando nenhuma mensagem passa pelo filtro.

Uma consulta limitada aos IDs da página, protegida pela lease da integração,
distingue identidades legitimamente admitidas de metadados antigos do incidente.
Não há consulta por mensagem. A janela móvel da reconciliação permanece uma
otimização de consulta; o limite de admissão é o `start_at` da integração.

Na nova migration `20261001170100_email_intake_temporal_admission.sql`:

- `admission_start_at` registra o limite na admissão e permanece imutável junto
  com identidade e data original. O servidor deriva esse campo da integração;
  payload não pode escolher um limite mais permissivo.
- Backfill conserva mensagens legadas dentro do limite atual. Metadados fora
  dele ficam sem prova de admissão e não processáveis. Nenhum histórico é apagado.
  Se houver histórico real fora do limite atual, exige reconciliação explícita
  antes de habilitar processamento; não há liberação automática por existir NF.
- `provider_removed_at` registra tombstone conhecido atomicamente com o cursor.
  Tombstone desconhecido não cria linha. Remoções suspendem novos claims, sem
  excluir NFs, revisões, anexos ou histórico. Atualização posterior da mesma
  identidade pode restaurar a disponibilidade do transporte.
- O predicado compartilhado `email_message_processable` é usado pelo seletor,
  obtenção do claim, validação do claim fiscal e origem de revisão. Nestes dois
  últimos pontos muda somente o predicado temporal/remoção; autorização, tenant,
  roteamento, ator, fencing, leases e regras fiscais permanecem iguais.
- O backlog operacional exclui metadados não processáveis. O wrapper de
  reconciliação não conta tombstones ou mensagens antigas como recuperações.
- Nenhuma migration aplicada é editada. Nenhum grant de tabela é ampliado.
  A RPC nova de leitura limitada é exclusiva de `service_role`, verifica lease
  e fundo ativo; os helpers privados têm execução revogada para clientes.

## Paginação e compatibilidade

Cada execução mantém o limite de uma página. `PAGE_COMMITTED` sinaliza nextLink
durável; o scheduler pode continuar pela próxima página. `SYNC_COMPLETED` só é
retornado após persistir deltaLink (ou o fim da reconciliação). Assinaturas e
health mantêm `COMPLETED`. Consumidores técnicos que esperavam `COMPLETED` para
delta/reconciliação devem acompanhar o novo contrato. Nenhuma UI operacional
passa a depender de loop dentro do request HTTP.

No smoke, continuar até `SYNC_COMPLETED`, acumulando páginas e contadores. Se
houver erro, preservar cursor e interromper; não reiniciar por padrão, nem mudar
`start_at` para acomodar resultados. SQL preserva mensagens/anexos/checkpoint na
mesma transação. IDs/cursor/assuntos/segredos não aparecem na telemetria de páginas.

## Validação

Validação local em 01/10/2026: TypeScript, build, 2.638 testes (12 ignorados)
e lint sem erros. Há um aviso preexistente em `liquidacao.ts` e outro apenas em
script operacional local ignorado pelo Git. Clean-room: 254 migrations, 27
verificações de fencing, 16 de automação, 12 temporais, 9 de Storage e 33 do
serviço compartilhado/revisão, com cleanup PASS. A primeira execução local do
novo teste SQL usou incorretamente o retorno composto da RPC como objeto; o
harness foi corrigido para `select *`, e a execução completa seguinte passou.
CI e Preview real continuam pendentes neste registro inicial.
O teste SQL está em `scripts/email-intake/temporal-db.mjs`, integrado ao clean-room
existente (`--storage-api --automation`) e restrito a conexão local descartável.

Casos cobertos: página antiga vazia, igualdade e offsets/milissegundos, timestamp
inválido, tombstones conhecidos/desconhecidos, identidade já admitida, paginação,
retomada, rollback conjunto, reconciliação, lookup com lease, concorrência real
de claims e defesa posterior diante de claim forjado de mensagem antiga.

Não interpretar testes unitários/SQL ou build como smoke Graph real. Registrar
os resultados atuais em `rehearsal/reports/RLX_EMAIL_03_R3_CHECKPOINT.json`, sem
segredos, dados de remetente, chave fiscal ou conteúdo de documento.

## Reteste Preview

1. Confirmar CI aprovada, alvo Preview, integração suspensa, subscription removida
   e scheduler ausente. Preservar evidência do incidente antes de terminalizar
   somente seus anexos de QA ainda sem tentativas; manter usuários/fundo/cedentes.
2. Aplicar somente a migration incremental e implantar o commit certificado.
3. Manter o `start_at` original. Preparar uma subscription nova, verificar seu
   recurso/callback e só então habilitar a integração de QA. Não adotar a removida.
4. Percorrer a leitura controlada até deltaLink; provar que mensagens antigas
   não chamam `listAttachments`, não entram na fila e não viram backlog.
5. Enviar uma nova mensagem QA, validar admissão e resultado pelo worker fiscal
   existente. Revalidar renovação e limpar somente artefatos descartáveis.
6. Marcar Ready somente depois de todos os gates reais. Não promover homolog.

Rollback operacional: desabilitar integração/automação e excluir apenas a
subscription QA identificada. Preservar migration, evidência e histórico; não
reimplantar worker antigo sobre uma integração habilitada.

`RLX_EMAIL_03_R3_PREVIEW_READY = NO`

`RLX_EMAIL_04_HOMOLOG_READY = NO`

`RLX_EMAIL_PRODUCTION_CHANGED = NO`

`RLX_EMAIL_HOMOLOG_CHANGED = NO`
