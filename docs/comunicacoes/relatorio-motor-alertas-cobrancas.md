# Motor de alertas, lembretes e cobranças por e-mail

## 1. Objetivo

O P1 introduz um motor único de comunicações operacionais por fundo. Ele transforma obrigações logísticas e financeiras já existentes no domínio em lembretes e cobranças rastreáveis, sem duplicar regras da Central Logística, da política operacional ou da liquidação.

O motor nasce desativado: nenhum fundo é incluído automaticamente. Uma configuração só produz comunicações depois de criada, revisada e publicada no contexto do fundo.

## 2. Arquitetura

```text
Fundo
  -> configuração de comunicações
  -> versão publicada imutável
  -> templates versionados
  -> cron protegido
  -> resolvedor logístico/financeiro
  -> agrupamento e renderização
  -> comunicação persistida e idempotente
  -> transporte SMTP IONOS com TLS
  -> tentativas, itens, estágios e histórico
```

As principais responsabilidades estão separadas em:

- domínio: `src/lib/comunicacoes/`;
- aplicação: `src/lib/actions/comunicacoes.ts` e `motor.server.ts`;
- transporte: `src/lib/email.ts`;
- scheduler: `src/app/api/cron/comunicacoes/route.ts`;
- apresentação: aba Comunicações do fundo e `/gestor/comunicacoes`;
- persistência: migration `20260807170000_p1_motor_comunicacoes_email.sql`.

## 3. Régua logística

A régua padrão é `D-5, D-3, D-1, D0, D+1 e D+3`. Após D+3, a cobrança pode recorrer a cada três dias. A data de obrigação vem da projeção logística canônica (`projetarDocumentoLogistico`) e considera o requisito materializado, a operação e a evidência atual.

Documentos aprovados ou aguardando análise não geram cobrança normal. Documento rejeitado gera mensagem específica uma vez por versão rejeitada; se continuar pendente, volta à régua de atraso.

## 4. Régua financeira

A régua padrão é `D-7, D-3, D-1, D0, D+1, D+3, D+5 e D+7`, com recorrência a cada três dias após D+7. Entram somente operações em andamento ou inadimplentes e NFs que não estejam liquidadas ou canceladas.

O destinatário é definido pela participação do sacado preservada no snapshot da operação. O contato é resolvido no cadastro canônico atual, sem aceitar e-mail vindo da interface.

## 5. Dias úteis

O motor reutiliza `ehDiaUtilAnbima`, a mesma função do cálculo operacional. Lembretes anteriores ao vencimento são antecipados para o dia útil anterior. D0 e cobranças posteriores são deslocados para o próximo dia útil. Se várias etapas caírem na mesma data, prevalece a mais crítica.

O cron não processa envios em dia não útil. Datas injetadas existem somente no domínio e no dry-run autorizado; a rota produtiva não aceita `?date=`.

## 6. Destinatários

Logística é dirigida ao contato do cedente vinculado ao fundo. Financeiro segue o snapshot de participação do sacado: quando aplicável, envia ao sacado; nos demais casos, ao cedente. Ausência de e-mail não é substituída silenciosamente: a comunicação fica bloqueada com motivo sanitizado.

## 7. CC

Gestores ativos e autorizados ao mesmo fundo entram em cópia apenas em eventos críticos: atraso ou rejeição. O motor não copia gestores de outro fundo e não usa listas globais.

## 8. Consolidação

Itens são agrupados por fundo, família, destinatário e data efetiva. O e-mail contém uma tabela gerada pelo sistema, enquanto todos os itens permanecem individualmente persistidos para auditoria. O limite visual não elimina itens do histórico.

## 9. Postergação

Quando existe nova previsão válida para o comprovante de entrega, ela substitui a data operacional usada pela régua. O prazo original continua no snapshot do item para rastreabilidade. A postergação não altera a política nem o requisito histórico.

## 10. Rejeição

