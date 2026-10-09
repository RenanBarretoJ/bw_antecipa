-- Ativacao da integracao nao equivale a liberacao de remessas.
-- Nao altera versoes publicadas, snapshots, grants ou dados existentes.
BEGIN;

CREATE OR REPLACE FUNCTION private.validar_publicacao_sinqia_p2_2_2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_tem_cessao boolean;
  v_tem_financeiro boolean;
  v_cnpj_fundo text;
  v_cnpj_cadastrado text;
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
  END IF;

  IF v_tem_financeiro THEN
    v_cnpj_fundo := NEW.configuracao_nao_sensivel #>> '{relatorios_financeiros,cnpj_fundo}';
    v_cnpj_cadastrado := private.cnpj_fundo_da_integracao(NEW.integracao_fundo_id);
    IF v_cnpj_cadastrado IS NULL OR v_cnpj_cadastrado !~ '^[0-9]{14}$' THEN
      RAISE EXCEPTION 'O CNPJ cadastrado do fundo deve possuir 14 digitos antes da publicacao financeira'
        USING ERRCODE = '23514';
    END IF;
    IF v_cnpj_fundo IS DISTINCT FROM v_cnpj_cadastrado THEN
      RAISE EXCEPTION 'O CNPJ dos relatorios financeiros deve corresponder ao CNPJ cadastrado do fundo'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validar_publicacao_sinqia_p2_2_2()
  FROM PUBLIC, anon, authenticated;

-- CNAB so pode ser parametrizado apos cadastrar um conector de cessao
-- compativel. O espelho SQL usa a mesma chave do registry de adapters.
CREATE OR REPLACE FUNCTION private.validar_cadastro_cnab_com_integracao()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_fundo_id uuid;
BEGIN
  IF NEW.status NOT IN ('rascunho', 'publicada') THEN RETURN NEW; END IF;
  SELECT c.fundo_id INTO v_fundo_id FROM public.configuracoes_cnab c
  WHERE c.id = NEW.configuracao_cnab_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.integracoes_fundo i
    JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id = i.id
    JOIN public.integracao_fundo_versao_capacidades cap ON cap.integracao_fundo_versao_id = v.id
    WHERE i.fundo_id = v_fundo_id AND v.adapter_key = 'sinqia_portal_fidc'
      AND (v.status = 'rascunho' OR (v.status = 'publicada' AND v.vigente_ate IS NULL))
      AND cap.capability = 'CESSAO_ENVIO'
  ) THEN
    RAISE EXCEPTION 'Cadastre uma integracao de cessao com formato CNAB antes de parametrizar o CNAB'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validar_cadastro_cnab_com_integracao() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cnab_exige_integracao_cadastrada ON public.configuracao_cnab_versoes;
CREATE TRIGGER trg_cnab_exige_integracao_cadastrada
BEFORE INSERT OR UPDATE ON public.configuracao_cnab_versoes
FOR EACH ROW EXECUTE FUNCTION private.validar_cadastro_cnab_com_integracao();

NOTIFY pgrst, 'reload schema';
COMMIT;
