-- P0 Claude: evolui a tab Integracoes para ser orientada por adapter e
-- habilita a Vortx VRS 2.0 como adapter selecionavel no formulario de Nova
-- integracao tecnica (catalogo em src/lib/integracoes/adapter-catalog.ts).
--
-- private.integracao_adapter_capability_suportada e o espelho SQL do
-- registry TS (src/lib/integracoes/registry.server.ts) usado como guarda
-- defensiva em admin_publicar_integracao_versao -- sem esta atualizacao,
-- publicar uma versao com adapter_key = 'vortx_vrs' sempre falharia com
-- "Adapter nao implementado para todas as capabilities selecionadas",
-- mesmo com o registry TS ja reconhecendo o adapter. As capabilities
-- liberadas para a Vortx (CESSAO_ENVIO/ESTOQUE/AQUISICOES/LIQUIDACOES,
-- sem CARTEIRA) espelham exatamente VORTX_VRS_CAPABILITIES no catalogo TS.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.integracao_adapter_capability_suportada(text, text)') IS NULL
    OR to_regclass('public.integracoes_vortx_vrs_credenciais') IS NULL
  THEN
    RAISE EXCEPTION 'Dependencias obrigatorias ausentes: private.integracao_adapter_capability_suportada ou integracoes_vortx_vrs_credenciais (aplicar 20260825100000 primeiro).';
  END IF;
END $$;

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
    WHEN 'sinqia_portal_fidc' THEN p_capability = 'CESSAO_ENVIO'
    WHEN 'vortx_vrs' THEN p_capability IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION private.integracao_adapter_capability_suportada(text, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
