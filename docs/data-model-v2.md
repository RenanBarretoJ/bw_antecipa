# BW Antecipa — Data Model v2

## Status do documento

Este documento registra a decisão arquitetural e o modelo de dados proposto na Fase 1.5. Ele foi elaborado somente a partir do código versionado, do `supabase/schema.sql`, do `supabase/homolog_setup.sql`, das migrations existentes, dos tipos TypeScript atuais e das decisões funcionais aprovadas nesta fase.

Esta fase é exclusivamente de análise e desenho. O documento não cria migration, não altera schema, não modifica RLS, não adiciona dependências e não altera o fluxo atual. O código analisado está na branch `homolog`, após o commit da Fase 1.

## 1. Resumo executivo

O modelo atual do BW Antecipa é centrado em um único vínculo implícito entre cedente e fundo, representado por `cedentes.fundo_id`. O sistema já possui cadastro de fundos, mas não registra na operação qual relacionamento cedente–fundo, política ou versão de configuração foi aplicado. Também há um repositório legado de documentos de compliance (`documentos`) preso ao cedente, sem suporte suficiente para documentos de NF, CT-e, canhoto, análise por versão ou requisitos derivados de política.

A decisão desta fase é adotar uma arquitetura híbrida:

1. manter as tabelas e fluxos atuais durante a transição;
2. criar, na Fase 2, um vínculo explícito `cedente_fundos`;
3. manter política operacional no relacionamento cedente–fundo, nunca apenas no fundo;
4. separar a política lógica da versão imutável da política;
5. registrar na operação os IDs normalizados e um snapshot imutável das regras aplicadas;
6. criar um repositório documental genérico com catálogo, versões, análises e vínculos tipados por FK;
7. tratar CT-e como entidade operacional estruturada e também como documento no repositório genérico;
8. tratar canhoto como entidade própria, pois ele possui prazo, análise e efeito sobre a entrega;
9. separar estado financeiro, estado documental, estado logístico e estado de integração;
10. manter `cedentes.fundo_id` como bridge de compatibilidade até que todas as escritas utilizem `cedente_fundos`.

A escolha evita dois riscos do estado atual: especializar uma tabela nova para cada tipo documental e, no extremo oposto, introduzir um vínculo polimórfico sem integridade referencial. O repositório genérico terá uma ponte única, `documento_vinculos`, mas cada contexto será representado por uma coluna FK tipada e o banco exigirá exatamente um contexto por linha.

O modelo é suficientemente detalhado para iniciar a implementação da Fase 2, mas recomenda-se não criar migrations antes de resolver as decisões pendentes listadas na seção 20, principalmente dados do novo fundo, campos jurídicos da política, estratégia de credenciais, regras de retenção, layout CNAB e contrato das integrações externas.

## 2. Fontes e estado atual considerado

Foram analisados:

- `DOCUMENTACAO.md`, documentação técnica do estado atual;
- `docs/plano-tecnico-multifundo-fase-0.md`, plano arquitetural da Fase 0;
- `docs/technical-debt-financial-transactions.md`, mapeamento das escritas financeiras;
- `supabase/schema.sql`, schema base e RLS inicial;
- `supabase/homolog_setup.sql`, setup alternativo de homologação;
- `supabase/migrations/003_storage_buckets_env.sql` até `016_termo_quitacao.sql`;
- `supabase/migrations/20260720203009_fase1_auditoria_atores_origem.sql`, migration da Fase 1;
- `src/types/database.ts` e `src/lib/types/domain.ts`, tipos atuais;
- ações em `src/lib/actions/`;
- Route Handlers em `src/app/api/`;
- `supabase/storage.sql`, `src/lib/storage.ts` e componentes de upload/download;
- geração de documentos, CNAB e Fromtis em `src/lib/pdf/`, `src/lib/cnab/` e `src/lib/fromtis/`.

### 2.1 Modelo efetivamente existente

O schema base contém as tabelas `profiles`, `cedentes`, `documentos`, `representantes`, `contas_escrow`, `movimentos_escrow`, `fundos`, `devedores_solidarios`, `notas_fiscais`, `operacoes`, `operacoes_nfs`, `taxas_cedente`, `consultor_cedente`, `sacados`, `logs_auditoria` e `notificacoes`. Migrations posteriores acrescentam `testemunhas`, `solicitacoes_alteracao_cedente` e `cedente_acessos`, além de colunas em cedente, NF, operação e documentos.

O relacionamento atual é:

```text
cedentes.fundo_id ────────────────> fundos.id
cedentes ──< notas_fiscais
cedentes ──< operacoes ──< operacoes_nfs >── notas_fiscais
cedentes ──< documentos
cedentes ──< representantes ──< documentos
cedentes ──< contas_escrow ──< movimentos_escrow
```

O código de Fromtis lê `cedentes.fundo_id` para obter `fundos.cnpj`. A geração de CNAB utiliza valores fixos no código e dados de cedente, NF e operação. Não há na modelagem atual um registro histórico de configuração CNAB, de versão de template ou de configuração de integração utilizado em cada operação.

### 2.2 Limitações do estado atual relevantes para a Fase 1.5

- `cedentes.fundo_id` permite somente um fundo corrente e não representa histórico de vínculos.
- `documentos` é específico para compliance do cedente e possui `cedente_id` obrigatório; não é um repositório genérico para NF, operação, CT-e ou evento de entrega.
- `notas_fiscais` possui apenas `arquivo_url`, sem separação obrigatória entre XML, DANFE/PDF e Pedido de Compra.
- Não existem entidades de CT-e, canhoto, entrega, evento logístico ou prazo pós-cessão.
- `operacoes` não possui IDs da política, versão da política, snapshot ou contexto histórico.
- Os estados financeiros de NF e operação existem, mas o estado logístico não existe.
- O aceite do sacado é modelado no fluxo atual por status de NF e campos de aprovação; não existe representação explícita de aceite dispensado por política.
- Buckets privados existentes são `documentos-cedentes`, `notas-fiscais` e `contratos`. As policies são baseadas em role e pasta/CNPJ, com ajustes para `cedente_acessos` na migration 012.
- A Fase 1 corrigiu os tipos TypeScript atuais e criou autorização server-side, mas não adicionou entidades da Fase 2.
- O schema base habilita RLS em várias tabelas, mas não em todas as tabelas de negócio existentes. `fundos`, `devedores_solidarios`, `taxas_cedente` e `consultor_cedente`, por exemplo, não aparecem na lista de `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` do schema base.
- `supabase/schema.sql`, `supabase/homolog_setup.sql` e migrations são artefatos distintos. O repositório não comprova qual combinação está aplicada em cada ambiente.

## 3. Princípios de modelagem congelados

### 3.1 Compatibilidade aditiva

As primeiras migrations da Fase 2 devem adicionar tabelas e colunas. Não devem remover `cedentes.fundo_id`, `documentos`, `notas_fiscais.arquivo_url`, campos de URL da operação ou status atuais enquanto o código legado ainda os utiliza.

### 3.2 Integridade referencial acima de abstração genérica

Não será usado um vínculo baseado somente em `contexto_tipo` e `contexto_id` sem FK. Esse padrão permitiria referências para entidades inexistentes e tornaria RLS e consultas mais frágeis. Contextos suportados pelo repositório documental serão colunas FK tipadas em `documento_vinculos`.

### 3.3 Configuração usada em operação não é editável

Uma configuração pode ser desativada ou receber nova versão, mas uma versão usada por uma operação não pode ser sobrescrita ou excluída. O mesmo vale para template, configuração CNAB, configuração de integração e versão documental analisada.

### 3.4 Normalização operacional e snapshot histórico

IDs e campos usados para consulta ficam normalizados. O snapshot guarda apenas as regras e configurações efetivamente aplicadas. O snapshot não substitui as tabelas relacionais e não deve ser usado como fonte primária de filtros operacionais.

### 3.5 Estados separados

Os estados financeiro, documental, logístico e de integração não devem ser codificados em um único status. Uma transição em uma máquina não deve apagar a informação das outras.

### 3.6 Autorização em duas camadas

RLS deve limitar linhas e operações no banco. A camada server-side deve validar transições, vínculo de negócio, integridade de entidade e papel do ator. O modelo não deve depender apenas de `TO authenticated` sem predicado de ownership.

### 3.7 Dados sensíveis somente server-side

Credenciais, chaves de Storage internas, payloads de integração e segredos não devem chegar ao browser, ao snapshot, aos logs ou às respostas de API.

