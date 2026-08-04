# Diagnóstico — gate documental com zero requisitos

Data da análise: 04/08/2026
Escopo: diagnóstico somente leitura; nenhuma correção foi implementada.

## 1. Resumo executivo

O bloqueio é reproduzível e sua causa-raiz está na aprovação individual e em
lote de Notas Fiscais. O carregador usado por essas ações consulta somente as
instâncias materializadas em `documento_requisito_instancias`. Quando a consulta
retorna zero linhas, a função pura de avaliação não sabe se:

- a política legitimamente possui zero requisitos; ou
- a política exige requisitos, mas a materialização falhou.

Ela assume sempre o segundo caso e cria uma pendência sintética chamada
`Checklist documental`. Essa pendência não existe no catálogo, na política, no
snapshot nem no banco. É uma mensagem hardcoded introduzida na otimização da
listagem do gestor.

Na massa analisada em homologação, a política publicada possui zero requisitos,
a NF possui zero instâncias e o PDF original existe no Storage. Portanto, o
resultado correto do gate documental é “não aplicável/satisfeito”, e não erro de
materialização.

O painel de detalhe não apresenta a pendência porque usa outro resolvedor, que
carrega a coleção esperada de requisitos e distingue corretamente `nao_aplicavel`
de `nao_instanciado`. Há, assim, duas implementações com semânticas divergentes.

O problema afeta a aprovação da NF. A aprovação da operação utiliza outra regra
e aceita corretamente uma coleção vazia de requisitos. Ela também valida o
aceite do sacado em um gate separado.

## 2. Reprodução confirmada em homologação

Foi inspecionada, somente por consultas de leitura, a NF mais recente com evento
de resubmissão após ajuste. Identificadores foram truncados neste relatório.

| Evidência | Resultado |
|---|---|
| NF | `e13d7274…`, número mascarado |
| Status | `submetida` |
| Evento anterior | ajuste solicitado |
| Último evento | `nota_fiscal_resubmetida` |
| Política atribuída | ativa |
| Versão da política | v1, `publicada` |
| Requisitos da versão | **0** |
| Instâncias pré-cessão | **0** |
| Instâncias pós-cessão | **0** |
| Documento agregado sintético | inexistente |
| `notas_fiscais.arquivo_url` | preenchido |
| Tipo do arquivo original | PDF |
| Objeto no bucket `notas-fiscais` | encontrado |
| Registro no repositório documental | 0, esperado porque não há requisito correspondente |
| Operação vinculada à NF | nenhuma |
| Snapshot de operação para essa NF | inexistente, pois a operação ainda não foi criada |
| Evento de tentativa de aprovação bloqueada | inexistente; a action retorna antes da auditoria |

Também foi encontrada em homologação uma operação já aprovada/em andamento cujo
`politica_snapshot.requisitos` possui zero itens, com aceite obrigatório em
estado `aceito`. Isso confirma que o pipeline de operação consegue avançar com
zero requisitos e que o defeito está concentrado no gate de aprovação da NF.

## 3. Fluxo técnico da aprovação da NF

```text
Botão “Aprovar NF”
  ↓
handleAprovar()
  ↓
aprovarNF(nfId)
  ↓
requireGestor() + sessão MFA elevada
  ↓
validarNfsNoFundoAtivo()
  ↓
carregarResumoDocumentalDasNotas()
  ↓
SELECT documento_requisito_instancias
  WHERE nota_fiscal_id = NF
    AND escopo_snapshot = 'nf_pre_cessao'
  ↓
avaliarChecklistDaNotaComDados()
  ↓ zero linhas
cria pendência sintética “Checklist documental”
  ↓
avaliarElegibilidadeAprovacaoNf()
  ↓
retorna a mensagem de bloqueio
```

### 3.1 Interface

A página de detalhe chama a Server Action e apenas apresenta seu retorno. A UI
não calcula a elegibilidade:

- [`src/app/gestor/notas-fiscais/[id]/page.tsx`](../../src/app/gestor/notas-fiscais/%5Bid%5D/page.tsx), `handleAprovar`, linhas 152–158;
- o botão “Aprovar NF” está no mesmo arquivo, linhas 288–293.

