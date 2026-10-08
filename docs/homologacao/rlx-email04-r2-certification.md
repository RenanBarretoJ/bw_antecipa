# RLX-EMAIL-04-R2 — recuperação e operação automática

Execução autorizada em 01/10/2026, a partir do R3 Preview aprovado no commit
`06622bd`. O roteiro autoriza Local, CI, Preview e, depois de Preview completo
PASS, homolog. Produção continua proibida. PR #82 permanece draft até a
promoção preparada. `RLX_EMAIL_04_HOMOLOG_READY = NO`.

## Escopo e diagnóstico

O scheduler existente despacha seis jobs via pg_cron/pg_net com segredo no
Vault e vínculo explícito ao projeto. A fila durable limita delta a cinco
minutos, permite continuar nextLink e mantém reconciliação diária de sete dias.
Os testes anteriores comprovaram webhook real, importação da NF 940001,
reconciliação sem duplicidade e limpeza; não comprovaram o scheduler automático.

O R2 acrescenta os eventos de assinatura expirada e recuperada, ausentes na
constraint anterior, e mantém saúde degradada durante recuperação de lifecycle.
Os sinais de mensagem perdida e de assinatura têm timestamps independentes:
renovar uma assinatura não resolve uma mensagem perdida e concluir delta não
resolve reautorização pendente. A identidade da integração e os sinais continuam
validados no servidor, e clientState divergente não produz efeito persistido.

Migration incremental `20261001180242_email_automation_subscription_recovery.sql`:
metadados de subscription/lifecycle, observação idempotente de expiração e
extensão dos eventos; atualiza somente RPCs operacionais do 04. O helper privado
não é acessível por anon/authenticated/service_role. As RPCs de transporte
continuam exclusivas de service_role, sem grants nas tabelas privadas.

Uma recuperação concluída sinaliza DELTA sem alterar cursor, retry delay ou
start_at. A expiração é registrada uma vez por timestamp observado, inclusive
quando o job de assinatura executa antes do job de saúde. As funções certificadas
de admissibilidade, claim e commit do R3 permanecem intactas.

## Certificação

Testes focados: lifecycle com clientState inválido, persistência de saúde
degradada, concorrência de três claimants, margem de renovação, expiração sem
flood de eventos, recuperação com cursor preservado, sinais de lifecycle
sobrepostos e grants. O clean-room executa também as regressões fiscais/Storage
e temporais já existentes.

Evidência local e remota atual em `rehearsal/reports/RLX_EMAIL_04_R2_CHECKPOINT.json`.
Resultados pendentes não equivalem a aprovação. A primeira montagem local da
migration teve delimitador SQL inválido no gerador; corrigido antes de qualquer
aplicação remota. Não houve mudança de migration já aplicada.

Validação local final: TypeScript PASS, 2.642 testes PASS (12 ignorados), lint
sem erros (dois avisos preexistentes, um deles em script local ignorado), build
PASS, 255 migrations no clean-room e cleanup PASS. O teste SQL novo passou a
contar eventos de recuperação a partir do baseline da fixture, pois ela já
contém um erro/recuperação de assinatura dos testes anteriores. Nenhuma falha
local foi tratada como aprovação; o conjunto completo de banco foi repetido
depois dos ajustes. CI e cenários reais R2 continuam pendentes neste registro.

## Smoke e promoção

1. Fixar HEAD/CI/Preview e conferir migration incremental/dry-run.
2. Recriar assinatura QA, testar renovação, lifecycle, expiração/recovery,
   clientState, percentis do webhook, health, alert raise/cooldown/resolve.
3. Ativar scheduler somente no Preview confirmado. Simular perda de notification
   e enviar XML QA novo; observar descoberta por watchdog e importação pelo
   worker fiscal. Registrar execuções reais do cron/HTTP, sem fabricar sinais.
4. Gap controlado de reconciliação: uma mensagem QA nova, ainda não descoberta;
   recuperar uma vez e repetir sem duplicar. Nunca apagar NF para fabricar gap.
5. Novo e-mail para o fluxo completo; isolar processamento dos anexos QA para
   que mensagens de terceiros na mailbox não entrem no smoke.
6. Limpar apenas artefatos QA, desativar jobs temporários e conferir Storage,
   assinaturas, auditoria e acessos preservados. Não apagar mensagens da mailbox.
7. Somente após todos os gates Preview PASS, promover o escopo isolado para
   homolog, repetir os cenários reais e limpar QA. Parar no Homolog_READY.

Referências verificadas: [Supabase Cron](https://supabase.com/docs/guides/cron) e
[Graph lifecycle](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events).
