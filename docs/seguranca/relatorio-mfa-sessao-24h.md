# Relatório — MFA/TOTP por sessão com validade de 24 horas

## 1. Regra funcional

Cada novo login no BW Antecipa exige senha e TOTP. Uma confirmação TOTP válida
eleva somente a sessão Supabase atual por 24 horas corridas, sem renovação por
navegação ou refresh do access token. Durante essa janela, ações operacionais
comuns reutilizam a elevação; ações sensíveis exigem outro TOTP, fresco e de uso
único.

## 2. Sessão e `session_id`

A identidade da elevação é `(user_id, session_id)`. O `session_id` é lido do JWT
no banco e conferido em `auth.sessions`, sempre para `auth.uid()`. Access token,
refresh token, IP, user agent, cookie da aplicação e `localStorage` não são fonte
de identidade ou autorização.

```text
usuário + senha
  -> sessão Supabase AAL1 / session_id
  -> challenge + verify TOTP
  -> sessão Supabase AAL2
  -> registrar_sessao_mfa_atual()
  -> sessoes_elevadas(user_id, session_id)
```

## 3. Janela fixa

`elevada_em` e `expira_em` são calculados por `clock_timestamp()` no PostgreSQL.
O vencimento é fixo em `elevada_em + interval '24 hours'`; nenhuma consulta ou
ação atualiza esse prazo. O instante exato de expiração já é inválido.

## 4. Login

Depois de `signInWithPassword`, o fluxo verifica fator TOTP, AAL2 e elevação da
sessão exata. Ausência de elevação, outra `session_id` ou método diferente de
TOTP direciona para `/mfa/desafio`. Usuários obrigados a MFA sem fator verificado
continuam no onboarding `/mfa/setup`.

## 5. Expiração

O endpoint `/api/auth/session-security` retorna vencimento e relógio do servidor.
O cliente calcula apenas o atraso do timer. Ao expirar, revoga a elevação, faz
logout local e redireciona para o login com a mensagem:

> Sua sessão de segurança de 24 horas expirou. Entre novamente para continuar.

Se o navegador estiver suspenso, foco e `visibilitychange` provocam revalidação
imediata. O servidor continua sendo a autoridade caso o timer não execute.

## 6. Logout

O logout voluntário revoga somente a elevação da sessão atual e usa
`signOut({ scope: 'local' })`. Troca de senha revoga todas as elevações e
autorizações sensíveis do usuário, encerra as demais sessões e, ao final, encerra
a sessão atual. Expiração, fator inválido e sessão Auth inexistente também
bloqueiam a operação.

## 7. Ações comuns

Aprovação, rejeição, desembolso, liquidação, documentos, CNAB, políticas,
templates, escrow, relatórios, dashboards, notificações e demais ações
operacionais usam o gate de 24 horas sem novo prompt TOTP. Role, fundo, vínculo,
RLS e regras de domínio permanecem obrigatórios e inalterados.

## 8. Ações sensíveis

Exigem TOTP fresco:

- alteração de senha;
- regeneração de recovery codes;
- encerramento das outras sessões;
- reset administrativo de MFA;
- cadastro, rotação, ativação e revogação de credencial de integração.

`alterar_email` está reservado no catálogo, mas o projeto ainda não possui fluxo
funcional de alteração de e-mail. Não existe funcionalidade de visualização de
segredo; caso seja criada, deverá receber tipo de ação próprio. Cadastro,
rotação, ativação e revogação de credencial possuem tipos distintos.

## 9. Autorização de uso único

Após `challenge` e `verify` oficiais do Supabase Auth, a aplicação confirma AAL2,
gera nonce aleatório, persiste somente seu SHA-256 e cria autorização vinculada
a usuário, sessão e tipo exato da ação. A validade técnica é de cinco minutos,
mas a autorização é consumida imediatamente na mesma chamada da Server Action.
O TOTP e o nonce em texto puro não são persistidos nem auditados.

## 10. Banco

Migration: `supabase/migrations/20260803172546_mfa_sessao_24h.sql`.

- `sessoes_elevadas`: chave primária `(user_id, session_id)`, método, fator,
  início, vencimento e revogação;
- `autorizacoes_acoes_sensiveis`: ação, hash do nonce, sessão, criação,
  vencimento, consumo e revogação;
