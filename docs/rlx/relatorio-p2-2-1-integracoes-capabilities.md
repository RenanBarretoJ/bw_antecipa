# P2.2.1 — Integrações técnicas por capability

## 1. Objetivo

Generalizar a infraestrutura SA3 para permitir múltiplas integrações técnicas por fundo e resolver cada função operacional pela capability necessária, sem presumir fornecedor ou produto único.

## 2. Problema anterior

O runtime associava o fundo a uma integração Portal FIDC/Sinqia. Isso atendia ao envio de cessão, mas não permitia atribuir Estoque, Aquisições, Liquidações e Carteira a fontes distintas sem criar regras específicas por fornecedor.

## 3. Provider

`integracoes_fundo.provider_key` identifica o fornecedor como metadata textual controlada. Não foi criado enum PostgreSQL fechado. O provider não determina automaticamente capabilities nem protocolo.

## 4. System

`integracoes_fundo.system_name` identifica o produto ou sistema usado. Provider e sistema são independentes; o backfill conhecido representa `SINQIA` como provider e `Portal FIDC` como sistema.

## 5. Adapter

`integracao_fundo_versoes.adapter_key` identifica a implementação server-side. O registry possui somente `sinqia_portal_fidc`, pois é o único adapter real comprovado, e declara suporte apenas a `CESSAO_ENVIO`.

Integrações futuras podem existir como rascunho sem adapter, mas não podem ser publicadas nem testadas operacionalmente.

## 6. Capabilities

O catálogo canônico inicial contém:

- `CESSAO_ENVIO`;
- `ESTOQUE`;
- `AQUISICOES`;
- `LIQUIDACOES`;
- `CARTEIRA`.

O domínio mantém a conversão central entre as quatro capabilities financeiras e os tipos P2.2 equivalentes.

## 7. Modelagem

A estrutura SA3 existente foi evoluída, sem plataforma paralela:

```text
fundos
  └─ integracoes_fundo (provider + sistema)
       └─ integracao_fundo_versoes (adapter + endpoint + credencial + configuração)
            └─ integracao_fundo_versao_capacidades (capabilities e vigência)
```

`integracao_fundo_versao_capacidades` é normalizada e possui FK restritiva, unicidade por versão/capability e identidade coerente com fundo e ambiente.

## 8. Versionamento

Capabilities pertencem à versão técnica. Uma versão publicada preserva exatamente o conjunto de funções que fornecia. Alterações exigem rascunho e nova publicação; memberships históricas não são editadas nem apagadas.

## 9. Publicação

A publicação valida adapter, capability, endpoint e credencial segundo o contrato do adapter. Advisory locks são adquiridos para cada combinação fundo/ambiente/capability antes da transferência. Todas as capabilities da versão são publicadas na mesma transação.

## 10. Conflitos

O índice parcial `uq_integracao_capability_fonte_ativa` garante no máximo uma fonte ativa por `fundo_id + ambiente + capability`. Publicar uma nova versão encerra a vigência anterior e ativa a nova de forma atômica. Não existe escolha por prioridade ou segunda fonte.

## 11. Credenciais

Credenciais continuam vinculadas à integração e à versão, não à capability. O resolvedor não procura credencial alternativa. Credencial ausente, inativa ou revogada torna indisponível um adapter que exige credencial. Segredos não entram no DTO do navegador, resolver, logs, auditoria ou importações.

## 12. Cessão

O runtime do Portal FIDC passou a resolver `CESSAO_ENVIO` pelo resolvedor canônico. Remessas históricas que já registram uma versão técnica continuam usando essa versão, preservando rastreabilidade.

## 13. CNAB

CNAB permanece uma configuração separada de formato e serialização. Ele não é provider nem capability. O adapter de cessão pode consumir a configuração CNAB vigente sem duplicá-la dentro da integração.

## 14. Dados financeiros

As importações automáticas P2.2 registram `integracao_fundo_versao_id`. A UI mostra a fonte técnica e a versão que originaram a publicação. Importações manuais e golden exibem sua origem própria sem fabricar integração.

## 15. Carteira

`CARTEIRA` é resolvida independentemente das demais famílias e pode apontar para outra integração. Nenhum adapter real de carteira foi adicionado nesta fase.