## 4. Decisão sobre o repositório documental

### 4.1 Opção A — tabelas especializadas

Tabelas como `documentos_notas_fiscais`, `documentos_operacoes`, `ctes` e `canhotos` tornam as constraints diretas e as consultas simples. O custo é repetir campos de arquivo, análise, versão e Storage em cada domínio. A evolução para novos documentos exigiria novas tabelas, policies e telas.

Essa abordagem é compatível com o legado atual: `documentos` já é especializado para compliance de cedente. Porém, usá-la como única estratégia faria o sistema replicar a mesma lógica para XML, DANFE, Pedido de Compra, CT-e, canhoto, termo e documentos futuros.

### 4.2 Opção B — repositório genérico

Um catálogo de tipos, requisitos, documentos, versões, vínculos e análises reduz duplicação e suporta o fluxo documental completo. Porém, uma implementação com `entidade_tipo` e `entidade_id` sem FK perde integridade referencial, complica RLS e deixa a autorização dependente de código que precisa conhecer todas as combinações possíveis.

### 4.3 Decisão — solução híbrida

A opção aprovada para a Fase 2 é híbrida:

- `documentos` continua sendo o repositório legado de compliance do cedente durante a transição;
- `documentos_repositorio` representa um documento lógico da nova arquitetura;
- `documento_versoes` representa cada arquivo físico enviado;
- `documento_tipos` define o catálogo sem depender de enum PostgreSQL para cada novo tipo;
- `documento_requisito_instancias` representa o checklist concreto de uma NF, operação ou entrega;
- `documento_analises` registra cada decisão de análise;
- `documento_vinculos` relaciona o documento a um contexto por colunas FK tipadas;
- CT-e, canhoto e entrega possuem tabelas próprias quando têm atributos, prazos ou transições próprias;
- arquivos de CT-e, canhoto e demais documentos ficam no repositório genérico, não em colunas `*_url` específicas.

Essa decisão usa o que o projeto já tem, preserva o fluxo atual e evita tanto a multiplicação de tabelas de arquivo quanto uma abstração polimórfica sem integridade.

## 5. Diagrama textual do modelo alvo

```text
cedentes
  ├──< cedente_fundos >── fundos
  │       └──< politicas_operacionais
  │               └──< politica_operacional_versoes
  │                       └──< politica_requisitos_documentais
  │
  ├──< documentos_repositorio
  │       ├──< documento_versoes
  │       │       └──< documento_analises
  │       ├──< documento_vinculos >── cedentes / representantes / notas_fiscais
  │       │                         / operacoes / fundos / ctes / eventos_entrega
  │       └──< documento_requisito_instancias
  │
  ├──< notas_fiscais
  │       └──< operacoes_nfs >── operacoes
  │                              ├── contexto cedente_fundo + politica versão + snapshot
  │                              └──< nota_fiscal_entregas
  │                                      ├──< eventos_entrega
  │                                      └──< canhotos
  │
  ├──< ctes >──< cte_notas_fiscais >── notas_fiscais
  │
  └── legado: documentos, contas_escrow, movimentos_escrow, taxas_cedente,
              consultor_cedente, cedente_acessos

fundos
  ├──< templates_documentos ──< template_versoes
  ├──< configuracoes_cnab ──< configuracao_cnab_versoes ──< remessas_cnab
  └──< integracoes ──< integracao_configuracoes
                         ├──< integracao_credenciais
                         └──< remessas_integracao ──< tentativas_integracao
```

### 5.1 Fluxo documental

```text
política vigente
  → requisito configurado
  → requisito instanciado para NF/operação/entrega
  → documento lógico criado
  → versão física enviada
  → análise registrada
  → versão aprovada ou rejeitada
  → requisito satisfeito pela versão aprovada
```

### 5.2 Fluxo pós-cessão

```text
desembolso
  → operacao.cessao_efetivada_em
  → criar requisito CT-e D+10 corridos
  → criar requisito canhoto D+20 corridos
  → NF em_transito
  → CT-e aprovado + canhoto aprovado
  → NF entregue / entrega_confirmada_em
```

### 5.3 Fluxo de configuração histórica

```text
cedente_fundo ativo
  → política e versão vigentes
  → operação criada
  → IDs normalizados + snapshot da política
  → geração de template/CNAB/integração
  → versão efetivamente utilizada preservada no artefato
```

## 6. Entidades e tabelas

Os tipos abaixo são o contrato de desenho. `uuid`, `text`, `integer`, `numeric`, `boolean`, `date`, `timestamptz` e `jsonb` referem-se aos tipos PostgreSQL. `NOT NULL` significa obrigatório; ausência de `NOT NULL` significa nullable. Os nomes podem ser ajustados durante a migration somente se a integridade e o significado forem preservados.

### 6.1 `cedente_fundos`

Representa o vínculo efetivo de um cedente com um fundo. A política pertence a este vínculo.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `cedente_id` | uuid | não | FK `cedentes.id` |
| `fundo_id` | uuid | não | FK `fundos.id` |
| `codigo_externo` | text | sim | Código usado por integração, se existir |
| `status` | text | não | `ativo`, `suspenso`, `encerrado` |
| `vigente_desde` | timestamptz | não | Início do vínculo |
| `vigente_ate` | timestamptz | sim | Nulo enquanto vigente |
| `observacoes` | text | sim | Não usar para regra operacional |
| `created_at` | timestamptz | não | Auditoria temporal |
| `updated_at` | timestamptz | não | Atualização administrativa |

Constraints: `UNIQUE (cedente_id, fundo_id)`, apenas um registro ativo sem `vigente_ate` para o mesmo par, `vigente_ate > vigente_desde` quando preenchido, nenhuma exclusão física se houver operação referenciada. Índices em `(cedente_id, status)`, `(fundo_id, status)` e `(status, vigente_desde)`.

`cedentes.fundo_id` permanece como campo legado nullable. Ele não deve ser a fonte histórica de novas operações depois do período de compatibilidade.

### 6.2 `politicas_operacionais`

Identidade lógica da política associada a um `cedente_fundos`. Não guarda valores históricos diretamente.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `cedente_fundo_id` | uuid | não | FK `cedente_fundos.id` |
| `codigo` | text | não | Único dentro do vínculo |
| `nome` | text | não | Nome administrativo |
| `status` | text | não | `rascunho`, `ativa`, `desativada` |
| `versao_atual_id` | uuid | sim | FK para versão publicada |
| `created_by` | uuid | não | FK `profiles.id` |
| `created_at` | timestamptz | não | |
| `updated_at` | timestamptz | não | |

Constraints: `UNIQUE (cedente_fundo_id, codigo)`, uma política ativa por vínculo salvo decisão funcional contrária, índice em `(cedente_fundo_id, status)` e proibição de exclusão quando houver operação referenciada.

### 6.3 `politica_operacional_versoes`

Versão imutável das regras operacionais.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `politica_operacional_id` | uuid | não | FK `politicas_operacionais.id` |
| `cedente_fundo_id` | uuid | não | Denormalização protegida por FK composta |
| `versao` | integer | não | Crescente a partir de 1 |
| `vigente_desde` | timestamptz | não | Publicação |
| `vigente_ate` | timestamptz | sim | Fechada ao ser substituída |
| `aceite_sacado_obrigatorio` | boolean | não | `false` para o novo fluxo aprovado |
| `cessao_no_desembolso` | boolean | não | Na primeira implementação: `true` |
| `prazo_cte_dias_corridos` | integer | não | Aprovado: 10 |
| `prazo_canhoto_dias_corridos` | integer | não | Aprovado: 20 |
| `configuracao` | jsonb | não | Somente regras evolutivas não primárias |
| `conteudo_hash` | text | não | Hash canônico da versão |
| `publicada_por` | uuid | sim | FK `profiles.id` |
| `publicada_em` | timestamptz | sim | |
| `created_at` | timestamptz | não | |

`UNIQUE (politica_operacional_id, versao)` e índice em `(cedente_fundo_id, vigente_desde)` são obrigatórios. A sobreposição de vigência deve ser impedida por constraint, trigger ou validação transacional. Campos de aceite, cessão e prazos ficam normalizados; `jsonb` não deve esconder gates financeiros ou de segurança.

### 6.4 `politica_requisitos_documentais`

