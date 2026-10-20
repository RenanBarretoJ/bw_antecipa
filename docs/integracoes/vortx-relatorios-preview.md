# Vórtx VRS 2.0 — contrato de relatórios e pendências da Preview

Estado local mais recente: secao **Atualizacao: persistencia nativa e leitores
por provedor — 19/10/2026**, ao final. As secoes anteriores preservam o relato
das etapas precedentes e nao indicam a versao hospedada atual.

## Escopo historico: contrato e parser

Branch `feature/vortx-real-data-preview`, originada de `homolog`.
Implementação local de validação do pedido, interpretação do protocolo,
parser CSV nativo e composição ativo/parcela, após recebimento das amostras.
Sem HTTP ao provedor, callback publicado, importação em banco, migration,
commit, push ou novo deploy nesta etapa. Os arquivos reais foram lidos apenas
para replay local; nenhum registro foi criado na plataforma.
O frontend da Preview continua na versão publicada anteriormente.

Fonte fornecida pelo usuário: `30099278e0.md`, lida em 19/10/2026.
SHA-256: `11e32ee5c692caf8ba3b1fe18b2838aa96f119a6619e138c857c8ef50f0f3ac3`.
O arquivo é documentação técnica, não autorização para alterar outros ambientes.

## Contrato confirmado e implementação

- Solicitação: `POST /v1/vrs/externo/solicitar`, autenticação Bearer V2.
- Payload: `codigoCarteira`, `dataInicio`, `dataFim`, `dataReferencia`,
  `tipoRelatorio`, `extensaoArquivo` (`1` XLSX, `2` CSV).
- A validação local usa as datas `YYYY-MM-DD` dos exemplos do manual.
  O schema também declara `date-time`; compatibilidade real ainda não foi testada.
- Usa os nomes textuais dos quatro tipos pedidos. Não presume código numérico
  para Posição Parcela nem habilita outros tipos sem necessidade.
- Reutiliza o validador de carteira da configuração existente; o padrão CSV é `2`.
- Exige fim posterior ao início, conforme a descrição. Pedido de um único dia
  precisa de confirmação da Vórtx antes de ser habilitado; não amplia o período
  silenciosamente para contornar essa dúvida.
- Rejeita datas futuras e exige referência explícita para posições.
- Inclusão/Exclusão sem referência recebem `dataFim` explicitamente, em acordo
  com o default descrito e com o `required` do schema.
- O protocolo contém `id` UUID, `status: 0` e `dataSolicitacao` UTC/offset.
  O schema descreve objeto direto e o exemplo usa `{ data: ... }`:
  a implementação admite os dois, rejeitando envelopes ambíguos.
- `status: 0` significa somente pedido pendente; nunca arquivo disponível,
  relatório importado ou carteira conciliada.
- O manual informa callback com URL S3 pré-assinada. Não informa contrato do
  callback, verificação de autenticidade, cadastro do destino nem polling.
  Nada disso foi inventado ou habilitado.
- `servers: []`: não há novo hostname confirmado por este documento.

Implementação: `src/lib/integracoes/vortx/relatorios-contrato.ts`.
Não é action ou fronteira de autorização: Fundo, ambiente, versão e carteira
precisam vir do contexto validado no servidor quando o fluxo for conectado.

## Mapeamento funcional informado pelo usuário

| Relatório | Domínio pretendido | Granularidade |
| --- | --- | --- |
| `Inclusao` | Cessões/aquisições | Movimento, layout pendente |
| `Exclusao` | Liquidações | Movimento, layout e motivos pendentes |
| `PosicaoAtivo` | Composição consolidada do estoque | Ativo |
| `PosicaoParcela` | Base operacional principal do estoque aberto | Parcela |

Inclusão não é endpoint de envio de remessa. Exclusão não autoriza baixar
automaticamente títulos sem interpretar os códigos/motivos do arquivo.
Não somar posição de ativo e posição de parcela: são granularidades do mesmo
estoque, não carteiras independentes. A chave de associação ativo/parcela ainda
deve ser confirmada nos layouts.

No domínio atual, `CARTEIRA` representa patrimônio líquido em
`carteira_snapshots`/`pl-referencia.server.ts`. Posição Ativo não fornece contrato
de PL; não habilita `CARTEIRA` nem substitui PL por soma do estoque.

## Documento adicional: Carteira JSON / PL

Fonte fornecida pelo usuário: `2063683m0.md`, lida em 19/10/2026.
SHA-256: `8f46f208f34042db5a6298fbbdbf24620e815301f07b6623cd2f298c05b9f60c`.
Esse contrato é separado dos pedidos assíncronos VRS acima:

- Método `GET`, path `/carteira-liberada/buscarCarteiraJSON`.
- Homologação: `https://apis-stg.vortx.com.br`.
- Produção do provedor: `https://apis.vortx.com.br`.
- Query obrigatória: `cnpjFundos[]` (somente dígitos) e `dataCarteira`
  (`YYYY-MM-DD`). Preservar o CNPJ como string, inclusive zeros iniciais,
  apesar de a tabela do manual rotular o parâmetro como `Int`.
