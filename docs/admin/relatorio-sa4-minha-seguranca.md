# SA4 — Minha Conta e Segurança do Super Admin

## 1. Objetivo

O SA4 disponibiliza ao Super Admin uma área pessoal para administrar a própria segurança em `/admin/minha-seguranca`. A solução não cria um segundo sistema de autenticação: reutiliza o núcleo já utilizado por Gestor, Cedente, Consultor e Sacado.

O fluxo administrativo de `/admin/usuarios/[id]?tab=seguranca` continua destinado à administração de outras contas. O reset administrativo do próprio MFA permanece bloqueado.

## 2. Diagnóstico

Antes do SA4, o projeto já possuía:

- componente compartilhado `SecurityPage`;
- alteração autenticada de senha;
- validação da senha atual por reautenticação formal e isolada no Supabase Auth;
- confirmação TOTP fresca para ações sensíveis;
- MFA TOTP nativo do Supabase;
- recovery codes armazenados somente como hash e exibidos uma única vez após geração;
- encerramento das outras sessões com `signOut({ scope: 'others' })`;
- sessão operacional AAL2 com janela fixa de 24 horas;
- auditoria de senha, MFA, recovery codes e sessões;
- bloqueio de self-reset administrativo no SA2;
- rota legada `/admin/minha-conta/seguranca`, sem item próprio no menu Admin.

O que faltava era a rota canônica exigida pelo SA4, o quarto item do menu, a proteção explícita da página por `requireSuperAdmin()`, um resumo orientado ao Super Admin e testes de arquitetura que impedissem regressões.

## 3. Componentes reutilizados

O núcleo compartilhado continua sendo:

```text
SecurityPage
  ├─ listarFatoresMfa
  ├─ alterarSenhaAutenticado
  ├─ regenerarCodigosRecuperacao
  └─ encerrarOutrasSessoes
```

As rotas de Gestor, Cedente, Consultor, Sacado e Super Admin renderizam o mesmo componente. Isso garante uma única conta, um único MFA, uma única política de senha e o mesmo comportamento de sessões para usuários híbridos.

## 4. Rota

A rota canônica é:

```text
/admin/minha-seguranca
```

A página executa `requireSuperAdmin()` no servidor antes de renderizar. Ela não consulta Fundo Ativo, `usuario_fundos` ou qualquer contexto operacional de fundo. Portanto, um Super Admin puro com zero fundos pode acessá-la.

A rota anterior `/admin/minha-conta/seguranca` foi mantida apenas como compatibilidade e redireciona para a rota canônica.

## 5. Senha

A alteração de senha reutiliza o fluxo canônico:

```text
sessão operacional AAL2 válida
  → senha atual validada por signInWithPassword isolado
  → política canônica de senha
  → TOTP fresco para a ação alterar_senha
  → updateUser({ password, nonce? })
  → revogação das outras sessões e elevações
  → logout local
  → novo login obrigatório
```

`currentPassword` não é encaminhado ao `updateUser`. A senha atual serve exclusivamente para reautenticação formal em um cliente Auth sem persistência de sessão. O payload de atualização contém somente `password` e, quando o Supabase exigir, o campo oficial `nonce`.

## 6. MFA

A página mostra se o MFA está configurado e lista apenas fatores TOTP verificados da própria conta. IDs de fator são usados somente como chave interna de renderização; não são exibidos ao usuário.

Quando não há fator, o usuário é direcionado ao enrollment compartilhado em `/mfa/setup`. Secret e QR Code continuam aparecendo somente durante a configuração inicial.

## 7. Recovery codes

Recovery codes já fazem parte do domínio atual. A regeneração:

- exige sessão operacional válida;
- exige TOTP fresco para `regenerar_recovery_codes`;
- invalida códigos anteriores ainda ativos;
- persiste apenas hashes;
- retorna plaintext somente na resposta da geração;
- exibe os novos códigos uma única vez na página;
- registra o evento canônico `MFA_RECOVERY_REGENERADO` com origem `minha_seguranca`.

## 8. Sessões

O SA4 reutiliza `encerrarOutrasSessoes`, que executa `signOut({ scope: 'others' })`, revoga elevações das outras sessões e atualiza `profiles.sessoes_revogadas_em`.

A sessão atual não é silenciosamente substituída por uma sessão administrativa. Tokens e IDs integrais de sessão não são exibidos.

## 9. AAL2 de 24 horas

O resumo mostra:

- conta ativa;
- MFA configurado ou não configurado;
- data de configuração do MFA, quando registrada no perfil;
- data da última alteração de senha, quando registrada no perfil;
- estado da sessão operacional;
- tempo restante até a expiração.

O tempo restante é calculado usando `serverNow` e `sessaoExpiraEm` retornados pelo registro canônico da sessão MFA. O navegador não define a origem do prazo.

A visita, o refresh e as mutações da página não renovam a janela. A expiração continua sendo de 24 horas corridas e é aplicada pelo gate server-side e pelo `MfaSessionProvider` compartilhado.

## 10. TOTP fresco

Alteração de senha, regeneração de recovery codes e encerramento de outras sessões usam `autorizarEConsumirAcaoSensivel`. Esse fluxo:

1. valida a sessão MFA canônica;
2. cria challenge TOTP no Supabase Auth;
3. verifica o código;
4. confirma AAL2 real com `getAuthenticatorAssuranceLevel()`;
5. cria uma autorização curta vinculada à sessão e ao tipo de ação;
6. consome essa autorização uma única vez.

O código TOTP e o nonce em plaintext não são persistidos nem auditados.

