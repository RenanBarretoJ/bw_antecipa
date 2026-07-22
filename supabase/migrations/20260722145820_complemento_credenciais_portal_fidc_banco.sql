-- Complemento obrigatorio: credenciais do Portal FIDC armazenadas no banco.
-- Os segredos sao criptografados no backend antes do INSERT e nunca devem ser
-- retornados ao navegador. A tabela fica sem acesso direto para authenticated.

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
    OR to_regclass('public.integracoes_fundo') IS NULL
    OR to_regclass('public.integracao_fundo_versoes') IS NULL
    OR to_regclass('public.profiles') IS NULL
  THEN
    RAISE EXCEPTION 'Fases anteriores obrigatorias ausentes: fundos/integracoes_fundo/integracao_fundo_versoes/profiles.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.credenciais_integracao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  integracao_fundo_id uuid NOT NULL REFERENCES public.integracoes_fundo(id) ON DELETE RESTRICT,
  ambiente text NOT NULL,
  nome text NOT NULL,
  usuario_criptografado text NOT NULL,
  senha_criptografada text NOT NULL,
  chave_versao text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  criada_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  criada_em timestamptz NOT NULL DEFAULT now(),
  ativada_em timestamptz,
  revogada_em timestamptz,
  substituida_por uuid REFERENCES public.credenciais_integracao(id) ON DELETE SET NULL,
  ultimo_uso_em timestamptz,
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT credenciais_integracao_ambiente_check CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT credenciais_integracao_status_check CHECK (status IN ('rascunho', 'ativa', 'substituida', 'revogada')),
  CONSTRAINT credenciais_integracao_nome_check CHECK (length(trim(nome)) >= 2),
  CONSTRAINT credenciais_integracao_chave_versao_check CHECK (length(trim(chave_versao)) >= 1),
  CONSTRAINT credenciais_integracao_usuario_cipher_check CHECK (usuario_criptografado ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  CONSTRAINT credenciais_integracao_senha_cipher_check CHECK (senha_criptografada ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'),
  CONSTRAINT credenciais_integracao_revogada_em_check CHECK (
    (status = 'revogada' AND revogada_em IS NOT NULL)
    OR (status <> 'revogada')
  ),
  CONSTRAINT credenciais_integracao_ativada_em_check CHECK (
    (status = 'ativa' AND ativada_em IS NOT NULL)
    OR (status <> 'ativa')
  )
);

ALTER TABLE public.integracao_fundo_versoes
  ADD COLUMN IF NOT EXISTS credencial_integracao_id uuid REFERENCES public.credenciais_integracao(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_credenciais_integracao_fundo
  ON public.credenciais_integracao(fundo_id, ambiente, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credenciais_integracao_integracao
  ON public.credenciais_integracao(integracao_fundo_id, ambiente, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credenciais_integracao_substituida_por
  ON public.credenciais_integracao(substituida_por)
  WHERE substituida_por IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_credenciais_integracao_ativa_por_ambiente
  ON public.credenciais_integracao(integracao_fundo_id, ambiente)
  WHERE status = 'ativa';

CREATE INDEX IF NOT EXISTS idx_integracao_fundo_versoes_credencial
  ON public.integracao_fundo_versoes(credencial_integracao_id)
  WHERE credencial_integracao_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_credenciais_integracao_updated_at ON public.credenciais_integracao;
CREATE TRIGGER update_credenciais_integracao_updated_at
  BEFORE UPDATE ON public.credenciais_integracao
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.validar_credencial_integracao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  integracao_fundo uuid;
BEGIN
  SELECT i.fundo_id
  INTO integracao_fundo
  FROM public.integracoes_fundo i
  WHERE i.id = NEW.integracao_fundo_id;

  IF integracao_fundo IS NULL THEN
    RAISE EXCEPTION 'Integracao do fundo nao encontrada.';
  END IF;

  IF integracao_fundo <> NEW.fundo_id THEN
    RAISE EXCEPTION 'Credencial nao pertence ao mesmo fundo da integracao.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.usuario_criptografado <> NEW.usuario_criptografado
      OR OLD.senha_criptografada <> NEW.senha_criptografada
      OR OLD.chave_versao <> NEW.chave_versao
      OR OLD.fundo_id <> NEW.fundo_id
      OR OLD.integracao_fundo_id <> NEW.integracao_fundo_id
      OR OLD.ambiente <> NEW.ambiente
    THEN
      RAISE EXCEPTION 'Credenciais sao imutaveis; rotacione criando novo registro.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_credencial_integracao_trigger ON public.credenciais_integracao;
CREATE TRIGGER validar_credencial_integracao_trigger
  BEFORE INSERT OR UPDATE ON public.credenciais_integracao
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_credencial_integracao();

CREATE OR REPLACE FUNCTION public.validar_integracao_versao_credencial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cred record;
  integ record;
BEGIN
  IF NEW.credencial_integracao_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.id, c.fundo_id, c.integracao_fundo_id, c.ambiente, c.status
  INTO cred
  FROM public.credenciais_integracao c
  WHERE c.id = NEW.credencial_integracao_id;

  IF cred.id IS NULL THEN
    RAISE EXCEPTION 'Credencial de integracao nao encontrada.';
  END IF;

  IF cred.status <> 'ativa' THEN
    RAISE EXCEPTION 'A versao da integracao deve apontar para credencial ativa.';
  END IF;

  IF cred.integracao_fundo_id <> NEW.integracao_fundo_id THEN
    RAISE EXCEPTION 'Credencial nao pertence a mesma integracao.';
  END IF;

  IF cred.ambiente <> NEW.ambiente THEN
    RAISE EXCEPTION 'Credencial nao pertence ao mesmo ambiente da versao.';
  END IF;

  SELECT i.fundo_id
  INTO integ
  FROM public.integracoes_fundo i
  WHERE i.id = NEW.integracao_fundo_id;

  IF integ.fundo_id <> cred.fundo_id THEN
    RAISE EXCEPTION 'Credencial nao pertence ao fundo da integracao.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_integracao_versao_credencial_trigger ON public.integracao_fundo_versoes;
CREATE TRIGGER validar_integracao_versao_credencial_trigger
  BEFORE INSERT OR UPDATE ON public.integracao_fundo_versoes
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_integracao_versao_credencial();

ALTER TABLE public.credenciais_integracao ENABLE ROW LEVEL SECURITY;

-- Defesa em profundidade: nenhum acesso direto de usuarios comuns.
-- A aplicacao usa server actions com service_role para retornar apenas metadados sanitizados.
REVOKE ALL ON public.credenciais_integracao FROM PUBLIC;
REVOKE ALL ON public.credenciais_integracao FROM anon;
REVOKE ALL ON public.credenciais_integracao FROM authenticated;
GRANT ALL ON public.credenciais_integracao TO service_role;

REVOKE ALL ON FUNCTION public.validar_credencial_integracao() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validar_integracao_versao_credencial() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validar_credencial_integracao() TO service_role;
GRANT EXECUTE ON FUNCTION public.validar_integracao_versao_credencial() TO service_role;