- Autenticação Bearer, com permissões próprias. O manual remete a
  `https://docs.vortx.com.br/6712150f0.md`. Essa página não pôde ser lida pela
  ferramenta de navegação nesta etapa; o contrato de obtenção do token
  continua pendente. Não presumir compatibilidade com `/v2/auth/login` do VRS.
- Não reutilizar o host do cliente VRS: `api` e `apis` são destinos diferentes.
- A resposta é um array de objetos com `carteiras`, `ativos`, `passivos`.
  O manual descreve `cnpjFundo`, `dataAtual`, `carteira`, `nome` e `pl`
  em Carteiras, mas não traz um exemplo populado dessa seção nem seus tipos.
  O mapeamento exato desses campos ainda exige resposta de referência.
- `pl` é a fonte documentada de patrimônio líquido. Não usar `plTotal`
  de categoria, somatório de ativos, posição de ativo ou parcelas como PL.
- A consulta operacional deve ser restrita ao CNPJ do Fundo autorizado no
  servidor, sem aceitar uma lista livre de fundos do frontend. A resposta
  deve ser conferida contra esse CNPJ e data, sem misturar resultados de
  fundos nem usar posição de data divergente como fallback silencioso.
- Arrays vazios não autorizam inventar `pl: 0` ou publicar uma carteira
  completa. Múltiplas carteiras para o mesmo Fundo/data exigem interpretação
  contratual; não selecionar a primeira ou somá-las automaticamente.
- O futuro adaptador deve preservar arquivo/JSON original privado, hash,
  origem e publicação versionada, integrando `carteira_snapshots` e o resolvedor
  temporal de PL existente. Não habilitar a capability apenas pelo manual:
  autenticação, consulta, normalização e testes ainda não foram implementados.

Na etapa de leitura do manual de Carteira houve somente documentação: nenhum GET
ao endpoint financeiro, tentativa de login, teste novo, escrita em banco,
migration, commit, push ou deploy. As validações registradas ao final deste
documento distinguem o contrato anterior do parser nativo posterior.

## Persistência proposta, ainda não implementada

1. Registrar solicitação durável antes de qualquer tentativa real: Fundo,
   ambiente, integração/versão, carteira, tipo, período, referência e estado.
   Persistir o protocolo retornado e rastrear tentativa/correlação. Cada POST
   cria outro pedido: não repetir automaticamente após timeout inconclusivo.
2. Autenticar e correlacionar o callback ao protocolo e contexto registrados.
   Não aceitar Fundo/carteira/URL arbitrários como autorização. Downloads devem
   usar controles próprios de origem, redirecionamento e tamanho, sem encaminhar
   Bearer ou certificado Vórtx ao S3.
3. Preservar arquivo original privado, hash e dados nativos do provedor por
   importação. A infraestrutura atual já tem `importacao_arquivos`,
   `importacao_linhas.dados_brutos` e `dados_normalizados`.
4. Os exemplos confirmam atributos nativos distintos por ativo e parcela,
   inclusive divergência de PDD. A proposta é preservar essas granularidades
   em extensão nativa por importação, sem um estoque paralelo invisível ao
   matching, logística, exposição e risco existentes. A migration ainda não
   foi implementada; precisa preservar RLS, linhagem e publicação atômica.
5. Projetar parcelas validadas na base canônica `estoque_posicoes`, preservando
   identificadores Vórtx, linhagem, precisão monetária e Fundo. Ativo consolidado
   serve para consistência e detalhe, sem duplicar valor no estoque operacional.
   Se o custo de aquisição existir somente no ativo, não repeti-lo integralmente
   em cada parcela nem rateá-lo sem uma regra contratual/gerencial confirmada.
6. Publicar snapshots completos atomicamente e preservar os anteriores.
   Repetição de arquivo/callback não duplica movimento nem muda Fundo.

O parser atual `processarArquivoRlx` aceita apenas `RLX_V1`, CSV com `;` e os
headers configurados. Não há prova de que esses headers se apliquem à Vórtx.
Não alterar aliases nem passar arquivos Vórtx por esse parser às cegas.
Nenhuma tabela ou migration foi criada antes da evidência de layout.

## Estado de entrada versus acompanhamento logístico

O usuário esclareceu que o **campo customizado 2** da Vórtx registra
“em trânsito” / “entregue” na entrada do título. Esse valor é estático.
O header confirmado é `Campo Customizado 2`. Nos exemplos, ele só está
preenchido em Posição Ativo; a associação com parcelas é descrita abaixo.

- Preservar esse campo como estado de entrada do provedor, com importação/data
  e valor bruto; não o tratar como atualização gerencial a cada sincronização.
- Acompanhamento posterior pertence ao BW Antecipa: um título inicialmente em
  trânsito pode tornar-se entregue sem alteração do campo estático na Vórtx.
