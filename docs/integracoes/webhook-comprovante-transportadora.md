# Webhook de comprovante de entrega (transportadora)

Ticket original: `P0_Claude_Webhook_Transportadora_Comprovante_Entrega`.
Fechamento de gaps (migration corretiva
`20260824150000_p0_fechar_webhook_transportadora_gaps.sql`):
`P0_Claude_Fechar_Webhook_Transportadora` — preservação/reconciliação
automática da evidência pré-desembolso (seção I) e provisionamento restrito
a Super Admin (seção B).
UI de gestão + ciclo de vida do token (migration corretiva
`20260824180000_p1_super_admin_integracao_transportadora.sql`):
`P1_Claude_Super_Admin_Integracao_Transportadora` — histórico de token com
rotação/revogação (seção L), telas Super Admin de gestão e observabilidade
(seção M), e reprocessamento de eventos (seção N).
Retenção de evidência + reprocessamento real (ajuste na própria migration
`20260824180000`, que ainda não tinha sido aplicada em homolog):
`P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora` — o arquivo
agora é sempre salvo e referenciado no próprio evento **antes** do
matching (seção H), tornando `NAO_IDENTIFICADO`/`REVISAO_MATCH`/
`ERRO_REPROCESSAVEL` genuinamente reprocessáveis (seção N reescrita —
`EVIDENCIA_INDISPONIVEL` deixou de ser o resultado normal e passou a ser
só um fallback de legado).
Retry externo x idempotência + coerência de `evidencia_retida` (mesmo
ajuste, na mesma migration ainda não aplicada):
`P0_Claude_Fechar_Retry_Webhook_Transportadora` — um retry idêntico da
transportadora agora aciona reprocessamento automático quando o evento
existente está em `NAO_IDENTIFICADO`/`REVISAO_MATCH`/`ERRO_REPROCESSAVEL`
(seção G), em vez de ficar preso em `DUPLICADO`; e `evidencia_retida`
passa a refletir `bucket`/`path` (nunca fica `true` presa depois que
`IGNORADO_CANHOTO_JA_APROVADO` remove o arquivo, seção E).

## Resultado

`P0_WEBHOOK_COMPROVANTE_TRANSPORTADORA = PASS` (implementação e testes;
aplicação em homolog e smoke test dependem de confirmação/execução
separadas — ver "Validações executadas" no relatório do ticket).
`P1_SUPER_ADMIN_INTEGRACAO_TRANSPORTADORA = PASS` (implementação e testes;
aplicação em homolog depende de confirmação separada).
`P0_WEBHOOK_RETENCAO_REPROCESSAMENTO = PASS` (implementação e testes;
aplicação em homolog depende de confirmação separada).
`P0_WEBHOOK_RETRY_IDEMPOTENCIA = PASS` (implementação e testes; aplicação
em homolog depende de confirmação separada).

## A. Contrato do endpoint

```
POST /api/integracoes/transportadoras/{provider}/comprovantes-entrega
Authorization: Bearer <token>
Content-Type: application/json
```

Corpo (todos os campos exceto `external_event_id` e `chave_cte` são
obrigatórios):

| Campo               | Tipo   | Observação                                   |
|---------------------|--------|-----------------------------------------------|
| `external_event_id` | string | opcional — usado na chave de idempotência     |
| `chave_nfe`         | string | 44 dígitos (aceita pontuação, é normalizada)  |
| `chave_cte`         | string | opcional, 44 dígitos                          |
| `cnpj_cliente`      | string | 14 dígitos                                    |
| `content_type`      | string | `image/jpeg`, `image/jpg`, `image/png`, `application/pdf` |
| `data_emissao_nfe`  | string | ISO-8601                                      |
| `cnpj_emitente`     | string | 14 dígitos                                    |
| `data_entrega_nfe`  | string | ISO-8601                                      |
| `cnpj_transportadora` | string | 14 dígitos                                  |
| `imagem_base64`     | string | aceita prefixo `data:...;base64,`; limite de 15MB decodificado |

Resposta: sempre JSON `{ success, status, webhook_evento_id, canhoto_id,
detalhe }`. Mapeamento de status HTTP:

