# SA3 — Administração técnica de fundos, CNAB, integrações e credenciais

## 1. Objetivo

Separar permanentemente infraestrutura técnica e operação. O Super Admin passa a configurar como a plataforma se conecta ao ecossistema de cada fundo; o Gestor continua decidindo como o fundo opera. O SA3 não concede ao Super Admin acesso a NFs, documentos ou decisões comerciais.

## 2. Diagnóstico

Antes do SA3, `/gestor/fundos/[id]` concentrava dados estruturais, políticas, templates, comunicações, CNAB, Portal FIDC e credenciais. As actions de `configuracoes-cnab.ts` ainda permitiam mutações pelo Gestor e alguns caminhos de credencial usavam `service role`. O runtime já consumia as tabelas canônicas versionadas, portanto não era necessário criar um segundo modelo.

## 3. Matriz de responsabilidades

| Área | Classificação | Responsável após SA3 |
|---|---|---|
| Fundo, administradora, gestora e custodiante | ESTRUTURAL_SUPER_ADMIN | Super Admin |
| Gestores autorizados no fundo | ESTRUTURAL_SUPER_ADMIN | Super Admin |
| Portal FIDC, endpoints e versões | TECNICA_SUPER_ADMIN | Super Admin |
| Credenciais e rotação | TECNICA_SUPER_ADMIN | Super Admin |
| CNAB e código originador | TECNICA_SUPER_ADMIN | Super Admin |
| Teste de conexão | TECNICA_SUPER_ADMIN | Super Admin |
| Políticas e elegibilidade | OPERACIONAL_GESTOR | Gestor |
| Templates jurídicos | OPERACIONAL_GESTOR | Gestor |
| Comunicações e réguas | OPERACIONAL_GESTOR | Gestor |
| Remessas e retornos | RUNTIME_AUTOMATICO / SOMENTE_LEITURA | Runtime; status para Gestor/Admin conforme contexto |
| Operações, NFs e aprovações | OPERACIONAL_GESTOR | Gestor |

## 4. Arquitetura antes/depois

Antes:

```text
Gestor -> cadastro do fundo -> políticas/templates + CNAB/integracao/credenciais
                                     |
                                     -> tabelas canônicas -> runtime
```

Depois:

```text
Super Admin -> /admin/fundos/[id] -> RPC administrativa -> mesmas tabelas canônicas
                                                               |
Gestor -> Configurações do fundo ativo -> políticas/templates/comunicações
                                                               |
Runtime automático --------------------------------------------+
```

## 5. Portal FIDC

A aba `Integrações` administra a integração canônica `fromtis`, apresentada como Portal FIDC / Sinqia. Ela mostra prontidão técnica derivada, endpoint, ambiente, credencial vinculada, versões e execuções recentes. Não há configuração global paralela.

## 6. Versões

Rascunhos podem ser criados ou alterados. Publicação substitui transacionalmente a versão publicada anterior; versões publicadas não são editadas. Alterações usam nova versão, preservando referências históricas.

## 7. Credenciais

Cadastro, ativação, rotação e revogação estão disponíveis somente no Admin. O navegador recebe apenas nome, ambiente, status, datas e identificador mascarado. A versão publicada mantém o ID exato da credencial selecionada.

## 8. Criptografia

Foi reutilizado o formato AES-256-GCM existente em `src/lib/portal-fidc/credenciais.ts`. Usuário e senha são criptografados na Server Action antes da RPC. Plaintext não é enviado ao PostgreSQL, não é auditado e não volta no DTO.

## 9. Rotação

Rotação cria uma nova credencial. A ativação serializada substitui a credencial corrente do mesmo ambiente, preserva a anterior e registra o evento administrativo. Não existe sobrescrita silenciosa do segredo.

## 10. Revogação

A revogação é idempotente, exige motivo e TOTP fresco e pode atingir uma credencial referenciada por versão publicada. Nesse caso a UI avisa que a integração ficou indisponível. A credencial não é apagada.

## 11. Testes técnicos

O teste usa exatamente a versão e a credencial vinculadas, possui timeout de 15 segundos, valida o endpoint novamente no servidor e registra duração, status e resposta sanitizada. Não cria remessa, não altera operação e é permitido em fundo inativo.

## 12. CNAB

A aba `CNAB` reutiliza `configuracoes_cnab` e `configuracao_cnab_versoes`. Somente os parâmetros já presentes no modelo são editáveis. Rascunhos, publicação, desativação e histórico permanecem versionados.

## 13. Código originador

O código originador permanece string, preservando zeros à esquerda. Ele é validado, versionado e auditado; o Gestor não possui mais caminho de alteração.

## 14. Fundo inativo

Fundo inativo pode receber credenciais, versões CNAB e versões de integração, além de executar teste técnico. O runtime Portal FIDC exige fundo ativo quando resolve automaticamente a versão operacional.

## 15. Runtime

O runtime continua usando as mesmas tabelas e a versão publicada do fundo. A mudança foi de autoria administrativa, não de fonte de verdade. A geração e o envio automáticos não dependem de um Super Admin autenticado.