Uma rejeição é identificada pela versão e pela análise documental atuais. A chave de estágio inclui a identidade da versão rejeitada, impedindo repetição da mesma mensagem e permitindo nova comunicação se outra versão também for rejeitada.

## 11. Liquidação

Obrigações financeiras liquidadas ou canceladas deixam de gerar novos itens. O motor consulta o estado canônico antes de materializar cada execução; não altera status de NF, operação ou liquidação.

## 12. Templates

Há sete categorias controladas: lembrete, vencimento, atraso e rejeição logística; lembrete, vencimento e atraso financeiro. Cada versão da configuração possui seu próprio conjunto de templates. O gestor pode manter o padrão ou publicar conteúdo personalizado. Templates publicados são imutáveis.

## 13. Variáveis

Somente variáveis da allowlist de cada família são aceitas. Não há `eval`, execução de código ou acesso arbitrário a propriedades. Dados operacionais são escapados antes da inserção em HTML. A tabela de itens é construída exclusivamente pelo servidor.

## 14. Idempotência

A chave é estável por fundo, versão da configuração, família, destinatário lógico, data e itens/estágios. E-mail não participa da chave para permitir recuperar uma comunicação bloqueada depois da correção do cadastro. Há constraints únicas para idempotência e `Message-ID`; concorrência retorna a comunicação já existente.

## 15. Retries

Cada comunicação aceita no máximo três tentativas, persistidas separadamente. O mesmo assunto, conteúdo, chave de idempotência e `Message-ID` são reutilizados. Há backoff curto e crescente entre tentativas. Transporte não configurado (`EMAIL_DISABLED`) interrompe o retry imediato.

Execuções abandonadas em `PROCESSANDO` por mais de 30 minutos podem ser retomadas como falha controlada.

## 16. Scheduler

O Vercel Cron chama `/api/cron/comunicacoes` diariamente às 11:00 UTC, equivalente a 08:00 em São Paulo. A rota exige `Authorization: Bearer <CRON_SECRET>` e usa comparação de tempo constante. Cada execução recebe ID e resumo persistidos.

## 17. SMTP e transporte

O transporte operacional usa o SMTP corporativo da IONOS por meio do adaptador central `src/lib/email.ts`. A conexão padrão é `smtp.ionos.com:465` com TLS desde o início; a porta 587 também é aceita quando configurada explicitamente com STARTTLS. O adaptador suporta texto, HTML, CC, `Message-ID`, cabeçalho técnico de idempotência e retorno sanitizado do servidor SMTP.