| Situação                                                    | HTTP |
|--------------------------------------------------------------|------|
| Token ausente/inválido/provider não corresponde              | 401  |
| Provider da rota mal formado                                  | 400  |
| JSON malformado ou payload reprovado na validação             | 400  |
| Corpo maior que o limite (20MB)                                | 413  |
| Qualquer resultado de negócio (`PROCESSADO`, `DUPLICADO`, `NAO_IDENTIFICADO`, `REVISAO_MATCH`, `IGNORADO_CANHOTO_JA_APROVADO`, `AGUARDANDO_ENTREGA`) | 200 |
| `ERRO_FINAL` (não é retentável)                                | 422  |
| `ERRO_REPROCESSAVEL` (carrier deveria reenviar)                 | 503  |
| Falha inesperada                                                | 500  |

A requisição em si é considerada "recebida com sucesso" mesmo quando o
resultado de negócio é `NAO_IDENTIFICADO`/`REVISAO_MATCH`/etc — o evento
fica registrado no inbox para auditoria e possível revisão manual; só
problemas da própria requisição (auth, formato, tamanho) voltam 4xx.

## B. Segurança

- Autenticação: `Authorization: Bearer <token>` por integração
  (`integracoes_transportadoras`), escopada a exatamente um `fundo_id` e um
  `provider`. Token gerado por `admin_criar_integracao_transportadora` e
  devolvido em texto puro **uma única vez**, no retorno dessa chamada —
  depois disso só o hash SHA-256 persiste, no histórico
  `integracoes_transportadoras_tokens.token_hash` (`UNIQUE`; modelo
  detalhado na seção L — não há mais coluna `token_hash` em
  `integracoes_transportadoras`). A rota recalcula o hash do token recebido
  e busca pelo token com `status = 'ativo'` — nunca compara texto puro.
- Provisionamento (criar/desativar integração, gerar/rotacionar/revogar
  token) é restrito a **Super Admin** (`private.usuario_e_super_admin()`,
  papel de plataforma em `usuario_papeis`, não `profiles.role`) — gestor
  **não** provisiona mais (mudança do ticket
  `P0_Claude_Fechar_Webhook_Transportadora`; antes era gestor-only). Gestor
  continua analisando comprovantes recebidos normalmente
  (`analisar_canhoto_documento`, inalterado). Super Admin é global
  (nenhum `usuario_tem_acesso_fundo`) — `p_fundo_id` ainda define a qual
  fundo a integração pertence, só não restringe quem pode criá-la. A UI
  dedicada de Super Admin para gerenciar integrações (`/admin/integracoes-transportadoras`)
  foi implementada pelo `P1_Claude_Super_Admin_Integracao_Transportadora`
  — ver seção M.
- Cross-fund deny: a NF resolvida (venda) precisa pertencer ao mesmo
  `fundo_id` da integração autenticada. Verificado duas vezes — na
  orquestração TypeScript e, de forma independente (defesa em
  profundidade), dentro da própria RPC `registrar_comprovante_entrega_webhook`.
  Qualquer divergência responde exatamente como `NAO_IDENTIFICADO` — nunca
  revela que a chave bateu com uma NF de outro fundo.
- MIME real: o `content_type` declarado nunca é confiado isoladamente — o
  arquivo decodificado é verificado por assinatura binária (magic bytes:
  JPEG, PNG, PDF) e precisa ser compatível com o declarado, senão o evento
  fecha em `ERRO_FINAL` (não retentável — reenviar o mesmo payload nunca
  vai corrigir um MIME real incompatível).
- Tamanho: `imagem_base64` decodificada tem limite de 15MB
  (`MAX_IMAGEM_BASE64_BYTES`); o corpo da requisição como um todo tem
  limite de 20MB, verificado antes do `JSON.parse`.
- HMAC de assinatura do corpo: **fora de escopo nesta versão** (MVP),
  conforme o próprio ticket. O Bearer token por integração é o único
  mecanismo de autenticação do chamador.
- Sem RPC exposta a `authenticated`/`anon`: `registrar_comprovante_entrega_webhook`
  só tem `GRANT EXECUTE` para `service_role` — não é alcançável por uma
  sessão de usuário normal, só pelo endpoint (que usa `createAdminClient()`).

## C. Resolução do vínculo (`notaFiscalVendaId` + `notaFiscalRemessaId` + `tipoVinculo`)

Ordem estrita, nunca por CNPJ/data/número isolado:

1. **`chave_nfe`** — match exato em `notas_fiscais.chave_acesso`
   (`DIRETO_VENDA`) OU `nota_fiscal_remessas.chave_acesso`, mas só quando a
   remessa já está `status_validacao = 'VALIDADA'` (`VIA_REMESSA`).
2. Se (1) não resolveu, **`chave_cte`** — via `cte_notas_fiscais`. Um único
   vínculo resolve (`tipo_vinculo` herdado da linha); zero vínculos ou
   CT-e não encontrado seguem para (3); **mais de um vínculo** (CT-e
   multi-NF) é `AMBIGUO` por definição — nunca escolhe um lado sozinho.
