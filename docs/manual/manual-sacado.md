# Manual do Sacado — BW Antecipa

**Versão 2.0 — Agosto de 2026**

Este manual orienta o perfil **Sacado**, responsável por consultar Notas Fiscais emitidas contra sua empresa, decidir sobre cessões e acompanhar vencimentos e pagamentos.

## Sumário

1. [Acesso e segurança](#1-acesso-e-segurança)
2. [Navegação e limite de acesso](#2-navegação-e-limite-de-acesso)
3. [Dashboard](#3-dashboard)
4. [NFs Recebidas](#4-nfs-recebidas)
5. [Aprovação de Cessão](#5-aprovação-de-cessão)
6. [Histórico de Pagamentos](#6-histórico-de-pagamentos)
7. [Notificações e segurança da conta](#7-notificações-e-segurança-da-conta)
8. [Status apresentados](#8-status-apresentados)
9. [Dúvidas frequentes](#9-dúvidas-frequentes)

## 1. Acesso e segurança

### 1.1 Entrar no portal

1. Informe e-mail e senha.
2. Confirme o código de seis dígitos do aplicativo autenticador.
3. Se for o primeiro acesso com MFA, conclua a configuração e guarde os códigos de recuperação.

Todo novo login exige senha e TOTP. A confirmação vale apenas para a sessão atual; outro navegador ou dispositivo exige novo código.

### 1.2 Sessão de 24 horas

- A sessão de segurança permanece válida por **24 horas corridas**.
- Atualizar a página ou navegar pelo portal não reinicia o prazo.
- Ao completar 24 horas, o logout ocorre automaticamente.
- Para continuar, entre novamente com senha e TOTP.
- Ações comuns não solicitam novo código durante a janela válida.
- Ações sensíveis podem pedir nova confirmação.
- O logout voluntário encerra somente a sessão atual.

Não compartilhe senha, TOTP ou códigos de recuperação. Encerre a sessão ao terminar, especialmente em computador compartilhado.

## 2. Navegação e limite de acesso

O menu do Sacado contém:

- **Dashboard**;
- **NFs Recebidas**;
- **Aprovação de Cessão**;
- **Histórico de Pagamentos**;
- **Notificações**;
- **Minha Segurança**.

O Sacado visualiza somente obrigações relacionadas à própria empresa. Não há acesso a cadastros de fundos, políticas operacionais, documentos internos do cedente, configurações de integração ou rotinas do gestor.

## 3. Dashboard

O **Dashboard do Sacado** apresenta:

- total a pagar;
- valores vencidos;
- valores que vencem hoje;
- valores dos próximos sete dias;
- calendário de vencimentos mais próximos;
- pagamentos agrupados por cedente;
- instruções de conta quando estiverem disponíveis para a obrigação;
- atalhos para NFs, aprovação e pagamentos.

As instruções exibidas devem ser conferidas antes de qualquer pagamento. Nem toda obrigação utiliza a mesma forma ou conta de destino.

## 4. NFs Recebidas

Em **NFs Recebidas**, consulte as notas emitidas contra sua empresa.

A tela oferece:

- indicadores de total, cedidas, liquidadas e vencidas;
- busca por número, cedente ou CNPJ;
- filtro por status;
- ordenação por data, vencimento, valor ou número;
- paginação;
- botão **Ver NF** quando há arquivo disponível.

Use **Ver NF** para conferir o documento antes de decidir sobre a cessão. A listagem apresenta emitente, valor, emissão, vencimento e status.

## 5. Aprovação de Cessão

A tela **Aprovação de Cessão** reúne as cessões que aguardam manifestação do sacado. A exigência do aceite depende das regras aplicáveis à operação; por isso, nem toda NF recebida necessariamente aparecerá nessa fila.

### 5.1 Aprovar uma NF

1. Localize a NF pela busca ou pelos filtros.
2. Use o ícone de visualização para conferir o arquivo, quando disponível.
3. Confira cedente, CNPJ, valor e vencimento.
4. Se estiver de acordo, selecione **Aprovar**.

A aprovação confirma a manifestação sobre a cessão. Ela é separada da análise documental feita pelo gestor.

### 5.2 Aprovar em lote

1. Marque as NFs desejadas ou selecione todas as NFs da página.
2. Confira a quantidade e o valor total selecionado.
3. Selecione **Aprovar N NF(s)**.
4. Aguarde a confirmação.

A aprovação em lote afeta somente os itens selecionados na tela.

### 5.3 Contestar

1. Na linha da NF, selecione **Contestar**.
2. Informe o motivo obrigatório.
3. Selecione **Confirmar Contestação**.

A contestação fica registrada e altera a situação da NF. Acompanhe o resultado em **NFs Recebidas** e nas notificações. Use um motivo claro e objetivo; não inclua senhas ou dados desnecessários.

### 5.4 Histórico das decisões

As aprovações e contestações deixam de aparecer como pendências na fila e permanecem refletidas no status da NF e nos avisos relacionados. Para conferir uma decisão anterior, pesquise a NF em **NFs Recebidas** e consulte as notificações correspondentes.

## 6. Histórico de Pagamentos

Em **Histórico de Pagamentos**, acompanhe as operações relacionadas à sua empresa.

A tela permite:

- pesquisar por cedente;
- filtrar entre **Todos**, **A pagar**, **Pagos** e **Inadimplentes**;
- ordenar por pagamento mais recente, vencimento mais próximo ou maior valor;
- navegar por páginas;
- consultar cedente, valor, vencimento e data de pagamento;
- usar **Informar Pagamento** em operações a pagar.

Os indicadores no topo consideram os registros da página atual.

### 6.1 Informar pagamento

1. Confirme a operação e o vencimento.
2. Confira a instrução de pagamento apresentada pelo portal ou recebida no fluxo autorizado.
3. Depois do pagamento, selecione **Informar Pagamento**.
4. Aguarde a confirmação e a atualização do status.

Essa ação informa a realização do pagamento; a conciliação e a conclusão financeira seguem o processo do gestor. Não presuma que toda operação utiliza conta escrow. Utilize somente a instrução exibida para a obrigação correspondente.

## 7. Notificações e segurança da conta

O sino do cabeçalho mostra avisos recentes. Em **Notificações**, filtre entre **Todas**, **Não lidas** e **Lidas**, abra o destino indicado e marque as mensagens como lidas.

Em **Minha Segurança**, é possível:

- consultar o MFA configurado;
- trocar a senha com as confirmações solicitadas;
- gerar novos códigos de recuperação;
- encerrar outras sessões.

O MFA é obrigatório e não pode ser desativado pelo próprio usuário.

## 8. Status apresentados

### Nota Fiscal e cessão

| Status | Significado |
|---|---|
| Submetida | A NF entrou no fluxo de análise. |
| Em análise | A conferência está em andamento. |
| Aprovada | A análise prévia foi concluída. |
| Cessão ativa | A NF aguarda sua manifestação na fila de aprovação. |
| Cedida (Em antecipação) | A NF participa do fluxo de cessão. |
| Antecipada | A cessão avançou conforme o fluxo. |
| Contestada | Foi registrada uma contestação. |
| Liquidada | O ciclo financeiro foi concluído. |
| Cancelada | A NF não seguirá no fluxo atual. |

### Pagamentos

| Status | Significado |
|---|---|
| A pagar | Operação em andamento com pagamento pendente. |
| Pago | Pagamento informado e operação liquidada. |
| Inadimplente | Pagamento vencido ou marcado como não realizado. |
| Vencido | A data de vencimento passou sem conclusão do pagamento. |

## 9. Dúvidas frequentes

### Por que fui desconectado?

A sessão completou 24 horas, houve logout ou a autenticação deixou de ser válida. Entre novamente com senha e TOTP.

### Por que o TOTP foi solicitado novamente?

Você iniciou um novo login, mudou de navegador ou dispositivo, completou 24 horas de sessão ou iniciou uma ação sensível.

### Por que não vejo uma NF?

O portal mostra apenas NFs vinculadas à sua empresa. A nota também pode ainda não ter chegado à etapa visível para o Sacado.

### Por que uma NF não aparece em Aprovação de Cessão?

Ela pode não exigir aceite, já ter recebido uma decisão ou ainda não ter chegado a essa etapa.

### Posso aprovar várias NFs de uma vez?

Sim. Marque os itens na página e use **Aprovar N NF(s)**.

### Por que não consigo contestar?

O motivo é obrigatório. Preencha a justificativa e tente novamente. Se a NF já recebeu uma decisão, ela não permanecerá na fila pendente.

### Onde consulto uma decisão anterior?

Pesquise a NF em **NFs Recebidas** e consulte as notificações relacionadas.

### Toda operação deve ser paga em conta escrow?

Não. Siga somente a instrução apresentada para a obrigação. A conta pode aparecer quando estiver configurada para aquele fluxo.

### O que acontece ao selecionar Informar Pagamento?

O portal registra sua comunicação. A confirmação final depende da conciliação e do processo conduzido pelo gestor.
