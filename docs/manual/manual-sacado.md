# Manual do Sacado — Portal BW Antecipa

**Versão 1.1 — Abril de 2026**

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Dashboard — Painel Principal](#2-dashboard--painel-principal)
3. [Notas Fiscais Recebidas](#3-notas-fiscais-recebidas)
4. [Aprovação de Cessão](#4-aprovação-de-cessão)
5. [Histórico de Pagamentos](#5-histórico-de-pagamentos)
6. [Notificações](#6-notificações)
7. [Dúvidas Frequentes](#7-dúvidas-frequentes)

---

## 1. Visão Geral

O Portal BW Antecipa permite que você, como sacado (destinatário das notas fiscais), acompanhe suas obrigações de pagamento, confirme ou conteste cessões de crédito e informe pagamentos realizados.

Quando um fornecedor (cedente) antecipa uma nota fiscal emitida contra sua empresa, o crédito é cedido ao fundo de antecipação. A partir daí, o pagamento deve ser feito diretamente ao fundo, na conta escrow indicada — não mais ao fornecedor.

---

## 2. Dashboard — Painel Principal

A tela inicial resume sua posição financeira com as obrigações de pagamento em aberto.

### 2.1 Indicadores principais

| Indicador | O que significa |
|---|---|
| Total a Pagar | Soma de todos os valores em aberto |
| Vencidos | NFs cujo vencimento já passou |
| Vencem Hoje | Valores com vencimento no dia atual |
| Próximos 7 Dias | Vencimentos dos próximos 7 dias |

### 2.2 Calendário de Vencimentos

Lista as NFs agrupadas por data de vencimento. Para cada data, você vê:

- Valor total do dia
- NFs individuais com número, cedente e valor
- Indicador de urgência:
  - **Verde** — vencimento futuro (mais de 5 dias)
  - **Amarelo** — vencendo em breve (até 5 dias)
  - **Vermelho** — vencido

### 2.3 Pagamentos por Cedente

Agrupa as NFs por fornecedor, mostrando:

- Razão social e CNPJ do cedente
- Total devido e quantidade de NFs
- Conta escrow para pagamento (quando informada)

> **Atenção:** O pagamento deve ser feito para a conta escrow indicada, não diretamente para o fornecedor.

### 2.4 Acesso rápido

No rodapé do Dashboard, três atalhos levam para:
- **NFs Recebidas** — lista completa de notas fiscais
- **Aprovação de Cessão** — NFs aguardando confirmação
- **Histórico de Pagamentos** — todas as operações

---

## 3. Notas Fiscais Recebidas

Acesse **NFs Recebidas** no menu lateral para consultar todas as notas fiscais emitidas contra a sua empresa.

### 3.1 Filtros disponíveis

- **Busca:** por número da NF, razão social ou CNPJ do cedente
- **Status:**
  - Cedidas (a pagar)
  - Liquidadas
  - Aprovadas

### 3.2 Indicadores

No topo da página, quatro cards mostram:

- Total de NFs
- Cedidas (com cessão ativa)
- Liquidadas (pagas)
- Vencidas (em vermelho, requerem atenção)

### 3.3 Status das notas fiscais

| Status | Significado |
|---|---|
| Validada | NF validada pelo gestor, ainda não cedida |
| Cedida (Em Antecipação) | Cessão ativa — o pagamento vai para o fundo |
| Aprovado pelo Sacado | Você confirmou a cessão |
| Contestada | Você contestou a cessão |
| Liquidada | NF paga e encerrada |
| Cancelada | NF cancelada |

> NFs vencidas aparecem com a data em vermelho e a indicação **(vencido)**.

---

## 4. Aprovação de Cessão

Quando um fornecedor cede uma NF ao fundo de antecipação, você precisa confirmar ou contestar essa cessão. Acesse **Aprovação de Cessão** no menu lateral.

### 4.1 O que aparece nessa tela

A tela exibe uma tabela com todas as NFs cedidas pendentes de resposta, com:

- Número da NF
- Cedente (emitente) — razão social e CNPJ
- Valor bruto
- Data de vencimento

### 4.2 Filtros disponíveis

Use os filtros no topo da tabela para localizar NFs específicas:

| Filtro | Como usar |
|---|---|
| Busca | Por número da NF, razão social ou CNPJ do cedente |
| Cedente | Dropdown com todos os emitentes presentes na lista |
| Vencimento de / até | Faixa de datas de vencimento |
| Valor mín / máx | Faixa de valor bruto |

### 4.3 Aprovar uma cessão individualmente

1. Localize a NF na tabela
2. Clique em **"Aprovar Cessão"** (botão verde)
3. O sistema registra a aprovação e notifica o gestor e o cedente

Ao aprovar, você confirma que reconhece a cessão e que o pagamento será feito para a conta escrow do fundo, não para o fornecedor.

### 4.4 Aprovação em lote

Para aprovar múltiplas NFs de uma vez:

1. Marque as caixas de seleção na coluna da esquerda para cada NF desejada
2. Uma barra de ação aparece no topo da tabela mostrando a quantidade selecionada e o valor total
3. Clique em **"Aprovar N NFs"** para confirmar todas de uma vez

> Use os filtros para refinar a lista antes de selecionar em lote. Por exemplo, filtre por cedente para aprovar todas as NFs de um fornecedor específico.

### 4.5 Contestar uma cessão

Se houver algum problema com a NF (ex: nota duplicada, valor incorreto, NF não reconhecida), você pode contestar:

1. Clique em **"Contestar"** (botão vermelho)
2. Uma linha se abre abaixo da NF com o campo de motivo
3. Preencha o **"Motivo da contestação"** — é obrigatório
4. Clique em **"Confirmar Contestação"**

O gestor BW será notificado imediatamente. O cedente também receberá uma notificação com o motivo informado.

> **Importante:** A contestação impede que a NF avance na operação de antecipação. O gestor decidirá o próximo passo.

### 4.6 Quando não há cessões pendentes

A tela exibe a mensagem *"Nenhuma cessão pendente de aprovação"*. Isso significa que todas as cessões foram respondidas ou não há NFs cedidas no momento.

---

## 5. Histórico de Pagamentos

Acesse **Histórico de Pagamentos** no menu lateral para acompanhar todas as operações de antecipação vinculadas à sua empresa.

### 5.1 Indicadores

| Indicador | O que significa |
|---|---|
| Total a Pagar | Operações em andamento aguardando pagamento |
| Total Pago | Operações já liquidadas |
| Total Operações | Quantidade total de operações |

### 5.2 Lista de operações

Para cada operação, você vê:

- ID da operação
- Status
- Cedente (razão social e CNPJ)
- Valor bruto total
- Data de vencimento (em vermelho se vencida)
- Conta escrow para pagamento

### 5.3 Informar um pagamento

Quando realizar o pagamento de uma operação, informe no portal para que o gestor possa confirmar a liquidação:

1. Localize a operação com status **"A pagar"**
2. Clique em **"Informar Pagamento"**
3. O gestor será notificado e confirmará a liquidação

> O botão **"Informar Pagamento"** aparece apenas em operações com status **"Em Andamento"**.

### 5.4 Filtros

- **Busca:** por razão social ou CNPJ do cedente
- **Status:**
  - A pagar (operações em andamento)
  - Pagas (liquidadas)
  - Inadimplentes

### 5.5 Status das operações

| Status | Significado |
|---|---|
| A pagar | Operação aprovada, aguardando pagamento |
| Pago | Operação liquidada pelo gestor |
| Inadimplente | Operação vencida e não paga |
| Vencido | Indicação adicional quando a data já passou |

---

## 6. Notificações

Acesse **Notificações** no menu lateral para ver todos os alertas e atualizações da sua conta.

### 6.1 Tipos de notificações

| Tipo | Exemplos |
|---|---|
| Sucesso | Cessão aceita confirmada |
| Alerta | Nova NF cedida aguardando aceite |
| Erro | Falha em algum processo |
| Info | Atualizações gerais |

### 6.2 Gerenciar notificações

- Notificações não lidas têm destaque visual com ponto azul
- Clique em **"Marcar como lida"** para arquivar individualmente
- Clique em **"Marcar todas como lidas"** para limpar de uma vez
- Use as abas **"Todas"**, **"Não lidas"** e **"Lidas"** para filtrar

As notificações chegam em tempo real — não é preciso recarregar a página.

---

## 7. Dúvidas Frequentes

**Recebi uma notificação de cessão. O que devo fazer?**
Acesse **Aprovação de Cessão** no menu e confirme ou conteste a cessão da NF indicada. O prazo para resposta é comunicado pelo gestor BW.

**Para qual conta devo pagar?**
Na tela de Histórico de Pagamentos e no Dashboard, a conta escrow do fundo aparece ao lado de cada operação. O pagamento deve ser feito para essa conta — não para o fornecedor.

**Paguei mas o status ainda mostra "A pagar". O que faço?**
Clique em **"Informar Pagamento"** na linha da operação. O gestor confirmará e atualizará o status para "Pago".

**Contestei uma cessão por engano. Como desfazer?**
Não é possível desfazer a contestação diretamente pelo portal. Entre em contato com a equipe BW Antecipa para regularizar.

**O que acontece se eu não aprovar nem contestar uma cessão?**
A operação fica bloqueada para aprovação pelo gestor até que todas as cessões sejam respondidas. Recomendamos responder o quanto antes para não atrasar o processo.

**Uma NF está como "Vencida" no meu Dashboard. O que devo fazer?**
Realize o pagamento para a conta escrow indicada e clique em **"Informar Pagamento"** no Histórico. Se já pagou, confirme com o gestor BW.

---

*Para suporte, entre em contato com a equipe BW Antecipa.*