- Uma reimportação com “em trânsito” não pode regredir uma entrega gerencial
  posterior já comprovada. Não atualizar o campo histórico para simular que
  a Vórtx publicou esse novo estado.
- A classificação atual reutilizável está em
  `src/lib/logistica/evidencias-logisticas.ts` e
  `src/lib/financeiro/logistica/snapshot.ts`: comprovante aprovado → `ENTREGUE`;
  CT-e aprovado → `EM_TRANSITO`; sem evidência aprovada → `INDETERMINADA`;
  sem matching forte → sem classificação atribuída à NF.
- A integração futura deve preservar esses guards e definir explicitamente
  como apresentar o estado inicial do provedor quando não há evidência interna.
  O esclarecimento não autoriza fabricar comprovante, matching ou aprovação.
- O tratamento conservador de indeterminados para exposição é distinto do
  estado gerencial; não alterar esse comportamento silenciosamente.

## Insumos pendentes

Pasta privada fora do Git: `C:\Users\BrenoAlvim\Downloads\BW_Antecipa_Vortx_Relatorios`.
Subpastas para Inclusão, Posição Ativo, Posição Parcela, documentação de callback
e Exclusão quando disponível. Os três primeiros exemplos foram analisados
localmente, conforme a seção abaixo.
Nenhum segredo deve ser colocado nessa pasta.

Ainda faltam esclarecer as divergências de PDD entre ativo e parcela,
obter motivos/layout de exclusão, mecanismo autenticado do
callback e contrato de autenticação/retorno populado de Carteira JSON. O usuário
informou que não houve liquidação: a certificação desse domínio ficará pendente,
não será declarada PASS nem inferida pela falta de arquivo.

## Parser nativo e evidência das amostras

Foram lidos três ZIPs, cada um contendo um CSV UTF-8 com delimitador `;`.
Cada CSV tem **2.538 registros**: Inclusão de 15–16/10/2026 e posições de
ativo/parcela de 16/10/2026. Os originais não foram extraídos para o Git,
alterados ou importados em banco. Hashes constam no relatório de replay local.

- A chave do ativo isoladamente tem 2.438 valores distintos: 100 ocorrências
  adicionais em 97 grupos, decorrentes de cedentes diferentes. Não são títulos
  a descartar. Incluindo carteira, documento do cedente e chave de ativo,
  há 2.538 identidades únicas; incluindo parcela, a unicidade é preservada.
  Isso foi também confirmado pelo usuário.
- A identidade técnica inclui Fundo, ambiente, carteira, cedente, ativo e,
  quando aplicável, parcela. Data da posição não muda a identidade do título.
  Para Inclusão, a unicidade do movimento considera também a data do movimento:
  não força um relatório de intervalo a uma única data.
- As 2.538 parcelas encontram exatamente um ativo no mesmo escopo e uma
  chave correspondente em Inclusão. Neste exemplo há uma parcela por ativo;
  a relação de várias parcelas por ativo só foi exercitada com dados sintéticos.
- O CSV Parcela tem o campo customizado 2 vazio nas 2.538 linhas. A composição
  usa a posição Ativo para preservar estado de entrada e proveniência:
  **1.100 `EM_TRANSITO`, 887 `ENTREGUE`, 551 `NAO_INFORMADO`**.
  Não elimina linhas sem status nem inventa uma entrega.
- O ID da parcela na registradora está vazio em todas as parcelas. Não serve
  de chave para esta amostra; a identidade nativa composta é preservada.
- Os valores de compra, nominal e presente reconciliam entre as posições.
  Há **548 divergências de PDD** entre ativo e parcela. Ambos os valores são
  preservados; não há substituição nem rateio automático. A reconciliação
  econômica integral permanece **não aprovada** e a publicação desabilitada.
- `Data de Pagamento` de Parcela coincide com vencimento nas 2.538 linhas;
  na posição Ativo está vazia. É preservada como informação do fornecedor,
  nunca convertida em liquidação. Não há relatório de Exclusão disponível.
- `Valor de Emissão (Total Ativo)` não é somado por parcela nem confundido com
  nominal em aberto. Ativo consolidado não é adicionado ao total das parcelas.
- `Campo Customizado 1` não é presumido como número de NF/chave fiscal.
  Não há matching automático criado nesta etapa.

Arquivos implementados nesta etapa:

- `src/lib/integracoes/vortx/relatorios-layout.ts`: headers nativos e estado de entrada.
- `src/lib/integracoes/vortx/relatorios-parser.ts`: validação, valores em strings,
  datas civis, bruto preservado, escopo de carteira, identidade composta e
  rejeição de duplicidade dentro do mesmo escopo, sem remover linhas.
- `src/lib/integracoes/vortx/estoque-composicao.ts`: junção escopada, projeção
  canônica local e divergências. Não persiste nem habilita publicação.
