# Fase 9 — MFA TOTP e hardening de segurança pré-produção

## 1. Diagnóstico do legado

Antes desta fase, o BW Antecipa utilizava Supabase Auth com e-mail e senha em `src/app/actions/auth.ts`. A sessão era criada por `supabase.auth.signInWithPassword`, persistida pelos cookies do `@supabase/ssr` e renovada em `src/lib/supabase/middleware.ts` via `supabase.auth.getUser()`.

O controle de rotas existia no proxy (`src/proxy.ts` + `src/lib/supabase/middleware.ts`) e validava autenticação e compatibilidade do perfil com o prefixo da rota (`/gestor`, `/cedente`, `/sacado`, `/consultor`). As validações server-side estavam centralizadas em `src/lib/auth/authorization.ts` (`requireAuthenticated`, `requireRole`, `requireGestor`, `requireCedenteAccess`, `requireOperationAccess`, `requireNotaFiscalAccess`).

Riscos encontrados:

- não existia MFA;
- não existia verificação de AAL2;
- o middleware tratava `"/"` com `startsWith("/")`, o que tornava todas as rotas compatíveis com rota pública;
- rate limit de login era apenas client-side na tela de login;
- actions financeiras e configurações críticas não exigiam sessão elevada;
- não existiam códigos de recuperação;
- não existia trilha específica de eventos de segurança;
- não existia área “Minha conta > Segurança”;
- headers de segurança não estavam configurados em `next.config.ts`;
- RPCs `SECURITY DEFINER` existem em migrations antigas e novas; parte delas possui `SET search_path`, mas funções antigas do `supabase/schema.sql` ainda precisam de revisão/aplicação efetiva em banco remoto.

## 2. Arquitetura MFA implementada

Foi adotado o MFA nativo do Supabase Auth, conforme documentação atual do Supabase para TOTP. O fluxo usa:

- `supabase.auth.mfa.enroll`;
- `supabase.auth.mfa.challenge`;
- `supabase.auth.mfa.verify`;
- `supabase.auth.mfa.listFactors`;
- `supabase.auth.mfa.unenroll`;
- `supabase.auth.mfa.getAuthenticatorAssuranceLevel`;
- AAL1/AAL2.

Fluxo:

```text
Login e senha válidos
↓
Supabase Auth cria sessão AAL1
↓
Sistema avalia perfil/permissão
↓
MFA obrigatório?
├─ sem fator verificado → /mfa/setup
└─ com fator verificado → /mfa/desafio
↓
Challenge + Verify TOTP
↓
Supabase eleva JWT para AAL2
↓
BW registra janela elevada de 15 min
↓
Portal liberado
```

Arquivos principais:

- `src/lib/auth/mfa.ts`;
- `src/app/actions/mfa.ts`;
- `src/app/mfa/setup/page.tsx`;
- `src/app/mfa/desafio/page.tsx`;
- `src/components/auth/security-page.tsx`;
- `src/lib/supabase/middleware.ts`.

## 3. Regra central de obrigatoriedade

A regra fica centralizada em `src/lib/auth/mfa.ts`:

- `gestor`: MFA obrigatório;
- `consultor`: MFA obrigatório;
- `cedente`: obrigatório quando for administrador/owner de cedente ou possuir acesso delegado administrador;
- `sacado`: opcional inicialmente;
- override futuro por `profiles.mfa_obrigatorio_override`.

Não há regra por e-mail, nome ou ID fixo de usuário.

Decisão pós-homologação: quando `estado.exigeMfa = true`, o usuário não pode desativar seu próprio MFA. Essa decisão foi aplicada em duas camadas:

- interface: `src/components/auth/security-page.tsx` deixa de renderizar o botão "Desativar MFA" e exibe a indicação "Obrigatório pela política";
- servidor: `src/app/actions/mfa.ts` bloqueia `desativarMfaProprio` quando MFA é obrigatório, registra evento `ACESSO_NEGADO` e retorna mensagem segura.

