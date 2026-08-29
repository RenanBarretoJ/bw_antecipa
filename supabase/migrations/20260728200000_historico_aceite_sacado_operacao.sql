-- Registra aceite/contestacao do sacado no historico operacional no mesmo
-- fluxo transacional que altera a NF. O evento precisa carregar o
-- operacao_id para aparecer tanto no historico da NF quanto no da operacao.

CREATE OR REPLACE FUNCTION public.registrar_evento_aceite_sacado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acao text;
  v_tipo_evento text;
  v_categoria text;
  v_descricao text;
  v_nome text;
  v_perfil text;
  v_operacao record;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     OR COALESCE(NEW.status, '') NOT IN ('aceita', 'contestada') THEN
    RETURN NEW;
  END IF;

  v_acao := CASE WHEN NEW.status = 'aceita' THEN 'aceitar' ELSE 'contestar' END;
  v_tipo_evento := CASE
    WHEN NEW.status = 'aceita' THEN 'cessao_aceita_sacado'
    ELSE 'cessao_contestada_sacado'
  END;
  v_categoria := CASE WHEN NEW.status = 'aceita' THEN 'aprovacao' ELSE 'reprovacao' END;

  SELECT
    COALESCE(p.nome_completo, p.email, 'Usuario'),
    COALESCE(p.role::text, 'sacado')
  INTO v_nome, v_perfil
  FROM public.profiles p
  WHERE p.id = auth.uid();

  v_nome := COALESCE(v_nome, 'Usuario');
  v_perfil := COALESCE(v_perfil, 'sacado');

  FOR v_operacao IN
    SELECT DISTINCT
      op.id,
      op.cedente_id,
      op.cedente_fundo_id,
      op.status AS operacao_status
    FROM public.operacoes_nfs onf
    JOIN public.operacoes op ON op.id = onf.operacao_id
    WHERE onf.nota_fiscal_id = NEW.id
  LOOP
    v_descricao := CASE
      WHEN NEW.status = 'aceita' THEN format('Sacado aceitou a cessao da NF %s.', NEW.numero_nf)
      ELSE format('Sacado contestou a cessao da NF %s.', NEW.numero_nf)
    END;

    INSERT INTO public.eventos_dominio (
      tenant_id,
      fundo_id,
      cedente_id,
      cedente_fundo_id,
      nota_fiscal_id,
      operacao_id,
      tipo_evento,
      categoria,
      ator_usuario_id,
      ator_nome_snapshot,
      ator_perfil_snapshot,
      origem,
      descricao,
      metadata,
      visibilidade,
      origem_evento,
      origem_registro_id,
      created_at
    )
    VALUES (
      NEW.fundo_id,
      NEW.fundo_id,
      NEW.cedente_id,
      COALESCE(NEW.cedente_fundo_id, v_operacao.cedente_fundo_id),
      NEW.id,
      v_operacao.id,
      v_tipo_evento,
      v_categoria,
      auth.uid(),
      v_nome,
      v_perfil,
      'portal_sacado',
      v_descricao,
      jsonb_build_object(
        'acao', v_acao,
        'numero_nf', NEW.numero_nf,
        'status_nf', NEW.status,
        'status_operacao', v_operacao.operacao_status
      ),
      'ambos',
      'processar_aceite_sacado',
      NEW.id::text || ':' || v_operacao.id::text,
      COALESCE(NEW.aprovacao_sacado_em, now())
    )
    ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
    DO UPDATE SET
      nota_fiscal_id = EXCLUDED.nota_fiscal_id,
      operacao_id = EXCLUDED.operacao_id,
      fundo_id = EXCLUDED.fundo_id,
      cedente_id = EXCLUDED.cedente_id,
      cedente_fundo_id = EXCLUDED.cedente_fundo_id,
      ator_usuario_id = EXCLUDED.ator_usuario_id,
      ator_nome_snapshot = EXCLUDED.ator_nome_snapshot,
      ator_perfil_snapshot = EXCLUDED.ator_perfil_snapshot,
      descricao = EXCLUDED.descricao,
      metadata = EXCLUDED.metadata,
      created_at = EXCLUDED.created_at;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evento_aceite_sacado ON public.notas_fiscais;

CREATE TRIGGER trg_evento_aceite_sacado
  AFTER UPDATE OF status ON public.notas_fiscais
  FOR EACH ROW
  EXECUTE FUNCTION public.registrar_evento_aceite_sacado();

REVOKE ALL ON FUNCTION public.registrar_evento_aceite_sacado() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_evento_aceite_sacado() TO authenticated, service_role;