- `src/lib/financeiro/ingestao/parser.ts`: somente exporta o normalizador de
  datas existente para reúso; comportamento do parser RLX não alterado.
- Testes e fixtures novos são integralmente sintéticos.

O parser aceita CSV, até 20 MiB e 100 mil linhas, com limites de registro.
O runner QA abre os ZIPs fornecidos em memória e confere hashes/CRC; isso
não representa um endpoint genérico de upload ZIP implementado na aplicação.
Exclusão e Carteira JSON não são aceitos como esses três layouts CSV.

Evidência privada reproduzível (fora do Git):
`SAMPLE_ARCHIVE_PROFILE.json`, `SAMPLE_JOIN_QUALITY_V2.json` e
`NATIVE_CSV_REPLAY.json` na pasta `bw-antecipa-evidence/vortx-preview-20261019`.
O contexto de Fundo do replay é sintético: não certifica autorização, RLS ou
associação dessas linhas ao Fundo real na plataforma.
O perfil V1 ordenava datas brasileiras lexicalmente; seus intervalos não são
evidência cronológica. O V2 normaliza datas ISO antes de ordenar e preserva V1
como histórico, sem usar seus intervalos incorretos.

## Verificação anterior: contrato de solicitação

Os testes do contrato são sintéticos e não fazem requisições externas.
Foram reexecutadas as regressões atuais de autenticação mTLS, configuração,
parser Sinqia/RLX, logística e exposição na suíte completa: **3.147 testes
aprovados e 18 ignorados**, incluindo 56 novos testes do contrato. Os 8 testes
sintéticos de isolamento da Preview também passaram. TypeScript, lint,
`git diff --check` e build Next.js com credenciais placeholder passaram.
Não houve CI remoto novo: estes arquivos permanecem locais, sem commit/push.
Aprovação unitária não certifica acesso real à Vórtx, callback, layout,
RLS nova ou dados importados.

## Verificação atual: parser nativo e composição

- 50 testes novos sintéticos aprovados para os três layouts, identidade
  por cedente, múltiplas parcelas, precisão decimal, PDD, órfãos, conflito de
  estado, ausência de matching, limites e preservação de entrega interna.
- Suíte completa: **3.197 testes aprovados e 18 ignorados**, sem remover testes.
- 8 testes de isolamento da Preview, TypeScript, lint, build Next.js com
  credenciais placeholder e `git diff --check` aprovados.
- Replay dos três CSVs reais: 2.538 linhas válidas por arquivo; associação
  completa. A reconciliação financeira integral **não passou** devido às
  548 diferenças de PDD. Publicação continua desabilitada no código.
- O primeiro TypeScript apontou TS7053/TS2322 somente na tipagem das novas
  fixtures/tabelas de casos. Foram corrigidas as anotações sem alterar
  assertions; a execução inicial está preservada em `NATIVE_PARSER_QUALITY.json`.
  A rodada final está em `VERIFIED_NATIVE_PARSER_QUALITY.json`.
- Nenhum teste de RLS/migration foi executado: não houve schema ou banco
  alterado. Nenhum smoke autenticado, callback ou chamada à Vórtx executado.
- Sem commit/push/deploy. A Preview hospedada continua no commit anterior
  `f387461de469c0f7f767dc2a3a8b06b15bcb9422`, sem estes parsers conectados.

O próximo escopo é implementar persistência nativa e projeção atômica com
migration incremental e ensaios locais de RLS/idempotência. A publicação
econômica exige esclarecer o PDD; automação depende também do callback e
da autenticação de Carteira JSON. Exclusão continua sem certificação por falta
de exemplo e de códigos/motivos de movimento.

## Atualizacao: persistencia nativa e leitores por provedor — 19/10/2026

Esta secao substitui o estado de implementacao local descrito nas etapas
historicas acima, sem substituir suas evidencias. A branch continua
`feature/vortx-real-data-preview`; nenhum deploy/migration remota desta
persistencia foi realizado. A Preview publicada permanece anterior a ela.

### Fontes e granularidade

- `vortx_posicao_ativos`: posicao consolidada nativa, com bruto, normalizado,
  Cedente, identidade composta e referencia ao arquivo original.
- `vortx_posicao_parcelas`: parcelas abertas, com os proprios valores, datas,
  chaves e FK para o ativo no mesmo snapshot. Mesma chave em Cedentes
  diferentes continua sendo registro distinto.
- `importacoes_financeiras`: cabecalho compartilhado de um snapshot
  `VORTX_ATIVO_PARCELA_V1`, com ambiente/carteira explicitos e dois registros em
  `importacao_arquivos`. Hash idempotente inclui Fundo, ambiente, carteira,
  referencia e os hashes dos dois CSVs.
- Nada e inserido em `estoque_posicoes` pelo worker nativo. A view
  `estoque_fontes_leitura` e uma projecao somente leitura, `security_invoker`,
  para reutilizar contratos dos modulos, sem merge fisico nem dupla contagem
  de ativo consolidado e parcelas.