Motivo: permitir desativação pelo próprio usuário anularia a política obrigatória de MFA. Para perfis obrigatórios, reset ou exceção deve ocorrer por fluxo administrativo controlado, não por autoatendimento.

## 4. Migration

Migration criada:

`supabase/migrations/20260722132525_fase9_mfa_totp_hardening.sql`

Novos campos em `profiles`:

- `mfa_obrigatorio_override`;
- `mfa_ativado_em`;
- `ultima_autenticacao_forte_em`;
- `mfa_reset_em`;
- `sessoes_revogadas_em`.

Novas tabelas:

### `seguranca_eventos`

Finalidade: trilha específica de eventos de segurança.

Eventos previstos:

- `MFA_ENROLL_INICIADO`;
- `MFA_ATIVADO`;
- `MFA_DESATIVADO`;
- `MFA_FALHA`;
- `MFA_RECOVERY_USADO`;
- `MFA_RECOVERY_REGENERADO`;
- `MFA_RESET_ADMINISTRATIVO`;
- `SESSAO_ELEVADA`;
- `SESSOES_REVOGADAS`;
- `CREDENCIAL_ROTACIONADA`;
- `ACESSO_NEGADO`;
- `RATE_LIMIT_BLOQUEADO`.

RLS:

- gestor lê eventos;
- usuário lê seus próprios eventos;
- escrita deve ocorrer server-side com service role.

### `mfa_recovery_codes`

Finalidade: códigos de recuperação de uso único.

Regras:

- armazena somente `code_hash`;
- código plaintext é mostrado apenas uma vez;
- código usado recebe `usado_em`;
- regeneração invalida códigos ativos anteriores via `invalidado_em`.

### `sessoes_elevadas`

Finalidade: janela aplicacional de sessão elevada.

Regras:

- AAL2 obrigatório;
- janela inicial de 15 minutos;
- métodos: `totp`, `recovery_code`, `admin_reset`;
- usada pelas actions críticas além do AAL2 do Supabase.

### `seguranca_rate_limits`

Finalidade: rate limit server-side.

Escopos implementados:

- login;
- setup MFA;
- MFA TOTP;
- MFA recovery;
- teste Portal FIDC;
- envio Portal FIDC;
- ação crítica.

## 5. Onboarding MFA

Rota:

`/mfa/setup`

Fluxo:

```text
Usuário autenticado
↓
iniciarConfiguracaoMfa()
↓
Supabase enroll TOTP
↓
Tela mostra QR Code e chave manual
↓
Usuário informa primeiro código de 6 dígitos
↓
challenge + verify
↓
MFA ativo
↓
recovery codes gerados e exibidos uma única vez
```

O segredo TOTP não é salvo em logs, auditoria ou tabela comum.

Observações de homologação incorporadas:

- MFA/TOTP precisa estar habilitado no Supabase Auth do projeto. A migration da Fase 9 cria estruturas auxiliares do BW Antecipa, mas não ativa o recurso TOTP no Auth. Quando o Supabase retorna `mfa_totp_enroll_not_enabled`, a interface mostra mensagem específica orientando a habilitação.
- `iniciarConfiguracaoMfa()` tornou-se tolerante a tentativas pendentes: antes de criar um novo fator, remove fatores TOTP não verificados do usuário e cria o novo fator com `friendlyName` único. Isso evita falhas por refresh, tentativa abandonada, Strict Mode em desenvolvimento ou conflito de nome de fator.
- O link "saia e entre novamente" deixou de ser navegação simples para `/login` e passou a executar `logout()` de `src/app/actions/auth.ts`, limpando a sessão/cookies do Supabase antes do redirecionamento. Sem isso, o middleware reencaminhava o usuário autenticado para `/mfa/setup`.

## 6. Login com MFA

`src/app/actions/auth.ts` agora:

- aplica rate limit server-side no login;
- autentica e-mail/senha;
- consulta o estado MFA;
- redireciona para `/mfa/setup` quando MFA é obrigatório e não configurado;
- redireciona para `/mfa/desafio` quando há fator ou obrigação e a sessão ainda não está em AAL2.

