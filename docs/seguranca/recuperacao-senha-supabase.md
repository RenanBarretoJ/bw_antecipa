# Recuperacao de senha — Supabase Auth

Este manual descreve o fluxo recomendado para evitar `otp_expired` na primeira utilizacao do link de recuperacao.

## Fluxo preferencial

Usar confirmacao intermediaria por `token_hash`:

```text
E-mail Supabase
  -> /auth/confirm?token_hash=...&type=recovery&next=/redefinir-senha
  -> verifyOtp({ token_hash, type: "recovery" }) no servidor
  -> cookie bw_auth_flow=password_recovery assinado
  -> /redefinir-senha
  -> updateUser({ password })
```

O fluxo `/auth/confirm` nao executa `exchangeCodeForSession`.

## Template Reset password

No Supabase Dashboard, em Auth -> Emails -> Reset password, configurar o link principal como:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha">
  Redefinir minha senha
</a>
```

Nao usar `{{ .ConfirmationURL }}` como link principal depois da migracao para `token_hash`.

## URLs obrigatorias no Supabase

Para desenvolvimento local:

```text
Site URL:
http://localhost:3001

Redirect URLs:
http://localhost:3001/redefinir-senha
http://localhost:3001/auth/confirm
```

Para homolog/producao, repetir as mesmas rotas no dominio publicado.

## Compatibilidade temporaria com PKCE

Enquanto o template antigo com `{{ .ConfirmationURL }}` ainda estiver ativo, o sistema mantem fallback em `/redefinir-senha?code=...`.

Regras do fallback:

- processa `code` apenas se nao houver `error` ou `error_code`;
- chama `exchangeCodeForSession(code)` apenas uma vez;
- usa `sessionStorage` para reduzir duplo consumo em React Strict Mode;
- redireciona para `/redefinir-senha` limpa apos troca bem-sucedida;
- se houver erro, limpa sessao/cookie e mostra link expirado.

## Logs seguros

Logs permitidos:

- fluxo recebido: `token_hash`, `code_pkce` ou `ausente`;
- sucesso/falha;
- `error_code` sanitizado;
- `next` autorizado.

Nunca registrar:

- `token_hash`;
- `code`;
- senha;
- nonce;
- access token;
- refresh token.

## Testes reais recomendados

- Link valido em janela normal.
- Link valido em janela anonima.
- Link expirado.
- Link reutilizado.
- Link copiado sem clicar.
- Link aberto em Gmail.
- Link aberto em Outlook.
- Link aberto em nova aba.
- Usuario sem MFA.
- Usuario com MFA.
- Acesso direto ao dashboard durante `password_recovery`.

Se ocorrer `otp_expired` antes do clique humano, suspeitar de scanner de e-mail ou template ainda usando `ConfirmationURL`.
