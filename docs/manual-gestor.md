# Manual do Gestor — Portal BW Antecipa

**Versão 1.1 — Abril de 2026**

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Dashboard — Central de Controle](#2-dashboard--central-de-controle)
3. [Cedentes](#3-cedentes)
4. [Notas Fiscais](#4-notas-fiscais)
5. [Operações](#5-operações)
6. [Contas Escrow](#6-contas-escrow)
7. [Documentos](#7-documentos)
8. [Relatórios](#8-relatórios)
9. [Auditoria](#9-auditoria)
10. [Configurações](#10-configurações)
    - [10.3 Testemunhas](#103-testemunhas)
11. [Dúvidas Frequentes](#11-dúvidas-frequentes)

---

## 1. Visão Geral

O portal do gestor é o centro de controle operacional da plataforma. Todas as aprovações, análises e decisões que movimentam o fluxo de antecipação passam por aqui.

**Fluxo resumido de uma operação:**

```
Cedente cadastra → Gestor aprova cadastro
→ Cedente sobe NFs → Gestor valida NFs
→ Cedente solicita antecipação → Sacado aprova cessão
→ Gestor define taxa e clica "Aprovar e Seguir" → Termo de Cessão gerado automaticamente
→ Gestor faz upload do Termo Assinado + Comprovante TED → Gestor clica "Desembolsar"
→ Valor creditado no escrow → Sacado paga → Gestor confirma liquidação
```

---

## 2. Dashboard — Central de Controle

A tela inicial oferece uma visão consolidada do estado atual da plataforma.

### 2.1 Indicadores principais

| Indicador | O que mostra |
|---|---|
| Cedentes | Total cadastrado, com quantos estão ativos |
| Operações Ativas | Count e volume total em R$ |
| Volume do Mês | Total de operações criadas no mês corrente |
| Saldo em Custódia | Soma de todos os saldos escrow |

### 2.2 Alertas automáticos

Quando há situações que requerem atenção, cards de alerta aparecem no topo:

- **Vermelho** — operações inadimplentes (clique para ir direto à lista de operações)
- **Amarelo** — operações aguardando análise
- **Azul** — documentos de cedentes pendentes de revisão

### 2.3 Operações recentes

As 8 operações mais recentes aparecem com razão social do cedente, data, status e valor bruto. Clique em qualquer uma para acessar o detalhe.

### 2.4 Links rápidos

Cards no rodapé levam para as seções principais com contadores em tempo real: Cedentes, NFs, Operações, Escrow e Auditoria.

---

## 3. Cedentes

### 3.1 Lista de cedentes

Acesse **Cedentes** no menu lateral para ver todos os cadastros. Use a busca por CNPJ ou razão social e o filtro de status para localizar rapidamente.

**Status possíveis:**

| Status | Significado |
|---|---|
| Pendente | Cadastro enviado, aguardando análise |
| Em Análise | Em revisão pelo gestor |
| Ativo | Cadastro aprovado, pode operar |
| Reprovado | Cadastro rejeitado |
| Bloqueado | Operação suspensa |

---

### 3.2 Detalhe do Cedente

Clique em **"Ver detalhes"** em um cedente para acessar a página completa, dividida em seções:

#### Dados Cadastrais

Informações da empresa (CNPJ, razão social, endereço, contato) e dados bancários da conta de recebimento. Estas informações foram preenchidas pelo próprio cedente no cadastro.

#### Representantes Legais

Lista todos os representantes cadastrados com nome, CPF, RG, cargo, e-mail e telefone. O representante principal é identificado visualmente.

#### Documentos da Empresa

Seis documentos obrigatórios que precisam ser aprovados antes de habilitar o cadastro:

| Documento |
|---|
| Contrato Social Atualizado |
| Cartão CNPJ |
| Comprovante de Endereço (últimos 90 dias) |
| Comprovante de Faturamento |
| Balanço Patrimonial (último exercício) |
| DRE |

#### Documentos por Representante

Para cada representante, três documentos obrigatórios e um opcional:

| Documento | Obrigatório |
|---|---|
| RG e CPF | Sim |
| Comprovante de Renda | Sim |
| Comprovante de Residência (últimos 90 dias) | Sim |
| Procuração | Não |

---

### 3.3 Analisar documentos

Para cada documento enviado, clique em **"Analisar"**:

1. O arquivo abre em preview (PDF ou imagem)
2. Clique em **"Aprovar"** ou **"Reprovar"**
3. Se reprovar, preencha obrigatoriamente o **motivo** — ele será exibido para o cedente

O cedente receberá uma notificação para cada documento analisado. Documentos reprovados podem ser reenviados pelo cedente para uma nova análise.

---

### 3.4 Aprovar o cadastro

O botão **"Aprovar Cadastro"** fica disponível somente quando:

- **Todos** os documentos obrigatórios da empresa estão **aprovados**
- **Todos** os documentos obrigatórios de **todos** os representantes estão **aprovados**
- O cedente não está no status **ativo**

Ao aprovar, o cedente passa para status **ativo** e pode submeter NFs e solicitar antecipações.

Para reprovar, clique em **"Reprovar Cadastro"** e informe um motivo. O cedente será notificado.

---

### 3.5 Configurar taxas pré-configuradas

Na seção **Taxas Pré-configuradas** da página do cedente, você define as faixas de taxa que serão aplicadas automaticamente quando o cedente solicitar uma antecipação:

1. Clique em **"Adicionar faixa"**
2. Defina o prazo mínimo (dias), prazo máximo (dias) e taxa (% a.m.)
3. Repita para cada faixa desejada
4. Clique em **"Salvar Taxas"**

> Exemplo: prazo de 1 a 30 dias → taxa 2,5% a.m.; prazo de 31 a 60 dias → taxa 3,0% a.m.

Essas taxas podem ser ajustadas manualmente no momento da aprovação de cada operação.

---

## 4. Notas Fiscais

### 4.1 Lista de NFs

Acesse **Notas Fiscais** no menu lateral para ver todas as NFs submetidas pelos cedentes.

**Indicadores no topo:**
- Pendentes de Análise
- Aprovadas
- Total de NFs
- Valor Total (excluindo canceladas)

**Filtros disponíveis:**
- Busca por número da NF, CNPJ ou razão social (emitente ou sacado)
- Status: Submetidas, Em Análise, Aprovadas, Em Antecipação, Aceitas, Contestadas, Liquidadas, Canceladas

A página carrega por padrão com o filtro **"Submetidas"** para priorizar o que precisa de análise.

---

### 4.2 Analisar uma NF

Clique em **"Analisar"** em qualquer NF para abrir o detalhe completo:

**Dados fiscais:**
- Número, série, chave de acesso
- Datas de emissão e vencimento
- Emitente (cedente) e destinatário (sacado)
- Valores: bruto, impostos (ICMS, ISS, PIS, COFINS, IPI), líquido

**Sidebar com resumo e preview do arquivo:**
- Resumo de valores com cálculo automático de impostos
- Preview do arquivo (PDF, imagem ou download para XML)
- Dias até o vencimento

**Ações:**
- **Aprovar NF** — libera a NF para ser incluída em uma antecipação
- **Reprovar** — requer motivo obrigatório; NF retorna para o cedente com a justificativa

---

### 4.3 Status das NFs

| Status | Significado |
|---|---|
| Submetida | Enviada pelo cedente, aguardando análise |
| Em Análise | Em revisão |
| Validada | Validada pelo gestor. Pronta para antecipação. |
| Em Antecipação | Incluída em uma operação, aguardando resposta do sacado |
| Aprovado pelo Sacado | Sacado confirmou a cessão |
| Contestada | Sacado contestou a cessão |
| Liquidada | NF paga e encerrada |
| Cancelada / Reprovada | Rejeitada |

---

## 5. Operações

### 5.1 Lista de operações

Acesse **Operações** no menu lateral. A lista exibe todas as solicitações de antecipação com:

- ID (8 primeiros caracteres)
- Cedente (razão social e CNPJ)
- Valor bruto total
- Taxa (% a.m.)
- Prazo (dias)
- Valor Líquido Desembolso (em verde)
- Status
- Botão **"Analisar"** ou **"Ver"**

**Filtros:**
- Busca por cedente, CNPJ ou ID
- Status: Solicitadas, Em Andamento, Liquidadas, Inadimplentes, Reprovadas, Canceladas

---

### 5.2 Analisar uma operação

Clique em **"Analisar"** em uma operação **Solicitada** para abrir o detalhe completo.

#### Tabela de NFs da operação

Lista todas as NFs incluídas com número, sacado, valor, valor antecipado, vencimento e status de aceite:

| Status da NF | Exibição |
|---|---|
| Aprovado pelo Sacado | Badge verde — pode ser aprovada |
| Aguard. aprovação | Badge amarelo — bloqueante para aprovação |
| Contestada | Badge laranja — botão "Remover" disponível |

#### Painel de análise (lateral direita)

**Taxas pré-configuradas do cedente** aparecem como botões de atalho. Clique em uma faixa para aplicar automaticamente a taxa.

**Campos editáveis:**
- **Taxa (% a.m.)** — pode ser a pré-configurada ou ajustada manualmente
- **Prazo (dias)** — sugerido automaticamente pelo vencimento mais distante das NFs
- **Valor Líquido Desembolso** — calculado pela fórmula, mas editável

O resumo abaixo dos campos mostra em tempo real:
- Valor Bruto
- (-) Desconto
- = Valor Líquido

#### Testemunhas do Termo

Na mesma área de análise, selecione as **duas testemunhas** que assinarão o Termo de Cessão:

1. Use os dropdowns **Testemunha 1** e **Testemunha 2** para escolher da lista de testemunhas cadastradas (ativas)
2. As duas testemunhas devem ser pessoas diferentes
3. Clique em **"Salvar Testemunhas"** para registrar a seleção

As testemunhas ficam salvas na operação e serão incluídas automaticamente no PDF do Termo de Cessão gerado na aprovação. Para gerenciar a lista global de testemunhas disponíveis, acesse **Configurações → Testemunhas**.

---

### 5.3 Pré-requisito: aprovação do sacado

O botão **"Aprovar e Seguir"** fica desabilitado enquanto houver NFs com status diferente de **"Aprovado pelo Sacado"**. Um aviso amarelo indica quantas NFs ainda aguardam resposta.

Isso garante que o sacado reconhece todas as cessões antes da aprovação da operação.

---

### 5.4 Remover NF contestada

Se o sacado contestou uma NF, ela aparece com badge laranja e um botão **"Remover"** na linha. Ao clicar:

- A NF é desvinculada da operação
- O status da NF reverte para **"Validada"** (disponível para nova operação futura)
- O **Valor Bruto Total** da operação é recalculado automaticamente com as NFs restantes
- Se não restar nenhuma NF, a operação é **cancelada automaticamente**

> O botão **"Remover"** está disponível apenas enquanto a operação estiver com status **"Solicitada"** ou **"Em Análise"**. Após "Aprovar e Seguir", as NFs ficam fixas na operação.

---

### 5.5 Aprovar uma operação ("Aprovar e Seguir")

Com todas as NFs com aprovação do sacado e taxa/prazo definidos:

1. Clique em **"Aprovar e Seguir"**
2. O sistema:
   - Registra `taxa_desagio` e `valor_antecipado` em cada NF individualmente
   - Gera o **Termo de Cessão** automaticamente (PDF)
   - Atualiza o status da operação para **"Aprovada"**
3. A página permanece aberta para a etapa de documentação e desembolso

---

### 5.6 Documentos e desembolso (operação "Aprovada")

Após "Aprovar e Seguir", a operação entra no status **"Aprovada"** e uma nova seção é exibida com as etapas para o desembolso:

#### Downloads disponíveis

| Documento | Descrição |
|---|---|
| Contrato Mãe | Contrato de cessão vinculado ao cedente |
| Termo de Cessão | PDF gerado automaticamente na aprovação |

Clique nos botões de download para obter os PDFs. Caso queira regerar um documento, um aviso de confirmação aparece se já houver versão assinada registrada.

#### Gerar CNAB 444

O arquivo CNAB 444 é o arquivo de remessa enviado à administradora do FIDC. Cada NF da operação gera uma linha de detalhe no formato padrão de 444 caracteres.

1. Clique em **"Gerar CNAB"**
2. O navegador fará o download automático do arquivo `.REM`
3. O nome segue o padrão `REMESSA_XXXXXXXX.REM`

> O arquivo segue o layout CNAB 444 do Banco do Brasil com código de originador fixo do FIDC DLZ. Importe no sistema da administradora para registrar a cessão.

#### Upload de documentos assinados

Antes de desembolsar, faça o upload dos dois documentos obrigatórios:

| Documento | Descrição |
|---|---|
| Termo de Cessão Assinado | PDF do termo após assinatura das partes e testemunhas |
| Comprovante de Desembolso (TED) | Comprovante do TED realizado ao cedente |

Para cada documento:
1. Clique no botão de upload
2. Selecione o arquivo (PDF, JPG ou PNG)
3. O arquivo é salvo e o link de download fica disponível

#### Botão "Desembolsar"

O botão **"Desembolsar"** só é habilitado quando **ambos os documentos** acima estiverem enviados. Ao clicar:

- O status da operação vai para **"Em Andamento"**
- O valor líquido é creditado na conta Escrow do cedente
- O cedente recebe uma notificação

---

### 5.7 Reprovar uma operação

Clique em **"Reprovar"**, preencha o motivo e confirme. O cedente será notificado e as NFs retornam ao status **"Validada"** para uma nova solicitação futura.

---

### 5.8 Confirmar liquidação e inadimplência

Para operações **Em Andamento**:

- **"Confirmar Liquidação"** — encerra a operação como paga; NFs passam para **"Liquidada"**
- **"Marcar Inadimplente"** — registra o não pagamento pelo sacado

---

### 5.9 Status das operações

| Status | Significado |
|---|---|
| Solicitada | Aguardando análise do gestor |
| Em Análise | Em revisão |
| Aprovada | Gestor aprovou os termos. Aguardando upload de docs e desembolso. |
| Em Andamento | Desembolso realizado. Valor creditado no escrow do cedente. |
| Liquidada | Sacado pagou; operação encerrada |
| Inadimplente | Vencida e não paga |
| Reprovada | Rejeitada pelo gestor |
| Cancelada | Cancelada pelo cedente ou gestor |

---

## 6. Contas Escrow

### 6.1 Lista de contas

Acesse **Escrow** no menu lateral para ver todas as contas de custódia dos cedentes.

**Indicadores globais:**
- Total de contas (com quantas estão ativas)
- Saldo Disponível Total
- Saldo Bloqueado Total
- Volume Custodiado (disponível + bloqueado)

**A tabela exibe** por conta: identificador, cedente, saldo disponível, saldo bloqueado, status e data de criação.

---

### 6.2 Extrato de uma conta

Clique em **"Extrato"** para ver o histórico de movimentos de um cedente específico.

**Filtros:**
- Data início e data fim
- Tipo: Todos, Créditos, Débitos

**Cada linha mostra:** data/hora, tipo (crédito/débito), descrição, valor e saldo após a movimentação.

> Os movimentos são sincronizados via integração com sistema bancário externo (API `/api/escrow/sync`).

---

## 7. Documentos

Acesse **Documentos** no menu lateral para uma visão centralizada de todos os documentos enviados por todos os cedentes, sem precisar entrar em cada cadastro individualmente.

**Indicadores:**
- Pendentes (enviados + em análise)
- Aprovados
- Reprovados
- Total

**Filtros:**
- Busca por cedente, CNPJ ou tipo de documento
- Status: Enviados, Em Análise, Aprovados, Reprovados

O botão **"Analisar"** aparece apenas para documentos com status **"Enviado"** ou **"Em Análise"**. O modal de análise funciona da mesma forma que na página do cedente.

---

## 8. Relatórios

Acesse **Relatórios** no menu lateral para análises gerenciais por período.

### 8.1 Filtro de mês

Selecione o mês desejado no dropdown. Apenas meses com operações registradas aparecem na lista.

### 8.2 KPIs do mês

| Indicador | O que calcula |
|---|---|
| Volume Bruto | Soma do valor bruto de operações do mês |
| Receita | Diferença entre valor bruto e líquido (deságio) com taxa média |
| Volume Total Acumulado | Soma histórica de todas as operações válidas |
| Inadimplência | Quantidade de operações inadimplentes |

### 8.3 Resumo por status

Cards mostrando quantidade de operações em cada status no mês: Solicitadas, Em Andamento, Liquidadas, Reprovadas, Canceladas.

### 8.4 Volume por Cedente

Tabela com desempenho individual de cada cedente no mês e no acumulado:

- Volume e quantidade de operações no mês
- Volume e quantidade de operações totais
- Inadimplentes (destacado em vermelho se houver)

A última linha da tabela mostra os totais consolidados.

---

## 9. Auditoria

Acesse **Auditoria** no menu lateral para o histórico completo de todas as ações realizadas no sistema.

### 9.1 O que é registrado

Toda ação relevante gera um log automático: cadastros, aprovações, reprovações, envio e análise de documentos, solicitação e aprovação de operações, movimentos escrow, aceites e contestações.

### 9.2 Campos de cada log

- Tipo de evento (ex: `OPERACAO_APROVADA`, `DOCUMENTO_REPROVADO`)
- Usuário que executou (nome, e-mail e papel no sistema)
- Entidade afetada (tipo e ID)
- Data e hora
- **Dados antes** da alteração (JSON, fundo vermelho)
- **Dados depois** da alteração (JSON, fundo verde)

### 9.3 Filtros disponíveis

- Busca livre por evento, usuário ou entidade
- Tipo de evento (dropdown com todos os tipos únicos presentes)
- Data início e data fim

Clique em qualquer linha para expandir e ver os dados antes/depois.

### 9.4 Principais tipos de evento

| Categoria | Exemplos de evento |
|---|---|
| Cedentes | CEDENTE_CADASTRADO, CEDENTE_APROVADO, CEDENTE_REPROVADO |
| Documentos | DOCUMENTO_ENVIADO, DOCUMENTO_APROVADO, DOCUMENTO_REPROVADO |
| NFs | NF_CADASTRADA, NF_SUBMETIDA, NF_APROVADA, NF_REPROVADA |
| Operações | OPERACAO_SOLICITADA, OPERACAO_APROVADA, OPERACAO_LIQUIDADA, OPERACAO_INADIMPLENTE |
| Escrow | ESCROW_CREDITO, ESCROW_DEBITO |
| Cessão | CESSAO_ACEITA, CESSAO_CONTESTADA, NF_REMOVIDA_CONTESTACAO |
| Taxas | TAXAS_ATUALIZADAS |

---

## 10. Configurações

Acesse **Configurações** no menu lateral para informações sobre o sistema e integrações.

### 10.1 Taxas e parâmetros

As taxas são configuradas individualmente por cedente. Para ajustar:
1. Acesse **Cedentes**
2. Abra o detalhe do cedente
3. Vá até a seção **Taxas Pré-configuradas**

### 10.2 Integrações API

| Endpoint | Função |
|---|---|
| `POST /api/escrow/sync` | Sincronizar movimentos escrow com o sistema bancário externo |
| `GET /api/cron/vencimentos` | Verificar vencimentos, enviar alertas D-5/D-1 e marcar inadimplentes |

Essas chamadas requerem as variáveis de ambiente `ESCROW_API_KEY` e `CRON_SECRET` configuradas no servidor.

---

### 10.3 Testemunhas

Acesse **Configurações → Testemunhas** para gerenciar a lista global de testemunhas disponíveis para assinar os Termos de Cessão.

#### Cadastrar uma testemunha

1. Preencha **Nome**, **CPF** e (opcionalmente) **E-mail**
2. Clique em **"Adicionar Testemunha"**
3. A testemunha aparece na lista e já fica disponível para seleção nas operações

#### Ativar / Desativar

Clique no botão **"Desativar"** ou **"Ativar"** ao lado de cada testemunha para controlá-la sem excluí-la. Testemunhas inativas não aparecem nos dropdowns de seleção das operações.

> Mantenha a lista atualizada — apenas testemunhas ativas aparecem no momento da análise de uma operação.

---

## 11. Dúvidas Frequentes

**O botão "Aprovar Cadastro" não aparece. Por quê?**
Todos os documentos obrigatórios (empresa e todos os representantes) precisam estar com status **"Aprovado"**. Verifique se há algum documento pendente ou reprovado.

**O botão "Aprovar e Seguir" está desabilitado. Por quê?**
Há NFs na operação que ainda não foram aprovadas pelo sacado. Aguarde a aprovação ou, em caso de contestação, remova a NF contestada e prossiga com as restantes.

**O botão "Desembolsar" está desabilitado. Por quê?**
Os dois documentos obrigatórios ainda não foram enviados: Termo de Cessão Assinado e Comprovante de Desembolso (TED). Faça o upload de ambos na seção de documentos da operação para habilitar o botão.

**Como remover uma NF contestada de uma operação?**
Na tabela de NFs da operação, clique no botão **"Remover"** que aparece na linha de cada NF com status **"Contestada"**. O valor total da operação é recalculado automaticamente. Atenção: após clicar em "Aprovar e Seguir", não é mais possível remover NFs da operação.

**O cedente disse que enviou um documento mas não aparece para analisar. O que verificar?**
Acesse **Documentos** no menu, filtre por **"Enviados"** e busque pelo cedente. Se o documento não aparecer, peça ao cedente para verificar se o upload foi concluído (status deve sair de "Aguardando Envio").

**Como gero o Contrato Mãe de um cedente?**
Na página de detalhe do cedente, o Contrato Mãe é gerado/baixado pelo botão específico na seção de documentos. O PDF é gerado automaticamente com os dados cadastrais e de fundo.

**Como gero o Termo de Cessão de uma operação?**
O Termo é gerado automaticamente ao clicar em "Aprovar e Seguir". Acesse o detalhe da operação e clique no botão de download disponível quando ela estiver com status **"Aprovada"**, **"Em Andamento"** ou **"Liquidada"**.

**Como gero o arquivo CNAB 444 para a administradora?**
No detalhe da operação com status **"Aprovada"**, clique em **"Gerar CNAB"** na seção de documentos. O arquivo `.REM` será baixado automaticamente e pode ser importado no sistema da administradora do FIDC.

**Como seleciono as testemunhas do Termo de Cessão?**
Na página de análise da operação, role até a seção **"Testemunhas do Termo"**, selecione as duas testemunhas nos dropdowns e clique em **"Salvar Testemunhas"**. Para cadastrar novas testemunhas, acesse **Configurações → Testemunhas**.

**O cedente contestou o valor do escrow. Como verificar?**
Acesse **Escrow**, localize a conta do cedente, clique em **"Extrato"** e use os filtros de data para localizar o movimento específico.

---

*Para suporte técnico, consulte a documentação interna ou o time de desenvolvimento.*