## 16. Cron

O cron resolve separadamente Estoque, Aquisições, Liquidações e Carteira. Cada handler busca somente sua família, com timeout e resultado próprios. D-1 permanece para Estoque/Aquisições/Liquidações e D-2 ANBIMA para Carteira. O ciclo agrega o resultado, mas preserva o detalhe `N/4 fontes disponíveis`.

## 17. Fallback manual

O fluxo manual P2.2 permanece explícito e usa parser, staging e publicação canônicos. O cron não converte ausência de integração em sucesso e não aciona upload manual automaticamente.

## 18. Admin UI

A aba foi generalizada para “Integrações técnicas” e apresenta:

- mapa das cinco capabilities;
- lista das integrações do fundo;
- provider, sistema, adapter e ambiente;
- edição do rascunho selecionado;
- credenciais apenas da integração selecionada;
- criação de nova integração;
- bloqueio visual de capabilities não suportadas pelo adapter.

A tela não renderiza formulários completos de todas as integrações simultaneamente.

## 19. RLS

A tabela de capabilities tem RLS habilitada e nenhuma permissão direta para `anon` ou `authenticated`; operações usam RPCs administrativas protegidas ou `service_role` no runtime server-side. O resolvedor é restrito ao `service_role`. O contexto sempre inclui fundo, ambiente e capability.

## 20. Auditoria

Foram preservados e generalizados os eventos:

- `INTEGRACAO_CRIADA`;
- `INTEGRACAO_CAPABILITIES_ATUALIZADAS`;
- `INTEGRACAO_PUBLICADA`;
- `INTEGRACAO_DESATIVADA`;
- `CAPABILITY_FONTE_SUBSTITUIDA`.

As entradas registram IDs, versões, ambiente e capabilities, nunca credenciais em claro.

## 21. Migration

A migration incremental é `20260813210000_p2_2_1_integracoes_capabilities.sql`. Ela evolui as tabelas SA3, cria a relação normalizada, índices, triggers, resolvedor, linhagem P2.2 e atualiza as RPCs existentes. Migrations anteriores não foram editadas.

## 22. Backfill

Integrações legadas `fromtis`/`sinqia` são identificadas como `SINQIA / Portal FIDC`, recebem o adapter `sinqia_portal_fidc` e somente `CESSAO_ENVIO`. IDs, versões, credenciais, vigências e execuções são preservados. Nenhuma capability financeira é atribuída automaticamente.

## 23. Testes

Os testes cobrem catálogo, registry, resolvedor exato, fundo/ambiente/capability, credencial revogada, adapter ausente, ausência de fallback, backfill, CNAB separado, linhagem P2.2, cron 4/4, falha parcial 3/4, D-1/D-2, SA3 e migration. A migration é validada em homologação com `BEGIN`, checks e `ROLLBACK` antes da aplicação.

## 24. Riscos

- A primeira aplicação precisa ocorrer no projeto correto de homologação e ser seguida pela verificação read-only.
- A integração legada deve ser testada com credencial real após o backfill.
- A mudança simultânea de muitas capabilities exige monitoramento dos eventos de substituição.
- Adapters financeiros ainda ausentes mantêm as respectivas capabilities não configuradas.

## 25. Limitações

- Não há failover automático.
- Não há credencial diferente por capability dentro da mesma integração.
- Não foram implementados adapters Vórtx, Portal Custódia ou financeiros Sinqia.
- O único adapter real continua sendo o Portal FIDC/Sinqia para cessão.
- Não há status global “fundo pronto”; a prontidão é por capability.

## 26. Próximos adapters

Um novo adapter deve ser criado somente com documentação oficial. Ele deverá declarar capabilities suportadas, requisitos de endpoint/credencial, handlers por família, sanitização de erros e testes próprios. Provider ou sistema novo não exige alteração estrutural do core, mas a implementação de código deve ser registrada explicitamente no registry.

## 27. Parecer

A arquitetura passa de uma associação implícita fundo/Sinqia para N integrações × N capabilities versionadas. A fonte é resolvida de maneira exata, auditável e fail-closed; a troca é transacional; o histórico e a origem financeira são preservados. O desenho suporta novos providers e produtos sem nova modelagem estrutural, mas não declara como operacional aquilo que ainda não possui adapter real.