### 3.2 Autorização

[`src/lib/actions/nota-fiscal.ts`](../../src/lib/actions/nota-fiscal.ts), linhas
49–53 e 1067–1071:

1. exige perfil gestor;
2. exige sessão MFA elevada;
3. resolve o fundo ativo autorizado;
4. confirma que a NF pertence ao fundo ativo.

As policies mais recentes de `notas_fiscais` também restringem leitura e update
ao fundo autorizado. A consulta documental retorna uma coleção vazia válida, e
não erro de RLS. RLS não é a causa do bloqueio.

### 3.3 Gate documental

[`src/lib/notas-fiscais/resumo-documental-gestor.server.ts`](../../src/lib/notas-fiscais/resumo-documental-gestor.server.ts),
linhas 38–60, consulta somente instâncias pré-cessão. Ela não carrega a política,
o conjunto esperado de requisitos nem o snapshot.

Para cada NF solicitada, mesmo sem instâncias, o loader chama
`avaliarChecklistDaNotaComDados` e produz um item no `Map` de avaliações. Logo,
o fallback “não foi possível validar” de `aprovarNF` normalmente não é alcançado;
o erro é uma decisão explícita da função pura.

### 3.4 Origem exata de “Checklist documental”

[`src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts`](../../src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts),
linhas 40–60:

```text
se requisitosDaNota.length === 0:
  elegivel = false
  requisitosPendentes = ["Checklist documental"]
  totalObrigatorios = 0
  pendentesObrigatorios = 1
```

Além da contradição entre `totalObrigatorios = 0` e
`pendentesObrigatorios = 1`, o nome é totalmente sintético. O `git blame`
identificou sua introdução no commit `5bba6c8` (`perf: otimiza notas e documentos
do gestor`, 29/07/2026).

[`src/lib/notas-fiscais/elegibilidade-aprovacao.ts`](../../src/lib/notas-fiscais/elegibilidade-aprovacao.ts),
linhas 23–42, transforma essa lista na mensagem final:

> A NF ainda possui documentos obrigatórios sem aprovação: Checklist documental.

### 3.5 Persistência e auditoria

Somente depois de todos os gates a action atualiza `notas_fiscais.status` para
`aprovada`, preenche `aprovada_gestor_em`, notifica o cedente e registra
`NF_APROVADA`/`nota_fiscal_aprovada`. Como a execução retorna antes do update,
nenhum status é alterado e nenhuma auditoria do bloqueio é criada
([`src/lib/actions/nota-fiscal.ts`](../../src/lib/actions/nota-fiscal.ts), linhas
1100–1133).

O fluxo em lote repete a mesma avaliação e também é afetado
([`src/lib/actions/nota-fiscal.ts`](../../src/lib/actions/nota-fiscal.ts), linhas
1309–1383).

## 4. Política, snapshot e fonte da decisão

### 4.1 Onde o snapshot existe

O snapshot é criado em
[`src/lib/operacoes/politica.ts`](../../src/lib/operacoes/politica.ts), função
`criarSnapshotPolitica`. Ele é armazenado em `operacoes.politica_snapshot`, com
hash em `politica_snapshot_hash`, e contém:

- IDs do vínculo, fundo, política e versão;
- flags de aceite, cessão e logística;
- configuração pública;
- coleção congelada `requisitos`, incluindo escopo, obrigatoriedade, tipo,
  validação, prazo e responsáveis.

Ele é criado no momento da solicitação da operação. A NF é submetida e aprovada
antes de poder ser selecionada para uma operação; portanto, uma NF isolada ainda
não possui snapshot de operação. A massa analisada confirma essa condição.

### 4.2 O que a aprovação da NF usa hoje

A aprovação da NF usa **somente instâncias materializadas**. Não usa:

- `politica_snapshot`;
- a versão publicada atual;
- a coleção de requisitos configurados;
- um fallback legado explícito.

Por isso, a action não consegue distinguir “zero requisitos esperados” de
“requisitos esperados que não foram instanciados”.

### 4.3 O que o painel visual usa

