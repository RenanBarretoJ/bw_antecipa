# P2.2.2 — Adapter financeiro Portal FIDC/Sinqia e Envios Operacionais

## 1. Objetivo

O P2.2.2 conecta os relatórios financeiros comprovados do Portal FIDC/Sinqia ao pipeline versionado do P2.2 e corrige a semântica da navegação de envio. O adapter passa a suportar funcionalmente `CESSAO_ENVIO`, `ESTOQUE`, `AQUISICOES` e `LIQUIDACOES`; `CARTEIRA` permanece sem suporte. A antiga subtab CNAB passa a ser “Envios Operacionais”, na qual CNAB é o método atual do Envio de Cessão, e não uma operação universal.

## 2. Diagnóstico

Antes desta fase, o registry real declarava somente `CESSAO_ENVIO`, embora o SC1 comprovasse o protocolo dos relatórios de Estoque, Aquisições e Liquidações. O cron P2.2 já resolvia cada família independentemente, mas não encontrava handlers Sinqia. O parser e a persistência P2.2 já eram adequados e foram preservados. Fontes analisadas: `src/lib/integracoes/`, `src/lib/portal-fidc/`, `src/lib/rlx/ingestao/`, `src/components/admin/`, `src/app/admin/fundos/` e o protocolo do SC1.

## 3. Adapter Sinqia anterior

O adapter `sinqia_portal_fidc` possuía credencial criptografada por fundo/integração/ambiente, endpoint versionado e execução real de cessão via Portal FIDC. Seu registry declarava apenas `CESSAO_ENVIO`; por isso as capabilities financeiras eram corretamente bloqueadas pela UI e pela função SQL defensiva. Não havia handler financeiro registrado.

## 4. Capabilities novas

O contrato canônico está em `src/lib/integracoes/capabilities.ts`. O registry em `src/lib/integracoes/registry.server.ts` declara exatamente:

- `CESSAO_ENVIO`;
- `ESTOQUE`;
- `AQUISICOES`;
- `LIQUIDACOES`.

`CARTEIRA` não é declarada. A seleção continua parcial: o adapter informa possibilidades e o Super Admin escolhe apenas as capabilities daquele fundo/versão.

## 5. Protocolo financeiro

O handler em `src/lib/rlx/ingestao/sinqia-portal-fidc.server.ts` implementa unidades independentes:

```text
agendamento SOAP
→ polling do relatório
→ download MTOM ou base64
→ abertura do ZIP
→ seleção inequívoca do CSV pela assinatura de headers
→ bytes originais do CSV
→ pipeline P2.2
```

Não foi copiada a segurança, tenancy, persistência ou parser do SC1. Somente endpoints, operações, parâmetros e estados comprovados foram usados.

## 6. Estoque

`ESTOQUE` usa `/agendador/relatorioEstoque?wsdl`, operação `agendadorRelatorioEstoque`, `cnpjFundo`, `dataReferencia`, filtro opcional de cedente e formato CSV. O ciclo solicita D-1 ANBIMA. O ZIP precisa conter exatamente um CSV com `SEU_NUMERO` e `DATA_REFERENCIA`; ausência ou ambiguidade falha fechada.

## 7. Aquisições

`AQUISICOES` usa `/agendador/relatorioAquisicaoLiquidados?wsdl`, `tipoRelatorio=1` e intervalo D-1 a D-1. O parser reconhece `ENTRADA` como data de movimento comprovada. Arquivo ausente, ZIP inválido ou layout desconhecido não são classificados como movimento vazio.

## 8. Liquidações

`LIQUIDACOES` usa a mesma família de serviço com `tipoRelatorio=2` e o filtro legado comprovado `tipoMovimento=BAIXA`, em D-1. Os códigos e descrições de movimento permanecem dados de origem. Não foi implementada semântica de encerramento, liquidação parcial ou catálogo financeiro futuro.

## 9. Layouts

O core continua usando contratos P2.2 versionados. Foram ampliados somente aliases comprovados em `src/lib/rlx/ingestao/layouts.ts`: `SEU_NUMERO` pode identificar o recebível de estoque e `ENTRADA` pode representar a data de aquisição. O UUID interno do fundo não é exigido no CSV externo; ele vem do contexto confiável. Os nomes `*_GOLDEN_V1` não foram renomeados para sugerir universalidade Sinqia.

## 10. Pipeline P2.2

O adapter não grava tabelas financeiras. `src/lib/rlx/ingestao/provider.ts` entrega o artefato a `src/lib/rlx/ingestao/ingestao.server.ts`, que preserva Storage privado, SHA-256, parser, staging, validação e publicação atômica. O CSV extraído do ZIP é o artefato financeiro bruto; seus bytes são entregues sem conversão de encoding antes do hash.

## 11. Credenciais

`src/lib/integracoes/credentials.server.ts` resolve credenciais somente no servidor e exige correspondência exata de `fundo_id`, integração, ambiente, versão e credencial ativa. O adapter não usa credencial global nem tenta outra credencial como fallback. A equivalência de autorização entre cessão e relatórios ainda requer homologação externa do provedor.

## 12. Timeout e retry

Cada capability possui agendamento, polling e timeout próprios. Não existe operação `buscarTodosRelatoriosSinqia`. O catálogo sanitizado diferencia autenticação, falha de relatório, timeout, arquivo inválido, layout não suportado e configuração inválida. O retry continua sob responsabilidade do ciclo P2.2; nenhuma resposta SOAP completa ou segredo é exposto.

## 13. Cron