## 28. Hotfix — fluxo Nova integração

### Causa raiz

A interface representava tanto “nenhuma integração selecionada” quanto “criação de nova integração” com a ausência de um ID. O botão Nova integração apenas repetia esse valor, sem transição perceptível e sem garantir a limpeza do formulário. Em paralelo, o schema do rascunho exigia ao menos uma capability, embora a RPC do P2.2.1 já aceite uma lista vazia. A mensagem genérica de UUID também não identificava se a falha vinha do fundo, da integração ou da versão.

### Lifecycle corrigido

O editor passou a possuir uma união tipada com três estados:

- `none`: nenhuma integração selecionada;
- `create`: nova integração, com `integrationId` e `versionId` nulos;
- `edit`: integração existente, identificada exclusivamente por UUID real.

Nenhum sentinel como `new` ou `novo` é usado. Ao clicar em Nova integração, o formulário é recriado com os defaults permitidos, as seleções anteriores são descartadas, o título muda para “Nova integração técnica” e a tela conduz o usuário ao editor. Um novo clique reinicia novamente o formulário.

### CREATE e EDIT

No primeiro salvamento, a action envia IDs nulos à RPC `admin_salvar_integracao_rascunho`. A RPC cria a integração e sua versão de rascunho e devolve `integracao_id`. A UI troca imediatamente para `edit`, seleciona o UUID retornado e solicita a revalidação dos dados. Os salvamentos seguintes enviam o UUID da integração e o UUID da versão rascunho, atualizando o mesmo registro em vez de criar outra integração.

A identidade usada pelo submit é capturada no início da ação. Assim, uma closure anterior não reaproveita o ID da integração que estava selecionada antes do clique em Nova integração.

### Validação de identificadores

O fundo permanece obrigatório e deve ser UUID. Integração e versão são opcionais no CREATE, mas precisam ser UUIDs reais no EDIT. As validações agora distinguem internamente `FUNDO_ID_INVALIDO`, `INTEGRACAO_ID_INVALIDO` e `VERSAO_ID_INVALIDO`, convertendo cada caso em mensagem adequada ao usuário.

O validador segue o formato canônico `8-4-4-4-12` aceito pelo tipo `uuid` do PostgreSQL, sem impor bits RFC de versão/variante. Essa distinção é necessária porque existem fundos legados válidos no banco que eram incorretamente rejeitados por `z.uuid()` antes da chamada à RPC.

### Rascunho incompleto e publicação

O rascunho aceita adapter nulo, zero capabilities, credencial nula e endpoint vazio. Isso permite cadastrar antecipadamente providers e sistemas ainda sem adapter. As regras de publicação não foram afrouxadas: Testar e Publicar permanecem indisponíveis sem adapter, e a validação server-side continua exigindo o contrato completo do adapter antes da publicação.

### Credenciais

Enquanto o CREATE ainda não retornou um UUID, a tela informa que a integração deve ser salva primeiro. Após o retorno, a integração criada passa a ser a seleção ativa e a área de credenciais usa exclusivamente esse UUID real.

### Regressões cobertas

Os testes automatizados cobrem:

- transição `none` → `create` → `edit`;
- CREATE com IDs nulos;
- cenário `CUSTOM / PORTAL FIDC`, endpoint `https://teste.com.br`, identificador `teste`, sem adapter, credencial ou capabilities;
- CREATE sem endpoint;
- segundo salvamento como EDIT da mesma integração/versão;
- bloqueio de sentinel antes de qualquer chamada ao Supabase;
- mensagens específicas por identificador inválido;
- bloqueio da publicação incompleta;
- tipos explícitos dos botões da área;
- preservação das regras SA3/P2.2.1, capabilities, credenciais e adapter registry.

O smoke do lifecycle foi automatizado no nível da action e do estado do editor. Nenhum dado QA foi criado ou removido no banco durante este hotfix. A validação visual autenticada no navegador permanece como passo de homologação humana.

### Impacto estrutural

Nenhuma migration foi criada. RPCs, RLS, resolvedor por capability, dados financeiros e adapters existentes não foram alterados por este hotfix. P2.3 não foi iniciado.