## 7. Sessão elevada

`src/lib/auth/mfa.ts` implementa:

- `obterEstadoMfaUsuario`;
- `usuarioExigeMfa`;
- `validarNivelAutenticacao`;
- `exigirMfaConfigurado`;
- `exigirSessaoElevada`;
- `registrarSessaoElevada`.

A janela inicial é de 15 minutos.

Actions protegidas nesta fase:

- publicar/desativar política;
- publicar/desativar template;
- criar/publicar/desativar configuração CNAB;
- criar/editar/publicar/desativar/testar integração Portal FIDC;
- gerar arquivo teste CNAB;
- aprovar operação;
- desembolsar operação;
- actions administrativas em `src/lib/actions/gestor.ts`;
- aprovações/análises de NF em `src/lib/actions/nota-fiscal.ts`;
- API de geração CNAB;
- API de envio Portal FIDC.

## 8. Códigos de recuperação

Implementado em `src/lib/auth/mfa.ts` e `src/app/actions/mfa.ts`.

Regras:

- 10 códigos;
- formato legível `XXXX-XXXX-XXXX`;
- armazenamento somente como SHA-256 por usuário;
- uso único;
- regeneração invalida códigos anteriores;
- regeneração exige sessão elevada;
- uso registra evento de segurança.

## 9. Rate limiting

Implementado em `src/lib/security/rate-limit.ts`.

Proteções aplicadas:

- login em `src/app/actions/auth.ts`;
- setup de MFA em `src/app/actions/mfa.ts`, com escopo `mfa_setup`, limite mais tolerante e limpeza do contador quando o QR Code é gerado com sucesso;
- TOTP/recovery em `src/app/actions/mfa.ts`;
- teste Portal FIDC em `src/lib/actions/configuracoes-cnab.ts`;
- envio Portal FIDC em `src/app/api/contratos/enviar-remessa/route.ts`.

Mensagens são sanitizadas e não revelam se o usuário existe, se senha estava correta ou se fator existe.

Decisão pós-homologação: o setup de MFA não deve compartilhar o mesmo rate limit da validação do código TOTP. A geração do fator pode ser repetida por refresh, tentativa anterior abandonada ou reconexão do navegador. Por isso, `mfa_setup` foi separado de `mfa_totp`; a validação do código continua mais restritiva.

## 10. Sessões

Implementado:

- registro de última autenticação forte em `profiles.ultima_autenticacao_forte_em`;
- janela elevada em `sessoes_elevadas`;
- ação “Encerrar outras sessões” em `src/app/actions/mfa.ts`, usando `supabase.auth.signOut({ scope: 'others' })`;
- registro em `seguranca_eventos`.

Limite: invalidação completa de todas as sessões por reset administrativo ainda depende de execução controlada com Supabase Auth Admin e homologação.

## 11. Interface

Novas telas:

- `/mfa/setup`;
- `/mfa/desafio`;
- `/gestor/minha-conta/seguranca`;
- `/consultor/minha-conta/seguranca`;
- `/cedente/minha-conta/seguranca`;
- `/sacado/minha-conta/seguranca`.

O menu lateral agora inclui “Minha Segurança” em todos os perfis.

A tela mostra:

- MFA obrigatório;
- MFA configurado;
- sessão elevada;
- códigos de recuperação restantes;
- fatores cadastrados;
- regeneração de recovery codes;
- encerramento de outras sessões.

Comportamento pós-homologação:

- em `/mfa/setup`, o link de saída executa logout real via server action `logout()`, removendo a sessão Supabase antes de voltar ao login;
- em `/mfa/desafio`, também existe saída segura para permitir trocar de conta sem ficar preso no redirect de MFA;
- em "Minha Segurança", usuários com MFA obrigatório não veem o botão "Desativar MFA"; veem apenas a indicação "Obrigatório pela política";
- usuários sem obrigatoriedade podem manter a possibilidade futura de desativação, desde que tenham sessão elevada válida;
- o bloqueio de desativação obrigatória também existe no servidor, portanto a UI não é a única barreira de segurança.