- RPCs canônicas para registrar, consultar e revogar elevação e para criar e
  consumir autorização sensível;
- índices para sessão, vencimento e autorização pendente.

A migration remove elevações legadas porque elas não possuem `session_id`
confiável. Ela não foi aplicada por esta implementação; foi validada contra o
schema de homologação em transação com rollback.

## 11. RLS e grants

`autorizacoes_acoes_sensiveis` possui RLS forçado e não concede acesso direto a
`anon` ou `authenticated`. As RPCs são `SECURITY DEFINER`, usam `search_path`
fixo, não contêm SQL dinâmico e obtêm usuário/sessão do contexto Auth. Apenas as
funções estritamente necessárias recebem `EXECUTE` para `authenticated`.

## 12. Provider

`MfaSessionProvider` envolve o portal, mantém um único timer e sincroniza abas
com `BroadcastChannel`, usando evento de `storage` apenas como fallback de
comunicação. Ele não usa armazenamento local como fonte de verdade, não faz
polling e revalida em montagem, foco e retorno à visibilidade.

## 13. Middleware e gate servidor

`obter_sessao_mfa_atual()` é a fonte de verdade no banco.
`requireSessaoMfaValida()` consolida as regras de sessão operacional.
`requireAuthenticated()` também rejeita, por padrão, perfis do portal sem
elevação válida, protegendo Server Actions que não passam pelo middleware.
Somente setup/desafio MFA usam `allowMfaPending`. O middleware protege navegação;
o endpoint de segurança e as ações protegidas repetem a validação autoritativa.

## 14. Auditoria

São registrados eventos de login MFA válido/falho, expiração/revogação da
sessão, validação/falha de ação sensível e consumo/reutilização bloqueada. Os
dados incluem apenas tipo de ação, sessão e motivo seguro. Códigos TOTP, nonce,
senha, token e segredo não entram em logs ou auditoria.

## 15. Rate limit

O escopo `mfa_sensitive` limita tentativas por usuário, sessão e tipo de ação.
Falhas de formato, fator, challenge e verify não concedem autorização. O desafio
de login mantém o rate limit TOTP existente.

## 16. Compatibilidade

Refresh do access token preserva a `session_id` e, portanto, o vencimento
original. Navegadores e dispositivos diferentes possuem sessões independentes.
No primeiro deploy, todas as elevações antigas são removidas e usuários já
conectados devem entrar novamente e confirmar TOTP. Recuperação de senha e
onboarding de MFA mantêm seus fluxos restritos existentes.

## 17. Testes automatizados

Foram cobertos cálculo de 24 horas, limite exato, sessão ausente/expirada,
isolamento por `session_id`, consumo atômico, vínculo por ação, escopos separados
de credenciais, ausência de código/nonce em auditoria, sincronização multiaba e
revalidação após suspensão. A suíte completa passou com 77 arquivos e 544 testes
no estado final desta implementação.

## 18. Homologação

Antes da produção:

- aplicar a migration antes do deploy da aplicação;
- validar login real em dois navegadores com o mesmo usuário;
- validar refresh de token sem alteração de `expira_em`;
- controlar `expira_em` em massa sintética para testar o limite sem aguardar 24h;
- testar retorno de suspensão e sincronização entre abas;
- executar uma ação operacional e cada ação sensível;
- confirmar uso único e escopo exato da autorização;
- revisar eventos e confirmar ausência de segredos.

Os testes interativos com JWT/TOTP reais não foram executados nesta entrega por
ausência de credenciais sintéticas interativas. A duração não é configurável em
homologação ou produção.

## 19. Rollback

O rollback funcional seguro é voltar temporariamente ao prompt TOTP em cada gate
protegido. Não ampliar validade, apagar eventos, autorizações consumidas ou
registros de auditoria. Como a migration remove elevações legadas, o rollback de
código deve continuar tratando sessões sem elevação como não autorizadas.

## 20. Parecer

A arquitetura passa a cumprir elevação forte por sessão Supabase estável, janela
fixa de 24 horas, bloqueio servidor e logout cliente sincronizado. A separação
entre sessão operacional e autorização sensível reduz prompts no uso cotidiano
sem reutilizar confirmação forte em ações críticas. A liberação depende da
aplicação ordenada da migration e da homologação manual com usuários sintéticos.
