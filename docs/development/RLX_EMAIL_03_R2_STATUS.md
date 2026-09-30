# RLX-EMAIL-03-R2 — recertificação

Execução iniciada em 30/09/2026, branch `feature/rlx-email-intake-graph`.
O R2 valida o diff local e corrige somente defeitos demonstrados pelos gates.
Produção está proibida. Homologação depende de Preview completo aprovado.

## Situação consolidada após o Preview — 30/09/2026

Preview **PASS**, aplicação `b46bc97`, Supabase `bwqpyphsmokzufeuxtim`.
Homologação ainda **não promovida**; `RLX_EMAIL_03_HOMOLOG_READY = NO`.
O [manifesto de evidências](../homologacao/rlx-email03-preview-evidence.json)
registra os 67 indicadores do plano e hashes dos relatórios sanitizados.
Nos indicadores de homologação, `FAIL` significa pendente/não executado.

- Código final: TypeScript, lint, build webpack e suíte completa aprovados;
  2.555 testes PASS, 12 opt-in ignorados, zero falhas. CI `36768881485` PASS.
- Clean-room final: 242 migrations, 27 grupos de banco, 9 checks de Storage
  real e 33 checks do serviço/interface, com cleanup PASS.
- Preview: seis XMLs da caixa real importados, originais conferidos por hash,
  duplicidade entre canais bloqueada. Worker limitado; sem agendamento.
- NFS-e por e-mail: ingestão SYSTEM, revisão pelo Consultor com login/MFA,
  vencimento manual, persistência HUMAN e origem EMAIL_INTAKE confirmadas.
  Reenvio durante revisão e após conclusão bloqueado, sem duplicar NF/Storage.
- PDF de imagem: usuário confirmou a NFS-e sintética 930007 no formulário
  hospedado. Strategy `danfse_v2_visual`, bruto 39.521,98, líquido 37.229,70,
  vencimento 30/10/2026 e hash do original conferidos; zero texto nativo.
- Concorrência e falhas de Storage: três disputas controladas no Preview,
  um vencedor, compensação real, falha simulada de delete, retry e geração
  antiga bloqueada. Esses ensaios usam bytes controlados no transporte;
  os testes com Graph real são evidências separadas.
- Recuperação XML: ID e original anterior preservados; bloqueio concorrente
  observado, rollback/retry, stale commit negado e histórico inseguro recusado.
- Roteamento ALL/ALLOWLIST, múltiplos cedentes por mensagem e resultados por
  arquivo passaram no clean-room. A matriz será repetida em homologação.
- Limpeza final: zero usuários/sessões/MFA, NFs, arquivos, integrações,
  anexos, reservas, journals, revisões e cadastros QA. Removidos 35 arquivos
  locais de QA e acesso. Auditoria das migrations, caixa real e env original
  do usuário preservados. Migrations com hash inalterado e triggers ativos.

A primeira tentativa do helper de limpeza atribuiu três cedentes a uma conta
temporária e foi recusada pelo resolvedor de contexto único, antes de excluir
NFs. A conta foi removida e o helper passou a conceder um acesso por vez.
A exclusão autenticada preservou os sete recibos de e-mail antes da limpeza
dos próprios registros QA. Quatro audits SYSTEM de ensaios anteriores foram
identificados por seus manifestos e removidos na conferência final.

Promoção preparada em `release/rlx-email03-r2-homolog`, a partir de
`origin/homolog` `3c050f9`, com cinco commits exclusivos do e-mail.
A3/A4 já estavam presentes. Mantidos os recursos existentes de A5/A6 e C5;
nenhuma migration dessas features foi alterada. Conflitos resolvidos apenas
na composição de props/imports, tipos e teste de autorização do original.
O Consultor Leitor mantém a visualização e não consulta revisões operacionais.
Doze migrations de e-mail ausentes no precheck; nenhuma aplicada nesta etapa.

Recertificação da combinação com a base atual de homologação: TypeScript,
303 testes focados, lint, build webpack e suíte completa PASS (2.582 testes,
12 opt-in ignorados, zero falhas). Clean-room: 251 migrations, os mesmos
27 grupos de banco, 9 checks de Storage e 33 checks de serviço/interface;
cleanup PASS. Apenas o warning preexistente de `liquidacao.ts` no lint.
Os hashes de A3/A4 em homolog coincidem com o código. O preflight registrou
195 NFs, 23 operações e 969 objetos existentes; nenhum alterado.