## 11. Self-reset

O reset administrativo do próprio MFA continua proibido em `/admin/usuarios/[me]?tab=seguranca`. A validação do SA2 permanece inalterada.

O SA4 não usa o reset administrativo como atalho. A conta própria utiliza somente os fluxos pessoais compartilhados.

## 12. Supabase Auth

Foram mantidas as APIs nativas já usadas no projeto:

- `auth.mfa.listFactors()`;
- `auth.mfa.challenge()`;
- `auth.mfa.verify()`;
- `auth.mfa.getAuthenticatorAssuranceLevel()`;
- `auth.updateUser({ password, nonce? })`;
- `auth.signOut({ scope: 'others' })`.

Referências oficiais consultadas: [Update a user](https://supabase.com/docs/reference/javascript/auth-updateuser), [MFA](https://supabase.com/docs/guides/auth/auth-mfa) e [Sign out](https://supabase.com/docs/reference/javascript/auth-signout).

## 13. Service role

Nenhuma chave privilegiada é enviada ao Client. O `service_role` permanece encapsulado nos adaptadores server-only já existentes para atualizações auxiliares de perfil, sessões elevadas e auditoria.

A troca da própria senha utiliza o cliente autenticado e a API nativa `updateUser`, não a Admin API.

## 14. Auditoria

Eventos canônicos existentes foram reutilizados:

- `PASSWORD_CHANGED`;
- `MFA_RECOVERY_REGENERADO`;
- `SESSOES_REVOGADAS`;
- eventos de validação e consumo de autorização sensível.

As ações próprias passaram a registrar `origem: minha_seguranca` nos dados seguros. Não são registrados senha, TOTP, secret, recovery code, access token, refresh token ou session ID integral.

## 15. Segurança

- A rota exige Super Admin ativo em toda navegação server-side.
- As mutações derivam o usuário-alvo de `auth.uid()`/sessão.
- Nenhuma action de segurança própria aceita `userId` arbitrário do Client.
- Usuário inativo é bloqueado por `requireAuthenticated()`.
- Super Admin revogado perde a rota na próxima navegação por `requireSuperAdmin()`.
- A página independe de fundo e não amplia RLS.
- O MFA permanece obrigatório para os perfis protegidos.

## 16. UI

O menu Admin passa a conter somente:

1. Visão geral;
2. Fundos;
3. Usuários & Acessos;
4. Minha Segurança.

A página segue o design compartilhado e apresenta feedback via sistema global de notificações. O formulário de senha mantém `type="submit"` explícito para evitar regressão com o componente Button baseado em Base UI.

## 17. Testes

Foram adicionados testes para:

- rota canônica protegida;
- independência de Fundo Ativo;
- rota legada redirecionada;
- quarta entrada do menu;
- reutilização do componente do Gestor;
- alvo derivado da sessão;
- TOTP fresco nas três mutações sensíveis;
- reautenticação formal da senha atual;
- payload oficial de `updateUser` sem `currentPassword`;
- self-reset administrativo bloqueado;
- ausência de desativação própria de MFA;
- botão submit explícito;
- cálculo de expiração pelo relógio servidor;
- fronteira exata de expiração;
- item ativo único na sidebar.

Resultado da validação local:

```text
npx tsc --noEmit
✓ sem erros

npm test -- --run
✓ 114 arquivos
✓ 845 testes

npm run lint
✓ sem erros
⚠ 6 warnings preexistentes fora do SA4

git diff --check
✓ sem erros

npx next build --webpack
✓ build concluído
⚠ warnings preexistentes do Handlebars/require.extensions
```

## 18. Regressões SA0–SA3

- **SA0:** `/admin` e `requireSuperAdmin()` permanecem inalterados; zero fundos continua suportado.
- **SA1:** nenhuma ação, tabela ou tela de fundos foi alterada.
- **SA2:** reset de MFA de terceiros e proteção do último Super Admin permanecem inalterados; self-reset continua bloqueado.
- **SA3:** credenciais, integrações, CNAB e seus escopos de TOTP fresco não foram alterados pelo SA4.

As rotas pessoais dos demais perfis continuam renderizando o mesmo `SecurityPage`.

## 19. Migration

O SA4 não exige migration. Todos os tipos de ação sensível, tabelas de recovery codes, sessões elevadas, campos de perfil e eventos necessários já existem.

## 20. Riscos residuais

- O smoke real de troca de senha exige uma conta de homologação e altera credencial/sessões; deve ser executado controladamente pelo time.
- A disponibilidade de nonce depende da configuração do Supabase Auth do ambiente.
- A renderização do tempo restante é um retrato do relógio servidor no carregamento; a expiração efetiva continua sendo imposta no servidor e pelo provider global.

## 21. Limitações

O projeto não possui hoje uma troca atômica de fator TOTP que valide um fator novo antes de invalidar o anterior. Por segurança, o SA4 não implementa reconfiguração própria nem reutiliza o reset administrativo.

Também não há listagem rica de dispositivos/sessões no domínio atual; o escopo oferece a ação segura de encerrar outras sessões, sem expor identificadores.

## 22. Parecer

O SA4 atende à área pessoal do Super Admin por composição da infraestrutura existente, sem duplicação, sem migration e sem ampliar privilégios. O usuário híbrido administra a mesma conta tanto pela área Admin quanto pela área Gestor, preservando um único MFA e uma única sessão operacional.

A arquitetura permanece adequada para homologação, sujeita ao smoke controlado de troca real de senha e reentrada com MFA no ambiente Supabase configurado.