### Persistencia/publicacao

Migration nova: `20261019192624_vortx_native_stock.sql`. Nao altera arquivos de
migrations historicas nem repara migration history.

O worker `estoque-ingestao.server.ts` resolve a integracao publicada no ambiente
canonico de runtime, preserva os dois originais no bucket privado ja existente
`financeiro-importacoes` e chama `persistir_estoque_vortx` em uma transacao.
Nao e Server Action, rota de usuario, callback nem downloader externo. Nenhuma
credencial real foi usada nos ensaios.

O banco verifica Fundo ativo, provider, versao, ambiente, carteira e capability
antes da escrita. A transacao preserva ambos os relatorios ou nao preserva
nenhum. Divergencias financeiras sao conservadas para revisao em `VALIDA`,
com `metadados.reconciliado=false`; nao entram na projecao financeira.

`publicar_estoque_vortx` e uma etapa interna explicita: revalida o escopo ativo
e compara nominal, aquisicao, presente e PDD por ativo novamente no banco.
Nao confia somente no marcador JSON de reconciliacao. Linhas publicadas sao
imutaveis, e a retificacao cria novo snapshot, preservando o anterior.
O publicador legado rejeita VORTX e nao retifica snapshots do namespace nativo.

A elegibilidade pura `publicacaoHabilitada` passa a depender de reconciliacao
integral. Isso nao autoriza nem executa publicacao: o RPC interno revalida os
dados. As 548 divergencias do replay anterior continuam bloqueando aqueles
arquivos; nao houve rateio, substituicao de PDD ou importacao real nesta etapa.

Falhas de upload sao compensadas somente nos arquivos criados pela tentativa.
Se o resultado da transacao estiver indeterminado, originais possivelmente
ja persistidos pela transacao sao preservados para reconciliacao. Um retry duplicado descarta
somente seus novos uploads, nunca os originais do snapshot vencedor.

### Conexao aos modulos

`financeiro/fontes/fonte-financeira.server.ts` centraliza a selecao da fonte:

- fonte Vortx: filtro obrigatorio por provider, ambiente e carteira;
- fluxo legado/manual: mantido, sem incluir registros Vortx;
- fonte indisponivel: erro explicito; sem fallback;
- fonte Vortx anteriormente publicada mas agora desativada/revogada:
  historico escopado impede fallback silencioso ao legado;
- ausencia de posicao nativa nao autoriza substituir por Fromtis.

Matching e conciliacao passam a ler a projecao, com paginacao integral e
ordenacao deterministica. A Central de Conciliacao e o fingerprint financeiro
do risco usam o mesmo seletor de fonte. Logistica grava exatamente uma FK:
estoque legado **ou** parcela nativa; guards de completude, matching,
pertencimento da NF, bootstrap e auditoria foram preservados.
Exposicao continua consumindo os resultados logisticos existentes, sem fork
de calculo, alteracao de PL ou politica de risco.

Campo Customizado 2 e apenas **estado de entrada**. Se ausente na parcela,
a projecao consulta o ativo daquele snapshot, preservando o bruto de ambos.
Esse estado e registrado nos detalhes para consulta, sem fabricar matching,
comprovante ou decisao gerencial. Evidencia interna aprovada de entrega nao
regride por uma reimportacao com estado de entrada em transito.

Aquisicoes/liquidacoes Fromtis nao completam bases Vortx. Ausencia de
Exclusao nao vira declaracao de movimento zero nem baixa automatica.

### Limites e pendencias

- Autenticacao e cadastro do callback ainda dependem da Vortx; nenhuma
  automacao de recebimento/download foi habilitada ou simulada como homologada.
- Cron legado continua sem handler automatico Vortx; informa adapter nao
  implementado. Nao e redirecionado ao parser RLX.
- O upload/publicacao nativo permanece interno; nao foi adicionada uma nova
  tela de importacao manual ao painel administrativo nesta etapa.
- A preparacao aceita os limites do parser CSV (20 MiB por arquivo, 100 mil
  linhas); isto nao e certificacao de transporte hospedado nesse volume.
- Preview atual usa runtime `homologacao`, enquanto as credenciais reais VRS
  foram cadastradas no contexto `producao`. O worker/leitor nao altera esse
  runtime e nao reutiliza flags de diagnostico para contornar sua separacao.
  O smoke hospedado das novas tabelas requer definir esse contexto
  explicitamente em etapa controlada de publicacao.
- SQL/RLS e transacoes foram exercitados em bases Docker locais descartaveis,
  com estrutura canonica focada e atores sinteticos nao-owner/non-BYPASSRLS.
  Nao substituem Auth/Storage E2E ou smoke autenticado na Preview.

Runners reproduziveis: `scripts/qa/vortx/native-stock-sql-rehearsal.mjs` e
`scripts/qa/vortx/native-stock-quality.mjs`. Evidencias, tentativas anteriores
e resultados completos ficam fora do Git em
`%LOCALAPPDATA%/bw-antecipa-evidence/vortx-native-stock-20261019/`.

