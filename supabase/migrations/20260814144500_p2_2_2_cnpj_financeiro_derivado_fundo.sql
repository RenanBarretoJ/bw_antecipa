-- P2.2.2 hotfix - o CNPJ usado nos relatorios financeiros deriva do fundo
-- e permanece congelado na configuracao versionada da integracao.

BEGIN;

CREATE OR REPLACE FUNCTION private.cnpj_fundo_da_integracao(
  p_integracao_fundo_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT regexp_replace(COALESCE(f.cnpj, ''), '[^0-9]', '', 'g')
    FROM public.integracoes_fundo i
    JOIN public.fundos f ON f.id = i.fundo_id
   WHERE i.id = p_integracao_fundo_id
$$;

REVOKE ALL ON FUNCTION private.cnpj_fundo_da_integracao(uuid)
  FROM PUBLIC, anon, authenticated;

-- Compatibilidade para rascunhos criados entre P2.2.2 e este hotfix.
-- Versoes publicadas permanecem intocadas e imutaveis.
UPDATE public.integracao_fundo_versoes v
   SET configuracao_nao_sensivel = COALESCE(v.configuracao_nao_sensivel, '{}'::jsonb)
     || jsonb_build_object(
       'relatorios_financeiros',
       CASE
         WHEN jsonb_typeof(v.configuracao_nao_sensivel -> 'relatorios_financeiros') = 'object'
           THEN v.configuracao_nao_sensivel -> 'relatorios_financeiros'
         ELSE '{}'::jsonb
       END || jsonb_build_object(
         'cnpj_fundo',
         private.cnpj_fundo_da_integracao(v.integracao_fundo_id)
       )
     ),
       updated_at = clock_timestamp()
 WHERE v.status = 'rascunho'
   AND private.cnpj_fundo_da_integracao(v.integracao_fundo_id) ~ '^[0-9]{14}$'
   AND EXISTS (
     SELECT 1
       FROM public.integracao_fundo_versao_capacidades c
      WHERE c.integracao_fundo_versao_id = v.id
        AND c.capability IN ('ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')
   )
   AND (v.configuracao_nao_sensivel #>> '{relatorios_financeiros,cnpj_fundo}')
       IS DISTINCT FROM private.cnpj_fundo_da_integracao(v.integracao_fundo_id);

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
    IF NULLIF(trim(NEW.codigo_originador), '') IS NULL THEN
      RAISE EXCEPTION 'Publique a configuracao CNAB antes de publicar o envio de cessao'
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

NOTIFY pgrst, 'reload schema';

COMMIT;