O detalhe da NF usa `listarChecklistDaNota`, em
[`src/lib/actions/documento-v2.ts`](../../src/lib/actions/documento-v2.ts). Esse
fluxo resolve a política publicada aplicável, carrega os requisitos esperados e
as instâncias, e chama
[`resolverEstadoChecklistDocumental`](../../src/lib/documentos-v2/checklist-state.ts).

Esse resolvedor já implementa a distinção correta:

- política existente + zero requisitos → `nao_aplicavel`, sem card e sem alerta;
- política com requisitos + alguma instância ausente → `nao_instanciado`;
- requisitos presentes e pendentes → `pendente`;
- obrigatórios concluídos → `completo`.

Essa é a razão para o painel estar vazio enquanto o botão de aprovação bloqueia.

### 4.4 Aprovação da operação

A aprovação da operação chama
`validarElegibilidadeAprovacao`, em
[`src/lib/operacoes/elegibilidade.ts`](../../src/lib/operacoes/elegibilidade.ts),
antes da RPC `aprovar_operacao_atomica`.

O loader documental da operação, em
[`src/lib/operacoes/elegibilidade-documental.server.ts`](../../src/lib/operacoes/elegibilidade-documental.server.ts),
usa `operacoes.politica_operacional_versao_id` e consulta os requisitos dessa
versão. Ele não consulta a versão atualmente publicada, então uma mudança futura
de política não troca a versão histórica da operação. Porém, a decisão não é
derivada exclusivamente do JSON de `politica_snapshot`; ela depende das linhas
da versão referenciada. A imutabilidade de versões publicadas reduz o risco, mas
isso deve ser tornado explícito na futura regra canônica.

Com zero requisitos configurados, o mapa contém uma lista vazia e
[`avaliarElegibilidadeDocumentalParaOperacao`](../../src/lib/operacoes/elegibilidade-documental.ts)
retorna elegível. O bug da NF não se repete atualmente nessa etapa.

### 4.5 Snapshots antigos ou incompletos

[`normalizarSnapshotPoliticaOperacao`](../../src/lib/operacoes/politica-operacao.ts)
normaliza snapshots antigos sem alterar o JSON persistido. Quando `requisitos`
não existe, usa lista vazia e inclui o aviso `requisitos_ausentes_no_snapshot`.
Algumas capacidades logísticas permitem fallback por evidência existente em
operações legadas.

Não foi encontrado um default de snapshot que crie ou exija “Checklist
documental”. O default problemático está exclusivamente no avaliador de NF.

## 5. Semântica atual de zero requisitos

| Cenário | Resultado esperado | Resultado no painel | Resultado na aprovação da NF | Resultado na aprovação da operação |
|---|---|---|---|---|
| A. Política sem requisitos aplicáveis | satisfeito | correto: `nao_aplicavel` | **incorreto: bloqueia** | correto: satisfeita |
| B. Obrigatórios materializados e pendentes | bloquear e listar reais | correto | correto | correto |
| C. Política exige requisito, instância ausente | erro de materialização | correto: `nao_instanciado` | bloqueia, mas como “Checklist documental” apenas se nenhuma instância existir | cria requisito vazio e bloqueia o tipo real |
| D. Apenas opcionais não bloqueantes | não bloquear | correto | correto quando instâncias existem | correto |

Conclusão: o código da aprovação da NF confunde A com C porque recebe somente a
coleção materializada, sem a coleção esperada.

## 6. Materialização de requisitos

O detalhe/submissão da NF chama
[`instanciarRequisitosDaNota`](../../src/lib/documentos-v2/requisitos.ts). O fluxo:

1. valida contexto `cedente_id` + `cedente_fundo_id` + `fundo_id`;
2. resolve a atribuição ativa e a versão publicada vigente;
3. chama `public.instanciar_requisitos_nota`;
4. a RPC insere somente requisitos ativos com escopo `nf_pre_cessao`;
5. usa `ON CONFLICT (politica_requisito_id, nota_fiscal_id)` para idempotência;
6. reconcilia XML/DANFE-base quando houver requisito correspondente.