3. Sem match unívoco → `NAO_IDENTIFICADO` (nenhuma chave bateu) ou
   `REVISAO_MATCH` (ambíguo, ou cross-validação abaixo reprovou).

Implementado em `src/lib/integracoes/webhook-comprovante-transportadora-matching.ts`
(puro, sem I/O) — o orquestrador em
`webhook-comprovante-transportadora.server.ts` só carrega as linhas do
banco e delega a decisão a essas funções.

## D. Validação cruzada pós-match

Depois de resolver a NF, qualquer divergência material vira
`REVISAO_MATCH` — nunca auto-anexa:

- `cnpj_cliente` do payload vs. destinatário da NF de venda.
- `cnpj_emitente` do payload vs. emitente esperado — o emitente da própria
  venda quando `DIRETO_VENDA`, ou o emitente da remessa quando
  `VIA_REMESSA`.
- `cnpj_transportadora` do payload vs. o cadastrado na integração e/ou o
  do CT-e resolvido (quando algum dos dois existir).
- Plausibilidade de datas: `data_entrega_nfe` nunca pode ser anterior a
  `data_emissao_nfe`.

## E. Já existe comprovante?

- **Aprovado** (`canhotos.status = 'aprovado'`) na entrega mais recente da
  venda → `IGNORADO_CANHOTO_JA_APROVADO`. Nunca substitui, nunca cria nova
  versão, nunca reabre o requisito. O arquivo recém-recebido **é removido
  do Storage** neste caso — seguro porque hash/metadados já foram
  gravados no próprio evento (seção H, passo 3) antes desta checagem
  rodar. Ao remover, `bucket`/`path` do evento são explicitamente
  **zerados** (`P0_Claude_Fechar_Retry_Webhook_Transportadora`) —
  `imagem_sha256`/`content_type`/`tamanho_bytes`/`persisted_at`
  permanecem intactos para auditoria (prova de que o arquivo chegou a ser
  recebido), mas `evidencia_retida` (seção M/N, calculada como `bucket IS
  NOT NULL AND path IS NOT NULL`) passa a `false` — a UI/RPC nunca oferece
  um arquivo que não existe mais, e este status nunca é elegível para
  reprocessamento (fora de `STATUSES_REPROCESSAVEIS`).
- **Pendente/em análise** ou nenhum ainda → segue o fluxo normal e
  registra uma nova versão em `em_analise` (nunca aprova automaticamente
  por ter vindo da transportadora — só a gestora aprova, via
  `analisar_canhoto_documento`, inalterado).

## F. Camada canônica reutilizada (sem modelo paralelo)

`registrar_comprovante_entrega_webhook` sempre insere
`documentos_repositorio` → `documento_versoes` (o arquivo nunca é
descartado silenciosamente). Quando já existe entrega, delega a
`private.vincular_comprovante_webhook_entrega` a **mesma** sequência de
`registrar_canhoto_documento`: `documento_vinculos` → `canhotos` → (se
existir um requisito compatível) `documento_requisito_instancias` — essa
função é compartilhada entre o caminho em tempo real e a reconciliação
tardia (seção I), para nunca duplicar a lógica de vínculo. Diferenças em
relação a `registrar_canhoto_documento`:

1. Autorização por integração ativa do mesmo fundo (não `auth.uid()` — não
   existe sessão de usuário numa chamada de webhook).
2. **Nunca bloqueia por `status_entrega`** — regra explícita do ticket: um
   comprovante de transportadora frequentemente chega depois da entrega já
   estar `'entregue'`, que é o caso mais comum, não uma excepção.
3. Sem entrega ainda, não vincula nada agora — preserva a evidência
   pendente (seção I) em vez de bloquear/descartar.

`criado_por`/`enviado_por` (`NOT NULL` nas tabelas canônicas, sem
precedente de ator "sistema") usam `integracoes_transportadoras.created_by`
— o **Super Admin** que provisionou a integração (`admin_criar_integracao_transportadora`
é Super Admin-only desde `P0_Claude_Fechar_Webhook_Transportadora`; nunca
gestor) — nunca `NULL`, nunca um perfil sintético novo. A origem técnica real (`INTEGRACAO_TRANSPORTADORA` +
`provider` + `webhook_evento_id`) fica registrada em
`eventos_entrega.dados`, via `registrar_evento_entrega(..., p_ator_tipo =>
'integracao', ...)` — valor já suportado pelo CHECK existente dessa
função.

