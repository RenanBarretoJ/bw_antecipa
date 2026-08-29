# Manual do Cedente — BW Antecipa

**Versão 2.0 — Agosto de 2026**

Este manual orienta empresas que cadastram Notas Fiscais e solicitam antecipação de recebíveis. Os documentos, prazos e etapas apresentados podem variar conforme o fundo e a política operacional aplicável.

## Sumário

1. [Acesso e segurança](#1-acesso-e-segurança)
2. [Navegação e fundo aplicável](#2-navegação-e-fundo-aplicável)
3. [Dashboard](#3-dashboard)
4. [Cadastro do cedente](#4-cadastro-do-cedente)
5. [Meus Documentos](#5-meus-documentos)
6. [Minhas NFs](#6-minhas-nfs)
7. [Solicitar antecipação](#7-solicitar-antecipação)
8. [Minhas Operações](#8-minhas-operações)
9. [Documentos pós-cessão e logística](#9-documentos-pós-cessão-e-logística)
10. [Nova previsão do comprovante de entrega](#10-nova-previsão-do-comprovante-de-entrega)
11. [Notificações, extrato e segurança](#11-notificações-extrato-e-segurança)
12. [Status apresentados](#12-status-apresentados)
13. [Dúvidas frequentes](#13-dúvidas-frequentes)

## 1. Acesso e segurança

### 1.1 Primeiro acesso e MFA

1. Entre com e-mail e senha.
2. Se solicitado, configure o MFA em um aplicativo autenticador usando o QR Code ou a chave exibida.
3. Informe o código de seis dígitos.
4. Guarde os códigos de recuperação em local seguro. Eles são exibidos somente no momento de geração.

Todo novo login exige senha e TOTP. Outro navegador ou dispositivo exige nova confirmação.

### 1.2 Sessão de 24 horas

- A confirmação de segurança vale por **24 horas corridas** na sessão atual.
- Atualizar a página ou navegar não reinicia o prazo.
- Após 24 horas, o logout é automático e será necessário entrar novamente com senha e TOTP.
- Ações comuns não solicitam novo código durante a janela válida.
- Ações sensíveis podem pedir uma nova confirmação.
- O logout voluntário encerra somente a sessão atual.

Não compartilhe senha, TOTP ou códigos de recuperação. Encerre a sessão ao usar computador compartilhado.

## 2. Navegação e fundo aplicável

O menu do Cedente contém:

- **Dashboard**;
- **Cadastro**;
- **Meus Documentos**;
- **Minhas NFs**;
- **Minhas Operações**;
- **Extrato**, somente quando habilitado;
- **Notificações**;
- **Minha Segurança**.

Um cedente pode estar vinculado a mais de um fundo. Quando houver mais de um vínculo ativo, um seletor aparece no cabeçalho para escolher o fundo operacional.

- A escolha muda o contexto das NFs, documentos e operações.
- Somente vínculos ativos e autorizados são exibidos.
- Trocar o fundo não concede novas permissões.
- Cada operação utiliza a política do vínculo e do fundo escolhidos.

Ao criar uma operação, as regras vigentes são preservadas para ela. Mudanças posteriores na política não alteram automaticamente documentos, aceite, logística ou prazos de uma operação já criada.

## 3. Dashboard

O **Dashboard** reúne:

- alertas de documentos rejeitados;
- volume ativo;
- quantidade de Notas Fiscais;
- saldo disponível, quando o recurso de escrow estiver habilitado;
- operações recentes;
- atalhos para documentos, NFs e operações;
- botão **Nova Solicitação**.

Os dados correspondem ao vínculo operacional selecionado.

## 4. Cadastro do cedente

No primeiro cadastro, a tela **Cadastro do Cedente** organiza as informações em:

1. **Dados da Empresa**;
2. **Representante Legal**;
3. **Dados Bancários**.

Preencha os campos obrigatórios indicados e selecione **Finalizar Cadastro**. É possível adicionar mais de um representante durante o preenchimento.

Depois do cadastro, a tela passa a exibir os dados em modo de consulta. Quando precisar corrigir informações:

1. selecione **Solicitar Alteração**;
2. ajuste os dados necessários;
3. avance pelas etapas;
4. escolha **Enviar Solicitação**.

O envio de alteração não significa aprovação imediata. Acompanhe o status e as notificações.

## 5. Meus Documentos

A tela **Meus Documentos** apresenta os itens solicitados no cadastro atual. Use sempre a lista exibida no portal como referência; os requisitos documentais de cada NF e operação são definidos separadamente pela política aplicável.

Para enviar um documento:

1. localize o item solicitado;
2. selecione **Enviar**;
3. escolha o arquivo;
4. aguarde a confirmação;
5. acompanhe o status.

### Regras importantes

- Documentos obrigatórios podem bloquear o avanço até serem aprovados.
- Documentos opcionais não bloqueantes não impedem o fluxo.
- Se não houver exigência para uma etapa, nenhuma pendência artificial será mostrada.
- Todo arquivo enviado fica aguardando análise.
- Se for rejeitado, consulte o motivo e envie nova versão quando a ação estiver disponível.
- A barra de progresso considera os documentos obrigatórios exibidos na tela.

Não utilize uma lista antiga como referência. Siga sempre os itens apresentados no portal.

## 6. Minhas NFs

### 6.1 Enviar arquivo original

Em **Minhas NFs**, use a área de envio para importar uma ou mais notas.

A NF precisa possuir arquivo original em:

- **PDF**; ou
- **XML**.

Um dos formatos é suficiente; não é necessário enviar os dois.

- **XML:** o portal faz a leitura automática dos dados quando disponível.
- **PDF:** pode ser necessário preencher ou conferir os dados manualmente.

Antes do registro, o portal valida o arquivo e o contexto do cedente. Se houver divergência nos dados fiscais, corrija o arquivo de origem e tente novamente.

### 6.2 Rascunho e submissão

Quando a leitura não concluir todos os dados, a NF pode permanecer como **Rascunho**.

1. Abra a NF.
2. Confira número, série, emissão, vencimento, emitente, destinatário e valores.
3. Preencha os campos editáveis solicitados.
4. Revise o arquivo original.
5. Selecione a ação de submissão apresentada na tela.

O PDF ou XML original continua obrigatório mesmo quando a política não exigir outros documentos.

### 6.3 Requisitos documentais da NF

No detalhe da NF, o portal identifica a política aplicável e mostra somente os requisitos correspondentes.

- **Documentos pré-cessão:** analisados antes do avanço da NF.
- **Documentos pós-cessão:** liberados conforme o estágio da operação, quando a logística for aplicável.
- **Obrigatório:** precisa ser aprovado quando bloquear o fluxo.
- **Opcional:** não impede o avanço quando classificado como não bloqueante.

Se a política não possuir requisitos para uma etapa, a seção não apresenta pendências artificiais. O aceite do sacado é separado da aprovação prévia da NF.

Para enviar ou reenviar:

1. expanda o requisito;
2. arraste o arquivo ou clique na área de seleção;
3. após uma versão existente, use **Enviar nova versão**;
4. acompanhe **Aguardando análise**;
5. em caso de rejeição, leia o motivo e corrija o documento.

Use **Ver** para abrir uma versão enviada.

### 6.4 Busca, filtros e status

A listagem permite pesquisar por número, CNPJ ou sacado, filtrar status, ordenar resultados e navegar por páginas. A NF também pode exibir um marcador logístico, como **Em trânsito**, além do status fiscal ou operacional.

## 7. Solicitar antecipação

1. Acesse **Minhas Operações**.
2. Selecione **Nova Solicitação**.
3. Confira o fundo ou vínculo operacional escolhido.
4. Pesquise e selecione as NFs elegíveis.
5. Confira quantidade, valor bruto, desconto estimado, valor líquido estimado e faixas apresentadas.
6. Selecione **Solicitar Antecipação**.

Somente NFs que atendem às regras vigentes aparecem como elegíveis. Se o vínculo não possuir política publicada e aplicada, a solicitação fica bloqueada.

A operação preserva as regras aplicáveis no momento de sua criação. Uma alteração futura na política não modifica automaticamente a solicitação existente.

## 8. Minhas Operações

A tela **Minhas Operações** mostra indicadores, filtros e a lista de solicitações. Use **Ver detalhes** para acompanhar uma operação.

No detalhe, podem ser exibidos:

- status e número da operação;
- valor bruto, valor líquido aprovado e valor desembolsado;
- taxa, prazo e vencimento;
- datas de aprovação, desembolso ou liquidação;
- NFs vinculadas e acesso à NF;
- pendências atribuídas ao cedente;
- comprovantes disponíveis;
- acompanhamento logístico, quando aplicável;
- histórico operacional.

A ação **Cancelar** aparece somente enquanto o status permite cancelamento.

### Aceite do sacado

O aceite é uma etapa independente da aprovação da NF. A política pode exigir o aceite antes de determinado marco ou dispensá-lo. O cedente não precisa executar essa decisão; acompanhe apenas o andamento apresentado na operação.

## 9. Documentos pós-cessão e logística

O painel logístico aparece somente quando a política preservada na operação exigir acompanhamento de entrega.

Os requisitos podem incluir:

- **CT-e** ou DACTE;
- **Comprovante de entrega** ou canhoto.

Cada documento apresenta, quando aplicável:

- obrigatoriedade;
- status;
- prazo original;
- data limite e dias restantes ou de atraso;
- versão enviada;
- motivo de rejeição;
- ações **Ver** e **Enviar nova versão**.

Depois do desembolso, a logística pode aparecer como **Em trânsito** ou **Aguardando comprovante**. Um upload enviado fica **Aguardando análise** até a decisão do gestor.

Se o gestor rejeitar o documento, a versão rejeitada permanece no histórico e uma nova versão pode ser enviada. A entrega só é concluída quando todos os requisitos obrigatórios forem aprovados.

Se a política não exigir logística, o painel não aparece e nenhuma ação de CT-e ou comprovante de entrega será solicitada.

## 10. Nova previsão do comprovante de entrega

Quando a política permitir, a tela mostra o card de previsão do comprovante de entrega, também referido na interface como canhoto.

Para comunicar uma nova previsão:

1. abra a NF e localize **Documentos pós-cessão**;
2. no card de previsão, selecione a ação para informar nova data;
3. informe a **Nova previsão**;
4. preencha o **Motivo**;
5. revise a comunicação;
6. confirme.

Regras:

- a comunicação é permitida uma única vez por NF;
- a nova data deve respeitar o limite definido na política;
- o prazo original continua visível;
- o histórico não é apagado;
- depois do primeiro upload do comprovante, não é possível postergar;
- a comunicação não depende de aprovação prévia do gestor;
- o gestor recebe notificação para acompanhamento.

A nova previsão não transforma um documento rejeitado em aprovado e não elimina alertas de atraso.

## 11. Notificações, extrato e segurança

### Notificações

O sino do cabeçalho mostra avisos recentes. Em **Notificações**, filtre entre **Todas**, **Não lidas** e **Lidas**, abra o destino indicado e marque os itens como lidos.

Consulte as notificações após envio, aprovação, rejeição, alteração de operação ou mudança logística.

### Extrato

O item **Extrato** aparece somente quando o recurso estiver habilitado para o cedente. A ausência do menu significa que esse recurso não está disponível no vínculo atual.

### Minha Segurança

Em **Minha Segurança**, é possível consultar o MFA, trocar a senha, gerar novos códigos de recuperação e encerrar outras sessões. O MFA é obrigatório e não pode ser desativado pelo próprio usuário.

## 12. Status apresentados

### Documentos

| Status | Significado |
|---|---|
| Pendente | O requisito ainda não possui versão aceita. |
| Aguardando análise | O arquivo foi enviado e aguarda decisão do gestor. |
| Aprovado | A versão atual foi aceita. |
| Rejeitado | A versão foi recusada; consulte o motivo e reenvie quando permitido. |

### Nota Fiscal

| Status | Significado |
|---|---|
| Rascunho | Dados ainda precisam ser conferidos ou submetidos. |
| Submetida | Enviada para análise. |
| Em análise | Conferência em andamento. |
| Validada | Análise prévia concluída. |
| Requer ajuste | É necessário corrigir ou complementar informações. |
| Em antecipação | Incluída em uma solicitação ou operação. |
| Antecipada | A cessão avançou conforme o fluxo. |
| Contestada | O sacado registrou contestação. |
| Liquidada | O ciclo financeiro foi concluído. |
| Cancelada | A NF foi retirada do fluxo atual. |

### Operação

| Status | Significado |
|---|---|
| Solicitada | Aguardando análise do gestor. |
| Em análise | A solicitação está em conferência. |
| Aprovada | Aprovada e aguardando próximos passos. |
| Em andamento | Operação desembolsada ou em execução. |
| Liquidada | Operação concluída financeiramente. |
| Inadimplente | Pagamento vencido ou não realizado. |
| Reprovada | Solicitação recusada. |
| Cancelada | Solicitação encerrada por cancelamento. |

### Logística

| Status | Significado |
|---|---|
| Aguardando desembolso | A etapa será liberada após o desembolso. |
| Em trânsito | Entrega em acompanhamento. |
| Aguardando comprovante | Falta documento de entrega aplicável. |
| Aguardando análise | Documento enviado ao gestor. |
| Entrega confirmada | Todos os requisitos obrigatórios foram aprovados. |
| Em atraso ou com pendência | Há prazo vencido, rejeição ou pendência relevante. |

## 13. Dúvidas frequentes

### Por que fui desconectado?

A sessão de segurança completou 24 horas, houve logout ou a autenticação deixou de ser válida. Entre novamente com senha e TOTP.

### Por que o TOTP foi solicitado novamente?

Você iniciou um novo login, usou outro navegador ou dispositivo, completou 24 horas de sessão ou iniciou uma ação sensível.

### Por que não vejo determinado fundo?

O seletor mostra somente vínculos ativos e autorizados. Procure o gestor responsável pelo onboarding.

### Por que não aparecem requisitos documentais?

Pode não haver requisitos para essa etapa na política da operação. O PDF ou XML original da NF continua necessário.

### PDF e XML são obrigatórios ao mesmo tempo?

Não. Um arquivo original em PDF **ou** XML é suficiente.

### Por que um documento está pendente?

Ele ainda não foi enviado, aguarda análise ou teve a versão rejeitada. Expanda o item para consultar detalhes.

### Como reenviar um documento rejeitado?

Abra o requisito, consulte o motivo e use **Enviar nova versão**.

### Por que não consigo solicitar antecipação?

Verifique se há NFs elegíveis, se o vínculo está ativo e se a política do fundo foi publicada e aplicada.

### Por que o painel logístico não aparece?

A política preservada na operação não exige acompanhamento de entrega.

### Como comunicar uma nova previsão do comprovante de entrega?

Abra a NF e use o card de previsão em **Documentos pós-cessão**. Informe nova data e motivo.

### Por que não consigo postergar novamente?

A comunicação é única por NF e deixa de estar disponível após a primeira postergação ou após o primeiro upload do comprovante.

### Por que não vejo uma operação ou NF?

Confirme o vínculo ou fundo operacional selecionado. Os dados permanecem separados entre fundos.