A definição vigente está em
[`supabase/migrations/20260727212953_corrigir_documento_tipo_requisitos_nf.sql`](../../supabase/migrations/20260727212953_corrigir_documento_tipo_requisitos_nf.sql).

Uma política sem requisitos gera legitimamente zero inserts. Não há linha
agregada “Checklist documental”. Requisitos pós-cessão não entram nessa RPC.

O materializador usa a política publicada atualmente aplicável ao vínculo, e não
o snapshot de uma operação. Isso é coerente para uma NF pré-operação, mas é um
ponto de atenção se uma NF já vinculada a operação for reprocessada após mudança
de política.

`resubmeterNFAjustada`, em
[`src/lib/actions/nota-fiscal.ts`](../../src/lib/actions/nota-fiscal.ts), linhas
1194–1244, apenas altera `requer_ajuste` para `submetida` e registra eventos. Não
reinstancia nem revalida o checklist. Na massa analisada não existem instâncias
residuais; logo, a resubmissão não causou este bloqueio.

Estados `dispensado` e `cancelado` existem no domínio da instância, mas os
avaliadores de aprovação não os tratam explicitamente como satisfeitos/ignorados.
Essa lacuna não causou o caso atual, pois não há instâncias, mas precisa de teste
na futura correção.

## 7. NF original em PDF ou XML

### 7.1 Fluxo atual

O upload de NF aceita XML ou PDF, salva o objeto no bucket `notas-fiscais` e
persiste um único caminho em `notas_fiscais.arquivo_url`
([`src/lib/actions/nota-fiscal.ts`](../../src/lib/actions/nota-fiscal.ts), funções
`processarArquivo` e `criarNFManual`).

Se a política tiver requisito `nf_xml` ou `nf_danfe_pdf`, o arquivo também é
registrado no repositório e reconciliado com a instância. Se não houver requisito,
[`uploadDocumentoSeRequerido`](../../src/lib/documentos-v2/upload.ts), linhas
485–503, retorna `false` sem criar documento no repositório. Esse comportamento
explica por que a massa possui arquivo original, mas zero documentos V2.

### 7.2 Regra “PDF OU XML”

Hoje a alternativa PDF/XML é implícita no fluxo de criação: uma única NF nasce a
partir de um dos arquivos e `arquivo_url` aponta para ele. Não existe um gate
canônico de aprovação que expresse “PDF OU XML”.

Nem `submeterNF` nem `aprovarNF` validam explicitamente:

- `arquivo_url` preenchido;
- extensão PDF/XML;
- existência do objeto no Storage;
- vínculo documental válido.

Na massa analisada, o caminho está preenchido, a extensão é PDF e o objeto foi
encontrado no bucket. Portanto, o arquivo está correto para o caso concreto.
Contudo, o código atual poderia aprovar uma NF somente com metadados se ela fosse
inserida por outro caminho autorizado e tivesse zero requisitos. Corrigir apenas
o erro de lista vazia sem introduzir o gate de arquivo original deixaria essa
lacuna.

Storage sem vínculo documental não é suficiente para satisfazer um requisito de
checklist quando a política exige esse requisito; nesse caso, a reconciliação
exige documento e versão persistidos. Para políticas sem requisitos, o arquivo
original deve ser tratado como evidência-base separada, não como requisito
sintético.

## 8. Aceite do sacado

O aceite não participa da aprovação formal da NF. Ele passa a ser aplicável após
a criação da operação e é validado separadamente em
[`src/lib/operacoes/elegibilidade.ts`](../../src/lib/operacoes/elegibilidade.ts):

- se obrigatório, `operacoes.aceite_sacado_status` deve ser `aceito` e cada NF da
  operação deve estar com status `aceita`;
- `pendente` e `contestado` bloqueiam;
- se dispensado pela política, o status deve ser `dispensado`.

O aceite, portanto, não está sendo mascarado pela mensagem documental no mesmo
gate: para a NF analisada ainda não há operação nem aceite operacional. A
mensagem atual identifica apenas o gate documental incorreto. Na aprovação da
operação, mensagens de aceite e documentação são separadas.

## 9. Aprovação da NF versus demais gates