Consolida os requisitos de uma versão da política. Não é necessário criar uma tabela adicional somente para `documento_requisitos`.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `politica_operacional_versao_id` | uuid | não | FK para versão |
| `codigo` | text | não | Código estável, ex.: `nf_xml` |
| `escopo` | text | não | `cedente`, `representante`, `nf_pre_cessao`, `operacao`, `pos_cessao`, `entrega` |
| `documento_tipo_id` | uuid | não | FK `documento_tipos.id` |
| `obrigatorio` | boolean | não | Gate do fluxo |
| `quantidade_minima` | integer | não | Default 1 |
| `formatos_aceitos` | text[] | não | Ex.: `xml`, `pdf` |
| `nivel_validacao` | text | não | `estrutural`, `manual`, `hibrido` |
| `prazo_dias_corridos` | integer | sim | Para requisito pós-cessão |
| `ordem` | integer | não | Ordenação de checklist |
| `ativo` | boolean | não | Desativação antes do uso |
| `created_at` | timestamptz | não | |

`UNIQUE (politica_operacional_versao_id, codigo)` deve impedir requisitos duplicados. Cada NF do novo fluxo terá separadamente XML, DANFE/PDF e Pedido de Compra. O mesmo pedido anexado a duas NFs será representado por duas instâncias e dois vínculos, mesmo que o hash seja igual.

### 6.5 `documento_tipos`

Catálogo extensível de tipos documentais, evitando migration para cada novo tipo.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `codigo` | text | não | Único e estável |
| `nome` | text | não | Nome exibido |
| `dominio` | text | não | `compliance`, `nf`, `operacao`, `cte`, `entrega`, `juridico` |
| `mime_types_aceitos` | text[] | não | Allowlist |
| `extensoes_aceitas` | text[] | não | Allowlist |
| `tamanho_max_bytes` | bigint | não | Limite por tipo |
| `permite_multiplas_versoes` | boolean | não | Deve ser true para reenvio |
| `ativo` | boolean | não | Soft disable |
| `created_at` | timestamptz | não | |

Tipos iniciais aprovados: `nf_xml`, `nf_danfe_pdf`, `nf_pedido_compra`, `cte_xml`, `cte_pdf_dacte` e `canhoto`. Contrato, termo, notificação, comprovante e remessa podem migrar progressivamente para o mesmo catálogo.

### 6.6 `documentos_repositorio`

Documento lógico, sem substituir imediatamente a tabela legada `documentos`.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `documento_tipo_id` | uuid | não | FK `documento_tipos.id` |
| `status` | text | não | `pendente`, `enviado`, `em_analise`, `aprovado`, `rejeitado`, `substituido`, `cancelado` |
| `versao_atual_id` | uuid | sim | FK para versão atual |
| `criado_por` | uuid | não | FK `profiles.id` |
| `created_at` | timestamptz | não | |
| `updated_at` | timestamptz | não | |
| `deleted_at` | timestamptz | sim | Soft delete |

O documento lógico não guarda `storage_path`; o caminho fica em `documento_versoes`.

### 6.7 `documento_versoes`

Cada upload físico é uma versão independente. Arquivos nunca são sobrescritos.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `documento_id` | uuid | não | FK `documentos_repositorio.id` |
| `numero_versao` | integer | não | Sequencial por documento lógico |
| `bucket` | text | não | Allowlist de buckets privados |
| `storage_path` | text | não | Gerado pelo servidor |
| `nome_original` | text | não | Metadado |
| `mime_type` | text | não | Validado contra tipo |
| `tamanho_bytes` | bigint | não | Validado no upload |
| `sha256` | text | não | Identificação; não bloqueia reutilização |
| `status` | text | não | `enviado`, `em_analise`, `aprovado`, `rejeitado`, `substituido`, `cancelado` |
| `substitui_versao_id` | uuid | sim | Auto-FK para versão anterior |
| `enviado_por` | uuid | não | FK `profiles.id` |
| `enviado_em` | timestamptz | não | |
| `created_at` | timestamptz | não | |

Constraints: `UNIQUE (documento_id, numero_versao)`, `UNIQUE (bucket, storage_path)`, `tamanho_bytes > 0`, hash validado e substituição somente dentro do mesmo documento lógico. O hash deve ser indexado, mas não `UNIQUE`.

### 6.8 `documento_vinculos`

Ponte genérica tipada. Cada linha vincula um documento lógico a exatamente um contexto; um documento pode ter várias linhas.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `documento_id` | uuid | não | FK `documentos_repositorio.id` |
| `cedente_id` | uuid | sim | FK `cedentes.id` |
| `representante_id` | uuid | sim | FK `representantes.id` |
| `nota_fiscal_id` | uuid | sim | FK `notas_fiscais.id` |
| `operacao_id` | uuid | sim | FK `operacoes.id` |
| `fundo_id` | uuid | sim | FK `fundos.id` |
| `cte_id` | uuid | sim | FK `ctes.id` |
| `nota_fiscal_entrega_id` | uuid | sim | FK `nota_fiscal_entregas.id` |
| `principal` | boolean | não | Vínculo principal quando necessário |
| `created_at` | timestamptz | não | |

Um `CHECK` deve exigir exatamente uma FK de contexto não nula. O par documento/contexto deve ser único conforme a regra de negócio. Para CT-e relacionado a várias NFs, o documento é vinculado ao `cte_id`; a relação CT-e–NF fica em `cte_notas_fiscais`.

### 6.9 `documento_requisito_instancias`

Instância concreta de um requisito aplicado a uma entidade.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `politica_requisito_id` | uuid | não | FK `politica_requisitos_documentais.id` |
| `cedente_id` | uuid | sim | Contexto de compliance |
| `representante_id` | uuid | sim | Contexto de representante |
| `nota_fiscal_id` | uuid | sim | Contexto de NF |
| `operacao_id` | uuid | sim | Contexto de operação |
| `nota_fiscal_entrega_id` | uuid | sim | Contexto pós-cessão |
| `status` | text | não | `pendente`, `satisfeito`, `vencido`, `dispensado`, `cancelado` |
| `obrigatorio_no_momento` | boolean | não | Cópia da regra aplicada |
| `prazo_limite` | timestamptz | sim | Derivado na instância |
| `documento_id` | uuid | sim | Documento lógico que satisfaz |
| `versao_aprovada_id` | uuid | sim | Versão efetivamente aprovada |
| `satisfeito_em` | timestamptz | sim | |
| `created_at` | timestamptz | não | |
| `updated_at` | timestamptz | não | |

Exatamente um contexto deve ser preenchido. A instância congela `obrigatorio_no_momento`, prazo e tipo exigido; alteração posterior da política não reescreve checklist histórico.

### 6.10 `documento_analises`

Histórico imutável de análise de versão documental.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `documento_versao_id` | uuid | não | FK `documento_versoes.id` |
| `resultado` | text | não | `aprovado`, `rejeitado`, `pendente`, `requer_ajuste` |
| `analisado_por` | uuid | sim | Usuário gestor |
| `ator_tipo` | text | não | `usuario`, `sistema`, `cron`, `integracao` |
| `observacoes` | text | sim | Motivo ou nota |
| `resultado_estruturado` | jsonb | sim | Validação XML sem segredo |
| `analisado_em` | timestamptz | não | |
| `created_at` | timestamptz | não | |

Não permitir `UPDATE` destrutivo de uma análise. Uma nova decisão gera nova linha e atualiza o estado derivado da versão de forma transacional.

### 6.11 Extensão de `operacoes` para contexto histórico

Não é necessária uma nova tabela de contexto; o contexto pertence à própria operação e deve ser preenchido na criação.

| Campo a acrescentar | Tipo | Nulabilidade | Regra |
|---|---|---:|---|
| `cedente_fundo_id` | uuid | sim na transição, não para novas | FK `cedente_fundos.id`; FK composta com `cedente_id` |
| `politica_operacional_id` | uuid | sim na transição, não para novas | FK da política aplicada |
| `politica_operacional_versao_id` | uuid | sim na transição, não para novas | Versão aplicada |
| `politica_versao` | integer | sim na transição, não para novas | Cópia legível |
| `politica_snapshot` | jsonb | sim para legado, não para novas | Snapshot mínimo |
| `politica_snapshot_hash` | text | sim | Hash canônico |
| `contexto_configuracao_status` | text | não | `completo`, `legado_inferido`, `legado_indefinido` |
| `contexto_capturado_em` | timestamptz | sim | Momento do snapshot |
| `aceite_sacado_exigido` | boolean | não para novas | Cópia da política |
| `aceite_sacado_status` | text | não para novas | `pendente`, `aceito`, `contestado`, `dispensado` |
| `aceite_sacado_em` | timestamptz | sim | Aceite ou dispensa registrada |
| `cessao_efetivada_em` | timestamptz | sim | Primeira implementação: desembolso |