## Histórico das evidências locais

- Windows 10.0.26200, Intel Core 7 240H, 16 processadores lógicos.
- Node 22.23.2, npm 10.9.8, Vitest 4.1.10. Memória disponível inicial:
  6.763.384.832 bytes de 33.879.650.304 bytes totais.
- `git diff --check` e `git diff --cached --check`: PASS.
- `tsc --noEmit`: PASS no diff inicial do R2.
- Testes focados: 19 arquivos, 291 testes PASS, 0 skipped, 0 falhas, 38 segundos.
  Comando: `vitest run src/lib/fiscal-intake src/lib/email-intake src/lib/nfse
  src/lib/storage-authorization-escopo9c.test.ts src/lib/notas-fiscais/upload-batch.test.ts
  src/lib/notas-fiscais/c4-consultor-notas-fiscais.test.ts src/lib/pdf-nf-parser.test.ts
  src/lib/documentos/parcelas-nf-boleto-architecture.test.ts
  --pool=threads --maxWorkers=1 --no-file-parallelism`.
- Evidências locais em `rehearsal/reports/email03-r2-*` e
  `rehearsal/reports/RLX_EMAIL_03_R2_ENV.json`.
- Lint completo: PASS em 205 segundos. Único warning preexistente:
  `notificarGestores` sem uso em `src/lib/actions/liquidacao.ts:6`; sem diff nesse arquivo.
- Build webpack: PASS em 336 segundos; TypeScript do build também aprovado.
- Suíte completa: PASS em 102 segundos; 294 arquivos aprovados e 3 inteiramente
  ignorados; 2.547 testes aprovados, 12 ignorados, zero falhas. Os arquivos
  ignorados são os ensaios opt-in de OpenAI, cadeia real de remessa e contrato.
- Novo ensaio opt-in `clean-room.mjs --storage-api`: upload/download HTTP,
  compensação, falha simulada de delete, retry e upload de geração antiga.
  Confere também os arquivos físicos do container descartável. Sintaxe e lint
  dos arquivos de ensaio: PASS; resultados funcionais abaixo.

As migrations originais A3/A4 mantêm os hashes documentados no diagnóstico.
O hash SHA-256 inicial da migration de transporte é
`2b24200597c59be3c4c3fbb1a0a51c860f542624d0c2833a3452a50ab79bdef2`.

Os testes de unidade não certificam Storage físico, MFA real ou prontidão
operacional. As provas locais de API estão registradas abaixo; a revisão pela
interface oficial, CI, Preview e homologação continuam pendentes.

## Ensaios de banco

Primeira execução R2 (`bw_email03_1790772243653`): as 239 migrations aplicaram
do zero, mas o ensaio de exclusão chamou a RPC de Consultor usando o ator de
Cedente. A autorização recusou corretamente. Corrigida somente a chamada no
harness para `excluir_notas_fiscais_rascunho_cedente`; sem mudança de permissão.
Cleanup PASS. O relatório original foi preservado com o ID do projeto.

O ensaio completo com 239 migrations passou em `bw_email03_1790772642473`:
23 grupos de verificações de banco, 7 grupos de Storage via API e cleanup PASS.
Isso inclui comparação do conteúdo baixado e inspeção do backend físico local,
além de compensação, retry e upload tardio de geração antiga. A revisão por
login/MFA real foi adicionada como prova separada; o ensaio anterior usava
fixtures de sessão apenas nos testes SQL.

## Defeito demonstrado pelo R2

Ao ampliar o teste para encerrar o anexo duplicado, `email_intake_settle_attachment`
falhou com SQLSTATE `23514`: a constraint exigia NF id até para `DUPLICATE`, mas
o serviço retorna somente o resultado de duplicidade, sem expor uma NF que
pode pertencer a outro fundo. A migration incremental
`20260930130158_email_intake_duplicate_transport_receipt.sql` permite esse
recibo terminal sem NF id e preserva a referência obrigatória para `IMPORTED`.
O teste também tenta marcar `IMPORTED` sem referência e exige rejeição.
As migrations anteriores permanecem intactas. Clean-room atualizado: 240 migrations.