| Etapa | Fonte documental | Zero requisitos | Arquivo original | Aceite |
|---|---|---|---|---|
| Submissão da NF | painel/lista esperada + instâncias | correto | não validado explicitamente | não aplicável |
| Aprovação individual da NF | somente instâncias | **incorreto** | não validado | não aplicável |
| Aprovação em lote de NFs | somente instâncias | **incorreto** | não validado | não aplicável |
| Solicitação da operação | snapshot recém-criado e NFs elegíveis | não bloqueia | depende da aprovação prévia | status inicial conforme snapshot |
| Aceite do sacado | snapshot/campos normalizados da operação | separado | não participa | validado |
| Aprovação da operação | versão congelada referenciada + instâncias | correto | não revalidado | validado |
| Desembolso | estado da operação e documentos próprios | não é a origem do bug | não revalidado | pressupõe operação aprovada |

## 10. Hipóteses avaliadas

| Hipótese | Conclusão | Evidência |
|---|---|---|
| `every()` sobre coleção vazia foi invertido | descartada | não há `every()` no ponto defeituoso; há um `if length === 0` explícito |
| ausência de instâncias vira pendência genérica | **confirmada** | `avaliarChecklistDaNotaComDados` |
| fallback “Checklist documental” é adicionado em lista vazia | **confirmada** | string hardcoded nas linhas 48–57 |
| gate da NF consulta política atual em vez do snapshot | descartada parcialmente | ele não consulta nem política nem snapshot; usa apenas instâncias |
| gate da operação consulta política atual | descartada | usa `politica_operacional_versao_id` congelado, embora não use exclusivamente o JSON snapshot |
| requisito pós-cessão bloqueia a aprovação pré-cessão | descartada | loaders filtram `nf_pre_cessao` |
| requisito opcional comum é tratado como obrigatório | descartada para opcionais não bloqueantes | filtro usa `obrigatorio || bloqueiaFluxo` |
| resubmissão deixou requisito residual | descartada na massa | zero instâncias e histórico coerente |
| materialização não distingue zero requisitos de falha | confirmada no consumidor da aprovação | a RPC pode retornar zero corretamente; o avaliador perde o contexto esperado |
| PDF/XML original é tratado como requisito separado | inconclusiva como regra global | quando configurado, é requisito V2; sem requisito, fica somente como arquivo-base |
| regra legada exige checklist sempre | confirmada como fallback local | comportamento hardcoded, não migration/RPC |
| cache/payload da UI está desatualizado | descartada | decisão ocorre server-side e foi confirmada nos dados |
| mensagem vem de RPC diferente da tela | descartada | mensagem nasce no TypeScript da action; nenhuma RPC participa desse gate |
| RLS escondeu requisitos existentes | descartada para o caso | homologação com acesso administrativo confirmou zero requisitos e zero instâncias |

## 11. Risco multifundo

O defeito é genérico e pode afetar qualquer fundo cuja política aplicável tenha
zero requisitos pré-cessão. Também pode afetar políticas contendo somente
requisitos pós-cessão, pois a consulta de aprovação verá zero itens pré-cessão.

Não deve ser criado bypass por fundo, cedente, nome de política ou ID. Um bypass
global de checklist também seria perigoso, pois liberaria o cenário C, em que a
política exige documentos e as instâncias não foram criadas.

A futura decisão precisa receber simultaneamente:

1. requisitos esperados pela fonte congelada/aplicável;
2. instâncias materializadas;
3. evidência do arquivo original;
4. contexto da etapa (NF pré-operação ou operação com snapshot).

## 12. Testes existentes

### Coberturas úteis

- requisito obrigatório aguardando análise bloqueia;
- requisito aprovado libera;
- opcional não bloqueante não bloqueia;
- requisito pós-cessão é ignorado na aprovação pré-cessão;
- rejeição permanece bloqueante;
- submissão exige status, contexto, política e dados obrigatórios;
- operação valida aceite obrigatório/dispensado;
- operação avalia documentos aprovados, pendentes e opcionais;
- criação e normalização do snapshot;
- reconciliação de XML/DANFE com documentos-base;
- validação estrutural dos documentos-base.

