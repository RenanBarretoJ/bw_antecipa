-- P0 Claude: versionamento real da NF de Remessa (ticket
-- P0_Claude_Versionamento_NF_Remessa). Esta migration NUNCA foi aplicada em
-- homologacao no design anterior (confirmado via list_migrations antes de
-- editar) -- por isso e reescrita aqui em vez de superseded por uma nova.
--
-- Problema do design anterior desta mesma migration: "Enviar nova versao"
-- fazia UPDATE destrutivo da linha em nota_fiscal_remessas e a action em
-- TypeScript removia o XML anterior do Storage -- insuficiente para
-- auditoria (nenhuma trilha append-only do que foi efetivamente enviado em
-- cada versao, e o arquivo antigo deixava de existir).
--
-- Modelo novo:
--   nota_fiscal_remessas        = entidade logica da remessa (1 por chave).
--                                 Mantem as colunas de metadata do arquivo
--                                 (bucket/path/nome_original/mime_type/
--                                 tamanho_bytes/sha256) e do estado atual
--                                 (status_validacao/referencia_nf_venda_
--                                 confirmada/motivos_validacao/aprovacao_
--                                 documental/...) como PONTEIRO/cache da
--                                 versao vigente -- e o que todo o resto do
--                                 sistema (CT-e via-remessa, canhoto,
--                                 satisfacao do requisito, UI "Ver") ja le
--                                 hoje, sem NENHUMA mudanca de contrato ou
--                                 de coluna.
--   nota_fiscal_remessa_versoes = historico append-only, nunca apagado, 1
--                                 linha por envio/reenvio efetivo.
--                                 UNIQUE(remessa_id, numero_versao); no
--                                 maximo 1 vigente=true por remessa
--                                 (indice unico parcial).
--
-- "Enviar nova versao" (mesma chave, mesma venda): NAO cria uma segunda
-- nota_fiscal_remessas; cria uma nova linha em nota_fiscal_remessa_versoes
-- (numero_versao = max+1 para esta remessa), marca a versao anterior
-- vigente=false, atualiza os ponteiros/estado em nota_fiscal_remessas para
-- refletir a nova versao (reexecuta matching -- valores recebidos do
-- chamador, que ja os recalcula sempre -- e reseta a aprovacao documental
-- anterior), e NUNCA remove o arquivo da versao anterior do Storage.
--
-- "Enviar outra NF de Remessa" (chave nova): INSERT em nota_fiscal_remessas
-- (como sempre) + a PRIMEIRA linha (numero_versao=1, vigente=true) em
-- nota_fiscal_remessa_versoes. Relacao 1:N com a NF de venda preservada.
--
-- Chave existente em OUTRA venda: continua DENY fail-closed (regra de
-- seguranca preexistente, inalterada).
--
-- Assinatura de registrar_nota_fiscal_remessa permanece EXATAMENTE a mesma
-- (21 parametros, nenhum novo) -- nenhum GRANT/REVOKE novo necessario para
-- essa funcao. A tabela nova ganha suas proprias RLS/GRANT (somente
-- leitura, mesmo padrao de nota_fiscal_remessas -- toda escrita passa por
-- este RPC SECURITY DEFINER).

BEGIN;

-- 1. Tabela de versoes (historico append-only) -----------------------------

CREATE TABLE IF NOT EXISTS public.nota_fiscal_remessa_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_remessa_id uuid NOT NULL REFERENCES public.nota_fiscal_remessas(id) ON DELETE CASCADE,
  numero_versao integer NOT NULL,
  bucket text NOT NULL,
  path text NOT NULL,
  nome_original text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  status_validacao text NOT NULL,
  referencia_nf_venda_confirmada boolean NOT NULL DEFAULT false,
  motivos_validacao jsonb NOT NULL DEFAULT '[]'::jsonb,
  vigente boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT nota_fiscal_remessa_versoes_numero_unique UNIQUE (nota_fiscal_remessa_id, numero_versao),
  CONSTRAINT nota_fiscal_remessa_versoes_numero_check CHECK (numero_versao > 0),
  CONSTRAINT nota_fiscal_remessa_versoes_status_check CHECK (status_validacao IN ('VALIDADA', 'REVISAO_MANUAL', 'REJEITADA')),
  CONSTRAINT nota_fiscal_remessa_versoes_tamanho_check CHECK (tamanho_bytes > 0),
  CONSTRAINT nota_fiscal_remessa_versoes_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_nota_fiscal_remessa_versoes_vigente
  ON public.nota_fiscal_remessa_versoes (nota_fiscal_remessa_id)
  WHERE vigente;