## Storage, autenticação e serviço compartilhado reais

Execução `bw_email03_1790774250109`: PASS, 240 migrations, 27 grupos de
verificações de banco, 9 de Storage via API e 11 do serviço compartilhado.
Cleanup do projeto descartável: PASS. Relatório detalhado local preservado em
`rehearsal/reports/RLX_EMAIL_03_CLEAN_ROOM_bw_email03_1790774250109.json`.

- Upload/download com igualdade dos bytes e inspeção do backend físico local.
- Falha de banco após upload; delete indisponível mantém cleanup durável;
  retry remove o objeto físico. Zero órfãos nos cenários de compensação.
- Request da geração antiga enviado após takeover é rejeitado pela API e não
  deixa arquivo físico. Esta prova não representa todas as intercalações de
  um stream já parcialmente recebido.
- Usuário QA criado pela API Auth, login, TOTP, MFA/AAL2 reais; AAL1 negado.
- Attachment controlado passa pelo worker, parser oficial e serviço comum;
  abre revisão e conclui por usuário humano, preservando auditoria SYSTEM/HUMAN.
- Concorrência manual/e-mail A, e-mail A/manual, e-mail A/e-mail B pelo serviço
  real: perdedor bloqueado antes do upload, uma NF e um objeto final.
- Recuperação XML conserva o id e o arquivo anterior; journal resolve o novo
  XML; geração antiga, documento versionado e operação cancelada histórica
  impedem substituição insegura.

O ensaio de API não usa navegador para revisar nem Graph para obter o anexo:
Chrome gera apenas o PDF sintético. Esses limites não devem ser confundidos
com validação da interface oficial ou certificação dos ambientes remotos.

Execução posterior `bw_email03_1790774873368`: PASS com 240 migrations,
27 verificações de banco, 9 de Storage e 17 do serviço compartilhado; cleanup
PASS. Acrescentou dois cedentes na mesma mensagem, ALL/ALLOWLIST/UNKNOWN,
cross-fund, resultados independentes por arquivo e PDF sem chave negado nos
dois canais. O ensaio anterior esperava o nome incorreto `INVALID` no estado
persistido do transporte; a regra vigente o registra como `REJECTED`. Corrigida
somente essa expectativa no teste, sem mudança na aplicação.

O usuário confirmou que a caixa não contém NFS-e de QA sem vencimento.
Uma consulta somente de metadados dos 20 e-mails mais recentes teve sucesso,
sem candidato identificado como QA, download de anexos ou escrita na caixa.
O novo ensaio de navegador usa resposta HTTP controlada de Graph exclusivamente
no processo Next local de QA. Não altera provider, aplicação nem credenciais
reais; Auth, MFA, formulário, actions, banco e Storage permanecem reais.
Execução `bw_email03_1790775932715`: PASS, 240 migrations, 27 verificações de
banco, 9 de Storage e 21 do serviço compartilhado/interface; cleanup PASS.
O formulário oficial abriu com vencimento vazio/obrigatório; a action buscou
o original novamente no servidor e concluiu a importação com ingest SYSTEM,
review HUMAN e vencimento informado. Não houve bypass de Auth, MFA, domínio,
parsers ou Storage. Os únicos dados HTTP simulados foram OAuth/download de
Graph para a mailbox sintética local. Isto não certifica Graph real nem UI
hospedada em Preview/homolog.

Durante a preparação desse ensaio foram corrigidos apenas o carregamento ESM
por URL de arquivo no Windows e a leitura do sinal de inicialização colorido.
Uma navegação inicial excedeu o limite de 60 segundos; o limite foi mantido e
a repetição completa passou. Logs de inicialização são locais e sanitizados.

A pré-checagem de acesso remoto via CLI confirmou homolog
`fhgkmggthxikfpogrvaa`. O conector MCP não localizou essa branch; nenhuma
alteração remota foi tentada. A branch Preview `release/guibor-prod-02`
pertence a outro escopo e será preservada.

`RLX_EMAIL_03_HOMOLOG_READY = NO`.
Este registro descreve a certificação local anterior à promoção. As próximas
etapas autorizadas são commits/PR, CI, Preview e homolog, nessa ordem. Gates
remotos permanecem pendentes até a evidência de cada ambiente.