O `contexto_configuracao_status` representa operações legadas sem inventar política histórica. `legado_inferido` significa vínculo deduzido de `cedentes.fundo_id`; `legado_indefinido` significa contexto não comprovado. Para operações novas, `completo` é obrigatório.

O snapshot é criado no momento da solicitação e não deve ser alterado depois da criação. Ele guarda somente regras e IDs necessários, por exemplo:

```json
{
  "cedente_fundo_id": "...",
  "fundo_id": "...",
  "politica_operacional_id": "...",
  "politica_versao": 1,
  "aceite_sacado_obrigatorio": false,
  "cessao_no_desembolso": true,
  "prazo_cte_dias_corridos": 10,
  "prazo_canhoto_dias_corridos": 20,
  "requisitos": [
    {"codigo": "nf_xml", "obrigatorio": true, "formatos": ["xml"]},
    {"codigo": "nf_danfe_pdf", "obrigatorio": true, "formatos": ["pdf"]},
    {"codigo": "nf_pedido_compra", "obrigatorio": true, "formatos": ["pdf", "xml"]}
  ]
}
```

IDs normalizados permanecem para joins e auditoria; o JSON não é fonte de consulta operacional.

### 6.12 `nota_fiscal_entregas`

Representa o acompanhamento logístico de uma NF dentro de uma operação. O uso de tabela separada mantém o status logístico fora de `notas_fiscais.status`.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `operacao_id` | uuid | não | FK para operação |
| `nota_fiscal_id` | uuid | não | FK para NF |
| `status_entrega` | text | não | `nao_aplicavel`, `em_transito`, `aguardando_validacao`, `entregue`, `entrega_com_pendencia`, `devolvida`, `cancelada` |
| `cessao_efetivada_em` | timestamptz | sim | Normalmente cópia do marco da operação |
| `data_limite_cte` | date | sim | D+10 corridos |
| `data_limite_canhoto` | date | sim | D+20 corridos |
| `data_entrega` | date | sim | Data informada/validada |
| `entrega_confirmada_em` | timestamptz | sim | Quando ambos os requisitos estão aprovados |
| `motivo_pendencia` | text | sim | Motivo controlado pelo serviço |
| `created_at` | timestamptz | não | |
| `updated_at` | timestamptz | não | |

`UNIQUE (operacao_id, nota_fiscal_id)` deve corresponder à associação em `operacoes_nfs`. Índices em `(status_entrega, data_limite_cte)`, `(status_entrega, data_limite_canhoto)` e `(nota_fiscal_id)` atendem às consultas críticas.

### 6.13 `eventos_entrega`

Histórico imutável dos eventos logísticos.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `nota_fiscal_entrega_id` | uuid | não | FK |
| `tipo_evento` | text | não | Ex.: `cessao_efetivada`, `cte_enviado`, `cte_aprovado`, `canhoto_aprovado`, `entregue` |
| `status_anterior` | text | sim | |
| `status_novo` | text | sim | |
| `ocorrido_em` | timestamptz | não | Momento de negócio |
| `registrado_por` | uuid | sim | Usuário, se humano |
| `ator_tipo` | text | não | `usuario`, `sistema`, `cron`, `integracao` |
| `dados` | jsonb | sim | Metadados sem segredo |
| `created_at` | timestamptz | não | Persistência |

Não permitir exclusão por atores da aplicação. A transição deve atualizar `nota_fiscal_entregas` e inserir o evento na mesma transação.

### 6.14 `ctes`

CT-e é entidade operacional porque possui atributos estruturados, status e relação N:N com NFs. O arquivo XML/PDF/DACTE fica no repositório documental.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `chave_cte` | text | não | UNIQUE quando disponível |
| `numero` | text | não | |
| `serie` | text | sim | |
| `data_emissao` | date | não | |
| `cnpj_transportadora` | text | não | Validar formato |
| `cnpj_remetente` | text | não | |
| `cnpj_destinatario` | text | não | |
| `valor_frete` | numeric | sim | `>= 0` |
| `formato_origem` | text | não | `xml`, `pdf`, `manual` |
| `nivel_validacao` | text | não | `estrutural`, `manual`, `hibrido` |
| `status` | text | não | `enviado`, `em_analise`, `aprovado`, `rejeitado`, `substituido`, `cancelado` |
| `analisado_por` | uuid | sim | FK `profiles.id` |
| `analisado_em` | timestamptz | sim | |
| `motivo_rejeicao` | text | sim | Obrigatório ao rejeitar |
| `created_at` | timestamptz | não | |
| `updated_at` | timestamptz | não | |

`chave_cte` deve ser única quando não nula. CNPJ e chave devem ser validados no serviço; parsing estruturado de XML não deve ser presumido antes da definição do parser e do schema de CT-e.

### 6.15 `cte_notas_fiscais`

Ponte N:N entre CT-e e NF.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `cte_id` | uuid | não | FK `ctes.id` |
| `nota_fiscal_id` | uuid | não | FK `notas_fiscais.id` |
| `created_at` | timestamptz | não | |

PK composta `(cte_id, nota_fiscal_id)` e índices em ambas as direções. A autorização precisa verificar se a NF pertence ao cedente/operação do usuário antes de inserir a relação.

### 6.16 `canhotos`

Canhoto deve ter entidade própria. A aprovação do canhoto é condição para `entregue`, possui prazo próprio e pode receber substituição documental.

| Campo | Tipo | Nulabilidade | Observação |
|---|---|---:|---|
| `id` | uuid | não | PK |
| `nota_fiscal_entrega_id` | uuid | não | FK |
| `status` | text | não | `pendente`, `enviado`, `em_analise`, `aprovado`, `rejeitado`, `substituido`, `cancelado` |
| `data_assinatura` | date | sim | Extraída ou informada |
| `recebido_em` | timestamptz | sim | |
| `analisado_por` | uuid | sim | Gestor |
| `analisado_em` | timestamptz | sim | |
| `motivo_rejeicao` | text | sim | Obrigatório ao rejeitar |
| `created_at` | timestamptz | não | |
| `updated_at` | timestamptz | não | |

O arquivo é vinculado a `canhotos.id` via `documento_vinculos`. A tabela não deve guardar a URL física.

## 7. Templates, CNAB e integrações

Essas entidades fazem parte do desenho completo, mas devem entrar depois do núcleo de contexto, documentos e logística. Não devem ser implementadas como solução específica para o novo parceiro.

### 7.1 `templates_documentos`, `template_versoes` e `documentos_gerados`

`templates_documentos` é o catálogo lógico: `id`, `fundo_id`, `codigo`, `tipo_documento`, `status`, `created_by` e timestamps. `template_versoes` contém `template_id`, `versao`, `vigente_desde`, `vigente_ate`, `storage_path_ou_conteudo`, `sha256`, `variaveis_schema`, `publicada_por` e timestamps. Uma versão usada não é atualizada.

`documentos_gerados` registra o artefato de uma operação: `id`, `operacao_id`, `template_versao_id`, `tipo`, `storage_bucket`, `storage_path`, `sha256`, `gerado_em`, `gerado_por`, `status` e metadados. O registro preserva o template exato usado e não depende do template vigente atual.

Não é necessário criar uma tabela de template por contrato. Contrato, termo, notificação e quitação são tipos de um catálogo comum, com versões distintas.

### 7.2 `configuracoes_cnab`, `configuracao_cnab_versoes`, `remessas_cnab`

`configuracoes_cnab` é lógica e pertence ao fundo, com `id`, `fundo_id`, `codigo`, `status` e timestamps. `configuracao_cnab_versoes` guarda `versao`, banco, layout, espécie, originador, campos de configuração, vigência e hash. Campos de layout devem ser normalizados quando usados na geração; `configuracao` JSON pode conter opções não consultadas.

`remessas_cnab` registra o arquivo efetivamente gerado: `id`, `fundo_id`, `configuracao_cnab_versao_id`, `status`, `bucket`, `storage_path`, `sha256`, `gerado_em`, `enviado_em`, `retorno`, `idempotency_key` e timestamps. Como uma remessa pode conter várias operações, usar `remessas_cnab_operacoes(remessa_id, operacao_id)` com PK composta. A implementação atual grava informações de remessa diretamente em `operacoes`; esses campos permanecem durante a transição.

