-- O transporte operacional passou da API Resend para o SMTP corporativo IONOS.
-- Tentativas historicas preservam o provider originalmente registrado.

alter table public.comunicacao_tentativas
  alter column provider set default 'ionos_smtp';

comment on column public.comunicacao_tentativas.provider is
  'Transporte efetivamente utilizado na tentativa; novos envios usam ionos_smtp.';