## G. Idempotência

Tabela `integracao_logistica_webhook_eventos` funciona como inbox:

- `idempotency_key` sempre gerada — de `external_event_id` quando o
  provider manda um, senão derivada de
  `integracao_id + chave_cte + chave_nfe + data_entrega + sha256_da_imagem`.
  `UNIQUE(idempotency_key)`.
- `UNIQUE(integracao_id, external_event_id)` reforça isso quando o
  provider manda id de evento (NULLs não colidem entre si — eventos sem
  `external_event_id` continuam distintos entre si pela outra chave).
- Um retry (mesmo `external_event_id`, ou mesmo conteúdo derivado) nunca
  cria um segundo documento nem uma segunda linha no inbox: a violação de
  unicidade (`23505`) na inserção é sempre detectada primeiro. **Retry
  nunca é bloqueado pela idempotência** (`P0_Claude_Fechar_Retry_Webhook_Transportadora`)
  — o que acontece depois depende do status do evento existente:
  - `PROCESSADO`, `AGUARDANDO_ENTREGA`, `IGNORADO_CANHOTO_JA_APROVADO`,
    `ERRO_FINAL` → responde `DUPLICADO` com o `canhoto_id` (se algum) do
    evento original. Nunca reprocessado — os dois primeiros já têm o
    vínculo/evidência registrados, `ERRO_FINAL` é permanentemente inválido
    (o mesmo Base64 sempre vai falhar do mesmo jeito).
  - `NAO_IDENTIFICADO`, `REVISAO_MATCH`, `ERRO_REPROCESSAVEL` → o retry
    **aciona automaticamente** `reprocessarWebhookComprovanteTransportadora`
    no mesmo evento (mesmo arquivo já retido, seção H/N) antes de
    responder. Isso significa que uma transportadora que reenvia
    exatamente o mesmo webhook depois de uma NF ser cadastrada, ou depois
    de uma inconsistência ser corrigida, se beneficia disso automaticamente
    — sem precisar de intervenção de um Super Admin.

## H. Processamento — ordem canônica e trade-off documentado

Não existe nenhuma infraestrutura de fila/outbox/job durável neste
repositório (confirmado por pesquisa antes de implementar). Por isso, o
processamento é **inteiramente síncrono**, dentro da mesma requisição
HTTP. Ordem canônica em `processarWebhookComprovanteTransportadora`
(`P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora`):

1. Decodifica a imagem (hash, MIME real) e grava o evento no inbox
   (idempotência) — duplicado retorna aqui, sem tocar o Storage.
2. Confere o MIME real contra o declarado — **antes** de qualquer upload.
   Incompatível fecha em `ERRO_FINAL` sem nunca enviar o arquivo (reenviar
   o mesmo Base64 sempre vai falhar do mesmo jeito — não é reprocessável).
3. Salva o arquivo no Storage privado e grava `bucket`/`path`/
   `tamanho_bytes`/`persisted_at` **no próprio evento** — sempre, **antes**
   de qualquer matching.
4. Só então roda a resolução de vínculo e as validações cruzadas.

**Nunca depende do resultado do matching para preservar a evidência** —
esse é o ponto central da correção: antes, a resolução acontecia antes do
upload, então `NAO_IDENTIFICADO`/`REVISAO_MATCH` nunca chegavam a ter um
arquivo salvo, e `ERRO_REPROCESSAVEL` tinha o arquivo removido pelo
tratamento de erro genérico. Agora o arquivo é sempre salvo primeiro, e
esses três status (mais `AGUARDANDO_ENTREGA` e `PROCESSADO`) sempre retêm
o arquivo — só `IGNORADO_CANHOTO_JA_APROVADO` pode removê-lo, e só depois
de já ter gravado hash/metadados no evento (seção E). Consequências do
processamento síncrono em si (inalteradas):

- A latência do webhook inclui download+validação da imagem, upload ao
  Storage e a RPC de persistência — tudo antes de responder.
- Uma falha transitória (rede, banco) durante o matching/persistência
  fecha o evento em `ERRO_REPROCESSAVEL` (HTTP 503) — o carrier pode
  reenviar (idempotência, seção G) **ou** um Super Admin pode reprocessar
  o mesmo arquivo já retido (seção N) sem esperar o carrier.