### 7.3 `integracoes`, `integracao_configuracoes`, `integracao_credenciais`, `remessas_integracao` e `tentativas_integracao`

`integracoes` identifica o conector lógico: `id`, `fundo_id` nullable quando sistêmico, `codigo`, `tipo`, `status` e timestamps.

`integracao_configuracoes` é a versão da configuração: `integracao_id`, `versao`, `vigente_desde`, `vigente_ate`, `endpoint`, `timeout_ms`, `configuracao_publica`, `hash`, `ativo` e timestamps. Não armazenar segredo neste JSON.

`integracao_credenciais` é uma tabela separada: `id`, `integracao_id`, `configuracao_id`, `key_version`, `algoritmo`, `ciphertext`, `iv`, `auth_tag`, `secret_kind`, `ativo`, `substituida_em`, `created_by` e timestamps. O segredo nunca é retornado nem exibido; substituir cria nova credencial e desativa a anterior.

`remessas_integracao` registra envio lógico: `id`, `integracao_id`, `integracao_configuracao_id`, `remessa_cnab_id` ou `operacao_id`, `idempotency_key`, `payload_hash`, `status`, `external_id`, `enviado_em`, `aceito_em`, `retorno_resumido` e timestamps.

`tentativas_integracao` registra retries: `id`, `remessa_integracao_id`, número da tentativa, status HTTP/protocolo, início/fim, erro sanitizado, resposta resumida e `created_at`. Não registrar headers de autenticação, tokens, XML completo com segredo ou payload irrestrito em log.

## 8. Idempotência, eventos e auditoria

### 8.1 `chaves_idempotencia`

É necessária para solicitações externas e comandos que criam movimentação. Campos: `id`, `escopo`, `chave`, `request_hash`, `resultado_status`, `resultado_id`, `created_at`, `expira_em` e `consumida_em`. `UNIQUE (escopo, chave)` impede duplicidade. A mesma chave com `request_hash` diferente deve ser rejeitada.

### 8.2 `eventos_dominio`

É necessária para transições que precisam de histórico independente do estado atual. Campos: `id`, `tipo`, `aggregate_type`, `aggregate_id`, `event_version`, `payload`, `ator_tipo`, `ator_id`, `origin`, `occurred_at` e `created_at`. Eventos são append-only e não carregam segredos.

### 8.3 `outbox_eventos`

É recomendada quando remessas, notificações ou integrações forem assíncronas. Campos: `id`, `evento_id`, `destino`, `status`, `tentativas`, `disponivel_em`, `processado_em`, `ultimo_erro` e timestamps. A linha deve nascer na mesma transação do evento de domínio. Pode aguardar a implementação efetiva de integração assíncrona; não deve ser criada sem consumidor definido.

### 8.4 Auditoria

`logs_auditoria` da Fase 1 continua sendo a trilha administrativa. Ela diferencia `usuario`, `sistema`, `integracao` e `cron` por `ator_tipo`, `origem` e `ator_identificador`. Eventos de domínio e auditoria têm objetivos diferentes: o primeiro permite reconstruir transições técnicas; o segundo registra ação administrativa e dados antes/depois. Não consolidar os dois em um JSON genérico.

## 9. Integridade, constraints e exclusões

### 9.1 Regras gerais

- Todas as tabelas novas têm PK UUID.
- FKs históricas devem usar `ON DELETE RESTRICT` ou o default restritivo. Não excluir fundo, política, versão, documento, template, configuração CNAB ou integração já usada.
- Dados operacionais vinculados a cedente ou operação podem usar `ON DELETE CASCADE` somente quando a exclusão física for comprovadamente permitida; a preferência é soft delete.
- Estados devem ter checks ou catálogos controlados; não aceitar texto livre em transições.
- Valores monetários devem ser `numeric` com validação `>= 0`.
- CNPJs, chaves NF-e e CT-e devem ser normalizados para dígitos antes de validar unicidade.
- Datas de vigência devem validar fim posterior ao início.
- Requisitos obrigatórios devem ter `quantidade_minima >= 1`.
- Versões devem ser únicas por entidade lógica e crescer monotonicamente.
- Hash é evidência de conteúdo, não substituto de FK, status ou autorização.

### 9.2 Soft delete

Configurações, tipos, políticas, templates, integrações e credenciais devem ser desativados, não apagados. Documentos e artefatos usados em operação devem permanecer consultáveis para auditoria, mesmo quando substituídos. A exclusão física deve ser restrita a registros nunca utilizados, mediante job de retenção aprovado.

### 9.3 Índices mínimos

- `cedente_fundos(cedente_id, status)` e `(fundo_id, status)`;
- políticas por vínculo, status e vigência;
- requisitos por versão e escopo;
- documentos por tipo, status, hash e vínculo;
- versões por documento e status;
- instâncias de requisito por contexto, status e prazo;
- entregas por status e limites CT-e/canhoto;
- eventos por entrega e data;
- CT-e por chave, status e CNPJ;
- ponte CT-e–NF em ambas as direções;
- operação por contexto, política, status e `cessao_efetivada_em`;
- remessas por fundo, status, chave de idempotência e data;
- tentativas por remessa e status;
- outbox por status e `disponivel_em`.

Índices parciais devem ser usados para registros ativos ou pendentes quando a consulta for recorrente, por exemplo requisitos não satisfeitos e configurações com `vigente_ate IS NULL`.

## 10. Versionamento e imutabilidade

| Entidade | Estratégia | O que não pode mudar após uso |
|---|---|---|
| Política | versão inteira + vigência + hash | regras e requisitos da versão |
| Requisito | pertence à versão da política | tipo, obrigatoriedade, formato e prazo |
| Documento lógico | identidade estável | histórico de versões |
| Documento físico | número sequencial + SHA-256 | arquivo, path e metadados de upload |
| Análise | evento/linha append-only | resultado e ator da análise |
| Template | versão inteira + hash | conteúdo e variáveis da versão |
| CNAB | versão inteira + hash | layout e parâmetros usados |
| Integração | configuração versionada | endpoint/parâmetros usados |
| Credencial | ciphertext + `key_version` | ciphertext e metadados criptográficos |
| Remessa | ID, hash, idempotência e retorno | arquivo enviado e resposta externa |
| Evento | `event_version` + timestamp | payload do evento |

Timestamp sozinho não identifica uma versão; ele apenas marca vigência. Hash sozinho não substitui número de versão nem FK. A combinação recomendada é número inteiro para ordenação, vigência para seleção e hash para evidência de conteúdo.

## 11. Snapshot da operação

### 11.1 Dados normalizados

Devem ficar em colunas/FKs:

- `cedente_id`;
- `cedente_fundo_id`;
- `fundo_id` quando necessário para consultas rápidas;
- `politica_operacional_id`;
- `politica_operacional_versao_id`;
- `politica_versao`;
- `contexto_configuracao_status`;
- `aceite_sacado_exigido` e `aceite_sacado_status`;
- `cessao_efetivada_em`;
- status e datas logísticas da entrega;
- IDs das versões de template, CNAB e integração nos artefatos gerados.

### 11.2 Dados no snapshot JSON

O JSON deve guardar o conjunto mínimo das regras aplicadas: flags de aceite, momento de cessão, prazos CT-e/canhoto, códigos e obrigatoriedade dos requisitos, formatos aceitos, níveis de validação e valores de configuração que afetem gates. Não copiar todos os campos cadastrais do cedente ou fundo, nem dados que possam ser consultados pelas FKs.

### 11.3 Momento e imutabilidade

O snapshot é criado no momento de criação da operação, antes da aprovação. Ele não pode ser alterado quando a operação for criada. Se a política mudar logo depois, a operação existente continua usando o snapshot original. Correção de erro exige nova ação auditada e regra funcional explícita; não se deve reescrever silenciosamente o histórico.

### 11.4 Legados

Operações sem snapshot recebem `contexto_configuracao_status` `legado_inferido` ou `legado_indefinido`. Não se deve criar snapshot histórico falso. Uma migração pode gerar snapshot de compatibilidade marcado como inferido, com a origem (`cedentes.fundo_id`) registrada.

## 12. Máquinas de estados

As máquinas abaixo são desenho de transição. Nenhuma mudança de enum ou status está sendo implementada nesta fase.

### 12.1 Estado financeiro da NF