## 12. Headers de segurança

Configurado em `next.config.ts`:

- `Content-Security-Policy`;
- `X-Content-Type-Options`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- `Strict-Transport-Security`;
- `frame-ancestors 'none'`.

A CSP preserva:

- conexão com Supabase;
- `data:`/`blob:` para QR Code e assets;
- inline script atual de boot do tema.

## 13. Auditoria de RPCs `SECURITY DEFINER`

Funções identificadas por arquivo:

- `supabase/schema.sql`: `get_user_role`, `get_user_cedente_id`, `get_user_sacado_cnpj`, `get_user_operacao_ids`, `handle_new_user`;
- `supabase/migrations/011_cedente_acessos.sql`: `get_user_cedente_id`;
- `supabase/migrations/20260721132903_fase3_repositorio_documental_nf.sql`: `instanciar_requisitos_nota`, `registrar_documento_upload`, `analisar_documento_versao`;
- `supabase/migrations/20260721170157_fase4_roteamento_aceite_sacado.sql`: `processar_aceite_sacado`;
- `supabase/migrations/20260721183540_fase5_logistica_pos_cessao.sql`: funções de leitura/registro/análise logística, desembolso e processamento de prazos;
- `supabase/migrations/20260721190904_fase6_templates_juridicos_fundo.sql`: `usuario_pode_ler_documento_gerado`;
- `supabase/migrations/20260721194546_fase7_cnab_configuravel_rastreavel.sql`: `usuario_pode_ler_remessa_cnab`;
- `supabase/migrations/20260722090000_fase8_portal_fidc_fundo.sql`: `usuario_pode_ler_integracao_execucao`.

Conclusão:

- funções novas das fases 3–8 geralmente possuem `SET search_path = public` e validações de `auth.uid()`/perfil quando executam escrita sensível;
- funções antigas do schema base não possuem `SET search_path` e devem ser saneadas em uma migration específica após validação em homolog;
- funções de processamento por cron/service role continuam sensíveis e devem passar por `supabase db lint`/advisors quando o banco local/remoto estiver disponível.

## 14. Auditoria de RLS

Tabelas revisadas no código/migrations:

- `fundos`;
- `cedente_fundos`;
- `politicas_operacionais`;
- `templates_documentos`;
- `configuracoes_cnab`;
- `integracoes_fundo`;
- `remessas_cnab`;
- `integracao_execucoes`;
- `retornos_integracao`;
- `documentos`;
- `documentos_repositorio`;
- `documento_versoes`;
- `nota_fiscal_entregas`;
- `operacoes`;
- `contas_escrow`;
- `profiles`.

Conclusão:

- RLS está habilitada nas tabelas sensíveis criadas pelas fases anteriores;
- tabelas novas da Fase 9 têm RLS habilitada;
- leitura de segurança é contextual;
- escrita das tabelas de segurança fica restrita ao server-side com service role;
- ainda é necessário validar policies no banco de homolog com testes negativos reais por perfil.

## 15. Endpoints

Revisão:

- `/api/contratos/gerar-cnab`: exige gestor + sessão elevada;
- `/api/contratos/enviar-remessa`: exige gestor + sessão elevada + rate limit;
- `/api/contratos/consultar-status-remessa`: exige gestor;
- `/api/contratos/download`: usa `requireOperationAccess`/`requireCedenteAccess`;
- `/api/cron/*`: usa `Authorization: Bearer <CRON_SECRET>` e não aceita segredo por query param;
- `/api/escrow/sync`: usa bearer API key.

O proxy deixou de capturar `/api/*`, evitando redirects HTML em chamadas API. A autenticação/autorização fica nos route handlers.

## 16. Credenciais Portal FIDC / Vault

O modelo continua armazenando apenas:

- `credential_ref`;
- `secret_name`;
- `vault_key`.

A Fase 9 não migrou segredo real para Vault, pois isso depende de decisão operacional e autorização de ambiente. O resolvedor atual segue server-side e não retorna segredos ao navegador.