### Verificacao final desta implementacao local

- 3.341 testes aprovados, 18 ignorados, nenhuma falha na suite completa.
- 32 verificacoes SQL por stack, em duas stacks independentes: 64 no total.
  Incluem RLS canonica, isolamento de escopo, par completo, idempotencia,
  retificacao historica, PDD divergente, NaN, revogacao/capability encerrada,
  protecao do publicador legado e matching/logistica nativos e Fromtis.
- Testes de compensacao de Storage usam doubles; SQL usa PostgreSQL real.
  Nenhum desses resultados equivale a Storage/Auth E2E hospedado.
- TypeScript, lint, oito testes de isolamento da Preview, build Next.js
  com placeholders e `git diff --check`: aprovados.
- `DOCKER_TEST_ENV_CLEANUP=true`; recursos preexistentes preservados.
- Migrations historicas, Auth, MFA, policies legadas e regras de calculo
  nao foram editados. Nenhum commit, push, CI remoto ou deploy desta etapa.

Para futura publicacao: validar os pre-requisitos no catalogo da Preview,
aplicar somente a migration nova, depois publicar o frontend/backend e somente
entao liberar ingestao/publicacao nativa. Nao publicar dados nativos enquanto
estiver servindo um frontend anterior que desconheca essa fonte.

## Callback de relatorios: receptor local, ainda desabilitado na Preview

Confirmacao fornecida pela Vortx em 19/10/2026: uma URL por carteira, POST
com o JSON de WebhookRelatorio, sem suporte a headers personalizados e com
preservacao dos parametros da URL. O usuario confirmou nao haver callback
cadastrado. Nenhuma URL real ou segredo foi gerado/cadastrado nesta etapa.

A implementacao usa um segredo aleatorio de 256 bits por carteira na query
string, acompanhado do identificador do endpoint. Isso e uma credencial
bearer compartilhada, **nao** uma assinatura do payload nem prova
criptografica da identidade da Vortx. Quem obtiver a URL podera apresentar
eventos; por isso sua entrega deve ser privada, com rotacao/revogacao e sem
registro da query em logs. Nao copiar a URL para issues, screenshots ou Git.

Arquitetura desta entrega:

- POST `/api/integracoes/vortx/relatorios/callback`, desativado por padrao;
- limite de 16 KiB para o JSON, inclusive em stream sem Content-Length;
- registro privado do hash do segredo, derivando Fundo/ambiente/carteira
  exclusivamente de uma integracao Vortx publicada e ativa;
- uma carteira nao pode ser transferida silenciosamente entre contextos;
- rate limit atomico por endpoint e global, sem criar chaves para IDs arbitrarios;
- revogacao/rotacao, Fundo e integracao ativa revalidados na persistencia;
- inbox `vortx_relatorio_eventos`, sem DML direto para usuarios ou worker;
- URL de download somente em payload criptografado AES-GCM, reutilizando
  o keyring existente sem exportar ou alterar chaves;
- HTTP 200 somente depois do commit; duplicatas nao geram novo evento/auditoria;
- correlacao por protocolo, Fundo, integracao, ambiente, carteira, tipo e datas;
- evento antecipado fica pendente e e correlacionado quando o protocolo
  for gravado; divergencia fica CONFLITANTE, sem importacao;
- leitura administrativa apenas dos campos de resumo, com RLS/MFA canonicos;
- historico append-only; mudanca de status e renovacao da URL geram eventos
  separados, sem sobrescrever a solicitacao original.

O endpoint nao baixa arquivos, nao executa parsers e nao grava estoque,
aquisicoes ou liquidacoes. Recebido/correlacionado nao significa importado.
Ainda nao ha worker de download, reprocessamento ou publicacao financeira,
nem nova apresentacao desses eventos na tela de historico de solicitacoes.
As divergencias de PDD anteriormente identificadas continuam bloqueadas.

Nomes enviados a API continuam os do manual: PosicaoAtivo/PosicaoParcela.
O receptor tambem normaliza PosicaoNivelAtivo/PosicaoNivelParcela, como no
manual do evento. Apenas os quatro tipos contratados nesta fase sao aceitos.

### Gates antes de habilitar ou cadastrar uma URL real

1. Revisar catalogo e aplicar somente a nova migration de callback e os
   pre-requisitos explicitamente aprovados na Preview, nunca replay global.
2. Publicar o backend e validar alcance externo do endpoint: a protecao da
   Preview nao pode devolver login/redirect ao POST da Vortx. Nao reutilizar
   token global de bypass nem desativar protecoes globalmente.
3. Comprovar a ausencia/redacao dos parametros sensiveis em logs da aplicacao,
   plataforma, observabilidade e encaminhamentos. O logger local registra
   somente status HTTP e duracao; isso nao prova redacao na hospedagem.
