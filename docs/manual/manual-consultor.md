# Manual do Consultor — BW Antecipa

**Versão 2.0 — Agosto de 2026**

Este manual descreve a consulta da carteira atribuída ao perfil **Consultor**. O perfil é de acompanhamento: não aprova, reprova, cadastra, altera ou desembolsa operações.

## Sumário

1. [Acesso e segurança](#1-acesso-e-segurança)
2. [Navegação e limite de acesso](#2-navegação-e-limite-de-acesso)
3. [Dashboard](#3-dashboard)
4. [Minha Carteira](#4-minha-carteira)
5. [Operações](#5-operações)
6. [Extratos Escrow](#6-extratos-escrow)
7. [Relatórios e comissões](#7-relatórios-e-comissões)
8. [Notificações e segurança da conta](#8-notificações-e-segurança-da-conta)
9. [Status apresentados](#9-status-apresentados)
10. [Dúvidas frequentes](#10-dúvidas-frequentes)

## 1. Acesso e segurança

### 1.1 Entrar no portal

1. Informe e-mail e senha.
2. Confirme o código de seis dígitos do aplicativo autenticador.
3. Se o MFA ainda não estiver configurado, conclua a configuração e guarde os códigos de recuperação.

Todo novo login exige senha e TOTP. A confirmação vale somente para a sessão atual; outro navegador ou dispositivo exige novo código.

### 1.2 Sessão de 24 horas

- A sessão de segurança permanece válida por **24 horas corridas**.
- Atualizar a página ou navegar não reinicia o prazo.
- Ao completar 24 horas, o logout ocorre automaticamente.
- Para continuar, entre novamente com senha e TOTP.
- Ações comuns não solicitam novo código durante a janela válida.
- Ações sensíveis podem pedir nova confirmação.
- O logout voluntário encerra somente a sessão atual.

Não compartilhe senha, TOTP ou códigos de recuperação. Encerre a sessão ao terminar, especialmente em computador compartilhado.

## 2. Navegação e limite de acesso

O menu do Consultor contém:

- **Dashboard**;
- **Minha Carteira**;
- **Operações**;
- **Extratos Escrow**;
- **Relatórios**;
- **Notificações**;
- **Minha Segurança**.

O Consultor visualiza somente os cedentes e dados financeiros autorizados da própria carteira. Não existe seletor de fundo para esse perfil na interface atual.

O acesso é de consulta. O Consultor não pode:

- vincular cedentes a fundos;
- configurar políticas, documentos, CNAB ou integrações;
- aprovar ou reprovar NFs;
- aprovar, reprovar, desembolsar ou liquidar operações;
- movimentar contas escrow;
- acessar cedentes de outra carteira.

## 3. Dashboard

O **Dashboard do Consultor** apresenta:

- cedentes ativos e total da carteira;
- operações ativas e respectivo volume;
- volume do mês de operações não canceladas;
- comissão estimada sobre operações em andamento;
- cedentes recentes da carteira;
- operações recentes;
- atalhos para carteira, operações e relatórios.

Os valores são indicadores de acompanhamento. A comissão exibida é uma estimativa; o valor final é confirmado pelo gestor.

## 4. Minha Carteira

Em **Minha Carteira**, consulte os cedentes sob sua responsabilidade.

A tela apresenta:

- total de cedentes;
- quantidade de cedentes ativos;
- volume total operado;
- busca por razão social, nome fantasia ou CNPJ;
- status do cedente;
- CNPJ e nome fantasia;
- volume operado;
- operações ativas;
- percentual de comissão cadastrado para o vínculo.

Os dados são resumidos. O perfil não possui acesso irrestrito a todo o cadastro ou documentação do cedente.

## 5. Operações

Em **Operações**, acompanhe as solicitações relacionadas à carteira autorizada.

A tela oferece:

- indicadores de total, pendências, operações em andamento e valor ativo;
- busca por operação ou cedente;
- filtro por status;
- ordenação;
- paginação;
- valores bruto e líquido;
- taxa, prazo, vencimento e status, quando disponíveis.

O Consultor não vê botões de aprovação, reprovação, cancelamento, desembolso ou liquidação. Caso identifique divergência, comunique o gestor responsável.

## 6. Extratos Escrow

Em **Extratos Escrow**, o Consultor acessa, em somente leitura, as contas dos cedentes da própria carteira quando elas existirem.

É possível:

- buscar por identificador, cedente ou CNPJ;
- filtrar por **Ativa**, **Bloqueada** ou **Encerrada**;
- filtrar por cedente;
- consultar valores disponível e bloqueado;
- navegar por páginas;
- selecionar **Extrato** para consultar os movimentos apresentados.

Escrow não é obrigatório para todos os cedentes ou fundos. Se não houver conta configurada na carteira, a tela poderá ficar vazia. O Consultor não pode realizar movimentações.

## 7. Relatórios e comissões

Em **Relatórios**, a tela **Relatórios e comissões** apresenta a performance da carteira no período selecionado.

Os indicadores incluem:

- volume no mês;
- quantidade de operações no mês;
- comissão estimada no mês;
- volume acumulado de operações em andamento e liquidadas;
- cedentes ativos.

Use os filtros de período e status. A tabela **Comissões por cedente** mostra:

- cedente e CNPJ;
- status;
- volume e operações do mês;
- percentual cadastrado;
- comissão estimada;
- volume total;
- paginação.

A plataforma realiza o cálculo com os dados vigentes da carteira. Não aplique uma fórmula manual universal. Os valores finais são confirmados pelo gestor.

## 8. Notificações e segurança da conta

O sino do cabeçalho mostra avisos recentes. Em **Notificações**, filtre entre **Todas**, **Não lidas** e **Lidas**, abra o destino indicado e marque mensagens como lidas.

Em **Minha Segurança**, é possível:

- consultar o MFA configurado;
- trocar a senha com as confirmações solicitadas;
- gerar novos códigos de recuperação;
- encerrar outras sessões.

O MFA é obrigatório e não pode ser desativado pelo próprio usuário.

## 9. Status apresentados

### Cedente

| Status | Significado |
|---|---|
| Pendente | Cadastro ou vínculo ainda em preparação. |
| Em análise | Avaliação em andamento. |
| Ativo | Cedente ativo na carteira. |
| Reprovado | Cadastro ou vínculo recusado. |
| Bloqueado | Operação temporariamente impedida. |

### Operação

| Status | Significado |
|---|---|
| Solicitada | Aguardando análise do gestor. |
| Em análise | Solicitação em conferência. |
| Aprovada | Aprovada e aguardando próximas etapas. |
| Em andamento | Operação desembolsada ou em execução. |
| Liquidada | Operação concluída financeiramente. |
| Inadimplente | Pagamento vencido ou não realizado. |
| Reprovada | Solicitação recusada. |
| Cancelada | Solicitação encerrada por cancelamento. |

### Conta escrow

| Status | Significado |
|---|---|
| Ativa | Conta disponível para consulta no fluxo atual. |
| Bloqueada | Conta temporariamente indisponível. |
| Encerrada | Conta sem novas movimentações. |

## 10. Dúvidas frequentes

### Por que fui desconectado?

A sessão completou 24 horas, houve logout ou a autenticação deixou de ser válida. Entre novamente com senha e TOTP.

### Por que o TOTP foi solicitado novamente?

Você iniciou um novo login, mudou de navegador ou dispositivo, completou 24 horas de sessão ou iniciou uma ação sensível.

### Por que não existe seletor de fundo?

O perfil Consultor é organizado pela carteira atribuída e não possui seletor de fundo na interface atual.

### Por que não vejo determinado cedente?

O portal mostra somente cedentes vinculados à sua carteira. Solicite ao gestor a revisão da atribuição.

### Por que não vejo uma operação?

A operação pode pertencer a um cedente fora da carteira ou não estar disponível no conjunto autorizado.

### Posso aprovar uma NF ou operação?

Não. O perfil Consultor é de acompanhamento e não possui ações operacionais.

### A comissão exibida é o valor definitivo?

Não. É uma estimativa calculada com os dados vigentes. O valor final é confirmado pelo gestor.

### Por que não há conta em Extratos Escrow?

O recurso pode não estar configurado para o cedente. Escrow não é universal.

### Posso movimentar uma conta escrow?

Não. A tela do Consultor é somente leitura.
