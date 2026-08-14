-- P2.5: inclui os parametros de exposicao na protecao de versoes publicadas.
CREATE OR REPLACE FUNCTION public.validar_versao_publicada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.publicada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Versao publicada de politica nao pode ser excluida';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.publicada_em IS NOT NULL AND (
    NEW.politica_operacional_id IS DISTINCT FROM OLD.politica_operacional_id
    OR NEW.cedente_fundo_id IS DISTINCT FROM OLD.cedente_fundo_id
    OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.permite_postergacao_upload_canhoto IS DISTINCT FROM OLD.permite_postergacao_upload_canhoto
    OR NEW.limite_postergacao_upload_canhoto_dias IS DISTINCT FROM OLD.limite_postergacao_upload_canhoto_dias
    OR NEW.metodo_calculo_financeiro IS DISTINCT FROM OLD.metodo_calculo_financeiro
    OR NEW.tipo_ativo_financeiro IS DISTINCT FROM OLD.tipo_ativo_financeiro
    OR NEW.exigir_status_logistico_pre_cessao IS DISTINCT FROM OLD.exigir_status_logistico_pre_cessao
    OR NEW.controle_exposicao_logistica_ativo IS DISTINCT FROM OLD.controle_exposicao_logistica_ativo
    OR NEW.limite_exposicao_em_transito_pct IS DISTINCT FROM OLD.limite_exposicao_em_transito_pct
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.regras IS DISTINCT FROM OLD.regras
    OR NEW.parametros IS DISTINCT FROM OLD.parametros
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Versao publicada de politica e imutavel';
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.publicada_em IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.publicada_em IS NULL)
     AND NEW.metodo_calculo_financeiro IS NULL THEN
    RAISE EXCEPTION 'Selecione o metodo de calculo financeiro antes de publicar';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id
      AND other.publicada_em IS NOT NULL
      AND tstzrange(other.vigente_desde, coalesce(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.vigente_desde, coalesce(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