4. Habilitar explicitamente `VORTX_REPORT_CALLBACK_PREVIEW_ENABLED=true` e
   `VORTX_REPORT_CALLBACK_QUERY_REDACTION_VERIFIED=true` somente apos a prova
   anterior; guard exige a branch, projeto Preview e Fundo configurado.
5. Criar o registro por tooling interno autorizado e entregar a URL em canal
   privado para cadastro pela Vortx. Nao configurar callback de producao
   apontando permanentemente para uma Preview descartavel.
6. Confirmar criterio de sucesso HTTP, intervalo/backoff e prazo de retries:
   a frase sobre tentativas continuas nao esclarece essas semanticas.
7. Fazer smoke de recebimento real. Depois, implementar o download separado,
   com hosts autorizados, SSRF/redirect controls, limites, integridade e
   compensacao, sem inferir que um evento disponivel autoriza publicacao.

O receptor permanece desabilitado ate esses gates. Banco remoto, Vercel,
Vortx, homolog e producao nao foram alterados nesta entrega local.

Runners: `scripts/qa/vortx/callback-sql-rehearsal.mjs` e
`scripts/qa/vortx/callback-quality.mjs`. Evidencias sanitizadas em
`%LOCALAPPDATA%/bw-antecipa-evidence/vortx-callback-20261019/`.

### Validacao local do receptor em 19/10/2026

- Suite completa: 3.394 testes aprovados, 18 ignorados, zero falhas; inclui
  53 verificacoes especificas do contrato, handler, criptografia e route.
- Callback SQL: 38 verificacoes por stack, em duas stacks independentes
  (76 no total), incluindo concorrencia real nos dois ordenamentos de
  callback/protocolo e rate limit concorrente sem perda de incrementos.
- Regressao SQL de solicitacoes: 27 verificacoes por stack (54 no total).
- Regressao SQL de estoque nativo: 32 por stack (64 no total).
- TypeScript, lint, oito checks de escopo da Preview, build com placeholders
  e `git diff --check`: aprovados.
- Recursos temporarios identificados por label e removidos; inventario
  preexistente preservado. Nenhuma conexao a banco remoto pelos runners.
- Esses ensaios sao focados (handler com doubles e SQL real com atores
  sinteticos), nao uma certificacao HTTP/Auth/Storage E2E hospedada.
- Relatorio consolidado: `CALLBACK_CLOSEOUT.json`, no diretorio de evidencias.

## Publicacao isolada da interface de callback em 19/10/2026

Commit `0714ef7`, somente na branch `feature/vortx-real-data-preview`.
As migrations `20261019201346_vortx_report_callback_inbox` e
`20261019203424_vortx_callback_admin_ui` foram aplicadas na Preview
`phdckowbexkkvuwnzeaf`, por lista explicita, conferindo hashes e registrando
somente a aplicacao verdadeira desses fontes. O pacote transacional completo
foi ensaiado em duas stacks: 56 checks em cada uma. A A6 original permanece
ausente; nao houve replay nem reconciliacao historica.

O estoque nativo e seus modulos ficaram fora desse commit e dessa aplicacao.
A interface de geracao/rotacao/revogacao aparece na integracao Vortx VRS 2.0,
com TOTP, revisao otimista, nonce consumido com a mutacao, URL exibida uma vez
e indicacao separada de cadastro informado e evento recebido.

Validacao local: 3.415 testes aprovados, 18 ignorados, 112 checks SQL na
certificacao do payload e 16 cenarios de navegador. CI remoto e build Vercel
aprovados para o commit publicado. As orientacoes UI/UX determinaram passos
curtos, confirmacao de rotacao, exibir/ocultar/copiar, erros inline e layout
responsivo com tema escuro, sem persistir o segredo no navegador.

**Ativacao real bloqueada:** a documentacao da Vercel inclui Search Params
nos detalhes de Runtime Logs e query no proxy.path de Drains. O probe
sintetico retornou 404 sem redirect e sem ecoar o valor; a busca de logs nao
retornou linhas. Isso nao demonstra redacao antes da persistencia.
Ambas as flags de habilitacao/verificacao continuam false, com escopo apenas
nesta branch. Nenhuma URL real foi gerada e nenhum callback foi cadastrado.

Antes de ativar, obter mecanismo suportado de redacao na hospedagem ou
aprovar separadamente um receptor com logs controlados. Nao usar bypass,
mascaramento apenas na UI ou ausencia de resultados de busca como prova.
Homolog, producao, credenciais VRS e usuarios QA permaneceram intocados.

Relatorio: `%LOCALAPPDATA%/bw-antecipa-evidence/vortx-callback-ui-20261019/CALLBACK_UI_PREVIEW_CLOSEOUT.json`.

## Incremento de persistencia do estoque — 20/10/2026

Esta secao descreve o novo incremento; as secoes anteriores sao checkpoints
historicos e nao representam a configuracao atual do callback. O recebimento
foi habilitado separadamente por autorizacao e os diagnosticos temporarios de
requisicao/corpo bruto foram retirados. Esta implementacao nao os reativa.

