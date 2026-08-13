# Diagnóstico técnico read-only — bases financeiras do SC1 para o P2 RLX

> Data do diagnóstico: 13/08/2026
> Escopo: Estoque, Aquisições e Liquidações
> Natureza: leitura, mapeamento e recomendação; nenhuma implementação ou alteração de banco
> SC1 analisado: `bwasset/sc1-order-processing-plataform`, commit `cba0c1c52dc1ad427d9ade8793452d7aca9a3164`

## 1. Resumo executivo

O SC1 possui as três bases solicitadas, importadas de relatórios Sinqia por SOAP/MTOM e persistidas em PostgreSQL:

```text
Sinqia
  ├─ relatório de estoque (D-1)
  ├─ relatório de aquisições (tipoRelatorio = 1)
  └─ relatório de liquidados/baixados (tipoRelatorio = 2; BAIXA)
       ↓
ZIP / CSV latin1, delimitado por ponto e vírgula
       ↓
parser comum
       ↓
UPSERT em lotes de 1.000
       ↓
estoque / aquisicoes / liquidacoes
```

Conclusões principais:

- **Estoque é histórico por snapshot diário**, não uma tabela sobrescrita de posição corrente. D-1, D-2 e D-3 podem coexistir.
- A chave do estoque é `(seu_numero, data_referencia)`. Ela funciona no contexto atual, mas é insuficiente para o BW multifundo porque não contém `fundo_id`.
- `id_recebivel` é a melhor ponte entre Aquisições e Liquidações, mas **não existe no Estoque**.
- `seu_numero` existe nas três bases e é a melhor ponte transversal disponível, porém sua unicidade global e estabilidade não são comprovadas pelo código.
- `chave_nfe` existe apenas no Estoque e é a melhor ponte direta para `notas_fiscais.chave_acesso` do BW quando preenchida e válida.
- `nu_documento`/`numero_documento`/`documento` não podem ser tratados automaticamente como número da NF: o layout não prova essa semântica.
- O parser é reutilizável **com ajustes relevantes**. Ele não é RFC 4180, usa `split(';')`, não valida calendário, converte `BIGINT` para `number` JavaScript e aceita silenciosamente campos obrigatórios de fundo vazios.
- A idempotência é apenas por linha/chave. Não há identidade do arquivo, checksum, atomicidade global, marca de snapshot completo ou fluxo formal de retificação.
- A Liquidação admite vários movimentos por recebível, data e tipo, mas não preserva dois movimentos parciais do mesmo tipo no mesmo dia. O suporte a liquidação parcial é, portanto, **não comprovado e estruturalmente insuficiente**.
- O cron está configurado para `30 12 * * 1-5`, equivalente a 09:30 em São Paulo enquanto UTC-3; o comentário do código diz 08:00 BRT e está divergente.
- Segurança e tenancy do SC1 **não devem ser copiadas**: as três bases têm `SELECT USING (true)` para qualquer usuário autenticado, o cliente administrativo ignora RLS e o CNPJ do fundo é uma variável global.
- A Carteira/PL D-2 necessária à RLX não existe no escopo financeiro encontrado no SC1. Deve continuar reservada a uma fase separada, sem schema inventado neste diagnóstico.

Para o BW, recomenda-se criar no futuro uma camada de ingestão multifundo, imutável e auditável, com `fundo_id`, execução/arquivo de origem, estado de completude, chave externa preservada como texto, reconciliação explícita e RLS por fundo. A posição ativa deve ser derivada de snapshots e movimentos; registros históricos não devem ser apagados quando o título sair da exposição.

## 2. Escopo funcional da RLX considerado

O ativo principal permanece a **Nota Fiscal**. A Duplicata Mercantil P2.0 continua sendo capacidade opcional e não deve ser usada como entidade financeira principal da RLX.

```text
NF BW
  ├─ NF-e XML/PDF
  ├─ Duplicata Digital / Boleto (lastro/cobrança)
  ├─ CT-e / DACTE
  └─ Canhoto / comprovante de entrega
```

O objetivo futuro, não implementado nesta etapa, é:

```text
Estoque D-2 + Aquisições D-1 - Liquidações D-1 = Estoque D-1
                                                    ↓
                                           título financeiro
                                                    ↓
                                                  NF BW
                                                    ↓
                                  ENTREGUE | EM_TRANSITO | INDETERMINADA
```

Um título liquidado sai da exposição corrente, mas seu histórico e a evidência de conciliação permanecem. A regra futura de 40% deverá usar o valor de aquisição dos títulos com risco `EM_TRANSITO` sobre o PL oficial D-2, com overlay intraday em fase própria. Nenhum cálculo foi criado neste diagnóstico.

## 3. Repositório e limitações da evidência

### 3.1 Repositório correto

O repositório correto foi confirmado como:

- checkout local: `C:\Users\BrenoAlvim\documentos\github-bluewave\sc1-order-processing-plataform`;
- GitHub privado: `bwasset/sc1-order-processing-plataform`;
- branch padrão: `main`;
- commit inspecionado: `cba0c1c52dc1ad427d9ade8793452d7aca9a3164`;
- URL: <https://github.com/bwasset/sc1-order-processing-plataform>.

O projeto contém migrations, as três bases, parsers, importação Sinqia automática/manual e execução agendada. Um repositório local de nome semelhante (`operacional_fundo_sc1`) foi descartado por não conter esse conjunto.

O checkout local estava na branch `main`, limpo (`git status --short` vazio) e no mesmo SHA fixado acima. A análise local foi confrontada com os arquivos do GitHub nesse commit. Consequências:

- o diagnóstico é reprodutível pelo SHA;
- nenhum arquivo do SC1 foi criado ou alterado;
- o schema foi reconstruído pelas migrations e pelo runtime, mas o estado efetivo de um banco SC1 implantado não foi consultado;
- valores reais de produção, distribuição de nulos e tipos reais de movimento não foram inferidos sem evidência.

### 3.2 Fontes principais