- Não há retry automático do lado da plataforma — se nada reenviar nem
  reprocessar, o evento fica parado até alguém notar (a tela de eventos,
  seção M, torna isso visível). Aceito como trade-off do MVP; se o volume
  justificar, a evolução natural é mover o processamento para depois da
  resposta (fila real), não inventar um "fire-and-forget" não confiável
  agora.

## I. `AGUARDANDO_ENTREGA` — evidência preservada e reconciliada automaticamente

`nota_fiscal_entregas` só é criada dentro de
`desembolsar_operacao_com_logistica` (no desembolso, pós-cessão) — uma NF
pode legitimamente não ter nenhuma linha de entrega ainda. Como
`canhotos.nota_fiscal_entrega_id` é `NOT NULL`, não é possível criar um
canhoto sem uma entrega existente.

Decisão original: **não** criar uma entrega on-the-fly e **não** bridgear
para o mecanismo separado de "envio antecipado"
(`registrar_documento_logistico_antecipado` →
`private.reconciliar_evidencia_logistica_nf`) — esse mecanismo já existe
para outros tipos de documento, mas seu ator (`criado_por`) exige uma
sessão real de cedente (`actor_role = 'cedente'`, inexistente numa chamada
de webhook via `service_role`) e sua chave única é escopada a uma versão
de política operacional, que o webhook não tem como resolver. Não foi
estendido — permanece exclusivo do fluxo de cedente.

**Correção (`P0_Claude_Fechar_Webhook_Transportadora`)**: em vez de
descartar o arquivo, `registrar_comprovante_entrega_webhook` agora
**sempre** persiste `documentos_repositorio`/`documento_versoes` (mesmo
sem entrega) e, quando não há entrega, insere uma linha em
`webhook_comprovantes_entrega_pendentes` (nova tabela) preservando
`nota_fiscal_venda_id`, `nota_fiscal_remessa_id` (nullable), `tipo_vinculo`,
o documento/versão já persistidos, e a origem (`integracao_id`,
`webhook_evento_id`, `provider`). O evento webhook continua respondendo
`AGUARDANDO_ENTREGA` (200) — nada muda do ponto de vista do carrier.

Quando `desembolsar_operacao_com_logistica` cria a entrega (única função
que insere em `nota_fiscal_entregas`), ela chama
`private.reconciliar_comprovantes_pendentes_webhook(nota_fiscal_id,
entrega_id)` automaticamente, logo após materializar os requisitos
pós-cessão daquela NF. Essa função busca todas as linhas `PENDENTE` para a
NF (`FOR UPDATE`, em ordem de chegada) e, para cada uma, chama
`private.vincular_comprovante_webhook_entrega` — a mesma lógica de vínculo
usada em tempo real (checa canhoto já aprovado → `documento_vinculos` →
`canhotos` em `em_analise` → requisito opcional → evento → notificação
para gestor) — marcando a linha pendente como `RECONCILIADO` (com o
`canhoto_id` resultante) ou `ERRO_RECONCILIACAO` (com `erro_detalhe`) sem
nunca abortar o desembolso ou as demais evidências pendentes daquela ou de
outras NFs (cada uma é capturada em seu próprio bloco `EXCEPTION`).

**Nunca depende de reenvio da transportadora** — a evidência já está
persistida no momento em que chega; o desembolso é o único gatilho
necessário para o vínculo se completar.

## J. Testes

- `webhook-comprovante-transportadora-payload.test.ts` — validação/normalização
  pura do payload (chaves, CNPJs, datas, base64, magic bytes, MIME
  declarado vs. real).
- `webhook-comprovante-transportadora-matching.test.ts` — resolução
  (regras A/B/C), validação cruzada, plausibilidade de datas.
- `webhook-comprovante-transportadora.server.test.ts` — orquestração via
  cliente Supabase fake, cobrindo `processarWebhookComprovanteTransportadora`
  (`DIRETO_VENDA`/`VIA_REMESSA` com sucesso — arquivo enviado antes do
  matching —, duplicado sem enviar arquivo, `ERRO_FINAL` sem enviar
  arquivo, não identificado/ambíguo/cross-fund/CNPJ divergente com arquivo
  retido, canhoto já aprovado removendo o arquivo com segurança, race na
  RPC, falha inesperada retendo o arquivo), `reprocessarWebhookComprovanteTransportadora`
  (venda passa a existir → `PROCESSADO` reusando o arquivo sem novo
  upload, remessa validada depois → `VIA_REMESSA` com a venda principal
  suprida, ainda sem match, sem entrega, canhoto já aprovado, cross-fund,
  evento legado sem arquivo → `EVIDENCIA_INDISPONIVEL`, status não
  elegível e evento inexistente rejeitados) e `resolverIntegracaoPorToken`.
  Não persegue cobertura exaustiva de todos os cenários do ticket via
  mock — os testes puros cobrem a maior parte do "porquê" de cada ramo.
