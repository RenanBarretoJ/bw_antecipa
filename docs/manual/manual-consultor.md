# Manual do Consultor — Portal BW Antecipa

**Versão 1.1 — Abril de 2026**

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Dashboard — Painel Principal](#2-dashboard--painel-principal)
3. [Minha Carteira](#3-minha-carteira)
4. [Operações](#4-operações)
5. [Extratos Escrow](#5-extratos-escrow)
6. [Relatórios e Comissões](#6-relatórios-e-comissões)
7. [Notificações](#7-notificações)
8. [Dúvidas Frequentes](#8-dúvidas-frequentes)

---

## 1. Visão Geral

O portal do consultor oferece visibilidade sobre a carteira de cedentes vinculados ao seu perfil, as operações de antecipação em andamento, os saldos escrow e as comissões estimadas por período.

O acesso é **somente leitura** — você acompanha o andamento das operações, mas as aprovações e ações operacionais são realizadas pelo gestor BW.

---

## 2. Dashboard — Painel Principal

A tela inicial resume sua carteira com os principais indicadores.

### 2.1 Indicadores principais

| Indicador | O que mostra |
|---|---|
| Cedentes Ativos | Total na sua carteira e quantos estão ativos |
| Operações Ativas | Quantidade e volume total em R$ |
| Volume do Mês | Operações criadas no mês corrente |
| Comissão Estimada | Estimativa de comissão sobre operações em andamento |

### 2.2 Minha Carteira (resumo)

Lista os primeiros 5 cedentes da sua carteira com razão social, CNPJ, status e percentual de comissão configurado. Para ver todos, clique em **"Ver todos"**.

### 2.3 Operações Recentes

Lista os 5 últimos pedidos de antecipação dos seus cedentes com cedente, data, status e valor bruto. Para ver todas, clique em **"Ver todas"**.

### 2.4 Acesso rápido

Três atalhos no rodapé do Dashboard levam para: **Carteira**, **Operações** e **Relatórios**.

---

## 3. Minha Carteira

Acesse **Carteira** no menu lateral para ver todos os cedentes vinculados ao seu perfil.

### 3.1 Indicadores

- **Total de cedentes** na carteira
- **Cedentes ativos** (habilitados para operar)
- **Volume total operado** (soma histórica das operações)

### 3.2 Busca

Use o campo de busca para filtrar por razão social, CNPJ ou nome fantasia.

### 3.3 Informações por cedente

Para cada cedente da carteira, você vê:

| Campo | Descrição |
|---|---|
| Razão Social | Nome registrado da empresa |
| CNPJ | Formatado |
| Status | Ativo, Pendente, Em Análise, Reprovado ou Bloqueado |
| Volume Operado | Soma de todas as operações do cedente |
| Operações Ativas | Quantidade de operações em andamento |
| Comissão | Percentual configurado (em verde) |

### 3.4 Status do cedente

| Status | Significado |
|---|---|
| Ativo | Cadastro aprovado, pode solicitar antecipações |
| Pendente | Cadastro enviado, aguardando análise do gestor |
| Em Análise | Em revisão pelo gestor |
| Reprovado | Cadastro não aprovado |
| Bloqueado | Operação suspensa |

---

## 4. Operações

Acesse **Operações** no menu lateral para acompanhar todas as solicitações de antecipação dos seus cedentes.

### 4.1 Filtros disponíveis

- **Busca** por razão social ou CNPJ do cedente
- **Status:** Todos, Em Andamento, Liquidadas, Solicitadas

### 4.2 Informações por operação

| Coluna | Descrição |
|---|---|
| ID | Primeiros 8 caracteres do identificador |
| Cedente | Razão social e CNPJ |
| Valor Bruto | Soma das NFs incluídas |
| Taxa | % a.m. aplicada (ou "—" se não definida) |
| Valor Líquido | Valor que o cedente receberá (em verde) |
| Vencimento | Data de vencimento da operação |
| Status | Status atual da operação |
| Criada em | Data da solicitação |

### 4.3 Status das operações

| Status | Significado |
|---|---|
| Solicitada | Aguardando análise do gestor |
| Em Análise | Em revisão |
| Aprovada | Gestor aprovou os termos; aguardando desembolso |
| Em Andamento | Desembolso realizado; valor creditado ao cedente |
| Liquidada | Sacado pagou; operação encerrada |
| Inadimplente | Vencida e não paga |
| Reprovada | Rejeitada pelo gestor |
| Cancelada | Cancelada pelo cedente ou gestor |

> Esta página é somente leitura. Para qualquer ação sobre as operações, o cedente ou o gestor devem ser acionados.

---

## 5. Extratos Escrow

Acesse **Escrow** no menu lateral para visualizar os saldos e movimentos das contas escrow dos seus cedentes.

### 5.1 Lista de contas

A tabela exibe todas as contas escrow dos cedentes da sua carteira:

| Coluna | Descrição |
|---|---|
| Identificador | Código da conta (em monospace) |
| Cedente | Razão social e CNPJ |
| Disponível | Saldo livre para movimentação (verde) |
| Bloqueado | Saldo retido como garantia (amarelo) |
| Status | Ativa ou Inativa |

Use a busca para filtrar por identificador, razão social ou CNPJ.

---

### 5.2 Extrato detalhado de uma conta

Clique em **"Ver extrato"** na linha de qualquer conta para acessar o histórico de movimentos.

**Informações da conta:**
- Identificador, cedente e CNPJ
- Saldo disponível e bloqueado

**Filtros de período:**
- Data início e data fim

**Cada linha do extrato:**

| Campo | Descrição |
|---|---|
| Data | Data e hora da movimentação |
| Tipo | Crédito (verde) ou Débito (vermelho) |
| Descrição | Descrição da movimentação |
| Valor | Com sinal + (crédito) ou − (débito), colorido |
| Saldo Após | Saldo da conta após o movimento |

> Esta visualização é **somente leitura**. Nenhuma movimentação pode ser realizada pelo consultor.

---

## 6. Relatórios e Comissões

Acesse **Relatórios** no menu lateral para acompanhar sua performance e comissões por período.

### 6.1 Selecionar período

Escolha o mês no dropdown no topo da página. Apenas meses com operações registradas são exibidos.

### 6.2 KPIs do período

| Indicador | O que calcula |
|---|---|
| Volume no Mês | Soma dos valores líquidos das operações do mês |
| Comissão no Mês | Comissão estimada sobre o volume do mês |
| Volume Acumulado | Soma histórica de todas as operações |
| Cedentes Ativos | Quantidade de cedentes com operações no período |

### 6.3 Tabela de comissões por cedente

A tabela mostra o desempenho individual de cada cedente e a comissão calculada:

| Coluna | Descrição |
|---|---|
| Cedente | Razão social e CNPJ |
| Status | Status atual do cedente |
| Volume no Mês | Soma das operações do mês |
| Ops no Mês | Quantidade de operações |
| % Comissão | Percentual acordado |
| Comissão | Valor estimado (em verde, em negrito) |
| Volume Total | Volume histórico acumulado |

A última linha da tabela exibe os **totais consolidados** de comissão e volume.

Os cedentes com maior comissão no mês aparecem no topo da tabela.

### 6.4 Como a comissão é calculada

```
Comissão = Volume Líquido do Mês × Percentual de Comissão / 100
```

Apenas operações com status **"Em Andamento"** e **"Liquidada"** são incluídas no cálculo.

> **Atenção:** Os valores exibidos são **estimados**. Os valores finais de comissão são confirmados e pagos pelo gestor BW conforme acordado contratualmente.

---

## 7. Notificações

Acesse **Notificações** no menu lateral para ver alertas e atualizações sobre sua carteira.

### 7.1 Tipos de notificações

| Tipo | Cor | Exemplos |
|---|---|---|
| Sucesso | Verde | Operação liquidada, novo cedente ativo |
| Alerta | Amarelo | Cessão contestada, cedente inadimplente |
| Erro | Vermelho | Falha em algum processo |
| Info | Azul | Atualizações gerais |

### 7.2 Gerenciar notificações

- Notificações não lidas têm destaque visual (borda azul e ponto indicador)
- Clique em **"Marcar como lida"** para arquivar individualmente
- Clique em **"Marcar todas como lidas"** para limpar todas de uma vez
- Use as abas **"Todas"**, **"Não lidas"** e **"Lidas"** para filtrar

As notificações chegam em **tempo real** — não é necessário recarregar a página.

---

## 8. Dúvidas Frequentes

**Posso realizar alguma ação nas operações ou documentos dos cedentes?**
Não. O portal do consultor é inteiramente somente leitura. Aprovações, análises e ações operacionais são realizadas exclusivamente pelo gestor BW.

**Como sei quando uma operação de um cedente foi aprovada?**
Você receberá uma notificação automática. Também pode verificar a aba **Operações** filtrada por **"Em Andamento"**.

**Meu percentual de comissão está incorreto. O que fazer?**
O percentual de comissão é configurado pelo gestor BW no cadastro do vínculo entre você e o cedente. Entre em contato com o time BW para solicitar a correção.

**Por que um cedente da minha carteira está com status "Pendente"?**
O cadastro foi enviado mas ainda não foi analisado ou aprovado pelo gestor. Você pode acompanhar a mudança de status na página **Carteira**.

**Os valores de comissão exibidos nos relatórios são os definitivos?**
Não. São estimativas baseadas nas operações em andamento e liquidadas no período. Os valores confirmados para pagamento são definidos pelo gestor BW.

**Um cedente da minha carteira teve uma NF contestada pelo sacado. Serei notificado?**
Sim. O sistema envia notificações automáticas para eventos relevantes da sua carteira, incluindo contestações.

**Não estou vendo o extrato de um cedente específico. Por quê?**
A conta escrow do cedente pode ainda não ter sido criada (isso ocorre automaticamente após a aprovação do cadastro) ou o cedente pode não ter operações com movimentações ainda.

---

*Para suporte, entre em contato com a equipe BW Antecipa.*