Preservar os estados atuais: `rascunho`, `submetida`, `em_analise`, `aprovada`, `em_antecipacao`, `aceita`, `contestada`, `requer_ajuste`, `liquidada`, `cancelada`.

Fluxo atual com aceite:

```text
rascunho → submetida → em_analise → aprovada → em_antecipacao
em_antecipacao → aceita → liquidada
em_antecipacao → contestada
em_analise → requer_ajuste → submetida
```

Fluxo novo sem aceite:

```text
rascunho → submetida → em_analise → aprovada
operação criada com aceite_sacado_status = dispensado
operação aprovada → desembolso
```

O novo fluxo não deve enviar a NF para a fila de aceite nem utilizar `em_antecipacao` como substituto de `dispensado`. A representação explícita fica no contexto da operação. O status financeiro da NF continua sendo usado para filtros legados e não ganha novo valor apenas para resolver o gate de aceite.

### 12.2 Estado da operação

Preservar `solicitada`, `em_analise`, `aprovada`, `em_andamento`, `liquidada`, `inadimplente`, `reprovada` e `cancelada`.

| Transição | Ator | Pré-condições | Efeitos/eventos |
|---|---|---|---|
| criar → `solicitada` | cedente | NFs e contexto completos | snapshot, requisito inicial e evento de solicitação |
| `solicitada` → `em_analise` | gestor | documentos pré-cessão satisfeitos | evento de análise |
| `em_analise` → `aprovada` | gestor | gate de aceite satisfeito ou `dispensado`, documentos e valores válidos | aprova operação e registra ator |
| `aprovada` → `em_andamento` | gestor | termo, comprovante e remessa conforme política | inicia desembolso idempotente |
| `em_andamento` → `liquidada` | gestor/sistema | pagamento confirmado | liquidação e quitação |
| `em_andamento` → `inadimplente` | cron/gestor | vencimento e regra aprovada | evento de inadimplência |
| estados não finais → `reprovada` | gestor | motivo obrigatório | encerra tentativa de aprovação |
| estados não liquidados → `cancelada` | ator autorizado | motivo e regra de cancelamento | cancela requisitos pendentes |

Cada transição deve verificar o status atual no `UPDATE`, gerar chave de idempotência e produzir auditoria/evento na mesma unidade transacional. São proibidas desembolso sem aprovação, aceite do sacado quando o contexto é `dispensado`, liquidação duplicada e alteração de contexto depois do snapshot.

### 12.3 Estado documental

```text
pendente → enviado → em_analise → aprovado
                         └──────→ rejeitado → enviado
aprovado → substituido → enviado
pendente/enviado/rejeitado → cancelado
```

O cedente envia e substitui versões pendentes. O gestor analisa e aprova/rejeita. A versão aprovada não é sobrescrita. Integração pode marcar análise estrutural, mas aprovação com efeito jurídico permanece explicitamente autorizada por gestor, salvo decisão futura documentada.

### 12.4 Estado logístico

```text
nao_aplicavel
em_transito → aguardando_validacao → entregue
                              └────→ entrega_com_pendencia
em_transito → devolvida
qualquer estado não final → cancelada
```

No desembolso, a primeira implementação cria a entrega e marca `em_transito`. CT-e e canhoto são enviados separadamente. A NF somente passa a `entregue` quando houver CT-e aprovado e canhoto aprovado. A transição é proibida quando um dos dois requisitos estiver pendente, rejeitado ou vencido sem tratamento.

### 12.5 Estado de integração

```text
pendente → processando → enviado → aceito
                    └──→ erro_temporario → processando
                    └──→ erro_definitivo
pendente/processando/enviado → cancelado
enviado → rejeitado
```

Retry exige `chaves_idempotencia`, limite e registro de tentativa. Resposta externa deve ser sanitizada antes da auditoria.

## 13. RLS e autorização

### 13.1 Regras gerais para tabelas novas

Todas as tabelas em schema exposto devem ter RLS habilitado. As policies devem usar `TO authenticated` ou `TO service_role` explicitamente, com ownership e vínculo de negócio. Não usar `auth.role()` em policies novas. Policies de `UPDATE` devem ter `USING` e `WITH CHECK`. Views futuras devem usar `security_invoker = true` ou ficar em schema não exposto.

Funções `SECURITY DEFINER` existentes (`get_user_role`, `get_user_cedente_id` e outras) fazem parte do estado atual e devem ser revisadas em migration própria com schema qualificado, search path controlado e grants mínimos. Esta revisão não altera essas funções.

### 13.2 Matriz de acesso

| Domínio | gestor | cedente | consultor | sacado | service/cron/integração |
|---|---|---|---|---|---|
| `cedente_fundos` | CRUD/desativar | consultar próprio | consultar vínculo permitido | nenhum | sincronizar quando autorizado |
| políticas e versões | CRUD/publicar | consultar aplicável | consultar | nenhum | consultar |
| requisitos | CRUD antes do uso | consultar checklist próprio | consultar | nenhum | instanciar em eventos autorizados |
| documentos e versões | consultar/analisar/desativar | inserir/substituir próprios | consultar escopo permitido | consultar escopo permitido | upload/processamento técnico |
| análises | consultar/criar decisão | consultar próprio | consultar | nenhum | análise estrutural sem aprovação jurídica |
| contexto de operação | CRUD/aprovar | criar/consultar própria | consultar | consultar elegível | transições automáticas específicas |
| entrega/eventos | consultar/alterar/aprovar | enviar documentos, não aprovar | consultar | consultar se definido | jobs de prazo/eventos técnicos |
| CT-e | consultar/aprovar | criar/corrigir pendente | consultar | nenhum por padrão | validação estrutural |
| canhoto | consultar/aprovar | criar/corrigir pendente | consultar | nenhum por padrão | processamento técnico |
| templates/CNAB | CRUD/publicar | nenhum | nenhum | nenhum | gerar arquivo com versão autorizada |
| integrações/credenciais | administrar sem ler segredo | nenhum | nenhum | nenhum | executar sem expor segredo |
| remessas/tentativas | consultar/reprocessar | nenhum | consultar escopo permitido | nenhum | enviar e registrar retorno |
| eventos/auditoria/idempotência | consultar | nenhum insert direto | nenhum insert direto | nenhum insert direto | inserir append-only |

RLS não substitui os helpers server-side da Fase 1 (`requireGestor`, `requireCedenteAccess`, `requireOperationAccess` etc.). A action deve validar entidade, vínculos e transição antes de chamar o banco.

### 13.3 Riscos herdados a resolver antes das migrations

- habilitar RLS nas tabelas de fundo, taxas, consultor e devedores se continuarem expostas;
- revisar policies abertas da migration de testemunhas, especialmente `testemunhas_select_all`;
- garantir grants do Data API para tabelas novas sem expor linhas indevidas;
- não usar `raw_user_meta_data` para role ou ownership;
- manter `service_role` apenas em código server-side;
- testar `UPDATE` com `SELECT` policy correspondente;
- definir como consultor acessa documentos vinculados sem depender apenas da role global.

## 14. Storage

### 14.1 Compatibilidade

Os buckets atuais permanecem durante a migração:

- `documentos-cedentes`;
- `notas-fiscais`;
- `contratos`.

Eles são privados e já possuem policies no SQL atual. Não alterar esses buckets nesta fase.

### 14.2 Recomendação para o repositório v2

Para documentos novos, recomenda-se um bucket privado único `documentos-v2`, evitando que o domínio físico determine o modelo lógico. O bucket não deve ser criado agora. A decisão final depende da retenção, volume e compatibilidade operacional de homologação.

Path recomendado, sempre gerado pelo servidor:

```text
<cedente_id>/<contexto_tipo>/<contexto_id>/<documento_tipo_id>/<documento_id>/v<numero_versao>/<uuid>.<ext>
```

O banco armazena bucket, path, hash, MIME e tamanho. O cliente nunca escolhe livremente bucket ou path final. Download exige localizar o registro documental, verificar vínculo e autorização, comparar o path registrado e só então gerar signed URL. Não aceitar `path` arbitrário, `bucket` arbitrário ou entidade sem validação.

### 14.3 Upload, substituição e retenção