- `webhook-comprovante-transportadora.migration.test.ts` — contrato da
  migration original (idempotência, grants restritos a `service_role`,
  ausência de bloqueio por `status_entrega`, uso de `FOR UPDATE`, nunca
  insere `'aprovado'`).
- `webhook-comprovante-transportadora-fechar-gaps.migration.test.ts` —
  contrato da migration corretiva: provisionamento exige
  `private.usuario_e_super_admin()` (não mais gestor/fundo), a nova tabela
  de evidência pendente carrega remessa/vínculo/origem, o arquivo é
  sempre persistido antes de decidir (mesmo sem entrega), a checagem de
  canhoto já aprovado continua acontecendo antes de qualquer persistência,
  a lógica de vínculo foi extraída e reutilizada pela reconciliação, a
  reconciliação nunca aborta o desembolso, e a lógica financeira original
  de `desembolsar_operacao_com_logistica` permanece intacta.
- `integracoes-transportadoras.test.ts` — funções puras (máscara de
  token, elegibilidade de reprocessamento, schemas Zod, parse de filtros
  da querystring de eventos).
- `integracoes-transportadoras.migration.test.ts` — contrato da migration
  P1: histórico de token com índice único parcial, backfill antes do
  `DROP COLUMN`, `admin_criar_integracao_transportadora` sem `token_hash`
  direto, ordem segura de `admin_rotacionar_token_...`, fail-closed do
  `admin_revogar_token_...`, todas as novas RPCs gated por
  `usuario_e_super_admin()`, detalhe de evento nunca expõe Base64/token,
  `EVIDENCIA_INDISPONIVEL` no `CHECK`, as 6 novas ações sensíveis
  sincronizadas nos dois espelhos SQL, nenhuma ação sensível
  pré-existente removida, as novas colunas de retenção
  (`bucket`/`path`/`tamanho_bytes`/`persisted_at`), e `evidencia_retida`
  calculada em ambas as RPCs a partir de `bucket IS NOT NULL AND path IS
  NOT NULL` (nunca só `persisted_at`, que nunca é limpo mesmo após o
  arquivo ser removido).
- `webhook-comprovante-transportadora.server.test.ts` também cobre o
  retry externo (`P0_Claude_Fechar_Retry_Webhook_Transportadora`): retry
  de `ERRO_REPROCESSAVEL`/`NAO_IDENTIFICADO`/`REVISAO_MATCH` aciona
  reprocessamento automático (pode chegar a `PROCESSADO`, sem novo
  upload), retry de `PROCESSADO`/`AGUARDANDO_ENTREGA`/
  `IGNORADO_CANHOTO_JA_APROVADO`/`ERRO_FINAL` só devolve o resultado
  existente sem reprocessar, e `bucket`/`path` ficam `null` no patch de
  finalização exatamente quando (e só quando) `IGNORADO_CANHOTO_JA_APROVADO`
  remove o arquivo.

## K. Riscos remanescentes

- Sem HMAC de assinatura do corpo (aceito, fora de escopo deste ticket).
- Processamento síncrono sem fila (seção H) — aceitável no volume atual,
  reavaliar se o número de integrações/eventos crescer.
- Rate limiting por integração não implementado (não existe
  infraestrutura de rate limit neste repositório para reutilizar; MIME
  allowlist e limite de tamanho já mitigam abuso básico).
- Múltiplas evidências pendentes para a mesma NF (ex.: reenvios legítimos
  antes do desembolso) são todas reconciliadas na ordem de chegada,
  criando um `canhoto` `em_analise` por evidência — mesmo comportamento já
  aceito para múltiplos webhooks pós-entrega (nunca deduplicado por
  design, ver seção E: "pendente/em análise… registra uma nova versão").
- ~~Não há tela de gestão dedicada para listar/reprocessar eventos~~ e
  ~~UI de Super Admin para provisionar/rotacionar/revogar integrações~~ —
  ambos resolvidos pelo `P1_Claude_Super_Admin_Integracao_Transportadora`
  (seções L/M/N abaixo).
- ~~Reprocessamento sem arquivo retido (`EVIDENCIA_INDISPONIVEL` como
  resultado normal)~~ — resolvido pelo
  `P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora` (seções H/N).