Escopo: somente a branch `feature/vortx-real-data-preview` e o banco Preview
`phdckowbexkkvuwnzeaf`. Migrations explicitas, nesta ordem:

1. `20261019192624_vortx_native_stock.sql` (base local previamente preservada).
2. `20261020192527_vortx_stock_callback_processing.sql` (ledger e transporte).

O aplicador `scripts/qa/vortx/deploy-stock-preview.mjs` confere nomes, versoes,
hashes LF dos fontes ensaiados em duas stacks, definicoes legadas e projeto.
Sem `--apply`, e somente leitura. A aplicacao real e o registro verdadeiro das
duas migrations ficam na mesma transacao; nao ha replay, adocao de objetos,
edicao de history antiga nem aplicacao da A6 original.

### Fluxo e limites

- O callback confirma somente seu recebimento duravel. `after()` acorda o
  processador, mas nao e a fonte de verdade nem uma fila duravel por si so.
- O banco seleciona um par `CORRELACIONADO` de PosicaoAtivo/PosicaoParcela,
  da mesma data pontual, Fundo, ambiente, carteira e versao ativa. Nao adota
  eventos pendentes nem reescreve solicitacoes antigas.
- Lease de dez minutos, no maximo tres tentativas apos interrupcao, um worker
  ativo por Fundo. Resultado conhecido invalido e falha terminal, nao loop.
- GET HTTPS em host exato aprovado, DNS publico validado e IP fixado na conexao
  mantendo SNI/Host e validacao TLS; sem redirects, bearer VRS ou cookies.
  Cada CSV tem limite de 20 MiB, deadline e verificacao de integridade HTTP.
- Parser estrito do layout confirmado, ate 100 mil linhas por arquivo, valores
  monetarios decimais. Mesmo ativo de cedentes diferentes permanece distinto.
  Duplicata conflitante dentro do mesmo escopo invalida o arquivo inteiro.
- Reserva privada do manifesto precede os dois uploads sem overwrite.
  Transporte normalizado em blocos de ate 500 linhas e menos de 2 MiB por RPC,
  em vez de um JSON monolitico. Contagem, sequencia, lease e manifesto sao
  novamente validados no commit.
- Uma transacao grava `vortx_posicao_ativos`, `vortx_posicao_parcelas`, linhagem,
  auditoria e resultado do job. Dedup por par de hashes/escopo preserva o
  snapshot vencedor. Staging concluido e removido; CSVs privados e historico
  financeiro sao preservados. Compensacao nunca apaga original possivelmente
  confirmado quando o resultado da transacao e indeterminado.
- Persistencia NAO publica. Divergencias de totais/PDD ficam em revisao e o
  publicador separado recusa dados nao reconciliados. O campo customizado 2
  registra estado de entrada, nao substitui evidencia logistica posterior.

### Operacao na Preview

Flags exclusivas desta branch: `VORTX_REPORT_STOCK_PROCESSING_ENABLED=true`
e `VORTX_REPORT_DOWNLOAD_HOSTS=vrs-remessas.s3.sa-east-1.amazonaws.com`.
Esse hostname foi observado nos callbacks autenticados; nao e uma atestacao
independente de titularidade pelo provedor. Nao permitir wildcard S3.

`POST /api/integracoes/vortx/relatorios/processar`, sem query nem corpo,
e um wakeup tecnico protegido por credencial aleatoria exclusiva cujo SHA-256
fica em `VORTX_REPORT_STOCK_WORKER_HASH`. Nao e action de usuario, nao recebe
Fundo/evento do cliente e nao substitui MFA. Nunca guardar essa credencial em
documentacao, frontend ou logs. Respostas so contem estado/contagens sanitizados.

O ambiente do job e derivado do contrato canonico no banco e revalidado com
resolver de integracao e RPC; nao se altera o runtime global da Preview.
Consequentemente a consulta financeira comum continua respeitando o runtime
global e somente snapshots publicados: persistir dados do provider producao
nesta Preview nao muda silenciosamente esse contexto nem exibe saldo publicado.

Pendencias explicitas: publicacao e validacao gerencial, recuperacao operacional
de tentativas interrompidas via worker protegido (sem cron automatico na
Preview), reconciliacao/GC dos manifestos de tentativas abandonadas, teste de
throughput hospedado e layout de Exclusao/liquidacao. Inclusao tem parser local,
mas nao integra este processador de estoque. Sem inferencia de baixa financeira.

Evidencias: `vortx-native-stock-20261019` (SQL/qualidade/aplicacao) e
`vortx-stock-processing-20261020` (performance/closeout), sob
`%LOCALAPPDATA%/bw-antecipa-evidence/`. Contagens finais e estado hospedado devem
ser lidos no closeout da execucao, nao inferidos apenas da existencia deste fonte.