- upload por signed upload URL criado server-side ou por ação server-side;
- MIME, extensão, tamanho e hash validados no servidor;
- substituição cria nova versão e novo path;
- arquivo idêntico pode ser reutilizado, mas cada requisito mantém seu próprio vínculo;
- versão aprovada não é apagada quando uma versão nova é enviada;
- exclusão física depende de política de retenção e não pode quebrar auditoria;
- jobs de vencimento tratam o requisito, não apagam o arquivo automaticamente;
- Storage policy deve refletir a mesma autorização da tabela e ter `INSERT`, `SELECT`, `UPDATE` e `DELETE` explicitamente definidos por operação.

## 15. Compatibilidade com dados legados

### 15.1 Bridge de `cedentes.fundo_id`

1. Cadastrar e validar o novo fundo em homologação.
2. Criar `cedente_fundos` para cada relação existente e válida entre cedente e fundo.
3. Não alterar destrutivamente `cedentes.fundo_id`.
4. Atualizar novas actions para gravar primeiro o vínculo explícito e, durante a compatibilidade, manter o campo legado coerente.
5. Fazer backfill de operações com `cedente_fundo_id` inferido a partir de `cedentes.fundo_id`.
6. Marcar operações sem evidência histórica como `legado_inferido` ou `legado_indefinido`.
7. Tornar o contexto obrigatório para novas operações antes de pensar em `NOT NULL` global.
8. Remover o uso de `cedentes.fundo_id` apenas depois de consultas críticas, Fromtis, CNAB, relatórios e telas utilizarem o bridge.

### 15.2 Operações legadas

Como foi aprovado que não existem operações antigas relevantes com `cedentes.fundo_id` nulo, o backfill pode começar pelo relacionamento existente. Isso não comprova qual política estava vigente no passado. Portanto:

- vínculo de fundo pode ser `legado_inferido`;
- política histórica deve ser `legado_indefinido` quando não houver evidência;
- não criar versão retroativa fictícia como se tivesse sido publicada;
- operações legadas continuam usando campos atuais e não devem ser forçadas ao fluxo logístico novo sem contexto;
- requisitos novos podem ser `nao_aplicavel` ou explicitamente criados por decisão de negócio.

### 15.3 Momento para constraints `NOT NULL`

`cedente_fundo_id`, `politica_operacional_versao_id` e snapshot devem permanecer nullable somente no período de bridge. Depois de backfill validado, novas escritas sem uso do campo legado, relatórios e integrações migrados, homologação aprovada e testes RLS/regressão concluídos, as colunas podem ser tornadas obrigatórias para novas operações e, posteriormente, globais se todos os legados tiverem classificação válida.

## 16. Segurança de credenciais

### 16.1 Recomendação atual

Para o estágio atual, usar tabela separada `integracao_credenciais` com segredo cifrado server-side. A chave-mestra deve permanecer em variável de ambiente de homologação/produção, nunca no banco, no código, no browser ou no documento de operação.

Campos criptográficos mínimos:

- `ciphertext`;
- `iv` único por segredo;
- `auth_tag`;
- algoritmo explícito, recomendado AES-256-GCM ou equivalente autenticado;
- `key_version` para rotação;
- tipo de segredo;
- status e datas de ativação/substituição.

O serviço de integração descriptografa somente no instante da chamada server-side. A interface permite substituir a credencial e testar a conexão com resposta sanitizada; não permite visualizar ou recuperar o segredo atual.

### 16.2 Evolução futura

Quando houver disponibilidade operacional, migrar o valor cifrado para um serviço de segredos gerenciado e manter no banco apenas referência, versão, escopo e status. A interface e o contrato do serviço devem permanecer iguais para permitir essa troca.

O estado atual ainda usa variáveis de ambiente para Fromtis (`FROMTIS_URL`, `FROMTIS_USERNAME`, `FROMTIS_PASSWORD`) e API keys para Escrow/Cron. A Fase 1.5 não altera isso nem cria novas secrets.

## 17. Consultas críticas e performance

### Checklist documental de NF

Consultar `documento_requisito_instancias` por `nota_fiscal_id`, `status`, `obrigatorio_no_momento` e `prazo_limite`, com join para `documento_tipos` e versão aprovada. Índice: `(nota_fiscal_id, status)` e parcial para `status IN ('pendente', 'vencido')`.

### NFs elegíveis para operação

Filtrar `notas_fiscais` pelo status financeiro atual, `cedente_id`, vínculo de operação e existência de todos os requisitos obrigatórios satisfeitos. Não calcular somente a partir do snapshot JSON. Índices atuais de cedente/status devem ser preservados; adicionar índices das instâncias.

### Operações com e sem aceite

Consultar `operacoes.aceite_sacado_status` e `aceite_sacado_exigido`. Não inferir dispensa pela ausência de `aprovacao_sacado_em`.

### CT-e e canhoto pendentes

Consultar `nota_fiscal_entregas.status_entrega`, `data_limite_cte`, `data_limite_canhoto`, `ctes.status` e `canhotos.status`. Índices parciais para pendências e vencimentos são prioritários.

### NFs em trânsito e entregues

Usar `nota_fiscal_entregas`, não `notas_fiscais.status`. `entregue` só deve ser possível quando CT-e e canhoto aprovados; a regra pode ser materializada no serviço ou em função transacional.

### Templates e CNAB vigentes

Selecionar a versão com `ativo`, vigência e maior versão dentro da entidade lógica. Uma operação já gerada consulta os IDs armazenados no artefato e não recalcula a versão vigente.

### Histórico de remessas e integrações

Consultar `remessas_cnab`, `remessas_cnab_operacoes`, `remessas_integracao` e `tentativas_integracao` por fundo, operação, chave de idempotência, status e período. Nunca reconstruir histórico olhando somente os campos atuais de `operacoes`.

## 18. Sequência recomendada de migrations

Esta é uma ordem lógica; não são migrations executáveis.

### Migration 1 — bridge de relacionamento

Criar `cedente_fundos`, índices, constraints e policies mínimas. Popular com os vínculos válidos de `cedentes.fundo_id`. Manter o campo legado.

### Migration 2 — políticas versionadas

Criar `politicas_operacionais`, `politica_operacional_versoes` e `politica_requisitos_documentais`. Cadastrar somente a política aprovada para o novo vínculo após confirmar os campos funcionais.

### Migration 3 — contexto histórico da operação

Adicionar colunas contextuais a `operacoes`, iniciar backfill marcado como inferido e exigir contexto completo nas novas actions. Não tornar todas as colunas `NOT NULL` ainda.

### Migration 4 — catálogo e repositório documental

Criar `documento_tipos`, `documentos_repositorio`, `documento_versoes`, `documento_vinculos`, `documento_requisito_instancias` e `documento_analises`. Criar catálogo dos três documentos pré-cessão.

### Migration 5 — checklist da NF

Instanciar XML, DANFE/PDF e Pedido de Compra por NF do novo fluxo. Manter `notas_fiscais.arquivo_url` para legado e só marcar NF elegível quando o checklist novo estiver completo.

### Migration 6 — pós-cessão

Criar `nota_fiscal_entregas`, `eventos_entrega`, `ctes`, `cte_notas_fiscais` e `canhotos`. Criar requisitos CT-e/canhoto no desembolso e regras de aprovação.

### Migration 7 — templates e CNAB

Criar catálogo/versões de template, documentos gerados, configuração CNAB versionada e remessas históricas. Adaptar geração para registrar a versão utilizada sem remover campos legados.

### Migration 8 — integrações e idempotência

Criar integrações, configurações, credenciais cifradas, remessas, tentativas, chaves de idempotência e, se houver consumidor assíncrono, outbox.

### Migration 9 — RLS, Storage e endurecimento

Habilitar RLS em todas as tabelas novas e legadas expostas, criar policies com grants explícitos, configurar bucket privado somente após definir retenção e testar signed URLs. Aplicar advisors e testes de ownership.

### Migration 10 — encerramento do bridge

Somente após backfill e homologação: tornar contexto obrigatório para novas operações, descontinuar leituras de `cedentes.fundo_id`, manter o campo para histórico e só remover em fase futura aprovada.

## 19. Alternativas rejeitadas

### Uma tabela especializada por documento

Rejeitada como arquitetura exclusiva por duplicar Storage, versões, análise, RLS e requisitos. CT-e e canhoto continuam entidades próprias por possuírem comportamento, mas seus arquivos não serão duplicados em tabelas físicas.

### Repositório totalmente polimórfico

Rejeitado por não oferecer FK real, tornar RLS dependente de lógica extensa e permitir documentos apontando para IDs de entidades inexistentes.

### Política pertencente somente ao fundo

