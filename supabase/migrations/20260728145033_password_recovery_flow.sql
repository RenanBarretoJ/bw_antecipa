-- Fluxo de recuperacao e alteracao de senha.
-- Mantem MFA obrigatorio: nenhum fluxo concede acesso a telas protegidas sem AAL2 quando aplicavel.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS senha_alterada_em timestamptz;

ALTER TABLE public.seguranca_rate_limits
  DROP CONSTRAINT IF EXISTS seguranca_rate_limits_escopo_check;

ALTER TABLE public.seguranca_rate_limits
  ADD CONSTRAINT seguranca_rate_limits_escopo_check CHECK (escopo IN (
    'login',
    'mfa_setup',
    'mfa_totp',
    'mfa_recovery',
    'password_reset',
    'password_change',
    'portal_fidc_test',
    'portal_fidc_send',
    'critical_action'
  ));

ALTER TABLE public.seguranca_eventos
  DROP CONSTRAINT IF EXISTS seguranca_eventos_tipo_check;

ALTER TABLE public.seguranca_eventos
  ADD CONSTRAINT seguranca_eventos_tipo_check CHECK (tipo_evento IN (
    'MFA_ENROLL_INICIADO',
    'MFA_ATIVADO',
    'MFA_DESATIVADO',
    'MFA_FALHA',
    'MFA_RECOVERY_USADO',
    'MFA_RECOVERY_REGENERADO',
    'MFA_RESET_ADMINISTRATIVO',
    'SESSAO_ELEVADA',
    'SESSOES_REVOGADAS',
    'CREDENCIAL_CRIADA',
    'CREDENCIAL_TESTADA',
    'CREDENCIAL_ATIVADA',
    'CREDENCIAL_ROTACIONADA',
    'CREDENCIAL_REVOGADA',
    'CREDENCIAL_USADA',
    'ACESSO_CREDENCIAL_NEGADO',
    'ACESSO_NEGADO',
    'RATE_LIMIT_BLOQUEADO',
    'PASSWORD_RESET_REQUESTED',
    'PASSWORD_RESET_EMAIL_SENT',
    'PASSWORD_RESET_COMPLETED',
    'PASSWORD_CHANGED',
    'PASSWORD_CHANGE_FAILED',
    'MFA_CHALLENGE_AFTER_PASSWORD_RESET',
    'MFA_VERIFIED_AFTER_PASSWORD_RESET',
    'MFA_FAILED_AFTER_PASSWORD_RESET'
  ));