`src/lib/rlx/ingestao/cron.server.ts` continua resolvendo Estoque, Aquisições, Liquidações e Carteira separadamente. As três primeiras podem resolver o adapter Sinqia; Carteira exige outra fonte. Uma falha não impede o registro das demais e o ciclo pode terminar parcial, com detalhe por capability e versão de integração.

## 14. Carteira

Não há evidência nem handler real de Carteira no Portal FIDC/Sinqia. A capability permanece desabilitada para esse adapter e deve ser configurada por fonte independente. PL D-2 não foi implementado nesta fase.

## 15. Envios Operacionais

`src/app/admin/fundos/[id]/page.tsx` usa `?tab=envios` como rota canônica e redireciona `?tab=cnab` para preservar bookmarks. `src/components/admin/fundo-envios-operacionais.tsx` mostra somente Envio de Cessão. Não há card, checkbox ou promessa de Baixa.

## 16. Operação, capability e método

Os conceitos ficam separados:

```text
Operação: Cessão
Capability: CESSAO_ENVIO
Integração: Portal FIDC/Sinqia
Método: CNAB
```

O domínio de método está no registry e hoje contém somente `CNAB`, único método comprovado.

## 17. CNAB

As tabelas, versões, layout, código originador, histórico e gerador existentes foram reutilizados. Não foi criada configuração paralela. O painel CNAB somente aparece quando a fonte publicada de `CESSAO_ENVIO` resolve um adapter cujo método seja `CNAB`.

## 18. Cessão

`src/lib/portal-fidc/integracao.ts` continua resolvendo `CESSAO_ENVIO` por fundo e ambiente. Antes de executar o fluxo existente, valida que o adapter declara método `CNAB`, inclusive para versões históricas. Geração, Storage, hash, remessa e envio não tiveram resultado funcional alterado.

## 19. Preparação para baixa futura

A navegação comporta novas operações sem ser renomeada. Um futuro `BAIXA_ENVIO` poderá declarar integração, método e configuração próprios no registry. Nenhuma capability genérica `ENVIO_ADMINISTRADORA`, implementação de baixa ou tela fictícia foi criada.

## 20. UI

Ao selecionar Portal FIDC/Sinqia, Cessão, Estoque, Aquisições e Liquidações ficam disponíveis; Carteira fica indisponível. Nenhuma capability é marcada automaticamente. A aba Envios Operacionais resolve a fonte publicada; sem `CESSAO_ENVIO`, mostra “Não configurado” e direciona para Integrações, sem liberar CNAB isoladamente.

## 21. RLS

Não houve ampliação de acesso. Configuração técnica permanece no contexto do Super Admin, e o runtime usa clientes server-side após resolver fundo, ambiente, capability e versão publicada. As tabelas P2.2/P2.2.1 mantêm suas políticas e grants existentes.

## 22. MFA

Salvar rascunho preserva o comportamento SA3. Publicar, testar e desativar continuam exigindo a confirmação TOTP fresca existente nas actions administrativas. Nenhum bypass foi introduzido pelo adapter.

## 23. Migration e backfill

A migration incremental `20260814123000_p2_2_2_sinqia_financeiro_envios.sql` atualiza apenas o espelho defensivo de capabilities e adiciona validação server-side do CNPJ versionado para capacidades financeiras. Não há coluna de método: `CNAB` é metadata controlada pelo adapter, portanto versões históricas Sinqia com `CESSAO_ENVIO` resolvem semanticamente CNAB sem reescrever registros. Migrations anteriores não foram editadas.

## 24. Testes

Foram adicionados testes de registry exato, ausência de Carteira, seleção/protocolo das três famílias, preservação de bytes, MTOM, ZIP inválido, configuração por fundo, aliases reais do parser, fundo confiável, migration, rota canônica e alias. A suíte existente cobre pipeline, hash, idempotência, retificação, ciclo parcial, SA3, MFA, RLS e multifundo.

## 25. Regressões

Foram revalidados criação/edição de integração, rascunho incompleto, resolução por capability, Portal FIDC de cessão, parser P2.2, cron, configurações técnicas e navegação administrativa. A configuração CNAB e o runtime de remessa existentes foram preservados.

## 26. Limitações

- Homologação externa com credencial segura dos serviços de relatório ainda precisa ser executada.
- O teste técnico continua sendo conectividade e não gera relatório real.
- Movimento vazio só é aceito quando o arquivo traz declaração explícita já reconhecida pelo P2.2; o adapter não sintetiza vazio.
- Não há provider real de Carteira, Vórtx ou Portal Custódia.
- Não há `BAIXA_ENVIO`, matching, conciliação, regra dos 40% ou P2.3.

## 27. Riscos

Os contratos SOAP são integrações externas e podem variar por ambiente/versão do provedor. A assinatura de headers é deliberadamente estrita para impedir ingestão no layout errado, podendo exigir novo contrato versionado quando o fornecedor alterar o arquivo. Credenciais de cessão podem não possuir autorização para relatórios; isso deve ser confirmado em homologação sem usar produção.

## 28. Próximos adapters

Novos adapters devem declarar capabilities e métodos apenas quando houver handler real, configuração versionada e teste. Vórtx, Portal Custódia e Carteira permanecem fora do registry até existirem evidências e implementações independentes.

## 29. Parecer

O P2.2.2 fecha a lacuna arquitetural sem criar um segundo pipeline financeiro. O Portal FIDC/Sinqia passa a ser fonte real das três famílias comprovadas, com execução isolada, bytes preservados, contexto multifundo e linhagem de versão. A cessão mantém o resultado CNAB existente, agora expressa por operação/capability/método. A arquitetura está pronta para homologação externa e para adapters futuros, mas não autoriza considerar Carteira ou Baixa implementadas.