As credenciais ficam exclusivamente no ambiente de execução: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_FROM`. Sem usuário e senha, nenhum e-mail sai e a tentativa retorna `EMAIL_DISABLED`; configuração parcial ou remetente fora do domínio da conta retorna `SMTP_CONFIG_INVALID`. Segredos não são armazenados nas tabelas, logs ou interface.

O endereço de e-mail autenticado permanece fixo em `EMAIL_FROM`, mas o nome visível do cabeçalho `From` é resolvido por fundo a partir de `fundos.gestora_nome`. O sufixo societário `LTDA`/`LIMITADA` é removido apenas para apresentação; por exemplo, `RX ASSET LTDA` é enviado como `RX ASSET <notificacoes@dominio>`. O nome é sanitizado e congelado em `comunicacoes.remetente_nome`, preservando retries e histórico mesmo se o cadastro do fundo mudar posteriormente. Na ausência de uma gestora válida, o fallback explícito é `BETTER WITH`.

O SMTP não oferece idempotência transacional equivalente à fila do banco. A aplicação preserva a constraint de idempotência, reutiliza o mesmo `Message-ID` e envia a chave como `X-BW-Idempotency-Key`; ainda existe risco residual de duplicidade quando o servidor aceita a mensagem, mas a conexão cai antes da confirmação ao cliente.

## 18. Histórico

`/gestor/comunicacoes` oferece visão consolidada somente leitura. A aba Comunicações no detalhe do fundo apresenta prontidão, versão, templates e últimas comunicações. O histórico preserva execução, comunicação, itens, estágios, tentativas, provider ID e erro sanitizado, sem copiar documentos ou payloads sensíveis.

## 19. RLS

Todas as tabelas usam RLS. Leitura autenticada depende do acesso ao fundo. Administração de configurações depende da permissão de gestor no fundo ativo. Mutações operacionais são realizadas apenas por RPCs autorizadas ao `service_role`. O `fundo_id` é validado nos relacionamentos e não é confiado ao frontend.

## 20. Performance

Índices cobrem fundo/status/data, execução, categoria, item e tentativa. O motor trabalha em lotes com limites defensivos configuráveis. Superar o limite de leitura interrompe a execução, evitando truncamento silencioso. A fila persistida pode ser retomada sem recalcular o conteúdo.

## 21. Testes

Os testes cobrem defaults, calendário, colisão, recorrência, catch-up, não repetição, agrupamento, criticidade, escape de XSS, allowlist, versionamento, RLS, service role, idempotência, tentativas, domínio compartilhado e proteção do cron.

O transporte real não é exercitado na suíte. Testes de integração devem usar `.invalid` ou caixa explicitamente controlada.

## 22. Homologação

Aplicar primeiro a migration incremental. Em seguida, executar:

```bash
npm run homolog:comunicacoes:verify
```

O `.env.homolog` deve declarar `COMUNICACOES_HOMOLOG_PROJECT_REF` com a referência pública exata do projeto de homologação. Como alternativa, use `--expected-project-ref <ref>`. O script compara API, banco e referências de produção antes de conectar.

O script é read-only e valida schema, RLS, configurações, templates, isolamento, idempotência, itens e tentativas. Ele não cria registros nem envia e-mail. O dry-run da aba do fundo resolve os candidatos sem persistir estágio como comunicado.

## 23. Rollout

1. Aplicar migration em homologação.
2. Executar o verify.
3. Criar configuração somente em um fundo piloto.
4. Revisar templates e executar dry-run.
5. Publicar a versão com o transporte ainda desabilitado.
6. Conferir comunicações bloqueadas e destinatários.
7. Configurar o SMTP IONOS e enviar teste somente ao gestor autenticado.
8. Liberar o cron para o piloto.
9. Expandir fundo a fundo após evidências.

Não existe ativação automática ou configuração global implícita.

## 24. Rollback

O rollback operacional preferencial é pausar a configuração do fundo e desabilitar o cron/transporte. Isso preserva todo o histórico. Se a implantação ainda não gerou dados e houver decisão de remover o schema, criar migration reversa específica; não editar nem apagar a migration aplicada.

Comunicações já enviadas não são reversíveis. Registros pendentes devem ser bloqueados/pausados, não excluídos para ocultar trilha.

## 25. Riscos

- migration ainda precisa ser aplicada e validada no ambiente alvo;
- caixa postal, limites e reputação do domínio IONOS precisam de homologação externa;
- qualidade dos e-mails cadastrais afeta comunicações bloqueadas;
- cron de cinco minutos de duração exige monitoramento de volume;
- a primeira ativação pode gerar catch-up controlado de pendências antigas;
- preview não substitui revisão jurídica do conteúdo personalizado;
- não há gestão de bounce/complaint/webhook neste P1.

## 26. Parecer

A arquitetura está preparada para múltiplos fundos, réguas e templates versionados sem acoplamento a um fundo legado. As regras operacionais continuam nas fontes canônicas e a camada de comunicação apenas decide quando, para quem e com qual conteúdo comunicar.

O P1 está tecnicamente apto para homologação após a aplicação das migrations. Produção depende de verify aprovado, piloto opt-in, validação dos destinatários, SMTP IONOS homologado, observabilidade do cron e aceite operacional/jurídico dos templates.
