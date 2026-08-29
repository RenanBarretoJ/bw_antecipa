# Manual do Gestor — BW Antecipa

**Versão 2.0 — Agosto de 2026**

Este manual descreve as rotinas disponíveis ao perfil **Gestor**. Algumas telas, documentos e ações dependem do fundo ativo, das permissões do usuário e da política operacional vigente.

## Sumário

1. [Acesso e segurança](#1-acesso-e-segurança)
2. [Navegação e fundo ativo](#2-navegação-e-fundo-ativo)
3. [Dashboard](#3-dashboard)
4. [Onboarding e cedentes](#4-onboarding-e-cedentes)
5. [Documentos cadastrais](#5-documentos-cadastrais)
6. [Cadastro do fundo](#6-cadastro-do-fundo)
7. [Política operacional](#7-política-operacional)
8. [Templates jurídicos](#8-templates-jurídicos)
9. [CNAB e integrações](#9-cnab-e-integrações)
10. [Análise de Notas Fiscais](#10-análise-de-notas-fiscais)
11. [Operações](#11-operações)
12. [Documentos assinados e desembolso](#12-documentos-assinados-e-desembolso)
13. [Acompanhamento logístico](#13-acompanhamento-logístico)
14. [Escrow, relatórios e auditoria](#14-escrow-relatórios-e-auditoria)
15. [Notificações e segurança da conta](#15-notificações-e-segurança-da-conta)
16. [Status apresentados](#16-status-apresentados)
17. [Dúvidas frequentes](#17-dúvidas-frequentes)

## 1. Acesso e segurança

### 1.1 Entrar no portal

1. Acesse a tela de login.
2. Informe e-mail e senha.
3. Confirme o código de seis dígitos do aplicativo autenticador.
4. Se o MFA ainda não estiver configurado, siga a tela de configuração, leia o QR Code e guarde os códigos de recuperação.

Todo novo login exige senha e TOTP. A confirmação vale somente para a sessão atual; outro navegador ou dispositivo exige novo código.

### 1.2 Sessão de segurança de 24 horas

- A sessão permanece válida por **24 horas corridas** após a confirmação do MFA.
- Atualizar a página ou navegar pelo portal não reinicia esse prazo.
- Ao completar 24 horas, o portal encerra a sessão automaticamente. Entre novamente com senha e TOTP para continuar.
- Ações comuns não pedem outro código durante a janela válida.
- Ações sensíveis, como alterações de segurança ou gestão de credenciais, podem solicitar nova confirmação TOTP.
- O logout voluntário encerra somente a sessão atual.

Nunca compartilhe senha, código TOTP ou código de recuperação. Em computador compartilhado, encerre a sessão ao terminar.

## 2. Navegação e fundo ativo

O menu do Gestor contém:

- **Dashboard**;
- **Cedentes**;
- **Onboarding**;
- **Documentos**;
- **Notas Fiscais**;
- **Operações**;
- **Escrow**;
- **Fundos**;
- **Relatórios**;
- **Notificações**;
- **Configurações**;
- **Minha Segurança**;
- **Auditoria**.

### 2.1 Fundo ativo

O seletor **Fundo ativo** aparece no cabeçalho. Ele define o contexto das telas de gestão.

1. Abra o seletor.
2. Pesquise pelo nome ou CNPJ, se necessário.
3. Escolha um dos fundos autorizados.
4. O portal retorna ao dashboard e recarrega os dados no novo contexto.

Trocar o fundo ativo não concede acesso adicional. O usuário visualiza somente os fundos para os quais já possui autorização. Cedentes, políticas, documentos, operações, relatórios e configurações permanecem separados por fundo.

## 3. Dashboard

O **Dashboard** apresenta o nome do fundo ativo e um resumo operacional, incluindo:

- cedentes do fundo;
- operações ativas;
- volume do mês;
- saldo em escrow, quando aplicável;
- NFs aguardando análise;
- documentos pendentes;
- inadimplência;
- entregas em acompanhamento, com pendência ou confirmadas;
- operações recentes;
- acessos rápidos para as principais rotinas.

Use os alertas como ponto de partida. Os totais sempre correspondem ao fundo ativo.

## 4. Onboarding e cedentes

### 4.1 Onboarding

A tela **Onboarding** organiza cedentes por situação operacional, como pendência de vínculo, ausência de política, aptidão ou inaptidão.

Para vincular um cedente:

1. Confirme o fundo ativo.
2. Localize o cedente pela busca ou pelos filtros.
3. Abra as ações da linha e selecione **Vincular fundo**.
4. Confira o cedente e o fundo apresentados no modal.
5. Selecione **Vincular fundo**.
6. Na etapa seguinte, defina a política operacional aplicável.

Um vínculo não cria automaticamente uma política. Enquanto não houver política publicada e aplicada, o cedente permanece impedido de criar novas operações nesse fundo.

### 4.2 Lista e detalhe de cedentes

Em **Cedentes**, a listagem mostra apenas os vínculos do fundo ativo. Use a busca e os filtros para localizar uma empresa e abra o detalhe para consultar:

- dados cadastrais;
- representantes legais;
- dados bancários;
- documentos;
- configurações de acesso disponíveis;
- fundo e acessos vinculados;
- contratos e demais informações exibidas pela tela.

Um cedente pode possuir vínculos com mais de um fundo, mas cada vínculo é tratado separadamente.

## 5. Documentos cadastrais

Em **Documentos**, o gestor acompanha os documentos cadastrais apresentados para o fundo e o cedente selecionados.

Os itens não formam uma lista universal: a tela deve ser seguida conforme os requisitos exibidos para o contexto atual. Para cada documento, o gestor pode encontrar ações como visualizar, aprovar, rejeitar ou solicitar atualização.

- **Obrigatório:** pode bloquear o avanço enquanto não for aprovado.
- **Opcional:** não bloqueia quando a política o classifica como não bloqueante.
- **Aguardando envio:** ainda não há arquivo disponível.
- **Aguardando análise:** há arquivo enviado que precisa de decisão.
- **Aprovado:** o documento foi aceito.
- **Rejeitado:** o motivo deve ser consultado; o cedente poderá enviar nova versão quando permitido.

Se nenhuma exigência se aplicar à etapa, o portal não cria pendências artificiais.

## 6. Cadastro do fundo

Em **Fundos**, selecione um fundo autorizado e abra seu detalhe. A tela é organizada em:

- **Dados gerais**;
- **Política operacional**;
- **Templates jurídicos**;
- **CNAB**;
- **Integrações**.

As configurações pertencem ao fundo aberto. Antes de salvar ou publicar qualquer alteração, confirme o nome e o CNPJ exibidos no cabeçalho.

## 7. Política operacional

A política define regras que podem variar entre fundos e vínculos, como:

- necessidade e momento do aceite do sacado;
- momento da cessão;
- acompanhamento de entrega;
- requisitos documentais pré e pós-cessão;
- obrigatoriedade e efeito de cada requisito;
- prazos;
- possibilidade de comunicar nova previsão do comprovante de entrega.

### 7.1 Criar e publicar

1. Abra **Fundos** e o detalhe do fundo.
2. Entre em **Política operacional**.
3. Selecione **Criar política** e informe nome, descrição e código interno.
4. Use **Nova versão** para configurar o fluxo e os requisitos.
5. Revise as etapas **Fluxo operacional**, **Requisitos documentais** e **Revisão e publicação**.
6. Crie a versão em rascunho.
7. Selecione **Publicar** quando a configuração estiver pronta.
8. Em **Cedentes e política aplicada**, vincule ou altere a política de cada cedente.

Versões publicadas são somente leitura. Para mudar regras, crie e publique uma nova versão. O histórico permite **Ver** e **Duplicar** versões; a opção **Comparar** pode aparecer indisponível.

### 7.2 Regras preservadas na operação

Ao criar uma operação, as regras vigentes são registradas para ela. Mudanças futuras na política não alteram automaticamente operações já criadas. Documentos, aceite, logística e prazos seguem as regras preservadas na operação.

Não mantenha mais de uma política concorrente para o mesmo vínculo. Confirme sempre qual versão está publicada e qual política está aplicada ao cedente.

## 8. Templates jurídicos

Na aba **Templates jurídicos**, o gestor acompanha a prontidão jurídica do fundo.

Os documentos apresentados atualmente incluem:

- **Contrato-mãe** e **Termo de cessão**, obrigatórios para a prontidão jurídica;
- **Notificação ao sacado**, **Termo de quitação** e **Contrato-mãe sem coobrigação**, opcionais.

As ações disponíveis variam conforme o estado:

- **Configurar**;
- **Continuar edição**;
- **Preview** ou **Gerar preview**;
- **Publicar**;
- **Visualizar**;
- **Criar nova versão**;
- **Histórico**.

Templates opcionais não configurados não contam como pendência obrigatória. Uma versão publicada permanece registrada; alterações exigem nova versão.

## 9. CNAB e integrações

### 9.1 CNAB

Na aba **CNAB**, configure o arquivo bancário do fundo. O layout, os dados bancários, o código originador e demais parâmetros dependem da configuração desse fundo.

O fluxo permite, conforme o estado da tela:

1. criar ou importar a configuração inicial;
2. criar uma versão;
3. salvar como rascunho;
4. publicar;
5. gerar arquivo de teste;
6. consultar o histórico.

Não reutilize valores de outro fundo. Operações antigas mantêm a configuração correspondente à remessa gerada.

### 9.2 Portal FIDC

Na aba **Integrações**, o bloco **Portal FIDC — Sinqia** informa se a integração está pronta para uso. A tela reúne:

- checklist de prontidão;
- último teste, último envio, taxa de sucesso e último erro, quando disponíveis;
- credenciais do próprio fundo;
- configuração do ambiente e do endereço de integração;
- credencial ativa compatível com o ambiente;
- código originador proveniente da configuração CNAB publicada;
- histórico de versões e execuções.

As principais ações são **Testar conexão**, **Salvar rascunho**, **Publicar** ou **Publicar integração**, conforme o estado.

Credenciais podem ser cadastradas, rotacionadas e revogadas. Essas ações podem solicitar TOTP. Nunca copie credenciais entre fundos nem compartilhe usuário ou senha.

Os arquivos e integrações disponíveis variam por fundo; não há layout, código originador ou administradora universal.

## 10. Análise de Notas Fiscais

### 10.1 Listagem

Em **Notas Fiscais**, use:

- busca por número, CNPJ ou razão social;
- filtro de status;
- filtro de cedente;
- período de vencimento;
- ordenação das colunas;
- paginação.

A seleção de linhas libera **Aprovar em lote** e **Reprovar em lote**. A aprovação em lote fica disponível somente quando todas as NFs selecionadas estiverem elegíveis.

### 10.2 Arquivo original

A NF precisa ter um arquivo original em **PDF ou XML**. Um dos dois formatos é suficiente.

- No XML, os dados são lidos automaticamente quando possível.
- No PDF, pode ser necessário preencher ou conferir informações manualmente.

O arquivo original não substitui os demais documentos exigidos pela política. Da mesma forma, uma política sem requisitos não dispensa o PDF ou XML original.

### 10.3 Análise individual

1. Abra a NF.
2. Confira dados fiscais, emitente, destinatário, valores e arquivo original.
3. Analise a seção **Documentos pré-cessão**.
4. Use **Ver** para abrir o arquivo de cada requisito.
5. Use **Aprovar** ou **Rejeitar** no documento enviado.
6. Quando a NF estiver apta, escolha **Aprovar NF**.
7. Se houver problema geral, use **Solicitar Ajuste** ou **Reprovar** e informe o motivo.

Todo documento enviado pelo cedente deve passar pela análise do gestor. Documentos obrigatórios pendentes ou rejeitados impedem a aprovação quando são bloqueantes. Se a política não possuir requisitos pré-cessão, nenhuma pendência artificial é exibida.

O aceite do sacado é uma etapa separada. Aprovar a NF não significa registrar o aceite do sacado. Quando a política dispensar esse aceite, o fluxo seguirá sem essa manifestação.

## 11. Operações

Em **Operações**, use busca, filtros de status, ordenação e paginação para localizar solicitações do fundo ativo.

No detalhe, o gestor encontra:

- situação e andamento da operação;
- resumo financeiro;
- NFs vinculadas;
- botão **Ver NF**;
- **Exportar CSV** para conferência das NFs da operação;
- termos de aprovação, quando a operação aguarda análise;
- documentos gerados e assinados;
- ações de CNAB e Portal FIDC, quando configuradas;
- acompanhamento logístico, quando aplicável;
- histórico operacional.

### 11.1 Aprovar ou reprovar

1. Confira todas as NFs e pendências.
2. Defina os termos apresentados na tela, quando necessário.
3. Confirme taxa e valor líquido.
4. Use **Aprovar e Seguir** ou **Reprovar**.
5. Para reprovar, informe o motivo solicitado.

### 11.2 Ciclo posterior

Conforme o status e as regras da operação, a tela pode liberar:

- geração de documentos;
- upload de documentos assinados;
- geração e envio de CNAB;
- **Desembolsar**;
- **Confirmar Liquidação**;
- **Marcar Inadimplente**.

Botões desabilitados indicam que existe uma etapa anterior pendente ou uma configuração do fundo ainda não publicada.

## 12. Documentos assinados e desembolso

Os tipos exibidos na operação podem incluir:

- **Termo de Cessão Assinado**;
- **Notificação ao Sacado Assinada**, quando aplicável;
- **Comprovante de Desembolso (TED)** ou **Comprovante de Pagamento**, conforme a etapa;
- **Termo de Quitação Assinado**, quando aplicável.

Para enviar:

1. Abra a operação do fundo correto.
2. Localize **Documentos assinados**.
3. Selecione a linha do documento e escolha o arquivo.
4. Confirme o envio.

Depois do registro, o botão principal permite abrir ou baixar o documento. Para trocar o arquivo, use o ícone à direita com a descrição **Substituir documento**. A substituição cria nova versão e preserva o histórico.

O botão **Desembolsar** só é liberado quando os documentos exigidos para aquela operação estiverem presentes. Não utilize arquivo pertencente a outro fundo.

## 13. Acompanhamento logístico

A logística aparece somente quando a política preservada na operação exigir acompanhamento de entrega.

### 13.1 Na NF

Em **Documentos pós-cessão**, acompanhe os requisitos aplicáveis, por exemplo:

- CT-e ou DACTE;
- comprovante de entrega ou canhoto.

Cada item mostra status, prazo quando iniciado, versões e ações de análise. Use **Aprovar** ou **Rejeitar**. Em caso de rejeição, informe o motivo; o cedente poderá enviar nova versão. A entrega somente é concluída após a aprovação de todos os requisitos obrigatórios.

### 13.2 Nova previsão do comprovante de entrega

Quando a política permitir, o cedente pode comunicar uma nova previsão uma única vez por NF. No detalhe da NF, o gestor visualiza:

- prazo original;
- nova previsão;
- justificativa;
- situação do prazo;
- registro da comunicação.

A comunicação não depende de aprovação prévia do gestor e não apaga o prazo original. Documento rejeitado ou nova previsão vencida continua em atenção.

### 13.3 Painel da operação

No detalhe da operação:

- se a logística não se aplicar, o painel não aparece;
- antes do desembolso, o estado é **Aguardando desembolso**;
- após o desembolso, o painel mostra percentual de conclusão e quantidades concluídas, pendentes, em análise e em atenção;
- inicialmente são exibidas até cinco NFs;
- **Ver todas** abre a visão completa, com dez itens por página;
- há busca por número da NF, filtros e ordenação por criticidade;
- **Ver NF** abre o detalhe e preserva o retorno à operação.

A prioridade operacional é: rejeitado, vencido, vence hoje, prazo próximo, aguardando envio, em análise, em andamento e concluído.

## 14. Escrow, relatórios e auditoria

### 14.1 Escrow

Em **Escrow**, consulte as contas vinculadas ao fundo ativo. A existência e os dados disponíveis dependem da configuração do cedente e do fundo; escrow não é uma etapa universal de toda operação.

### 14.2 Relatórios

Em **Relatórios**, acompanhe a visão gerencial do fundo ativo. A tela apresenta indicadores e volume por cedente, com filtros de período e status e paginação.

### 14.3 Auditoria

Em **Auditoria**, pesquise eventos registrados no fundo autorizado. Os filtros disponíveis incluem texto, tipo de evento, entidade, ator e período. Use **Aplicar filtros**, **Limpar** e **Carregar mais** conforme necessário.

O histórico de auditoria serve para rastrear ações; não altere nem interprete identificadores técnicos como instruções operacionais.

## 15. Notificações e segurança da conta

O sino no cabeçalho mostra as notificações mais recentes. Em **Notificações**, use os filtros **Todas**, **Não lidas** e **Lidas**, abra o destino indicado e marque uma ou todas como lidas.

Em **Minha Segurança**, é possível:

- consultar o MFA configurado;
- trocar a senha mediante confirmação da senha atual e TOTP;
- gerar novos códigos de recuperação;
- encerrar outras sessões.

O MFA é obrigatório e não pode ser desativado pelo próprio usuário.

## 16. Status apresentados

### Documentos

| Status | Significado |
|---|---|
| Pendente | Ainda não há versão aceita para cumprir o requisito. |
| Aguardando análise | O cedente enviou um arquivo e aguarda decisão. |
| Aprovado | A versão atual foi aceita. |
| Rejeitado | A versão foi recusada e pode exigir reenvio. |

### Nota Fiscal

| Status | Significado |
|---|---|
| Submetida | A NF foi enviada para análise. |
| Em análise | A conferência está em andamento. |
| Aprovada | A análise prévia foi concluída. |
| Requer ajuste | O cedente precisa corrigir ou complementar informações. |
| Em antecipação | A NF participa de uma solicitação ou operação. |
| Antecipada | A cessão avançou conforme o fluxo. |
| Contestada | O sacado registrou contestação. |
| Liquidada | O ciclo financeiro foi concluído. |
| Cancelada ou Reprovada | A NF não seguirá no fluxo atual. |

### Operação

| Status | Significado |
|---|---|
| Solicitada | Aguardando análise do gestor. |
| Em análise | A solicitação está em conferência. |
| Aprovada | Aprovada e aguardando as próximas etapas. |
| Em andamento | Operação desembolsada ou em execução. |
| Liquidada | Operação concluída financeiramente. |
| Inadimplente | Pagamento vencido ou marcado como não realizado. |
| Reprovada | Solicitação recusada. |
| Cancelada | Fluxo encerrado por cancelamento. |

### Logística

| Status | Significado |
|---|---|
| Não iniciado | A etapa logística ainda não começou. |
| Aguardando desembolso | A logística será liberada após o desembolso. |
| Em trânsito | A entrega está em acompanhamento. |
| Aguardando comprovante | Falta documento de entrega aplicável. |
| Aguardando análise | Há documento enviado para decisão. |
| Entrega confirmada | Todos os requisitos obrigatórios foram aprovados. |
| Em atraso ou com pendência | Existe prazo vencido, rejeição ou pendência relevante. |

## 17. Dúvidas frequentes

### Por que fui desconectado?

A sessão de segurança completou 24 horas, houve logout nesta sessão ou a autenticação deixou de ser válida. Entre novamente com senha e TOTP.

### Por que o TOTP foi solicitado novamente?

Pode ser um novo login, outro navegador ou dispositivo, o fim da janela de 24 horas ou uma ação sensível.

### Por que não vejo determinado fundo?

O seletor lista apenas fundos autorizados. Solicite a revisão do seu acesso ao responsável interno.

### Por que um cedente não consegue operar?

Confirme se o vínculo está ativo, se existe uma política publicada e se ela foi aplicada ao vínculo no fundo correto.

### Por que não aparece uma lista documental?

Se a política não exigir documentos naquela etapa, a ausência do checklist é esperada. Confirme a versão publicada e aplicada.

### PDF e XML são obrigatórios ao mesmo tempo?

Não. A NF precisa de PDF **ou** XML original. Documentos adicionais dependem da política.

### Por que não consigo aprovar a NF?

Verifique arquivo original, documentos obrigatórios bloqueantes, versões rejeitadas e dados pendentes. O aceite do sacado é separado da aprovação da NF.

### Por que não consigo desembolsar?

Confira o status da operação, os documentos assinados exigidos, a configuração CNAB e as demais pendências indicadas no card da operação.

### Como substituir um documento assinado?

Use o ícone à direita da linha do documento, identificado como **Substituir documento**, e confirme o novo arquivo.

### Por que o painel logístico não aparece?

A política preservada na operação não exige acompanhamento de entrega ou a operação ainda não possui uma etapa logística aplicável.

### Por que uma NF continua em atenção após nova previsão?

A comunicação não apaga o prazo original. Documento rejeitado ou nova previsão vencida continua exigindo acompanhamento.

### Por que não vejo uma operação ou um cedente?

Confirme o fundo ativo. O portal não mistura dados entre fundos nem exibe vínculos fora da sua autorização.