- [Criação do Estoque](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/supabase/migrations/001_create_estoque.sql)
- [Criação de Aquisições](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/supabase/migrations/002_create_aquisicoes.sql)
- [Criação de Liquidações](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/supabase/migrations/003_create_liquidacoes.sql)
- [Alteração final da precisão numérica](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/supabase/migrations/004_fix_numeric_precision.sql)
- [Índices adicionais de Estoque](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/supabase/migrations/026_estoque_search_indexes.sql)
- [Tracking de execuções](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/supabase/migrations/027_sinqia_report_runs.sql)
- [Parser CSV](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/src/lib/sinqia/csv-parser.ts)
- [Persistência/UPSERT](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/src/lib/sinqia/importar.ts)
- [Cliente de relatórios Sinqia](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/src/lib/sinqia/relatorios.ts)
- [Orquestração de relatório](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/src/lib/sinqia/executar.ts)
- [Cron Sinqia](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/src/app/api/cron/sinqia/route.ts)
- [Configuração do cron](https://github.com/bwasset/sc1-order-processing-plataform/blob/cba0c1c52dc1ad427d9ade8793452d7aca9a3164/vercel.json)

## 4. Cadeia de migrations relevante

| Migration | Efeito final relevante |
|---|---|
| `001_create_estoque.sql` | Cria `estoque`, chave `(seu_numero, data_referencia)`, índices e RLS permissiva de leitura. |
| `002_create_aquisicoes.sql` | Cria `aquisicoes`, `UNIQUE(id_recebivel)`, índices e RLS permissiva de leitura. |
| `003_create_liquidacoes.sql` | Cria `liquidacoes`, chave `(id_recebivel, data_movimento, id_tipo_movimento)`, índices e RLS permissiva de leitura. |
| `004_fix_numeric_precision.sql` | Converte todos os campos financeiros/taxas das três bases para `NUMERIC` sem precisão/escala declarada. Este é o tipo efetivo final. |
| `013_manual_sinqia_imports.sql` | Cria sessões temporárias e histórico da importação manual. |
| `026_estoque_search_indexes.sql` | Adiciona índices compostos e RPC global de datas de referência. |
| `027_sinqia_report_runs.sql` | Cria tracking agregado de execuções automáticas/manuais. |
| `037_manual_sinqia_import_rows.sql` | Move linhas validadas para tabela paginável por sessão. |

Outras migrations consomem essas bases em funcionalidades operacionais, mas a busca da cadeia não encontrou alteração posterior de colunas, chaves ou constraints das três tabelas além da precisão em `004` e dos índices/RPC em `026`.

## 5. Schema efetivo — Estoque

Legenda de classificação: **ESSENCIAL** para conciliação/exposição; **ÚTIL** para auditoria ou investigação; **LEGADO** específico do SC1/layout sem uso comprovado no BW; **INCERTO** sem semântica suficiente.

| Campo | Tipo efetivo | Nulo/default | Origem CSV | Significado e uso no runtime | Classe BW |
|---|---|---|---|---|---|
| `id` | `uuid` | não; `gen_random_uuid()` | sistema | PK técnica; não vem do arquivo | ÚTIL |
| `nome_fundo` | `text` | não | `NOME_FUNDO` | nome do fundo no relatório | ÚTIL |
| `doc_fundo` | `text` | não | `DOC_FUNDO` | CNPJ textual do fundo | ESSENCIAL |
| `data_fundo` | `date` | sim | `DATA_FUNDO` | data associada ao fundo; sem uso funcional encontrado | INCERTO |
| `nome_originador` | `text` | sim | `NOME_ORIGINADOR` | identificação descritiva do originador | ÚTIL |
| `doc_originador` | `text` | sim | `DOC_ORIGINADOR` | documento do originador | ÚTIL |
| `nome_cedente` | `text` | sim | `NOME_CEDENTE` | descrição do cedente | ÚTIL |
| `doc_cedente` | `text` | sim | `DOC_CEDENTE` | CPF/CNPJ do cedente; indexado | ESSENCIAL |
| `nome_sacado` | `text` | sim | `NOME_SACADO` | descrição do sacado | ÚTIL |
| `doc_sacado` | `text` | sim | `DOC_SACADO` | CPF/CNPJ do sacado; indexado | ESSENCIAL |
| `seu_numero` | `text` | não | `SEU_NUMERO` | identificador do título no portal Sinqia; parte da chave natural | ESSENCIAL |
| `nu_documento` | `text` | sim | `NU_DOCUMENTO` | número documental não tipado; não é provado como NF | ÚTIL/INCERTO |
| `tipo_recebivel` | `text` | sim | `TIPO_RECEBIVEL` | tipo textual do recebível | ESSENCIAL |
| `ds_nosso_numero` | `text` | sim | `DS_NOSSO_NUMERO` | identificador bancário/administrador | ÚTIL |
| `chave_nfe` | `text` | sim | `CHAVE_NFE` | chave NF-e; melhor ponte direta para a NF BW | ESSENCIAL |
| `id_lote` | `text` | sim | `ID LOTE` | lote externo | ÚTIL |
| `id_operacao_banco` | `text` | sim | `ID_OPERACAO_BANCO` | operação externa/bancária | ÚTIL |
| `valor_nominal` | `numeric` | sim | `VALOR_NOMINAL` | valor de face no snapshot | ESSENCIAL |
| `valor_presente` | `numeric` | sim | `VALOR_PRESENTE` | valor presente no snapshot | ESSENCIAL |
| `valor_aquisicao` | `numeric` | sim | `VALOR_AQUISICAO` | custo/valor de aquisição carregado na posição | ESSENCIAL |
| `valor_pdd` | `numeric` | sim | `VALOR_PDD` | provisão no snapshot | ÚTIL |
| `faixa_pdd` | `text` | sim | `FAIXA_PDD` | classificação textual de PDD | ÚTIL |
| `taxa_cessao` | `numeric` | sim | `TAXA_CESSAO` | taxa mensal de cessão segundo comentário | ÚTIL |
| `tx_recebivel` | `numeric` | sim | `TX_RECEBIVEL` | taxa implícita do recebível | ÚTIL |
| `data_referencia` | `date` | não | `DATA_REFERENCIA` | data do snapshot; parte da chave natural | ESSENCIAL |
| `data_vencimento_original` | `date` | sim | `DATA_VENCIMENTO_ORIGINAL` | vencimento original | ESSENCIAL |
| `data_vencimento_ajustada` | `date` | sim | `DATA_VENCIMENTO_AJUSTADA` | vencimento ajustado | ÚTIL |
| `data_emissao` | `date` | sim | `DATA_EMISSAO` | emissão do título/documento | ÚTIL |
| `data_aquisicao` | `date` | sim | `DATA_AQUISICAO` | aquisição informada no snapshot | ESSENCIAL |
| `prazo` | `integer` | sim | `PRAZO` | prazo informado; derivável/sem regra encontrada | LEGADO |
| `prazo_atual` | `integer` | sim | `PRAZO_ATUAL` | prazo corrente informado pela fonte | LEGADO/INCERTO |
| `situacao_recebivel` | `text` | sim | `SITUACAO_RECEBIVEL` | situação da posição; livre, sem catálogo | ESSENCIAL |
| `coobrigacao` | `text` | sim | `COOBRIGACAO` | coobrigação textual | ÚTIL |
| `num_contrato_c3` | `text` | sim | `NUM_CONTRATO_C3` | identificador C3 | LEGADO/INCERTO |
| `num_parcela_c3` | `text` | sim | `NUM_PARCELA_C3` | parcela C3 | LEGADO/INCERTO |
| `qtd_parcelas_cbb` | `integer` | sim | `QTD_PARCELAS_CBB` | quantidade de parcelas CBB | LEGADO/INCERTO |
| `taxa_contrato` | `numeric` | sim | `TAXA_CONTRATO` | taxa de contrato | ÚTIL/INCERTO |
| `ltv` | `numeric` | sim | `LTV` | LTV da fonte | ÚTIL/INCERTO |
| `agio` | `numeric` | sim | `AGIO` | ágio da fonte | ÚTIL/INCERTO |
| `arquivo_origem` | `text` | sim | nome do arquivo | rastreabilidade mínima do arquivo | ESSENCIAL, renomear/relacionar |
| `importado_em` | `timestamptz` | não; `now()` | sistema | instante da persistência | ESSENCIAL |

Todos os campos de origem acima são efetivamente mapeados pelo parser; `id` e `importado_em` são preenchidos pelo banco.

### 5.1 Chaves, constraints e índices

- PK: `id`.
- Chave de conflito/unique: `(seu_numero, data_referencia)`.
- Índices simples: referência, documento do cedente, documento do sacado, tipo, situação, número do documento, lote parcial e importação.
- Índices compostos: `(data_referencia, doc_cedente)`, `(data_referencia, situacao_recebivel)`, `(data_referencia, nu_documento)`, `(data_referencia, seu_numero)`, `(data_referencia, data_vencimento_original)`, `(data_referencia, nome_sacado)` e `(data_referencia, nome_cedente)`.
- RPC `get_estoque_referencias()` é `SECURITY DEFINER`, retorna todas as datas globais e pode ser executada por `authenticated` e `service_role`.

### 5.2 Snapshot versus estado atual

O próprio comentário da migration define a tabela como snapshot D-1. A chave contém `data_referencia`, e a importação atualiza apenas o mesmo título na mesma referência. Logo:

- D-1, D-2, D-3 e outras referências coexistem;
- um título ausente em D-1 não é apagado de D-2;
- a ausência no snapshot seguinte pode indicar saída da posição corrente, mas o SC1 não registra explicitamente o motivo;
- o importador não marca o arquivo como fotografia completa e não remove linhas antigas da mesma referência que tenham desaparecido numa retificação.

### 5.3 UPSERT e riscos da chave

O importador deduplica em memória por `seu_numero + data_referencia`, mantendo a última ocorrência, e executa `UPSERT ... DO UPDATE` em lotes de 1.000.

Riscos:

- dois fundos com o mesmo `seu_numero` e data colidem;
- dois cedentes com numeração não global podem colidir;
- reenviar um snapshot atualiza linhas presentes, mas não remove linhas que deixaram de existir no arquivo retificado;
- sem `importacao_id`, não há como reconstruir qual versão de arquivo formou a fotografia;
- a chave é aceitável somente se a Sinqia garantir `seu_numero` global no escopo do CNPJ do fundo configurado — garantia não encontrada no código.

## 6. Schema efetivo — Aquisições

| Campo | Tipo efetivo | Nulo/default | Origem CSV | Significado e uso no runtime | Classe BW |
|---|---|---|---|---|---|
| `id` | `uuid` | não; `gen_random_uuid()` | sistema | PK técnica | ÚTIL |
| `id_fundo` | `integer` | sim | `ID_FUNDO` | ID interno Sinqia | ÚTIL/INCERTO |
| `fundo` | `text` | não | `FUNDO` | nome textual do fundo | ÚTIL |
| `id_cedente` | `integer` | sim | `ID_CEDENTE` | ID interno Sinqia do cedente | ÚTIL |
| `cedente` | `text` | sim | `CEDENTE` | nome do cedente | ÚTIL |
| `cpf_cnpj_cedente` | `text` | sim | `CPF_CNPJ_CEDENTE` | documento do cedente | ESSENCIAL |
| `nome_sacado` | `text` | sim | `NOME SACADO` ou `NOME_SACADO` | nome do sacado | ÚTIL |
| `cpf_cnpj_sacado` | `text` | sim | `CPF_CNPJ SACADO` ou `CPF_CNPJ_SACADO` | documento do sacado | ESSENCIAL |
| `id_recebivel` | `bigint` | não | `ID RECEBIVEL` ou `ID_RECEBIVEL` | chave natural Sinqia | ESSENCIAL |
| `numero_documento` | `text` | sim | `NUMERO DOCUMENTO` ou `NUMERO_DOCUMENTO` | documento do título; sem prova de ser NF | ÚTIL/INCERTO |
| `seu_numero` | `text` | sim | `SEU NUMERO` ou `SEU_NUMERO` | identificador externo transversal | ESSENCIAL |
| `nosso_numero` | `text` | sim | `NOSSO NUMERO` ou `NOSSO_NUMERO` | identificador bancário | ÚTIL |
| `tipo_recebivel` | `text` | sim | `TIPO RECEBIVEL` ou `TIPO_RECEBIVEL` | tipo do ativo na fonte | ESSENCIAL |
| `id_lote` | `text` | sim | `ID LOTE` ou `ID_LOTE` | lote externo | ÚTIL |
| `id_operacao_banco` | `text` | sim | `ID OPERAÇÃO BANCO` ou `ID_OPERACAO_BANCO` | operação externa | ÚTIL |
| `coobrigacao` | `text` | sim | `COOBRIGACAO` | coobrigação textual | ÚTIL |
| `quantidade` | `integer` | sim | `QUANTIDADE` | quantidade do registro | ÚTIL/INCERTO |
| `valor_compra` | `numeric` | sim | `VALOR DE COMPRA` ou `VALOR_COMPRA` | valor pago na aquisição | ESSENCIAL |
| `valor_vencimento` | `numeric` | sim | `VALOR DE VENCIMENTO` ou `VALOR_VENCIMENTO` | valor de face no vencimento | ESSENCIAL |
| `entrada` | `date` | sim | `ENTRADA` | data de entrada no fundo | ESSENCIAL |
| `data_vencimento` | `date` | sim | `DATA VENCIMENTO` ou `DATA_VENCIMENTO` | vencimento | ESSENCIAL |
| `arquivo_origem` | `text` | sim | nome do arquivo | rastreabilidade mínima | ESSENCIAL, renomear/relacionar |
| `importado_em` | `timestamptz` | não; `now()` | sistema | instante de persistência | ESSENCIAL |

### 6.1 Chaves, índices e comportamento

- PK: `id`.
- Unique e conflito: `id_recebivel`.
- Índices: entrada, vencimento, ID/documento do cedente, documento do sacado, tipo, ID do fundo, número documental, `(entrada, cpf_cnpj_cedente)` e importação.
- O importador usa `ignoreDuplicates: true`: conflito em `id_recebivel` resulta em **DO NOTHING**.
- Reimportar o mesmo movimento não duplica, mas também não corrige valor ou metadados. É uma semântica first-write-wins, não um mecanismo formal de evento imutável, pois não existe hash/evidência da versão recebida.
- O código pressupõe unicidade global de `id_recebivel`; não há `fundo_id` na constraint. Essa premissa não foi comprovada fora do único CNPJ global configurado.

## 7. Schema efetivo — Liquidações

| Campo | Tipo efetivo | Nulo/default | Origem CSV | Significado e uso no runtime | Classe BW |
|---|---|---|---|---|---|
| `id` | `uuid` | não; `gen_random_uuid()` | sistema | PK técnica | ÚTIL |
| `fundo` | `text` | não | `FUNDO` | nome textual do fundo | ÚTIL |
| `identificacao_cedente` | `text` | sim | `IDENTIFICACAO_CEDENTE` | documento do cedente | ESSENCIAL |
| `cedente` | `text` | sim | `CEDENTE` | nome do cedente | ÚTIL |
| `identificacao_sacado` | `text` | sim | `IDENTIFICACAO_SACADO` | documento do sacado | ESSENCIAL |
| `sacado` | `text` | sim | `SACADO` | nome do sacado | ÚTIL |
| `id_recebivel` | `bigint` | não | `ID_RECEBIVEL` | chave do recebível Sinqia | ESSENCIAL |
| `documento` | `text` | sim | `DOCUMENTO` | documento do título; sem prova de ser NF | ÚTIL/INCERTO |
| `seu_numero` | `text` | sim | `SEU_NUMERO` | identificador externo transversal | ESSENCIAL |
| `numero_correspondente` | `text` | sim | `NUMERO_CORRESPONDENTE` | correspondência externa sem semântica documentada | INCERTO |
| `ds_nosso_numero` | `text` | sim | `DS_NOSSO_NUMERO` | identificador bancário | ÚTIL |
| `tipo_recebivel` | `text` | sim | `TIPO_RECEBIVEL` | tipo do recebível | ESSENCIAL |
| `id_lote` | `text` | sim | `ID_LOTE` | lote externo | ÚTIL |
| `id_operacao_banco` | `text` | sim | `ID_OPERACAO_BANCO` | operação externa | ÚTIL |
| `tipo_movimento` | `text` | sim | `TIPO_MOVIMENTO` | descrição livre do movimento | ESSENCIAL |
| `id_tipo_movimento` | `integer` | sim no banco; obrigatório no parser | `ID_TIPO_MOVIMENTO` | código Sinqia e parte da chave | ESSENCIAL |
| `st_recebivel` | `text` | sim | `ST_RECEBIVEL` | situação do recebível na movimentação | ESSENCIAL |
| `ds_risco_atraso` | `text` | sim | `DS_RISCO_ATRASO` | faixa/descrição de atraso | ÚTIL |
| `data_movimento` | `date` | não | `DATA_MOVIMENTO` | data do evento de saída | ESSENCIAL |
| `data_aquisicao` | `date` | sim | `DATA_AQUISICAO` | data de aquisição carregada na baixa | ÚTIL |
| `data_vencimento` | `date` | sim | `DATA_VENCIMENTO` | vencimento | ESSENCIAL |
| `tx_aquisicao` | `numeric` | sim | `TX_AQUISICAO` | taxa da aquisição | ÚTIL |
| `vl_aquisicao` | `numeric` | sim | `VL_AQUISICAO` | valor pago na aquisição, copiado no evento | ESSENCIAL |
| `valor_vencimento` | `numeric` | sim | `VALOR_VENCIMENTO` | valor de face no vencimento | ÚTIL |
| `vl_presente` | `numeric` | sim | `VL_PRESENTE` | valor presente no movimento | ÚTIL |
| `valor_pago` | `numeric` | sim | `VALOR_PAGO` | valor efetivamente pago | ESSENCIAL |
| `ajuste` | `numeric` | sim | `AJUSTE` | ajuste financeiro da fonte | ÚTIL |
| `valor_nominal` | `numeric` | sim | `VALOR_NOMINAL` | valor nominal | ÚTIL |
| `valor_presente` | `numeric` | sim | `VALOR_PRESENTE` | segundo campo de valor presente do layout | ÚTIL/INCERTO |
| `juros` | `numeric` | sim | `JUROS` | juros no evento | ÚTIL |
| `arquivo_origem` | `text` | sim | nome do arquivo | rastreabilidade mínima | ESSENCIAL, renomear/relacionar |
| `importado_em` | `timestamptz` | não; `now()` | sistema | instante de persistência | ESSENCIAL |

### 7.1 Chaves, índices e comportamento

- PK: `id`.
- Unique/conflito: `(id_recebivel, data_movimento, id_tipo_movimento)`.
- Índices: data, recebível, documentos de cedente/sacado, tipo/código de movimento, situação, tipo do recebível, documento, `(data_movimento, identificacao_cedente)`, `(data_movimento, id_tipo_movimento)` e importação.
- O importador deduplica pela chave e faz `DO UPDATE`, mantendo a última ocorrência do arquivo/lote.
- Embora `id_tipo_movimento` seja anulável no DDL, o parser descarta a linha quando esse campo é nulo. A execução normal evita o problema de `NULL` não colidir em `UNIQUE` PostgreSQL.

### 7.2 Tipos de movimento e liquidação parcial

Evidência encontrada:

- o cliente de relatório aceita `BAIXA` e `LIQUIDACAO` como parâmetros de solicitação;
- o fluxo automático de Liquidações solicita somente `BAIXA`;
- o seed local contém apenas `id_tipo_movimento = 1`, `tipo_movimento = 'BAIXA POR DEPOSITO SACADO'` e `st_recebivel = 'LIQUIDADO'`;
- não existe constraint/catalogação de descrições no banco.

Portanto, não é possível classificar com segurança recompra, substituição, ajuste, baixa parcial ou outros códigos. O texto livre não deve decidir sozinho se a exposição foi encerrada.

Liquidação parcial: a tabela possui `valor_pago` e aceita movimentos em datas/tipos distintos, mas não possui saldo, sequência do movimento, identificador externo do evento nem indicador de parcialidade. Dois pagamentos do mesmo `id_recebivel`, no mesmo dia e com o mesmo `id_tipo_movimento`, colidem e o último sobrescreve o anterior. Assim:

- existência funcional: **não comprovada**;
- identificação confiável: **não existe**;
- permanência no estoque: só pode ser observada pelo snapshot seguinte, não pela liquidação isolada;
- saldo: **nenhum campo representa saldo de forma explícita**.

## 8. Relação entre as três bases e identificadores

| Conceito | Estoque | Aquisições | Liquidações | Força como ponte |
|---|---|---|---|---|
| Fundo | `doc_fundo`, `nome_fundo` | `id_fundo`, `fundo` | `fundo` | Média; nomes são frágeis e os identificadores não são homogêneos |
| ID do recebível | inexistente | `id_recebivel` | `id_recebivel` | Forte entre aquisição e liquidação; ausente no estoque |
| Seu número | `seu_numero` obrigatório | `seu_numero` opcional | `seu_numero` opcional | Média/forte quando presente e validado dentro do fundo |
| Documento | `nu_documento` | `numero_documento` | `documento` | Média/ambígua; sem semântica fiscal comprovada |
| Nosso número | `ds_nosso_numero` | `nosso_numero` | `ds_nosso_numero` | Média; não há garantia de unicidade |
| Chave NF-e | `chave_nfe` | inexistente | inexistente | Forte para ligar Estoque à NF BW, não liga diretamente movimentos |
| Lote | `id_lote` | `id_lote` | `id_lote` | Média; um lote pode conter vários títulos |
| Operação externa | `id_operacao_banco` | `id_operacao_banco` | `id_operacao_banco` | Média; cardinalidade não comprovada |
| Tipo | `tipo_recebivel` | `tipo_recebivel` | `tipo_recebivel` | Apenas discriminador auxiliar |
| Cedente | `doc_cedente` | `cpf_cnpj_cedente` | `identificacao_cedente` | Forte como componente, não como chave isolada |
| Sacado | `doc_sacado` | `cpf_cnpj_sacado` | `identificacao_sacado` | Forte como componente, não como chave isolada |
| Valor de aquisição | `valor_aquisicao` | `valor_compra` | `vl_aquisicao` | Conceito provavelmente relacionado; igualdade não comprovada |
| Vencimento | original/ajustado | `data_vencimento` | `data_vencimento` | Componente útil de conciliação |

### 8.1 Identificador principal recomendado

Não existe uma única chave forte presente nas três bases. A recomendação é preservar os dois identificadores externos e resolver em camadas:

1. `id_recebivel`, como **MATCH_FORTE** entre Aquisições e Liquidações, sempre escopado por `fundo_id` e provedor;
2. `seu_numero`, como **MATCH_FORTE** transversal somente após validar completude, estabilidade e unicidade por fundo em um golden dataset real;
3. `chave_nfe`, como **MATCH_FORTE** entre Estoque e `notas_fiscais.chave_acesso` do BW;
4. composição determinística com fundo, documentos do cedente/sacado, documento canônico, vencimento, tipo e valor, como **MATCH_DETERMINISTICO_COMPOSTO**;
5. `nu_documento`/número da NF isolado, como **AMBIGUO**;
6. qualquer caso que não satisfaça uma regra explícita deve permanecer **NAO_CONCILIADO**, sujeito a revisão manual.

### 8.2 Semântica dos campos críticos

`seu_numero`:

- o comentário do DDL o chama de identificador do título no portal Sinqia;
- é a chave obrigatória do Estoque, mas opcional nas outras bases;
- o código não informa quem o gera nem garante estabilidade entre relatórios;
- no BW atual, o CNAB 444 gera `seuNumero` deterministicamente a partir de cedente, CNPJ, NF, data de cessão e sufixo. Isso não prova equivalência com registros históricos Sinqia; para novas remessas, o valor gerado deve ser persistido como crosswalk antes de ser usado no matching.

`id_recebivel`:

- é identificado no DDL como ID único do recebível Sinqia;
- existe em Aquisições e Liquidações, não no Estoque;
- é armazenado como `BIGINT`, mas o parser o converte para `number` JavaScript, podendo perder precisão acima de `Number.MAX_SAFE_INTEGER`;
- no BW futuro deve ser preservado como texto canônico, não convertido para número.

`nu_documento`/`numero_documento`/`documento`:

- os nomes são semelhantes, mas não existe comentário ou validação que os defina como número de NF;
- não há série fiscal associada;
- podem representar título, duplicata, boleto ou documento do cedente;
- só devem ser usados como evidência auxiliar até validação com arquivos reais.

### 8.3 Relação com a Nota Fiscal BW

O BW já possui `notas_fiscais.chave_acesso` única, número, série, emitente, destinatário e contexto `cedente_fundo_id`/`fundo_id`. A ponte de maior qualidade é:

```text
estoque.chave_nfe normalizada (44 dígitos)
  = notas_fiscais.chave_acesso
  + mesmo fundo
```

Quando `chave_nfe` não existir, o matching deve ser composto. Número da NF isolado não é seguro entre cedentes, séries e fundos. O BW não possui hoje `id_recebivel` nem crosswalk financeiro persistente. A Duplicata P2.0 é relacionada à NF e não substitui esse crosswalk.

## 9. Valores, precisão e datas

### 9.1 Valor de aquisição

| Base | Campo | Natureza observada |
|---|---|---|
| Estoque | `valor_aquisicao` | custo carregado no snapshot diário |
| Aquisições | `valor_compra` | valor pago no evento de entrada |
| Liquidações | `vl_aquisicao` | valor de aquisição repetido no evento de saída |

Os três campos parecem representar o mesmo conceito econômico em momentos distintos, mas o código não compara nem garante igualdade. Para a regra futura dos 40%:

- fonte corrente preferencial: `estoque.valor_aquisicao` do snapshot D-1, pois mede a exposição efetivamente presente;
- evidência/origem: `aquisicoes.valor_compra`;
- conferência na saída: `liquidacoes.vl_aquisicao`;
- divergências devem ser conciliadas e registradas, não sobrescritas silenciosamente.

### 9.2 Precisão monetária

A migration inicial usava escalas explícitas (`18,4`, `20,10`, `18,6`), mas a migration `004` converteu todos os campos financeiros e taxas para `NUMERIC` sem `p,s`. Esse é o estado efetivo final. Não há `double precision` no schema das três bases.

O parser, contudo, converte valores para `number` por `parseFloat` antes do envio ao banco. Portanto, a precisão arbitrária do PostgreSQL não é preservada ponta a ponta. No BW recomenda-se:

- manter o valor textual bruto;
- converter com biblioteca decimal ou normalizador textual validado;
- persistir monetários com escala definida, por exemplo `numeric(20,4)`, e taxas com escala maior;
- colocar overflow ou formato ambíguo em quarentena, em vez de ampliar silenciosamente a precisão.

### 9.3 Datas

| Conceito | Campos | Tipo |
|---|---|---|
| Snapshot | `estoque.data_referencia` | `date`, obrigatório |
| Fundo | `estoque.data_fundo` | `date` |
| Aquisição | `estoque.data_aquisicao`, `aquisicoes.entrada`, `liquidacoes.data_aquisicao` | `date` |
| Movimento | `liquidacoes.data_movimento` | `date`, obrigatório |
| Vencimento | original/ajustado ou `data_vencimento` | `date` |
| Emissão | `estoque.data_emissao` | `date` |
| Importação | `importado_em` | `timestamptz`, `now()` |

O parser espera `DD/MM/YYYY` e apenas reordena os segmentos. Não valida se a data existe no calendário; valores como `31/02/2026` podem chegar ao banco e falhar no lote inteiro.

## 10. Arquivos, parsers e importação

### 10.1 Relatórios e formatos

| Base | Solicitação Sinqia | Parâmetro | Entrega observada |
|---|---|---|---|
| Estoque | `agendadorRelatorioEstoque` | CNPJ global + data de referência | ZIP/MTOM contendo CSV |
| Aquisições | `agendadorRelatorioAquisicaoLiquidados` | `tipoRelatorio=1`, período | ZIP/MTOM contendo CSV |
| Liquidações | `agendadorRelatorioAquisicaoLiquidados` | `tipoRelatorio=2`, `tipoMovimento=BAIXA`, período | ZIP/MTOM contendo CSV |

O cliente:

1. autentica por usuário/senha em headers SOAP próprios;
2. agenda o relatório;
3. consulta o status a cada 5 segundos, por até 120 segundos;
4. baixa a resposta MTOM;
5. extrai o ZIP em memória;
6. detecta o tipo pelo header do CSV;
7. parseia e persiste em lotes.

As credenciais e o CNPJ são globais por ambiente (`SINQIA_*`). O diagnóstico não expõe valores. O formato esperado é CSV `latin1`/Windows-1252, delimitado por `;`, cabeçalho na primeira linha, decimais brasileiros e datas `DD/MM/YYYY`.

### 10.2 Parser comum

Arquivo: `src/lib/sinqia/csv-parser.ts`.

| Base | Detecção | Campos mínimos para aceitar linha | Aliases |
|---|---|---|---|
| Estoque | header contém `SEU_NUMERO` e `DATA_REFERENCIA` | ambos presentes e data parseável | praticamente nenhum; `ID LOTE` contém espaço |
| Aquisições | header contém `ID_FUNDO` e `ENTRADA` | `ID_RECEBIVEL` parseado e diferente de zero | aceita variantes com espaço/underscore em vários campos |
| Liquidações | header contém `DATA_MOVIMENTO` e `TIPO_MOVIMENTO` | `ID_RECEBIVEL`, data e `ID_TIPO_MOVIMENTO` | praticamente nenhum |

Normalizações:

- strings vazias viram `null`, exceto campos obrigatórios textuais de fundo, que podem virar `''`;
- números removem todos os pontos e trocam vírgula por ponto;
- inteiros usam `parseInt`;
- linhas vazias são removidas;
- linhas inválidas nos campos mínimos são descartadas, sem erro individual persistido no fluxo automático.

### 10.3 Robustez

Classificação: **REUTILIZÁVEL COM AJUSTES**, com risco médio-alto se o layout variar.

Fragilidades comprovadas:

- `line.split(';')` não suporta delimitador dentro de campo entre aspas;
- não suporta quebras de linha dentro de campo;
- não valida quantidade de colunas;
- não normaliza BOM/cabeçalhos de modo geral;
- número `1,000.00` seria interpretado incorretamente;
- CNPJ/CPF são mantidos como texto sem normalização/validação;
- datas são apenas rearranjadas;
- `BIGINT` passa por `number` JavaScript;
- linha inválida pode desaparecer silenciosamente;
- não existe versão explícita do layout;
- os aliases são assimétricos entre relatórios.

Recomendação: reutilizar o mapeamento semântico e os nomes aceitos como ponto de partida, mas substituir o tokenizer, validar schema/versionamento, preservar valores brutos e produzir erros por linha.

### 10.4 Persistência e idempotência

`src/lib/sinqia/importar.ts`:

- lote de 1.000;
- deduplicação global prévia por chave, com última linha vencendo;
- Estoque: `DO UPDATE` em `(seu_numero,data_referencia)`;
- Aquisições: `DO NOTHING` em `id_recebivel`;
- Liquidações: `DO UPDATE` na chave tripla;
- falha de um lote contabiliza todas as linhas do lote como erro, mas os lotes seguintes continuam;
- não existe transação envolvendo todo o arquivo ou ZIP;
- `upserted` conta o tamanho do lote sem verificar linhas realmente inseridas; em Aquisições, conflitos ignorados podem ser reportados como salvos;
- ZIP sem CSV reconhecido pode produzir lista vazia e ainda retornar `ok: true` no orquestrador.

Conclusão por base:

| Base | Reexecução idempotente? | Retificação confiável? |
|---|---|---|
| Estoque | Parcialmente, por linha e data | Atualiza linhas presentes; não remove linha ausente da nova versão do snapshot |
| Aquisições | Evita duplicata | Não; primeira versão vence e correção posterior é ignorada |
| Liquidações | Parcialmente, pela chave tripla | Atualiza a chave existente; perde eventos repetidos de mesmo tipo/dia |

Não existe idempotência por arquivo, hash, report ID ou execução.

## 11. Importação manual

O fallback manual reutiliza exatamente os mesmos parsers e UPSERTs. O fluxo é:

```text
upload CSV/ZIP
  → validação e preview
  → sessão temporária (1 hora)
  → linhas validadas em JSONB por sessão
  → confirmação
  → UPSERT nas bases
  → histórico permanente
```

Controles positivos:

- valida extensão, tamanho, assinatura/CRC de ZIP, quantidade de entradas e path traversal;
- exige uma única entrada CSV válida;
- guarda payload no servidor entre validação e confirmação;
- pagina as linhas validadas;
- associa sessão ao usuário e expiração.

Limitações:

- não há lock/transação que torne confirmação concorrente inequivocamente única;
- o status TypeScript admite `PARTIAL`, mas o código grava `IMPORTED` quando houve alguma linha salva e outras falharam;
- falhas ao atualizar o próprio histórico não são verificadas em todas as operações;
- para Aquisições/Liquidações com período, `reference_date` é inferida como uma data representativa e não substitui a granularidade das linhas;
- RLS do histórico usa `raw_user_meta_data.role`, padrão que não deve ser copiado.

## 12. Cron, ordem, dias sem movimento e disponibilidade

### 12.1 Agenda efetiva

- expressão: `30 12 * * 1-5`;
- Vercel Cron usa UTC: 12:30 UTC corresponde a 09:30 em São Paulo quando UTC-3;
- comentário da rota: 08:00 BRT — **divergente da configuração**;
- duração máxima da rota: 300 segundos;
- cada relatório pode aguardar até 120 segundos, de forma sequencial. Três relatórios podem exceder 300 segundos antes de considerar download/importação.

### 12.2 Ordem

```text
1. ESTOQUE
2. AQUISIÇÕES
3. LIQUIDAÇÕES
```

Não há dependência transacional entre eles. Falha retornada pelo Estoque não impede as chamadas seguintes; o resultado geral é a conjunção dos três `ok`.

### 12.3 Data operacional

O D-1 é calculado por calendário local “ANBIMA”, com fins de semana, feriados fixos e móveis. O conjunto fixo analisado não inclui 20 de novembro e não representa necessariamente todas as datas de não funcionamento de mercado. Além disso, `isDateAllowed` documenta rejeitar fins de semana/feriados, mas implementa apenas `data <= último dia útil`; uma data antiga não útil pode ser aceita manualmente.

### 12.4 Dias sem movimento

Pelo código, um CSV reconhecido com zero linhas válidas retorna sucesso com zero importações. Não há distinção entre:

- dia legitimamente sem aquisição/liquidação;
- arquivo vazio;
- layout alterado que descartou todas as linhas;
- ZIP sem relatório reconhecido.

Logo, “zero movimentos” não é comprovado por uma declaração da fonte. O BW deve exigir status explícito do relatório/arquivo (`COMPLETO_VAZIO`, `COMPLETO_COM_DADOS`, `FALHO/INCOMPLETO`).

### 12.5 Estoque obrigatório

`availability.ts` considera disponível o D-1 se existir pelo menos uma linha global para a data. Não verifica fundo, completude, quantidade esperada nem checksum. Não há retry do ciclo após falha; existe apenas polling durante a geração e nova execução externa/manual.

## 13. Tracking de execução e retificação

`sinqia_report_runs` possui:

| Campo | Finalidade |
|---|---|
| `id` | UUID da execução |
| `report_type` | `ESTOQUE`, `AQUISICAO` ou `LIQUIDACAO` |
| `reference_date` | data-base |
| `status` | `RUNNING`, `SUCCESS`, `FAILED` |
| `trigger_type` | `CRON` ou `MANUAL` |
| `started_at`, `finished_at`, `created_at` | timestamps |
| `records_processed` | contador agregado |
| `error_message` | último erro agregado |
| `executed_by` | origem/ator textual |

O conceito é útil, mas insuficiente para BW. Faltam `fundo_id`, arquivo/report ID, hash, contadores lidos/válidos/inseridos/atualizados/ignorados, completude, versão do layout, correlação, tentativa, predecessora/retificação e reconciliação.

Não há retificação formal. Reenvio:

- Estoque e Liquidações sobrescrevem a linha com mesma chave;
- Aquisições ignoram a correção;
- dados anteriores sobrescritos não ficam versionados;
- arquivo e resultado não têm hash;
- uma execução duplicada é permitida porque não existe unique por relatório/data/fundo.

## 14. Segurança e RLS do SC1 — LEGADO, NÃO REUTILIZAR

| Achado | Avaliação para BW |
|---|---|
| `SELECT USING (true)` em Estoque, Aquisições e Liquidações para `authenticated` | Crítico: qualquer autenticado lê todos os dados financeiros |
| `service_role` para importação e busca | Aceitável somente em backend fechado; exige autorização anterior e escopo por fundo |
| `SINQIA_CNPJ_FUNDO` global | Incompatível com multifundo |
| histórico manual consulta `auth.users.raw_user_meta_data.role` | Não copiar; metadata mutável não deve ser autoridade |
| RPC global `SECURITY DEFINER` de referências | Deve validar fundo e permissões |
| rotas que usam cliente admin para busca | Devem aplicar autorização de fundo antes da consulta |
| stream manual sem checagem de role na própria rota | Falta de defesa em profundidade |
| tracking sem RLS no DDL original | Exposição depende de configuração externa/seed local; não copiar |
| endpoints de debug escrevem artefatos no filesystem | Risco de dados sensíveis; não levar a produção |

Padrão BW recomendado:

- `fundo_id NOT NULL` em toda linha financeira;
- política baseada em função segura de acesso ao fundo e vínculo de usuário;
- deny-by-default para usuários finais;
- ingestão somente por papel técnico/backend;
- credenciais referenciadas por integração do fundo, nunca em tabela/JSON exposto;
- autorização server-side antes de cliente administrativo;
- auditoria imutável de execução e de qualquer reconciliação manual;
- não confiar em nome, CNPJ vindo do frontend ou metadata de usuário para definir escopo.

## 15. Adaptação multifundo — manter, renomear, adicionar e não carregar

### 15.1 Regras comuns

| Ação | Elementos |
|---|---|
| MANTER | identificadores externos brutos, documentos de cedente/sacado, datas do evento/snapshot, valores, status da fonte e arquivo de origem |
| RENOMEAR | nomes inconsistentes de documentos e valores para vocabulário canônico, preservando o nome de origem em metadados |
| ADICIONAR | `fundo_id`, `tenant_id` se distinto, provedor, versão de layout, `importacao_id`, arquivo/hash, completude, payload bruto, matching, NF vinculada, auditoria e timestamps de origem |
| REMOVER DO MODELO CANÔNICO | duplicação de nome do fundo como autoridade, `prazo` derivável e dependência em metadata de usuário; manter valores brutos em staging/auditoria |
| NÃO COPIAR | RLS global, `service_role` sem autorização prévia, CNPJ único em env, chaves sem fundo, parsing por `number` e sobrescrita sem versão |

Campos classificados como LEGADO ou INCERTO não devem ser descartados na ingestão inicial. Devem permanecer no payload bruto/quarentena até que amostras oficiais provem sua inutilidade. “Remover” significa não promover ao modelo canônico, não apagar evidência de origem.

### 15.2 Arquitetura futura recomendada

```text
Integração por fundo
  ↓
Execução de importação (fundo, tipo, data, layout, status, completude)
  ↓
Arquivo de origem imutável (hash, tamanho, report ID, Storage)
  ↓
Staging validado / erros por linha
  ↓
Snapshot ou movimento canônico
  ↓
Crosswalk de identidade externa
  ↓
Conciliação financeira título a título
  ↓
Match com NF BW
  ↓
Status logístico + exposição RLX
```

Uma execução deve ser publicada atomicamente. Consultas operacionais não devem enxergar carga parcialmente persistida.

## 16. Proposta read-only de schema — Estoque BW

Nome sugerido: `rlx_estoque_posicoes`. Não é migration; é contrato conceitual.

| Campo sugerido | Tipo | Origem | Motivo |
|---|---|---|---|
| `id` | `uuid` | sistema | identidade interna imutável |
| `fundo_id` | `uuid not null` | contexto da integração | isolamento multifundo; FK `fundos` |
| `importacao_id` | `uuid not null` | execução publicada | linhagem, atomicidade e retificação |
| `provedor` | `text not null` | integração | namespace da identidade externa |
| `data_referencia` | `date not null` | `data_referencia` | chave temporal do snapshot |
| `external_title_key` | `text not null` | chave canônica resolvida | identidade dentro de fundo/provedor |
| `id_recebivel_externo` | `text null` | não existe no Estoque SC1 | adicionar somente quando a fonte/matching comprovar; nunca fabricar |
| `seu_numero` | `text not null` | `seu_numero` | ponte transversal observada |
| `nu_documento` | `text null` | `nu_documento` | evidência auxiliar, sem rotular como NF |
| `nosso_numero` | `text null` | `ds_nosso_numero` | investigação/crosswalk |
| `chave_nfe` | `text null` | `chave_nfe` | vínculo forte com a NF BW |
| `nota_fiscal_id` | `uuid null` | resultado de matching | FK BW; não inferida sem evidência |
| `tipo_recebivel` | `text null` | `tipo_recebivel` | discriminação do ativo |
| `doc_cedente` | `text null` | `doc_cedente` normalizado | conciliação e controle |
| `nome_cedente_snapshot` | `text null` | `nome_cedente` | evidência histórica |
| `doc_sacado` | `text null` | `doc_sacado` normalizado | conciliação e concentração |
| `nome_sacado_snapshot` | `text null` | `nome_sacado` | evidência histórica |
| `valor_nominal` | `numeric(20,4) null` | `valor_nominal` | face/exposição |
| `valor_aquisicao` | `numeric(20,4) null` | `valor_aquisicao` | numerador futuro de exposição logística |
| `valor_presente` | `numeric(20,4) null` | `valor_presente` | posição financeira |
| `valor_pdd` | `numeric(20,4) null` | `valor_pdd` | risco/provisão |
| `faixa_pdd` | `text null` | `faixa_pdd` | classificação da fonte |
| `taxa_cessao` | `numeric(20,10) null` | `taxa_cessao` | auditoria financeira |
| `taxa_recebivel` | `numeric(20,10) null` | `tx_recebivel` | auditoria financeira |
| `data_emissao` | `date null` | `data_emissao` | matching auxiliar |
| `data_aquisicao` | `date null` | `data_aquisicao` | entrada histórica |
| `data_vencimento_original` | `date null` | homônimo | vencimento canônico preferencial |
| `data_vencimento_ajustada` | `date null` | homônimo | regra operacional da fonte |
| `situacao_origem` | `text null` | `situacao_recebivel` | valor bruto da fonte |
| `coobrigacao_origem` | `text null` | `coobrigacao` | atributo contratual da fonte |
| `id_lote_externo` | `text null` | `id_lote` | rastreabilidade |
| `id_operacao_externa` | `text null` | `id_operacao_banco` | rastreabilidade |
| `matching_status` | enum/check | sistema | `MATCH_FORTE`, `MATCH_DETERMINISTICO_COMPOSTO`, `AMBIGUO`, `NAO_CONCILIADO` |
| `matching_metodo` | `text null` | sistema | regra e versão utilizadas |
| `payload_origem` | `jsonb not null` | linha bruta/canônica | preserva campos legados/incertos |
| `created_at` | `timestamptz not null` | sistema | auditoria |

Constraint recomendada somente após validar unicidade: `UNIQUE(fundo_id, provedor, data_referencia, external_title_key, importacao_id)`. Uma visão publicada deve selecionar a execução vigente/completa. Não apagar posições de execução anterior; substituí-las por nova publicação de snapshot.

## 17. Proposta read-only de schema — Aquisições BW

Nome sugerido: `rlx_aquisicao_movimentos`.

| Campo sugerido | Tipo | Origem | Motivo |
|---|---|---|---|
| `id` | `uuid` | sistema | evento interno |
| `fundo_id` | `uuid not null` | contexto | multifundo |
| `importacao_id` | `uuid not null` | execução | linhagem |
| `provedor` | `text not null` | integração | namespace |
| `id_recebivel_externo` | `text not null` | `id_recebivel` | evitar perda de precisão e preservar zeros |
| `seu_numero` | `text null` | `seu_numero` | ponte com estoque |
| `numero_documento` | `text null` | homônimo | evidência auxiliar |
| `nosso_numero` | `text null` | homônimo | evidência auxiliar |
| `nota_fiscal_id` | `uuid null` | matching | vínculo com NF BW |
| `cedente_id` | `uuid null` | matching | vínculo BW quando determinístico |
| `doc_cedente` | `text null` | `cpf_cnpj_cedente` | evidência e matching |
| `nome_cedente_snapshot` | `text null` | `cedente` | histórico |
| `doc_sacado` | `text null` | `cpf_cnpj_sacado` | evidência e matching |
| `nome_sacado_snapshot` | `text null` | `nome_sacado` | histórico |
| `tipo_recebivel` | `text null` | homônimo | classificação |
| `data_aquisicao` | `date not null` | `entrada` | data do movimento; tornar obrigatória após validação |
| `data_vencimento` | `date null` | homônimo | conciliação |
| `valor_aquisicao` | `numeric(20,4) null` | `valor_compra` | valor da entrada |
| `valor_vencimento` | `numeric(20,4) null` | homônimo | face |
| `quantidade` | `integer null` | homônimo | metadado da fonte |
| `coobrigacao_origem` | `text null` | `coobrigacao` | atributo da fonte |
| `id_fundo_externo` | `text null` | `id_fundo` | preservar identificador sem autoridade local |
| `id_cedente_externo` | `text null` | `id_cedente` | crosswalk |
| `id_lote_externo` | `text null` | `id_lote` | rastreabilidade |
| `id_operacao_externa` | `text null` | `id_operacao_banco` | rastreabilidade |
| `matching_status`, `matching_metodo` | controlados | sistema | conciliação explícita |
| `payload_origem` | `jsonb not null` | linha | evidência bruta |
| `created_at` | `timestamptz not null` | sistema | auditoria |

Se a Sinqia confirmar que `id_recebivel` é único e estável por fundo, a chave recomendada é `UNIQUE(fundo_id, provedor, id_recebivel_externo)`. Diferentemente do SC1, uma retificação não deve ser ignorada: deve gerar nova versão/evento de correção ou nova execução publicada, preservando o valor anterior.

## 18. Proposta read-only de schema — Liquidações BW

Nome sugerido: `rlx_liquidacao_movimentos`.

| Campo sugerido | Tipo | Origem | Motivo |
|---|---|---|---|
| `id` | `uuid` | sistema | evento interno |
| `fundo_id` | `uuid not null` | contexto | multifundo |
| `importacao_id` | `uuid not null` | execução | linhagem |
| `provedor` | `text not null` | integração | namespace |
| `id_movimento_externo` | `text null` | não existe no SC1 | usar quando o provedor disponibilizar sequência/ID real |
| `id_recebivel_externo` | `text not null` | `id_recebivel` | ponte com aquisição |
| `seu_numero` | `text null` | homônimo | ponte com estoque |
| `documento` | `text null` | homônimo | evidência auxiliar |
| `nosso_numero` | `text null` | `ds_nosso_numero` | evidência auxiliar |
| `nota_fiscal_id` | `uuid null` | matching | vínculo BW |
| `data_movimento` | `date not null` | homônimo | data do evento |
| `id_tipo_movimento_externo` | `text not null` | `id_tipo_movimento` | código sem perda de formatação |
| `tipo_movimento_origem` | `text null` | `tipo_movimento` | descrição da fonte |
| `movimento_classe` | enum/check null | regra catalogada | só preencher após mapear códigos oficiais |
| `encerra_exposicao` | `boolean null` | catálogo/versionamento | nunca inferir apenas do texto |
| `situacao_recebivel_origem` | `text null` | `st_recebivel` | estado da fonte |
| `doc_cedente`, `nome_cedente_snapshot` | texto | campos de cedente | evidência/matching |
| `doc_sacado`, `nome_sacado_snapshot` | texto | campos de sacado | evidência/matching |
| `tipo_recebivel` | `text null` | homônimo | classificação |
| `data_aquisicao` | `date null` | homônimo | conferência |
| `data_vencimento` | `date null` | homônimo | conferência |
| `valor_aquisicao` | `numeric(20,4) null` | `vl_aquisicao` | conferência do custo |
| `valor_pago` | `numeric(20,4) null` | homônimo | baixa efetiva |
| `valor_nominal` | `numeric(20,4) null` | homônimo | comparação |
| `valor_presente` | `numeric(20,4) null` | `vl_presente`/`valor_presente` | mapear distinção antes de consolidar |
| `valor_vencimento` | `numeric(20,4) null` | homônimo | comparação |
| `ajuste` | `numeric(20,4) null` | homônimo | composição financeira |
| `juros` | `numeric(20,4) null` | homônimo | composição financeira |
| `id_lote_externo`, `id_operacao_externa` | texto | campos externos | rastreabilidade |
| `matching_status`, `matching_metodo` | controlados | sistema | conciliação explícita |
| `payload_origem` | `jsonb not null` | linha | evidência bruta |
| `created_at` | `timestamptz not null` | sistema | auditoria |

Não reutilizar a unique tripla do SC1 como solução definitiva. A chave ideal é `UNIQUE(fundo_id, provedor, id_movimento_externo)`. Enquanto a fonte não fornecer ID/sequência, usar fingerprint versionado da linha como idempotency key e manter colisões em quarentena, especialmente para liquidações parciais no mesmo dia.

## 19. Carteira e Boleto/Duplicata

### 19.1 Carteira

Não foi encontrada no SC1 uma base equivalente à Carteira oficial necessária ao denominador do PL D-2 da RLX. Portanto:

```text
SC1 não fornece a Carteira/PL oficial necessária ao desenho atual do BW.
```

Nenhum schema de Carteira é proposto aqui. Ela deve ser desenhada from scratch após confirmar fonte, calendário, publicação/liberação da Administradora, versão, retificação e trilha de auditoria.

### 19.2 Boleto e Duplicata Digital

Nenhum parser financeiro foi proposto. No fluxo RLX, Boleto/Duplicata Digital continua documento de lastro/cobrança relacionado à NF. Não relacionar Estoque diretamente a boleto/duplicata sem evidência explícita do layout. A Duplicata P2.0 existente no BW não deve assumir o papel de título financeiro importado da Sinqia.

## 20. Conciliação futura

### 20.1 Hierarquia de matching

| Ordem | Regra | Resultado |
|---|---|---|
| 1 | mesmo fundo/provedor + `id_recebivel` entre Aquisição/Liquidação | `MATCH_FORTE` |
| 2 | mesmo fundo/provedor + `seu_numero`, validado único/estável no golden dataset | `MATCH_FORTE` |
| 3 | `estoque.chave_nfe` válida = `notas_fiscais.chave_acesso`, mesmo fundo | `MATCH_FORTE` |
| 4 | fundo + cedente + sacado + documento canônico + vencimento + tipo + valor | `MATCH_DETERMINISTICO_COMPOSTO` |
| 5 | número/documento isolado, nome, valor aproximado ou raiz de CNPJ | `AMBIGUO`; não vincular automaticamente |
| 6 | sem evidência suficiente | `NAO_CONCILIADO` |

Toda associação deve registrar regra, versão, evidências, instante e responsável. Matching manual não deve alterar a linha de origem; deve criar um vínculo auditável.

### 20.2 Reconciliação D-2/D-1

Para cada título:

```text
posição esperada D-1
  = posição publicada D-2
  + aquisições completas D-1
  - liquidações classificadas como encerramento/baixa D-1
```

Resultados mínimos futuros:

- `MANTIDO_CORRETO`;
- `ENTRADA_INCORPORADA`;
- `ENTRADA_NAO_INCORPORADA`;
- `SAIDA_REFLETIDA`;
- `SAIDA_NAO_REFLETIDA`;
- `LIQUIDADO_AINDA_NO_ESTOQUE`;
- `DIVERGENCIA_VALOR`;
- `NAO_CONCILIADO`;
- `BASE_INCOMPLETA`.

A equação só pode rodar quando todas as três execuções relevantes estiverem publicadas e marcadas completas. Totais agregados são controle secundário; não substituem conciliação título a título.

### 20.3 Saída da exposição e status logístico

- posição ativa vem do Estoque D-1 publicado;
- uma liquidação só encerra exposição quando o tipo oficial estiver catalogado com essa semântica e a reconciliação confirmar sua saída;
- o histórico de posição, movimentos e matching permanece;
- o status logístico vem do domínio BW da NF, não do texto da Sinqia;
- título sem NF forte permanece `INDETERMINADA` para o componente logístico, sem associação forçada.

## 21. Golden dataset recomendado para P2.1

O seed futuro deve gerar dados sintéticos por pelo menos dois fundos e cobrir:

1. título presente em D-2 e D-1 sem movimento;
2. aquisição D-1 incorporada ao Estoque D-1;
3. aquisição D-1 ausente no Estoque D-1;
4. liquidação D-1 removida do Estoque D-1;
5. liquidação D-1 ainda presente no Estoque D-1;
6. saída de estoque sem liquidação correspondente;
7. divergência entre `valor_compra`, `valor_aquisicao` e `vl_aquisicao`;
8. retificação de Estoque com título removido e valor alterado;
9. retificação de Aquisição;
10. duas liquidações do mesmo tipo/recebível/data, para provar o problema de parcialidade;
11. liquidação parcial em datas diferentes e saldo remanescente no snapshot;
12. dia sem aquisição e/ou liquidação declarado explicitamente;
13. arquivo vazio, ZIP sem CSV reconhecido e layout alterado;
14. arquivo duplicado por hash e mesma execução concorrente;
15. mesmo `seu_numero` e `id_recebivel` em fundos distintos;
16. `id_recebivel` acima de `Number.MAX_SAFE_INTEGER` e com zeros relevantes;
17. CSV com campo cotado contendo `;`, BOM, linha extra e data impossível;
18. `chave_nfe` válida, inválida, ausente e duplicada;
19. match por chave NF-e, por seu número, por composição e sem match;
20. NF `ENTREGUE`, `EM_TRANSITO` e `INDETERMINADA`;
21. operação intraday ainda não incorporada no Estoque D-1;
22. snapshot incompleto que deve bloquear a conciliação.

Campos mínimos por caso: fundo, execução/arquivo/hash, data, identificadores externos, documentos normalizados, tipo, valores, vencimento, status da fonte, chave NF-e quando aplicável, NF BW esperada, resultado de matching e resultado de conciliação esperado.

## 22. Diferenças SC1 × BW necessário

| Tema | SC1 | BW necessário | Ação futura |
|---|---|---|---|
| Tenant/fundo | CNPJ global em env; chaves sem fundo | contexto explícito por fundo e autorização | adaptar estruturalmente |
| Segurança | authenticated lê todas as bases | RLS hardened por fundo; backend técnico fechado | não copiar |
| Estoque | snapshot por data, sem publicação/completude | snapshot versionado, completo e publicado por fundo | reaproveitar conceito |
| Aquisição | first-write-wins por `id_recebivel` global | evento/correção auditável por fundo e provedor | adaptar |
| Liquidação | chave tripla, sem sequência/saldo | evento externo único, catálogo de encerramento e parcialidade | redesenhar chave |
| NF | `chave_nfe` só no Estoque | ligação explícita a `notas_fiscais` | adicionar crosswalk/matching |
| Duplicata | não é elo principal dessas bases | lastro opcional da NF RLX | manter separada |
| PL/Carteira | inexistente no escopo | Carteira oficial D-2 publicada | criar em fase própria |
| Auditoria | arquivo e timestamp; tracking agregado | execução, arquivo, hash, linha, regra e retificação imutáveis | ampliar |
| Parser | split manual e `number` JS | parser versionado, decimal/texto, validação por linha | substituir infraestrutura |
| Cron | dias úteis locais, 09:30 SP atual, sem lock | timezone explícito SP, calendário oficial, lock/retry/SLA | adaptar |
| Idempotência | por chave de linha | por execução/arquivo/evento + linha | ampliar |
| Retificação | sobrescreve/ignora | nova publicação preservando versão anterior | criar |
| Vazio | zero linhas pode virar sucesso | declaração explícita de base completa vazia | criar gate |
| Conciliação | não encontrada título a título | D-2 + entradas - saídas = D-1 | construir após ingestão |
| Status logístico | ausente | derivado do domínio NF/entrega BW | integrar sem duplicar |

## 23. Riscos e pontos não comprovados

### 23.1 Comprovados no código

- chaves naturais não incluem fundo;
- leitura global das bases para usuários autenticados;
- CNPJ do fundo global;
- `id_recebivel BIGINT` convertido para `number` JavaScript;
- parser sem suporte a CSV cotado;
- contagem de `upserted` inexata em conflitos ignorados;
- execução pode ser parcial por lote;
- Aquisição não aceita retificação;
- Estoque retificado não remove linha desaparecida;
- Liquidação perde movimento repetido do mesmo tipo no mesmo dia;
- nenhum saldo explícito de liquidação parcial;
- nenhum hash/versionamento de arquivo;
- cron sem lock/retry e com potencial de exceder `maxDuration`;
- comentário do horário divergente da expressão;
- zero linhas não distingue ausência real de falha de layout;
- disponibilidade do Estoque é global e baseada em uma única linha;
- calendário de feriados é local/incompleto em relação a um calendário oficial dinâmico;
- datas manuais antigas de fim de semana/feriado podem passar em `isDateAllowed`;
- `nu_documento` não é comprovado como NF.

### 23.2 Hipóteses que exigem amostra/documentação oficial

- unicidade e estabilidade de `seu_numero` por fundo;
- unicidade de `id_recebivel` entre fundos;
- equivalência entre os três campos de número documental;
- equivalência econômica exata entre os três valores de aquisição;
- catálogo completo de `id_tipo_movimento` e quais códigos encerram exposição;
- existência real e representação de liquidação parcial;
- cardinalidade de `id_lote` e `id_operacao_banco`;
- preenchimento/qualidade de `chave_nfe` no Estoque;
- garantia de que cada arquivo de Estoque é fotografia completa.

Essas hipóteses não podem ser convertidas em constraints ou automações sem golden files reais e confirmação do provedor/administrador.

## 24. Parecer de reaproveitamento

| Componente | Reutilização | Justificativa |
|---|---|---|
| ESTOQUE | ALTA no conceito; MÉDIA no schema | snapshot diário e campos financeiros são aderentes; chave, tenancy, completude e auditoria precisam mudar |
| AQUISIÇÕES | MÉDIA | layout e `id_recebivel` são úteis; first-write-wins e chave global não atendem retificação/multifundo |
| LIQUIDAÇÕES | MÉDIA/BAIXA | campos são ricos, mas chave e ausência de catálogo/saldo impedem afirmar encerramento e parcialidade |
| PARSER | MÉDIA/BAIXA | mapeamento é aproveitável; tokenizer, tipos e validação precisam ser substituídos |
| INTEGRAÇÃO SOAP/MTOM | MÉDIA | sequência funcional pode orientar; deve virar integração versionada por fundo e com credencial segura |
| CRON | BAIXA como implementação; MÉDIA como fluxo | ordem é útil; horário, lock, retry, timeout, calendário e completude precisam de novo desenho |
| TRACKING | MÉDIA como ponto de partida | tipos/status básicos existem; faltam fundo, arquivo, hash, completude e reconciliação |
| SEGURANÇA/RLS | BAIXA — NÃO REUTILIZAR | modelo global é incompatível com o isolamento multifundo do BW |

### 24.1 Parecer final

O SC1 prova a viabilidade operacional das três fontes e fornece um bom dicionário inicial. Ele não fornece uma fundação pronta para copiar no BW. A estratégia tecnicamente segura é:

1. preservar o layout e a semântica conhecida;
2. construir camada de ingestão multifundo com staging e publicação atômica;
3. validar identificadores e movimentos com golden dataset;
4. criar crosswalk explícito entre título externo e NF BW;
5. só então implementar a reconciliação D-2/D-1;
6. deixar Carteira/PL e regra dos 40% para fases próprias.

Antes de qualquer cálculo de exposição, os maiores bloqueadores são: falta de catálogo oficial dos movimentos, ausência de identidade comum forte nas três bases, ausência de completude/versionamento dos snapshots e segurança monofundo do legado.

## 25. Ordem recomendada das próximas fases

Sem implementação nesta etapa:

1. obter três golden files reais e anonimizados por fonte, incluindo dia vazio e retificação;
2. confirmar contrato dos identificadores e tipos de movimento com Sinqia/Administradora;
3. definir modelo de execução, arquivo, staging, erro por linha e publicação;
4. definir schemas multifundo e RLS do BW;
5. implementar parser versionado com Decimal/texto e testes de layout;
6. importar Estoque, Aquisições e Liquidações sem matching automático destrutivo;
7. implementar crosswalk/matching e fila de ambiguidades;
8. implementar reconciliação título a título e controles agregados;
9. integrar a NF e o status logístico;
10. desenhar Carteira/PL D-2;
11. implementar regra dos 40% e overlay intraday após homologação das bases.

## 26. Checklist de validação do diagnóstico

- [x] Repositório SC1 correto identificado pelo conteúdo.
- [x] Cadeia de migrations das três bases analisada.
- [x] Schema final de Estoque mapeado.
- [x] Schema final de Aquisições mapeado.
- [x] Schema final de Liquidações mapeado.
- [x] PKs, uniques, índices, UPSERTs e RLS documentados.
- [x] Snapshot versus estado atual esclarecido.
- [x] Parser, formatos, aliases e fragilidades documentados.
- [x] Integração, cron, ordem e tracking analisados.
- [x] Dias sem movimento, idempotência e retificação analisados.
- [x] Liquidação parcial explicitamente classificada como não comprovada.
- [x] Campos comuns e hierarquia de matching propostos.
- [x] Relação possível com NF BW documentada sem equiparar `nu_documento` a NF.
- [x] Valor de aquisição e precisão analisados.
- [x] Proposta multifundo read-only produzida.
- [x] Carteira e regra dos 40% não implementadas.
- [x] Segurança incompatível marcada como legado não reutilizável.
- [x] Nenhuma migration, SQL mutante, seed, banco, código ou configuração alterados.

## 27. Estado do Git e arquivos produzidos

Antes do diagnóstico, `git status --short` estava vazio na branch `homolog`.

Único arquivo criado:

```text
docs/rlx/diagnostico-sc1-bases-financeiras.md
```

A verificação final de `git status --short` mostrou somente este arquivo não rastreado. Não foi feito commit nem push.
