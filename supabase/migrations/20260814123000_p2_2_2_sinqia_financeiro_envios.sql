-- P2.2.2 - capacidades financeiras comprovadas do adapter Portal FIDC/Sinqia.
-- Incremental: nao altera migrations ja aplicadas e nao habilita CARTEIRA.

CREATE OR REPLACE FUNCTION private.integracao_adapter_capability_suportada(
  p_adapter_key text,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_adapter_key
    WHEN 'sinqia_portal_fidc' THEN p_capability IN (
      'CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES'
    )
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION private.integracao_adapter_capability_suportada(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validar_publicacao_sinqia_p2_2_2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tem_cessao boolean;
  v_tem_financeiro boolean;
  v_cnpj_fundo text;
BEGIN
  IF NEW.status <> 'publicada'
     OR NEW.adapter_key IS DISTINCT FROM 'sinqia_portal_fidc'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'publicada') THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(bool_or(c.capability = 'CESSAO_ENVIO'), false),
    COALESCE(bool_or(c.capability IN ('ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')), false)
  INTO v_tem_cessao, v_tem_financeiro
  FROM public.integracao_fundo_versao_capacidades c
  WHERE c.integracao_fundo_versao_id = NEW.id;

  IF v_tem_cessao THEN
    IF NULLIF(trim(NEW.identificador_cliente), '') IS NULL THEN
      RAISE EXCEPTION 'Informe o identificador do cliente antes de publicar o envio de cessao'
        USING ERRCODE = '23514';
    END IF;
    IF NULLIF(trim(NEW.codigo_originador), '') IS NULL THEN
      RAISE EXCEPTION 'Publique a configuracao CNAB antes de publicar o envio de cessao'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_tem_financeiro THEN
    v_cnpj_fundo := NEW.configuracao_nao_sensivel #>> '{relatorios_financeiros,cnpj_fundo}';
    IF v_cnpj_fundo IS NULL OR v_cnpj_fundo !~ '^[0-9]{14}$' THEN
      RAISE EXCEPTION 'Configure relatorios_financeiros.cnpj_fundo com 14 digitos antes de publicar capacidades financeiras'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validar_publicacao_sinqia_p2_2_2()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS integracao_p2_2_2_validar_publicacao
  ON public.integracao_fundo_versoes;
CREATE TRIGGER integracao_p2_2_2_validar_publicacao
BEFORE INSERT OR UPDATE OF status, adapter_key, identificador_cliente,
  codigo_originador, configuracao_nao_sensivel
ON public.integracao_fundo_versoes
FOR EACH ROW
EXECUTE FUNCTION private.validar_publicacao_sinqia_p2_2_2();

NOTIFY pgrst, 'reload schema';