## 16. Gestor

O Gestor mantém políticas, templates jurídicos, comunicações, operações e acompanhamento. As antigas actions técnicas retornam bloqueio explícito e não contêm mais caminho com `service role`.

## 17. Reorganização do menu

Foram removidos `Fundos` e `Comunicações` como entradas independentes da sidebar do Gestor. Permanece uma única entrada `Configurações`, sempre contextualizada pelo fundo ativo.

## 18. Configurações do Fundo

`/gestor/configuracoes` resolve o fundo ativo no servidor e apresenta somente Políticas, Templates jurídicos e Comunicações. Ausência de fundo redireciona para `/gestor/sem-fundo`. IDs arbitrários não selecionam outro fundo.

## 19. RLS e grants

A migration remove as policies `gestor_all` das tabelas técnicas, revoga acesso direto autenticado e restringe mutações a RPCs administrativas. Execuções e retornos mantêm leitura operacional contextual, sem permitir escrita direta pelo Gestor.

## 20. RPCs

As RPCs SA3 são `SECURITY DEFINER`, têm `search_path` fechado, parâmetros explícitos, validação `private.usuario_e_super_admin()` e auditoria. Foram criadas RPCs sanitizadas para leitura, credenciais, versões de integração, CNAB e teste técnico.

## 21. MFA fresco

Cadastro, rotação, ativação/revogação de credencial, salvamento/publicação/desativação, teste externo e alterações CNAB consomem autorização sensível derivada de uma confirmação TOTP de seis dígitos. A sessão MFA de 24 horas isoladamente não autoriza a mutação.

## 22. Auditoria

Eventos técnicos são gravados em `plataforma_auditoria` com ator, fundo, entidade, antes/depois sanitizados, origem `admin_configuracoes_tecnicas` e `correlation_id`. Segredos não integram o evento.

## 23. Concorrência

Publicação e rotação usam advisory locks transacionais. Atualizações de rascunho usam comparação de `updated_at`. Índices únicos parciais existentes continuam garantindo no máximo uma versão publicada ativa; operações repetidas de publicação, revogação e desativação são seguras.

## 24. Segurança

Não há `service role` na UI SA3. Endpoints aceitam somente HTTPS, sem credenciais na URL, localhost, IP privado ou metadata; DNS é resolvido no servidor e uma allowlist opcional pode ser configurada. O DTO é uma allowlist e não contém ciphertext ou plaintext.

## 25. Regressões

Geral e Gestores no detalhe administrativo foram preservados. A sidebar Admin continua com apenas Visão geral, Fundos e Usuários & Acessos. Políticas, Templates e Comunicações permanecem com o Gestor. Nenhuma tabela operacional, P1 ou P2.0 foi remodelada.

## 26. Testes

Foram adicionados testes SA3 para validação dos DTOs, preservação de zeros do originador, ausência de fallback, bloqueio das actions do Gestor, redirects legados, MFA/RPC, grants, status canônicos, bloqueio de CNAB para fundo inativo, limpeza write-only da senha e ausência de segredo nos DTOs. A validação local final registrou 110 arquivos e 807 testes aprovados; TypeScript, `git diff --check` e build Next.js passaram. O lint passou sem erros e manteve seis avisos preexistentes fora do SA3. Os smokes com JWT real dependem da aplicação da migration em homologação.

## 27. Migration

Migration incremental: `supabase/migrations/20260812190000_sa3_admin_configuracoes_tecnicas.sql`. Ela não cria tabelas paralelas. A migration não foi aplicada pelo agente: o MCP Supabase está desconectado e não houve autorização para ação alternativa no banco remoto.

## 28. Riscos

- migration ainda não validada transacionalmente contra o banco remoto;
- testes JWT Gestor, Super Admin puro e híbrido dependem de homologação;
- teste externo depende de endpoint e credencial reais;
- jobs e comunicações de fundo inativo devem ser reconfirmados em smoke integrado;
- uma allowlist explícita é recomendada em produção por `PORTAL_FIDC_ENDPOINT_ALLOWLIST`.

## 29. Limitações

SA3 não implementa novos provedores, protocolos, layouts CNAB, gates de prontidão global ou dashboard operacional. A tela mostra apenas as 20 execuções da página atual e pagina por demanda.

## 30. Próximos passos

Aplicar a migration primeiro em transação de homologação, executar os cenários A–I do escopo com JWTs reais, validar o endpoint Sinqia, confirmar bloqueio de fundo inativo nos jobs e só então promover o schema. Produção permanece fora deste escopo.

## 31. Parecer

A arquitetura de código está separada por responsabilidade e mantém a fonte canônica usada pelo runtime. Super Admin puro administra qualquer fundo sem receber acesso operacional; usuário híbrido continua limitado por `usuario_fundos` na área Gestor. O SA3 somente estará homologado após migration e smokes remotos; até lá, o estado é **implementado e validado localmente, pendente de aplicação no banco**.