Rejeitada porque o mesmo fundo pode ter regras diferentes para cedentes ou parceiros diferentes. A regra aprovada é que a política pertence a `cedente_fundos`.

### Copiar todo o cadastro no snapshot

Rejeitado por duplicar dados, dificultar consultas e aumentar risco de divergência. O snapshot preserva apenas regras e IDs necessários para explicar a decisão.

### Criar uma tabela genérica para todos os estados

Rejeitada. Estados financeiros, documentais, logísticos e de integração possuem atores, pré-condições e efeitos diferentes. Um único status aumentaria ambiguidade e quebraria filtros existentes.

### Criptografia com segredo em `user_metadata` ou no browser

Rejeitada. Autorização não deve usar `raw_user_meta_data`, e credenciais de integração nunca devem ser expostas ao cliente.

## 20. Decisões ainda pendentes que bloqueiam migrations

As seguintes decisões não estão definidas pelo código nem pelas decisões funcionais aprovadas:

1. ID, CNPJ, administradora, custodiante e dados operacionais definitivos do novo fundo.
2. Se haverá uma única política ativa por vínculo ou várias políticas selecionáveis por produto/período.
3. Campos jurídicos e financeiros completos da política, além de aceite, cessão e prazos já aprovados.
4. Definição dos estados e responsáveis por CT-e rejeitado, canhoto ilegível, devolução e reentrega.
5. Schema oficial do XML de CT-e e biblioteca de validação aceita em homologação.
6. Se uma entrega é controlada por NF, por operação/NF ou por lote logístico.
7. Regra de acesso do sacado a documentos pós-cessão.
8. Bucket v2 único ou manutenção dos buckets por domínio; retenção e exclusão.
9. Template jurídico, versão inicial, variáveis permitidas e hash do conteúdo.
10. Layout CNAB do novo fundo, origem, espécie, banco e campos variáveis.
11. Contratos, credenciais, certificados e idempotência das integrações externas.
12. Estratégia de chave-mestra e serviço futuro de segredos.
13. Política de retenção, anonimização e exclusão de documentos e retornos externos.
14. Dados reais de homologação e confirmação de que não há operações relevantes com fundo nulo.
15. Grants do Data API para todas as tabelas novas e estratégia de testes RLS no projeto Supabase.

Sem essas definições, criar migrations obrigaria decisões estruturais durante a codificação e poderia congelar uma política ou integração incorreta.

## 21. Tabelas necessárias na Fase 2 e tabelas adiáveis

### 21.1 Núcleo realmente necessário na Fase 2

1. `cedente_fundos`;
2. `politicas_operacionais`;
3. `politica_operacional_versoes`;
4. `politica_requisitos_documentais`;
5. `documento_tipos`;
6. `documentos_repositorio`;
7. `documento_versoes`;
8. `documento_vinculos`;
9. `documento_requisito_instancias`;
10. `documento_analises`;
11. extensão contextual de `operacoes`;
12. `nota_fiscal_entregas`;
13. `eventos_entrega`;
14. `ctes`;
15. `cte_notas_fiscais`;
16. `canhotos`.

### 21.2 Necessárias quando o domínio correspondente entrar

- `templates_documentos`, `template_versoes`, `documentos_gerados`: quando templates forem parametrizados por fundo/política;
- `configuracoes_cnab`, `configuracao_cnab_versoes`, `remessas_cnab`, `remessas_cnab_operacoes`: quando CNAB deixar de ser fixo e histórico de remessas for requisito;
- `integracoes`, `integracao_configuracoes`, `integracao_credenciais`, `remessas_integracao`, `tentativas_integracao`: quando houver integração configurável por fundo;
- `chaves_idempotencia`: antes de qualquer retry que crie movimento ou remessa;
- `eventos_dominio`: quando as transições forem publicadas como eventos;
- `outbox_eventos`: somente quando existir consumidor assíncrono;
- `notificacoes_emitidas`: somente se a deduplicação não puder ser resolvida com eventos/outbox.

### 21.3 Tabelas que não devem ser duplicadas

Não criar tabelas paralelas para `profiles`, `fundos`, `notas_fiscais`, `operacoes`, `contas_escrow`, `movimentos_escrow`, `documentos` de compliance ou `logs_auditoria`. O novo modelo deve estender ou relacionar essas tabelas.

## 22. Critérios de aceite para a Fase 2

### Dados e integridade

- novo fundo e vínculo cedente–fundo cadastrados em homologação;
- nenhum novo registro depende somente de `cedentes.fundo_id`;
- FKs e checks impedem vínculo documental órfão;
- política e requisitos publicados têm versão única e hash;
- operação nova possui contexto completo e snapshot imutável;
- backfill legado é auditável e classificado.

### Fluxo funcional

- novo fluxo exige XML, DANFE/PDF e Pedido de Compra individualmente por NF;
- mesmo hash pode ser reutilizado sem bloquear o envio;
- novo fluxo não aparece na fila de aceite do sacado;
- fluxo atual com aceite continua funcionando;
- desembolso cria `cessao_efetivada_em` e requisitos CT-e/canhoto;
- NF só fica entregue com CT-e e canhoto aprovados;
- status financeiro não é usado como status logístico.

### Segurança

- todas as tabelas novas têm RLS e grants revisados;
- matriz de acesso testada para gestor, cedente, consultor, sacado e service role;
- uploads e downloads usam registro de Storage autorizado, sem path arbitrário;
- credenciais não aparecem no browser, snapshot, logs ou erros;
- policies de `UPDATE` têm `USING` e `WITH CHECK`;
- nenhuma autorização usa `raw_user_meta_data`.

### Histórico e operação

- cada documento analisado preserva versão, ator, data e resultado;
- cada template/CNAB/integração usado permanece identificável;
- remessa e tentativas têm chave de idempotência;
- concorrência de desembolso, Escrow e integração é testada;
- `supabase db lint`, advisors, testes RLS, Storage e regressão do fluxo atual passam em homologação.

## 23. Revisão crítica obrigatória

1. **Repositório documental:** híbrido. Legado especializado permanece; documentos novos usam núcleo genérico com vínculos tipados.
2. **Propriedade da política:** relacionamento `cedente_fundos`, porque a regra depende do par cedente–fundo.
3. **Normalização versus snapshot:** IDs, status, datas, gates e versões ficam normalizados; regras aplicadas e requisitos mínimos ficam no snapshot; o snapshot não substitui relações.
4. **CT-e:** entidade estruturada e documento. `ctes` guarda dados e estado; arquivos ficam em `documento_versoes`.
5. **Canhoto:** entidade própria, pois possui prazo, análise, aprovação e efeito sobre entrega.
6. **Controle de abstração:** uma ponte documental única com FKs tipadas, catálogo limitado, nenhuma tabela genérica para estados e nenhuma FK polimórfica por texto.
7. **Necessário na Fase 2:** bridge cedente–fundo, política/versionamento, requisitos, repositório documental, contexto/snapshot, entrega, CT-e, ponte CT-e–NF e canhoto.
8. **Adiável:** templates, CNAB versionado, integrações configuráveis, credenciais cifradas, outbox e deduplicação avançada de notificações, salvo se o fluxo da Fase 2 exigir algum deles.
9. **Bloqueios:** dados do fundo, campos jurídicos da política, retenção/Storage, CT-e, CNAB, integração, credenciais e grants/RLS de homologação.
10. **Menor risco:** bridge → política → contexto/snapshot → documentos/checklist → logística/CT-e/canhoto → templates/CNAB → integrações/idempotência → RLS/Storage endurecidos → constraints finais.

## 24. Conclusão e recomendação

A Fase 1.5 está concluída no aspecto de desenho: o modelo híbrido, o relacionamento multifundo, a política versionada, o snapshot, o repositório documental, o ciclo logístico e os domínios futuros estão definidos com integridade, RLS, Storage, histórico e compatibilidade legada.

Não é recomendado iniciar a implementação da Fase 2 imediatamente. Primeiro devem ser resolvidas as decisões pendentes da seção 20 e confirmados os dados reais de homologação. Depois disso, a Fase 2 pode começar pela migration de `cedente_fundos` e pelo cadastro controlado da primeira política, sempre mantendo `cedentes.fundo_id` e o fluxo atual durante o bridge.

Nenhum código, schema, tipo, RLS, bucket, migration, dependência, frontend, API ou banco foi alterado nesta fase. Nenhuma parte de Sinqia foi implementada.