### Teste que permite e protege o bug

[`src/lib/notas-fiscais/avaliacao-checklist-aprovacao.test.ts`](../../src/lib/notas-fiscais/avaliacao-checklist-aprovacao.test.ts),
linhas 122–130, exige que uma coleção vazia produza a pendência “Checklist
documental”. O teste não fornece a coleção de requisitos esperados e, portanto,
codifica a ambiguidade A/C.

### Lacunas

- política existente com zero requisitos na aprovação da NF;
- política com requisitos esperados e zero instâncias;
- integração loader + action + banco para ambos os cenários;
- PDF, XML e ambos como alternativas de arquivo original;
- metadado `arquivo_url` sem objeto real;
- NF sem `arquivo_url` e zero requisitos;
- requisito `dispensado` e `cancelado`;
- resubmissão sob política sem requisitos;
- operação antiga cujo snapshot não exige requisitos enquanto a política atual exige;
- paridade entre aprovação individual, lote e operação;
- autorização cruzada entre fundos no novo gate.

Os testes do painel exercitam “requisito esperado sem instância”, mas não possuem
um caso explícito de política existente com coleção esperada vazia. Os testes da
operação também não nomeiam explicitamente o caso zero, embora a implementação o
trate corretamente por consequência.

## 13. Matriz mínima para a futura correção

| Cenário | Resultado esperado |
|---|---|
| Sem requisitos + PDF existente + aceite válido na operação | NF aprova; operação aprova |
| Sem requisitos + XML existente + aceite válido | NF aprova; operação aprova |
| Sem requisitos + PDF e XML existentes + aceite válido | NF aprova; operação aprova |
| Sem requisitos + sem PDF/XML | bloqueia pelo arquivo original, não por checklist |
| Sem requisitos + aceite pendente | NF pode ser analisada; operação bloqueia explicitamente pelo aceite |
| Obrigatório pendente | bloqueia e nomeia o requisito real |
| Todos os obrigatórios aprovados | aprova |
| Opcional ausente | não bloqueia |
| Requisito dispensado | não bloqueia |
| Requisito cancelado | não bloqueia, conforme regra de domínio confirmada |
| Snapshot exige requisito, instância ausente | erro explícito de preparação/materialização |
| Política atual exige documento, snapshot antigo não | operação antiga não bloqueia pelo requisito novo |
| Requisito somente pós-cessão | não bloqueia aprovação pré-cessão |
| NF resubmetida sem requisitos | continua aprovável |
| Gestor de outro fundo | acesso negado antes do gate |
| Aprovação em lote | mesma semântica da individual |

## 14. Proposta de correção futura — não implementada

### 14.1 Regra canônica

Separar quatro decisões:

1. **Arquivo original:** existe PDF ou XML válido associado à NF.
2. **Aplicabilidade documental:** obter os requisitos pré-cessão esperados.
3. **Materialização:** para cada requisito esperado, deve existir instância
   correspondente, salvo regra explícita de evidência-base.
4. **Satisfação:** somente obrigatórios ou bloqueantes aplicáveis precisam estar
   aprovados; opcionais, pós-cessão, dispensados e cancelados não bloqueiam.

Se a coleção esperada for vazia, o gate documental é satisfeito. Essa conclusão
só pode ocorrer depois de confirmar que a fonte de política existe e realmente
contém zero requisitos.

### 14.2 Função central

Evoluir uma única função de domínio baseada em
`resolverEstadoChecklistDocumental` para produzir também a elegibilidade formal
de aprovação. Ela deve receber requisitos esperados e instâncias, e substituir a
semântica isolada de `avaliarChecklistDaNotaComDados`.

O loader de aprovação deve carregar a fonte de política junto às instâncias:

- NF ainda sem operação: versão publicada aplicável ao vínculo, com contexto
  explicitamente identificado como pré-operação;
- NF vinculada a operação: `politica_snapshot.requisitos` da operação, sem
  recalcular pela política atual;
- operação: manter a versão congelada, preferencialmente validando e comparando
  com o snapshot persistido.

### 14.3 Mensagens