## Recertificação do diff final

- TypeScript: PASS, 73 segundos.
- Focados: PASS, 19 arquivos, 291 testes, zero skipped/fail, 7 segundos.
- Lint: PASS, 39 segundos, somente o warning preexistente documentado acima.
- Build webpack: PASS, 100 segundos, 92 páginas; TypeScript do build aprovado.
- Full suite: PASS, 64 segundos, 294 arquivos aprovados e 3 inteiramente
  ignorados, 2.547 testes aprovados, 12 ignorados, zero falhas.
- Worker model: threads, maxWorkers=1, no-file-parallelism; Node 22.23.2.
- Migrations A3/A4 e transporte: hashes novamente conferidos e preservados.
- Revisão de escopo: sem diff em P17, Vórtx, CERC ou comissão/A5/A6; sem `.env`
  a versionar. `git diff --check` também cobre os arquivos novos por intent-to-add.

Os tempos são observações de execução, não certificação de performance.

## Correção do vínculo documental e evidência final local

A exigência de XML no repositório `documentos-v2` demonstrou outro defeito:
o trigger legado `reconciliar_base_nf_apos_vinculo` chamava a reconciliação
HUMAN durante o commit fiscal SYSTEM e recusava a transação. A migration
incremental `20260930141139_fiscal_intake_document_reconciliation_trigger.sql`
adia somente essa chamada redundante quando existe importação privada preparada,
reserva ativa e journal da mesma geração/token/escopo. O commit continua chamando
a reconciliação privada com o fence do solicitante. Não há novos grants nem
derivação de autorização a partir do service_role.

Execução `bw_email03_1790777564196`: PASS com 241 migrations, 27 verificações
de banco, 9 de Storage e 23 do serviço/interface. O XML foi baixado pela API
com bytes iguais ao original e vinculado ao requisito. Depois do commit, o
mesmo trigger legado continuou recusando a mutação sem usuário humano.
Cleanup PASS. Migrations previamente existentes mantidas sem alteração.

Advisors de segurança no banco descartável: cinco warnings preexistentes de
`search_path` em funções de logística/matching/títulos, presentes no HEAD;
nenhum achado novo do escopo. Relatório local: `email03-r2-advisors.json`.

Após encerrar o Next de QA, um arquivo gerado `.next/dev/types/validator.ts`
ficou incompleto. Foi preservado em `rehearsal/tmp` e os tipos foram regenerados
com `next typegen`, conforme a documentação instalada. TypeScript passou sem
alteração de código, tsconfig ou limites de testes.

Recertificação após a segunda migration corretiva: TypeScript PASS (4s),
focados PASS (291 testes, 5s), lint PASS (29s, mesmo warning preexistente),
build webpack PASS (43s), full suite PASS (186s: 2.547 aprovados, 12 opt-in
ignorados, zero falhas; 294 arquivos aprovados e 3 inteiramente ignorados).

Última execução, após todos os gates de código e na ordem do plano:
`bw_email03_1790778413538`, 241 migrations, 27 verificações de banco, 9 de
Storage e 23 de serviço/interface, todas PASS. Cleanup PASS; nenhum container
do ensaio permaneceu em execução. O arquivo local detalhado é
`rehearsal/reports/RLX_EMAIL_03_CLEAN_ROOM_bw_email03_1790778413538.json`.

## Regressão demonstrada no smoke do Consultor no Preview

Em 30/09, a importação manual da NF QA 930005 pelo Consultor falhou antes do
Storage. A reserva foi liberada, sem NF, journal de arquivo ou objeto adicional.
A revalidação `fiscal_validate_stored_actor` chamava o predicado de RLS
`consultor_usuario_pode_operar_cedente`, que exige `p_user_id = auth.uid()`.
Durante o staging de infraestrutura, `auth.uid()` é nulo. A reprodução somente
leitura confirmou vínculo de fundo e MFA válidos, seguida de `FISCAL_SCOPE_DENIED`.

A migration incremental `20260930183215_fiscal_intake_consultor_stored_actor`
reutiliza os predicados canônicos de organização e fundo, e exige o vínculo ativo
com o cedente para o ator persistido. Mantém a verificação da sessão/MFA, o
predicado de RLS com identidade vinculada à sessão e os grants restritos.
O ensaio descartável passa a cobrir importação real pelos papéis Owner, Admin e
Operador, download do original, duplicidade e revogação de autorização após a
reserva. A reaplicação do smoke no Preview permanece pendente nesta etapa.