CREATE INDEX IF NOT EXISTS idx_nota_fiscal_remessa_versoes_remessa
  ON public.nota_fiscal_remessa_versoes (nota_fiscal_remessa_id);

COMMENT ON TABLE public.nota_fiscal_remessa_versoes IS
  'Historico append-only de cada arquivo/versao enviado para uma NF de remessa (nota_fiscal_remessas = entidade logica, 1 linha por chave). Nunca apagado -- a versao anterior sempre permanece acessivel, mesmo apos "Enviar nova versao". No maximo 1 vigente=true por remessa (idx_nota_fiscal_remessa_versoes_vigente).';

ALTER TABLE public.nota_fiscal_remessa_versoes ENABLE ROW LEVEL SECURITY;

-- Somente leitura via RLS, mesmo padrao de nota_fiscal_remessas -- toda
-- escrita passa exclusivamente por registrar_nota_fiscal_remessa
-- (SECURITY DEFINER). Acesso segue o mesmo criterio da remessa logica pai
-- (join, ja que esta tabela nao duplica fundo_id/cedente_id).
DROP POLICY IF EXISTS nota_fiscal_remessa_versoes_gestor_select ON public.nota_fiscal_remessa_versoes;
CREATE POLICY nota_fiscal_remessa_versoes_gestor_select ON public.nota_fiscal_remessa_versoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nota_fiscal_remessas r
    WHERE r.id = nota_fiscal_remessa_versoes.nota_fiscal_remessa_id
      AND (SELECT private.usuario_tem_acesso_fundo(r.fundo_id))
  ));

DROP POLICY IF EXISTS nota_fiscal_remessa_versoes_consultor_select ON public.nota_fiscal_remessa_versoes;
CREATE POLICY nota_fiscal_remessa_versoes_consultor_select ON public.nota_fiscal_remessa_versoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nota_fiscal_remessas r
    WHERE r.id = nota_fiscal_remessa_versoes.nota_fiscal_remessa_id
      AND (SELECT private.consultor_tem_acesso_cedente(r.cedente_id))
  ));

DROP POLICY IF EXISTS nota_fiscal_remessa_versoes_cedente_select ON public.nota_fiscal_remessa_versoes;
CREATE POLICY nota_fiscal_remessa_versoes_cedente_select ON public.nota_fiscal_remessa_versoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.nota_fiscal_remessas r
    WHERE r.id = nota_fiscal_remessa_versoes.nota_fiscal_remessa_id
      AND r.cedente_id = (SELECT public.get_user_cedente_id())
  ));

REVOKE ALL ON public.nota_fiscal_remessa_versoes FROM PUBLIC, anon;
GRANT SELECT ON public.nota_fiscal_remessa_versoes TO authenticated;

-- 2. registrar_nota_fiscal_remessa: versiona em vez de sobrescrever -------