## 17. Testes adicionados

Arquivo:

`src/lib/auth/mfa.test.ts`

Cobre:

- obrigatoriedade por perfil;
- override central;
- formato TOTP de 6 dígitos;
- geração de recovery codes;
- hash por usuário.

## 18. Riscos residuais

- Migration precisa estar aplicada em cada ambiente alvo antes de ativar MFA obrigatório.
- MFA/TOTP precisa estar habilitado no Supabase Auth de cada ambiente; a migration não ativa esse recurso.
- MFA precisa continuar sendo testado com usuários reais Supabase Auth em AAL1/AAL2.
- Supabase Auth Admin para reset administrativo completo ainda precisa de homologação segura.
- Vault/Supabase Vault ainda não foi ativado para segredos Portal FIDC.
- `supabase db lint`/advisors ainda precisa ser executado quando houver banco local/remoto disponível.
- Testes negativos de RLS precisam ser executados contra o banco real.
- Usuários obrigatórios não podem desativar MFA por autoatendimento; ainda falta implementar fluxo administrativo completo de reset/exceção com auditoria operacional.

## 19. Checklist de homologação

☐ Aplicar migration da Fase 9  
☐ Confirmar que Supabase Auth MFA/TOTP está habilitado no projeto  
☐ Testar login gestor sem fator → onboarding obrigatório  
☐ Testar `/mfa/setup` após tentativa abandonada/refresh e confirmar que novo QR Code é gerado
☐ Testar mensagem específica quando TOTP estiver desabilitado no Supabase Auth
☐ Testar "saia e entre novamente" em `/mfa/setup` e confirmar limpeza de cookie/sessão Supabase
☐ Testar saída segura em `/mfa/desafio`
☐ Testar login gestor com fator → desafio MFA  
☐ Confirmar JWT AAL2 após verify  
☐ Confirmar bloqueio AAL1 em geração CNAB  
☐ Confirmar bloqueio AAL1 em envio Portal FIDC  
☐ Confirmar aprovação/desembolso exigindo sessão elevada  
☐ Confirmar recovery code de uso único  
☐ Confirmar regeneração invalida códigos anteriores  
☐ Confirmar que usuário com MFA obrigatório não vê botão "Desativar MFA" em Minha Segurança
☐ Confirmar que chamada direta a `desativarMfaProprio` é bloqueada quando MFA é obrigatório
☐ Confirmar rate limit de login  
☐ Confirmar rate limit separado de setup MFA (`mfa_setup`)
☐ Confirmar rate limit TOTP  
☐ Confirmar que segredo TOTP não aparece em logs  
☐ Confirmar que recovery code não aparece em banco em texto aberto  
☐ Confirmar headers no ambiente publicado  
☐ Executar testes reais gestor/consultor/cedente/sacado  
☐ Executar testes negativos de RLS  
☐ Executar `supabase db lint`/advisors  
☐ Homologar política de reset administrativo  
☐ Homologar estratégia Vault para Portal FIDC  

## 20. Conclusão

A Fase 9 cria a base de MFA TOTP nativo Supabase e hardening pré-produção sem alterar regras financeiras ou fluxos de negócio. O sistema passa a ter onboarding MFA, desafio AAL2, janela elevada, recovery codes, rate limit server-side, eventos de segurança, headers e gates em ações críticas.

Após os testes iniciais em homologação, a implementação foi refinada para cobrir comportamentos reais de uso: setup idempotente com limpeza de fatores TOTP pendentes, mensagem específica para TOTP desabilitado no Supabase Auth, logout real nas telas de MFA para limpar cookies/sessão, rate limit separado para setup e bloqueio de desativação de MFA quando a política torna o fator obrigatório.

Ainda impedem produção plena: aplicação e validação da migration em todos os ambientes alvo, confirmação de MFA/TOTP habilitado no Supabase Auth, testes reais AAL1/AAL2, auditoria automatizada Supabase no banco, reset administrativo completo e estratégia final de Vault/rotação de credenciais.