Recertificação da correção: TypeScript, 291 testes focados, lint, build webpack
e suíte completa aprovados (2.547 testes, 12 opt-in ignorados, zero falhas).
O lint local apontou o warning já conhecido em `liquidacao.ts` e um warning no
helper de provisionamento QA ignorado pelo Git; nenhum nos arquivos alterados.
Advisors: os mesmos cinco warnings preexistentes, nenhum novo.

O ensaio `bw_email03_1790794693964` aplicou 242 migrations e aprovou 27 grupos
de banco, 9 de Storage e 33 de serviço/interface, incluindo os dez novos checks
do Consultor. Cleanup PASS. Duas tentativas anteriores foram preservadas:
timeout ao abrir a página e revisão não concluída na automação. O harness passou
a aguardar a atualização React da data antes do clique real do navegador e a
registrar diagnóstico sanitizado da submissão. Nenhum timeout foi ampliado e
nenhuma validação foi removida. A prova continua usando Graph HTTP controlado
somente no processo local; não certifica a integração Graph hospedada.

## Compatibilidade observada na caixa real do Graph

O smoke autenticado do Consultor foi concluído no Preview, incluindo duplicidade,
abertura do original, exclusão de rascunho, cleanup pela API e reimportação com
nova geração. Cedente e Gestor também confirmaram os cenários de consulta e
abertura de originais. Isso não conclui os gates remotos de e-mail e concorrência.

A leitura autorizada da caixa real identificou dois defeitos de transporte:

- `attachment.size` era maior que os bytes retornados por `/$value` (por exemplo,
  12.307 contra 11.885 bytes em um XML fiscal válido). Exigir igualdade rejeitava
  o arquivo antes do parser. O tamanho declarado passa a ser um limite superior;
  o limite físico de 20 MiB, MIME/extensão, assinatura e validação fiscal continuam
  obrigatórios. O arquivo persistido usa o tamanho real e o hash dos bytes.
- O Graph retornou continuação com `mailFolders('inbox')` para uma consulta a
  `mailFolders/inbox`. A validação agora compara segmentos de recurso e identidade
  nos dois formatos, preservando a URL opaca original. Origem HTTPS, caixa, pasta,
  tipo de recurso e identificadores continuam restritos; barras codificadas dentro
  de IDs não viram separadores de caminho.

Os testes cobrem metadados maiores que o conteúdo, arquivo vazio, limite físico,
continuação realista em duas páginas e rejeição de outra caixa/pasta/recurso ou
seletor inválido antes da autenticação. Não há migration nem novo provider.
Evidências sanitizadas: `email03-live-compatibility.json` (reprodução) e
`email03-live-compatibility-fixed.json` (leitura real corrigida), em
`rehearsal/reports`. XMLs e identificadores externos ficam no diretório local
protegido de QA, fora do Git.

O cadastro solicitado é exclusivo do Preview: um emitente extraído do XML,
vínculo canônico ao fundo QA, acesso pela consultoria QA e integração ALLOWLIST
para esse cedente. Não foram criados usuários técnicos. A descoberta inicial
limitada a XML localizou 24 anexos em 27 mensagens; o primeiro processamento
parou em `RETRYABLE_ERROR` pela incompatibilidade de tamanho, sem importação.
Reteste do worker depende da recertificação desta correção. O agendamento
contínuo permanece desativado; homologação e produção não foram alteradas.

Recertificação local dessa correção: TypeScript PASS; 299 testes focados PASS;
lint e build webpack PASS; suíte completa com 2.555 aprovados, 12 opt-in
ignorados e zero falhas. Nenhum warning nos arquivos alterados. Um warning no
novo helper local de QA foi corrigido e o lint direcionado foi reexecutado.
Ensaio `bw_email03_1790797893591`: 242 migrations, 27 grupos de banco, 9 de
Storage e 33 de serviço/interface aprovados, incluindo Auth/MFA e revisão pelo
formulário oficial. Cleanup do ambiente descartável PASS. Relatório detalhado:
`rehearsal/reports/email03-live-graph-fix-gates.json`.