- Eventos com arquivo retido acumulam objetos no Storage indefinidamente
  (não há expurgo/TTL para `NAO_IDENTIFICADO`/`REVISAO_MATCH`/
  `ERRO_REPROCESSAVEL` antigos que nunca foram reprocessados nem
  resolvidos) — aceitável no volume atual; se crescer, avaliar uma
  rotina de expurgo por idade combinada com o status.
- `webhooks-transportadora/{integracao_id}/{webhook_evento_id}/...` é um
  prefixo de Storage novo, fora da árvore por-cedente
  (`{cedente_id}/logistica/...`) usada pelo resto do domínio — deliberado,
  já que o cedente/NF ainda não é conhecido no momento do upload (seção
  H); os buckets de RLS/policies do Storage já são globais ao bucket
  `documentos-v2`, então isso não abre uma superfície de acesso nova.

## L. Histórico de token (P1)

Antes, `integracoes_transportadoras.token_hash` guardava um único hash, sem
histórico, sem rotação/revogação dedicada. Migration corretiva
`20260824180000_p1_super_admin_integracao_transportadora.sql` introduz
`integracoes_transportadoras_tokens` — uma linha por token gerado
(`ativo`/`substituido`/`revogado`), índice único parcial garantindo **no
máximo um `ativo` por integração**, no mesmo formato de histórico de
`credenciais_integracao` (`rascunho→ativa→substituida/revogada`).

Diferença deliberada em relação a `credenciais_integracao`:
`usuario_criptografado`/`senha_criptografada` daquela tabela são AES-256-GCM
**reversível** (a plataforma precisa reenviar a senha à API externa em cada
teste técnico). O token do webhook nunca precisa ser "relembrado" — só
comparado por igualdade de hash — então permanece SHA-256 **one-way**,
exatamente como já era no P0. `token_display` (últimos 4 caracteres em
texto puro, calculado uma única vez na criação/rotação) permite a UI
mostrar `•••• ab12` sem nunca reter nada recuperável.

- `admin_criar_integracao_transportadora` — agora insere o primeiro token
  no histórico em vez de gravar `token_hash` direto na integração.
- `admin_rotacionar_token_integracao_transportadora` — marca o token
  `ativo` atual como `substituido` **antes** de inserir o novo (nunca dois
  tokens `ativo` simultâneos — a ordem importa por causa do índice único
  parcial), devolve o novo token em texto puro uma única vez.
- `admin_revogar_token_integracao_transportadora` — marca o token `ativo`
  como `revogado` (com motivo opcional); falha explicitamente se não há
  token ativo (fail-closed, nunca revoga silenciosamente nada). Depois de
  revogado, o webhook desta integração deixa de autenticar imediatamente
  — `resolverIntegracaoPorToken` só aceita `status = 'ativo'`.
- Nenhuma policy de `SELECT` para `authenticated` nesta tabela — gestor
  nunca vê nem o hash nem o `token_display`; toda leitura Super Admin
  passa pelas RPCs curadas (metadados mascarados apenas), nunca por select
  direto na tabela.

## M. Gestão e observabilidade (Super Admin, P1)

- **`/admin/integracoes-transportadoras`** — lista todas as integrações
  (todos os fundos), com nome do fundo, provider, CNPJ, status
  ativo/inativo, status/display do token ativo, último recebimento, último
  processamento `PROCESSADO`, e contagem de eventos com erro nos últimos 7
  dias. Formulário de criação inline + ações por linha: Ativar/Desativar,
  Rotacionar token, Revogar token, Copiar endpoint (monta a URL a partir
  do `provider`, client-side, sem chamada ao servidor), e link para os
  eventos filtrados daquela integração.
- **`/admin/integracoes-transportadoras/eventos`** — lista
  `integracao_logistica_webhook_eventos` com filtros (status, chave NF-e,
  chave CT-e, fundo/integração via querystring) e paginação. Cada linha
  abre o detalhe (`/eventos/[id]`) com todos os metadados — **nunca**
  Base64 nem token (nenhuma dessas colunas existe nesta tabela; a RPC de
  detalhe (`admin_obter_webhook_evento_transportadora`) só projeta campos
  de metadados/hashes).
- Todas as RPCs de listagem/leitura (`admin_listar_integracoes_transportadoras`,
  `admin_listar_webhook_eventos_transportadora`,
  `admin_obter_webhook_evento_transportadora`) são gated por
  `private.usuario_e_super_admin()`, sem escopo de fundo (Super Admin é
  global, mesmo padrão de todo o resto da superfície admin).