- zero requisitos: nenhuma mensagem de pendência;
- requisito real pendente: listar seu nome;
- requisitos esperados sem instâncias: “Não foi possível preparar os requisitos
  documentais da política para esta NF”;
- arquivo ausente: “A NF não possui arquivo original PDF ou XML válido”;
- aceite pendente/contestado: mensagem própria do gate de aceite.

### 14.4 Arquivos provavelmente alterados

- `src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts`;
- `src/lib/notas-fiscais/resumo-documental-gestor.server.ts`;
- `src/lib/notas-fiscais/elegibilidade-aprovacao.ts`;
- `src/lib/documentos-v2/checklist-state.ts` ou novo módulo canônico compartilhado;
- `src/lib/actions/nota-fiscal.ts`, apenas para consumir o resultado e o gate de arquivo;
- testes correspondentes em `src/lib/notas-fiscais`, `src/lib/documentos-v2` e
  `src/lib/operacoes`.

### 14.5 Banco e migration

A correção da causa-raiz **não exige migration**: a política, versão, snapshot e
instâncias já armazenam os dados necessários. A mudança principal é de consulta
e domínio.

Uma migration só seria necessária se a equipe decidir persistir na própria NF um
snapshot pré-operação ou um tipo explícito do arquivo original. Isso é uma
decisão arquitetural adicional, não requisito para corrigir o bloqueio imediato.

## 15. Riscos e rollback da futura correção

Riscos principais:

- tratar qualquer lista vazia como sucesso sem confirmar a política e liberar
  NFs cuja materialização falhou;
- consultar a política atual em operações antigas e alterar comportamento
  histórico;
- esquecer a aprovação em lote;
- liberar NF sem arquivo original;
- alterar implicitamente a semântica de `dispensado`/`cancelado` sem decisão de
  domínio;
- introduzir queries por NF em lote.

O rollback futuro é simples se a correção ficar concentrada no loader e função
de domínio, sem banco: reverter o commit restaura o comportamento anterior. Não
há dados a desfazer.

## 16. Validações executadas

- consultas somente leitura em homologação;
- confirmação de existência do objeto original no Storage, sem baixar ou expor o conteúdo;
- 10 arquivos de teste direcionados: **66 testes aprovados**;
- suíte completa: **78 arquivos, 552 testes aprovados**;
- `npx tsc --noEmit`: aprovado;
- `npm run lint`: aprovado com 6 avisos preexistentes de imports não utilizados;
- nenhuma migration, escrita no banco, deploy, commit ou push executado.

## 17. Parecer

**Causa-raiz confirmada:** a aprovação de NF interpreta zero instâncias como
falha de materialização sem consultar quantos requisitos eram esperados.

**Camada responsável:** domínio/aplicação TypeScript da aprovação de NF,
principalmente `avaliarChecklistDaNotaComDados` e o loader que fornece apenas
instâncias.

**Origem de “Checklist documental”:** fallback hardcoded e sintético; não existe
registro correspondente no banco.

**Snapshot:** não é usado na aprovação da NF; para a massa analisada ele ainda
nem existe, porque a NF não pertence a uma operação. Na aprovação da operação,
a versão congelada é respeitada, embora a leitura ainda dependa das linhas da
versão em vez de exclusivamente do JSON snapshot.

**Zero requisitos:** é confundido com erro somente no gate da aprovação
individual/em lote da NF. O painel e a aprovação da operação têm a semântica
correta.

**PDF/XML:** o caso analisado possui PDF real no Storage. A alternativa PDF/XML
existe no upload, mas não há validação explícita do arquivo original na submissão
ou aprovação.

**Aceite:** está corretamente separado e é validado na operação, não na aprovação
pré-operação da NF.

**Abrangência:** todos os fundos com zero requisitos pré-cessão podem ser
afetados; não é um defeito específico de fundo ou cedente.

**Recomendação:** corrigir em etapa própria com uma fonte canônica que receba
requisitos esperados + instâncias + arquivo original, preserve o snapshot das
operações e mantenha o aceite como gate independente. Não criar exceções por
fundo. Nenhuma migration é necessária para a correção imediata.