CREATE OR REPLACE FUNCTION public.registrar_nota_fiscal_remessa(
  p_nota_fiscal_venda_id uuid,
  p_chave_acesso text,
  p_numero text,
  p_serie text,
  p_emitente_cnpj text,
  p_emitente_razao_social text,
  p_destinatario_cnpj text,
  p_destinatario_razao_social text,
  p_data_emissao date,
  p_valor_total numeric,
  p_quantidade_total numeric,
  p_itens jsonb,
  p_status_validacao text,
  p_referencia_nf_venda_confirmada boolean,
  p_motivos_validacao jsonb,
  p_bucket text,
  p_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  venda record;
  chave_limpa text := regexp_replace(coalesce(p_chave_acesso, ''), '\D', '', 'g');
  v_id uuid;
  v_nivel_validacao text;
  v_aprovacao_documental text;
  v_existente record;
  v_atualizacao boolean := false;
  v_numero_versao integer;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar NF de remessa';
  END IF;
  IF p_status_validacao NOT IN ('VALIDADA', 'REVISAO_MANUAL', 'REJEITADA') THEN
    RAISE EXCEPTION 'Status de validacao da remessa invalido';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  IF chave_limpa !~ '^[0-9]{44}$' THEN
    RAISE EXCEPTION 'Chave de acesso da remessa invalida';
  END IF;
  IF p_valor_total < 0 THEN
    RAISE EXCEPTION 'Valor total da remessa invalido';
  END IF;

  SELECT id, cedente_id, fundo_id, cedente_fundo_id, chave_acesso
    INTO venda
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_venda_id;

  IF venda.id IS NULL THEN
    RAISE EXCEPTION 'NF de venda nao encontrada';
  END IF;
  IF venda.fundo_id IS NULL OR venda.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'NF de venda sem contexto de fundo e vinculo';
  END IF;
  IF venda.chave_acesso IS NOT NULL AND venda.chave_acesso = chave_limpa THEN
    RAISE EXCEPTION 'A remessa nao pode ter a mesma chave de acesso da NF de venda';
  END IF;

  IF actor_role = 'cedente' AND venda.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'NF de venda fora do cedente autenticado';
  END IF;
  IF actor_role = 'gestor' AND NOT private.usuario_tem_acesso_fundo(venda.fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
  END IF;

  -- "Enviar nova versao" (mesma remessa logica) vs "Enviar outra NF de
  -- Remessa" (remessa fisica nova): decidido pela CHAVE, nunca pelo caller.
  -- Uma chave repetida de OUTRA venda continua bloqueada (fail-closed,
  -- regra de seguranca preexistente -- nunca reatribui uma remessa entre
  -- vendas). FOR UPDATE trava a linha logica (quando existente) para
  -- serializar contra um reenvio concorrente da mesma chave -- sem isso,
  -- dois envios simultaneos poderiam calcular o mesmo numero_versao.
  SELECT id, nota_fiscal_venda_id INTO v_existente
  FROM public.nota_fiscal_remessas
  WHERE chave_acesso = chave_limpa
  FOR UPDATE;

  IF v_existente.id IS NOT NULL AND v_existente.nota_fiscal_venda_id <> p_nota_fiscal_venda_id THEN
    RAISE EXCEPTION 'Chave de acesso da remessa ja cadastrada para outra NF de venda';
  END IF;

  -- Nivel de validacao do requisito nf_remessa vigente para esta venda,
  -- lido do snapshot instanciado por instanciar_requisitos_nota (fonte mais
  -- confiavel -- nao a politica viva). Sem requisito instanciado (politica
  -- sem nf_remessa configurado, estado valido), trata como automatico --
  -- nunca inventa um gate manual onde nenhum requisito de politica existe.
  SELECT dri.nivel_validacao_snapshot
    INTO v_nivel_validacao
  FROM public.documento_requisito_instancias dri
  WHERE dri.nota_fiscal_id = p_nota_fiscal_venda_id
    AND dri.tipo_documento_codigo_snapshot = 'nf_remessa'
    AND dri.status <> 'cancelado'
  ORDER BY dri.created_at DESC
  LIMIT 1;

  v_aprovacao_documental := CASE
    WHEN p_status_validacao <> 'VALIDADA' THEN NULL
    WHEN v_nivel_validacao IN ('manual', 'hibrido') THEN 'aguardando_analise'
    ELSE NULL
  END;

  IF v_existente.id IS NOT NULL THEN
    -- "Enviar nova versao": mesma remessa logica, mesma chave. Nunca cria
    -- uma segunda nota_fiscal_remessas. Reexecuta matching/aprovacao
    -- (valores ja recalculados pelo chamador a cada envio) e reseta a
    -- decisao documental anterior -- uma aprovacao/rejeicao de uma versao
    -- antiga nao pode vazar para a versao nova. Os ponteiros/estado em
    -- nota_fiscal_remessas sao atualizados para refletir a nova versao,
    -- mas o arquivo/registro da versao anterior permanece intacto em
    -- nota_fiscal_remessa_versoes (nunca apagado).
    v_atualizacao := true;
    v_id := v_existente.id;

    SELECT coalesce(max(numero_versao), 0) + 1
      INTO v_numero_versao
    FROM public.nota_fiscal_remessa_versoes
    WHERE nota_fiscal_remessa_id = v_id;

    UPDATE public.nota_fiscal_remessa_versoes
    SET vigente = false
    WHERE nota_fiscal_remessa_id = v_id AND vigente = true;

    UPDATE public.nota_fiscal_remessas
    SET numero = nullif(p_numero, ''),
        serie = nullif(p_serie, ''),
        emitente_cnpj = nullif(regexp_replace(coalesce(p_emitente_cnpj, ''), '\D', '', 'g'), ''),
        emitente_razao_social = nullif(p_emitente_razao_social, ''),
        destinatario_cnpj = nullif(regexp_replace(coalesce(p_destinatario_cnpj, ''), '\D', '', 'g'), ''),
        destinatario_razao_social = nullif(p_destinatario_razao_social, ''),
        data_emissao = p_data_emissao,
        valor_total = coalesce(p_valor_total, 0),
        quantidade_total = p_quantidade_total,
        itens = coalesce(p_itens, '[]'::jsonb),
        status_validacao = p_status_validacao,
        referencia_nf_venda_confirmada = coalesce(p_referencia_nf_venda_confirmada, false),
        motivos_validacao = coalesce(p_motivos_validacao, '[]'::jsonb),
        aprovacao_documental = v_aprovacao_documental,
        aprovacao_analisado_por = NULL,
        aprovacao_analisado_em = NULL,
        aprovacao_motivo_rejeicao = NULL,
        bucket = p_bucket,
        path = p_path,
        nome_original = p_nome_original,
        mime_type = lower(p_mime_type),
        tamanho_bytes = p_tamanho_bytes,
        sha256 = lower(p_sha256)
    WHERE id = v_id;
  ELSE
    -- "Enviar outra NF de Remessa" (ou primeiro envio): chave nova, nova
    -- entidade logica. Comportamento identico ao existente, inalterado.
    v_numero_versao := 1;

    INSERT INTO public.nota_fiscal_remessas (
      nota_fiscal_venda_id, cedente_id, fundo_id, cedente_fundo_id,
      chave_acesso, numero, serie,
      emitente_cnpj, emitente_razao_social, destinatario_cnpj, destinatario_razao_social,
      data_emissao, valor_total, quantidade_total, itens,
      status_validacao, referencia_nf_venda_confirmada, motivos_validacao,
      aprovacao_documental,
      bucket, path, nome_original, mime_type, tamanho_bytes, sha256, criado_por
    )
    VALUES (
      venda.id, venda.cedente_id, venda.fundo_id, venda.cedente_fundo_id,
      chave_limpa, nullif(p_numero, ''), nullif(p_serie, ''),
      nullif(regexp_replace(coalesce(p_emitente_cnpj, ''), '\D', '', 'g'), ''), nullif(p_emitente_razao_social, ''),
      nullif(regexp_replace(coalesce(p_destinatario_cnpj, ''), '\D', '', 'g'), ''), nullif(p_destinatario_razao_social, ''),
      p_data_emissao, coalesce(p_valor_total, 0), p_quantidade_total, coalesce(p_itens, '[]'::jsonb),
      p_status_validacao, coalesce(p_referencia_nf_venda_confirmada, false), coalesce(p_motivos_validacao, '[]'::jsonb),
      v_aprovacao_documental,
      p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), actor_id
    )
    RETURNING id INTO v_id;
  END IF;

  -- Historico append-only: sempre uma nova linha, nunca uma atualizacao de
  -- linha existente -- e o registro imutavel de "o que foi enviado nesta
  -- versao", independente do que os ponteiros em nota_fiscal_remessas
  -- venham a refletir depois.
  INSERT INTO public.nota_fiscal_remessa_versoes (
    nota_fiscal_remessa_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status_validacao, referencia_nf_venda_confirmada, motivos_validacao, vigente, created_by
  )
  VALUES (
    v_id, v_numero_versao, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256),
    p_status_validacao, coalesce(p_referencia_nf_venda_confirmada, false), coalesce(p_motivos_validacao, '[]'::jsonb),
    true, actor_id
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'status_validacao', p_status_validacao,
    'nota_fiscal_venda_id', venda.id,
    'aprovacao_documental', v_aprovacao_documental,
    'atualizacao', v_atualizacao,
    'numero_versao', v_numero_versao
  );
END;
$$;

COMMIT;