Toda ação sensível (criar/ativar/desativar integração, rotacionar/revogar
token, reprocessar evento) exige o mesmo step-up de TOTP fresco usado em
SA1/SA2/SA3 (`autorizarEConsumirAcaoSensivel` — desafio TOTP real contra o
Supabase Auth, não apenas "logado com MFA há até 24h"). As 6 novas ações
foram adicionadas aos três espelhos sincronizados da lista fechada: o
`CHECK` de `autorizacoes_acoes_sensiveis.action_type`, o `IN`-list dentro
de `criar_autorizacao_acao_sensivel`, e o array TypeScript
`ACAO_SENSIVEL_TIPOS` (`src/lib/auth/mfa.ts`).

## N. Reprocessamento real (corrigido por
`P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora`)

A primeira versão deste recurso (ticket P1) descobriu, ao investigar, que
o arquivo original nunca chegava a ser retido para `NAO_IDENTIFICADO`/
`REVISAO_MATCH` (resolvidos antes do upload) nem para
`ERRO_REPROCESSAVEL` (o tratamento de erro genérico sempre limpava o
objeto órfão) — reduzindo "Reprocessar" a um diagnóstico sem arquivo.
Corrigido movendo o upload para **antes** do matching (seção H) — agora
`reprocessarWebhookComprovanteTransportadora` reprocessa de verdade:

1. Carrega o evento (precisa estar em `NAO_IDENTIFICADO`, `REVISAO_MATCH`
   ou `ERRO_REPROCESSAVEL` — outros status são rejeitados).
2. Le `bucket`/`path`/`tamanho_bytes`/`content_type`/`imagem_sha256` do
   próprio evento — **nunca envia um novo arquivo, sempre reusa o
   original** já retido no Storage.
3. Re-roda a resolução de vínculo (`resolverComprovanteWebhook`) e as
   validações cruzadas (`validarCruzamentoComprovanteWebhook`,
   `datasComprovanteWebhookPlausiveis`) contra o estado **atual** do
   banco — as mesmas funções puras e já testadas do fluxo em tempo real,
   através do núcleo compartilhado `resolverEFinalizarComprovante`.
4. Se resolver, chama a **mesma** RPC de persistência
   (`registrar_comprovante_entrega_webhook`) que o fluxo em tempo real
   usa, passando o `bucket`/`path` já existentes (sem novo upload) — cria
   o canhoto normalmente (`PROCESSADO`) ou registra a evidência pendente
   se ainda não há entrega (`AGUARDANDO_ENTREGA`, seção I).
5. Atualiza a **mesma** linha do evento in place (nunca cria uma segunda
   linha, nunca duplica documento/canhoto) e incrementa `tentativa_count`.

Resultados possíveis de um reprocessamento:
- **`PROCESSADO`** — a NF (e, se aplicável, a entrega) já existiam ou
  passaram a existir; o canhoto é criado normalmente a partir do arquivo
  original.
- **`AGUARDANDO_ENTREGA`** — resolveu, mas ainda não há
  `nota_fiscal_entregas`; evidência preservada, reconciliação automática
  (seção I) assume a partir daqui quando a entrega for criada.
- **`IGNORADO_CANHOTO_JA_APROVADO`** — já existe canhoto aprovado; arquivo
  removido com segurança (seção E).
- Ainda não resolve / ainda ambíguo → permanece `NAO_IDENTIFICADO`/
  `REVISAO_MATCH` (`tentativa_count` incrementado, arquivo continua
  retido para uma tentativa futura).
- Cross-fund na nova resolução → `NAO_IDENTIFICADO` (nunca revela o
  match).
- **VIA_REMESSA que evolui**: se a chave NF-e original era da remessa e a
  remessa só foi validada (`status_validacao = 'VALIDADA'`) depois do
  recebimento original, o reprocessamento agora resolve `VIA_REMESSA`
  corretamente e sempre supre `nota_fiscal_venda_id` (a NF principal) —
  nunca fica só com a remessa.

**`EVIDENCIA_INDISPONIVEL` deixou de ser um resultado normal** — só
acontece como fallback explícito quando o evento é anterior a esta
correção e genuinamente não tem `bucket`/`path`/`tamanho_bytes` gravados
(evento legado). Nesse caso, e só nesse caso, o texto do erro instrui a
solicitar o reenvio à transportadora.

Uma falha durante o reprocessamento (ex.: a RPC falha por um erro
transitório) nunca apaga o arquivo — ele permanece retido no evento para
uma próxima tentativa; o evento volta para `ERRO_REPROCESSAVEL` com
`tentativa_count` incrementado.
