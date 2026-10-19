BEGIN;

CREATE TABLE public.vortx_relatorio_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  integracao_versao_id uuid NOT NULL REFERENCES public.integracao_fundo_versoes(id) ON DELETE RESTRICT,
  ambiente text NOT NULL CHECK (ambiente IN ('producao', 'homologacao')),
  pedido jsonb NOT NULL CHECK (jsonb_typeof(pedido) = 'object'),
  hash_pedido text NOT NULL CHECK (hash_pedido ~ '^[0-9a-f]{64}$'),
  estado text NOT NULL DEFAULT 'registrada' CHECK (estado IN ('registrada', 'enviando', 'aceita', 'recusada', 'indeterminada', 'falha_autenticacao')),
  protocolo_externo uuid,
  codigo_http integer CHECK (codigo_http BETWEEN 100 AND 599),
  solicitada_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  lease_hash text NOT NULL CHECK (lease_hash ~ '^[0-9a-f]{64}$'),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  envio_iniciado_em timestamptz,
  concluida_em timestamptz,
  CONSTRAINT vortx_relatorio_pedido_unico UNIQUE (fundo_id, ambiente, integracao_versao_id, hash_pedido),
  CONSTRAINT vortx_relatorio_aceite_check CHECK (
    (estado = 'aceita' AND protocolo_externo IS NOT NULL AND codigo_http IS NOT NULL AND codigo_http BETWEEN 200 AND 299)
    OR (estado <> 'aceita' AND protocolo_externo IS NULL)
  ),
  CONSTRAINT vortx_relatorio_estado_http_check CHECK (
    (estado IN ('registrada','enviando','falha_autenticacao') AND codigo_http IS NULL)
    OR (estado = 'recusada' AND codigo_http IS NOT NULL AND codigo_http IN (400,401,403,404,405,415,422,429))
    OR estado IN ('aceita','indeterminada')
  ),
  CONSTRAINT vortx_relatorio_protocolo_unico UNIQUE (ambiente, protocolo_externo)
);
CREATE INDEX vortx_relatorio_fundo_historico_idx ON public.vortx_relatorio_solicitacoes (fundo_id, criada_em DESC, id DESC);
CREATE INDEX vortx_relatorio_versao_idx ON public.vortx_relatorio_solicitacoes (integracao_versao_id);
CREATE INDEX vortx_relatorio_ator_idx ON public.vortx_relatorio_solicitacoes (solicitada_por);
ALTER TABLE public.vortx_relatorio_solicitacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vortx_relatorio_solicitacoes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,estado,protocolo_externo,codigo_http,solicitada_por,criada_em,envio_iniciado_em,concluida_em)
  ON public.vortx_relatorio_solicitacoes TO authenticated;
GRANT SELECT ON public.vortx_relatorio_solicitacoes TO service_role;

-- Definer interno somente para consultar contratos canonicos de identidade e MFA.
CREATE FUNCTION private.vortx_relatorio_pode_acessar(p_fundo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (SELECT private.usuario_e_super_admin())
    AND EXISTS (SELECT 1 FROM public.usuario_fundos u JOIN public.fundos f ON f.id=u.fundo_id
      WHERE u.usuario_id=(SELECT auth.uid()) AND u.fundo_id=p_fundo_id AND u.status='ativo' AND f.ativo)
    AND EXISTS (SELECT 1 FROM public.obter_sessao_mfa_atual() m WHERE m.status='valid')
    AND (SELECT auth.jwt()->>'aal')='aal2';
$$;
REVOKE ALL ON FUNCTION private.vortx_relatorio_pode_acessar(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_relatorio_pode_acessar(uuid) TO authenticated;
CREATE POLICY vortx_relatorio_leitura_administrativa ON public.vortx_relatorio_solicitacoes FOR SELECT TO authenticated
  USING (private.vortx_relatorio_pode_acessar(fundo_id));

-- Nao ha grants de DML para o cliente. Reserva e nonce sao atomicos nesta fronteira estreita.
CREATE FUNCTION private.vortx_relatorio_reservar(
  p_fundo_id uuid, p_versao_id uuid, p_tipo text, p_inicio date, p_fim date,
  p_referencia date, p_extensao integer, p_nonce_hash text, p_lease_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%rowtype;
  v_carteira text; v_capability text; v_pedido jsonb; v_hash text;
  v_row public.vortx_relatorio_solicitacoes%rowtype;
  v_criada boolean; v_hoje date := timezone('America/Sao_Paulo',clock_timestamp())::date;
BEGIN
  IF private.vortx_relatorio_pode_acessar(p_fundo_id) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Acesso administrativo com MFA e vinculo ao Fundo exigido.';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('Inclusao','Exclusao','PosicaoAtivo','PosicaoParcela')
    OR p_inicio IS NULL OR p_fim IS NULL OR p_referencia IS NULL OR p_extensao IS NULL
    OR p_extensao NOT IN (1,2) OR p_fim<=p_inicio
    OR greatest(p_inicio,p_fim,p_referencia)>v_hoje
    OR p_lease_hash IS NULL OR p_lease_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Parametros de relatorio invalidos.';
  END IF;
  SELECT v.* INTO v_versao FROM public.integracao_fundo_versoes v
    JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id
    WHERE v.id=p_versao_id AND i.fundo_id=p_fundo_id AND i.status='ativa'
      AND v.status='publicada' AND v.adapter_key='vortx_vrs';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Versao Vortx publicada deste Fundo nao encontrada.'; END IF;
  v_carteira := trim(v_versao.configuracao_nao_sensivel->>'codigo_carteira');
  IF v_carteira IS NULL OR v_carteira !~ '^[A-Za-z0-9._-]{1,100}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Codigo de carteira VRS nao configurado.';
  END IF;
  v_capability := CASE p_tipo WHEN 'Inclusao' THEN 'AQUISICOES' WHEN 'Exclusao' THEN 'LIQUIDACOES' ELSE 'ESTOQUE' END;
  IF NOT EXISTS (SELECT 1 FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id=v_versao.id AND c.fundo_id=p_fundo_id
      AND c.ambiente=v_versao.ambiente AND c.capability=v_capability
      AND c.disponivel_desde<=clock_timestamp() AND (c.disponivel_ate IS NULL OR c.disponivel_ate>clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Relatorio nao habilitado nesta versao da integracao.';
  END IF;
  IF public.consumir_autorizacao_acao_sensivel('testar_conexao_vortx_vrs',p_nonce_hash) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Autorizacao MFA expirada ou ja utilizada.';
  END IF;
  INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,dados)
    SELECT e,auth.uid(),'usuario','vortx_relatorios','info',
      jsonb_build_object('fundo_id',p_fundo_id,'action_type','testar_conexao_vortx_vrs','session_id',auth.jwt()->>'session_id')
    FROM unnest(ARRAY['MFA_ACAO_SENSIVEL_VALIDADA','AUTORIZACAO_SENSIVEL_CONSUMIDA']) e;
  v_pedido := jsonb_build_object('codigoCarteira',v_carteira,'dataInicio',to_char(p_inicio,'YYYY-MM-DD'),
    'dataFim',to_char(p_fim,'YYYY-MM-DD'),'dataReferencia',to_char(p_referencia,'YYYY-MM-DD'),
    'tipoRelatorio',p_tipo,'extensaoArquivo',p_extensao);
  v_hash := encode(pg_catalog.sha256(convert_to(v_pedido::text,'UTF8')),'hex');
  INSERT INTO public.vortx_relatorio_solicitacoes(fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,solicitada_por,session_id,lease_hash)
    VALUES (p_fundo_id,v_versao.id,v_versao.ambiente,v_pedido,v_hash,auth.uid(),(auth.jwt()->>'session_id')::uuid,p_lease_hash)
    ON CONFLICT ON CONSTRAINT vortx_relatorio_pedido_unico DO NOTHING RETURNING * INTO v_row;
  v_criada := FOUND;
  IF NOT v_criada THEN
    SELECT * INTO STRICT v_row FROM public.vortx_relatorio_solicitacoes s
      WHERE s.fundo_id=p_fundo_id AND s.integracao_versao_id=v_versao.id AND s.ambiente=v_versao.ambiente AND s.hash_pedido=v_hash;
    IF v_row.pedido IS DISTINCT FROM v_pedido THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Conflito na identidade da solicitacao.';
    END IF;
  ELSE
    INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
      VALUES ('CREDENCIAL_USADA',auth.uid(),'usuario','vortx_relatorios','info','vortx_relatorio_solicitacoes',v_row.id,
        jsonb_build_object('fundo_id',p_fundo_id,'etapa','RESERVADA','tipo_relatorio',p_tipo,'hash_pedido',v_hash));
  END IF;
  RETURN jsonb_build_object('criada',v_criada,'solicitacao',to_jsonb(v_row)-'lease_hash'-'session_id');
END;
$$;

CREATE FUNCTION public.admin_reservar_relatorio_vortx(p_fundo_id uuid,p_versao_id uuid,p_tipo text,p_inicio date,p_fim date,p_referencia date,p_extensao integer,p_nonce_hash text,p_lease_hash text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.vortx_relatorio_reservar(p_fundo_id,p_versao_id,p_tipo,p_inicio,p_fim,p_referencia,p_extensao,p_nonce_hash,p_lease_hash);
$$;

CREATE FUNCTION private.vortx_relatorio_transicionar(p_id uuid,p_lease text,p_estado text,p_protocolo uuid,p_http integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row public.vortx_relatorio_solicitacoes%rowtype;
BEGIN
  SELECT * INTO v_row FROM public.vortx_relatorio_solicitacoes s WHERE s.id=p_id FOR UPDATE;
  IF NOT FOUND OR private.vortx_relatorio_pode_acessar(v_row.fundo_id) IS NOT TRUE
    OR v_row.solicitada_por IS DISTINCT FROM auth.uid()
    OR v_row.session_id IS DISTINCT FROM (auth.jwt()->>'session_id')::uuid
    OR p_lease IS NULL OR length(p_lease)<>64
    OR v_row.lease_hash IS DISTINCT FROM encode(pg_catalog.sha256(convert_to(p_lease,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Solicitacao nao autorizada para esta sessao.';
  END IF;
  IF p_estado IS NULL OR NOT ((v_row.estado='registrada' AND p_estado IN ('enviando','falha_autenticacao'))
    OR (v_row.estado='enviando' AND p_estado IN ('aceita','recusada','indeterminada'))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Transicao de solicitacao nao permitida.';
  END IF;
  IF p_estado='enviando' AND clock_timestamp()>v_row.criada_em+interval '2 minutes' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Autorizacao de envio expirada; nao reenviar automaticamente.';
  END IF;
  -- Revalidar apos o login externo: desativacao ou troca de contexto impede o POST.
  IF p_estado='enviando' AND NOT EXISTS (
    SELECT 1 FROM public.integracao_fundo_versoes v JOIN public.integracoes_fundo i ON i.id=v.integracao_fundo_id
      JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id=v.id
    WHERE v.id=v_row.integracao_versao_id AND i.fundo_id=v_row.fundo_id AND i.status='ativa'
      AND v.status='publicada' AND v.adapter_key='vortx_vrs' AND v.ambiente=v_row.ambiente
      AND trim(v.configuracao_nao_sensivel->>'codigo_carteira')=v_row.pedido->>'codigoCarteira'
      AND c.fundo_id=v_row.fundo_id AND c.ambiente=v_row.ambiente
      AND c.capability=CASE v_row.pedido->>'tipoRelatorio' WHEN 'Inclusao' THEN 'AQUISICOES' WHEN 'Exclusao' THEN 'LIQUIDACOES' ELSE 'ESTOQUE' END
      AND c.disponivel_desde<=clock_timestamp() AND (c.disponivel_ate IS NULL OR c.disponivel_ate>clock_timestamp())
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='A integracao mudou apos a reserva; envio nao autorizado.';
  END IF;
  UPDATE public.vortx_relatorio_solicitacoes SET estado=p_estado,protocolo_externo=p_protocolo,codigo_http=p_http,
    envio_iniciado_em=CASE WHEN p_estado='enviando' THEN clock_timestamp() ELSE envio_iniciado_em END,
    concluida_em=CASE WHEN p_estado IN ('aceita','recusada','indeterminada','falha_autenticacao') THEN clock_timestamp() ELSE NULL END
    WHERE id=p_id RETURNING * INTO v_row;
  INSERT INTO public.seguranca_eventos(tipo_evento,ator_usuario_id,ator_tipo,origem,severidade,entidade_tipo,entidade_id,dados)
    VALUES ('CREDENCIAL_USADA',auth.uid(),'usuario','vortx_relatorios','info','vortx_relatorio_solicitacoes',v_row.id,
      jsonb_build_object('fundo_id',v_row.fundo_id,'estado',p_estado,'codigo_http',p_http));
  RETURN to_jsonb(v_row)-'lease_hash'-'session_id';
END;
$$;
CREATE FUNCTION public.admin_transicionar_relatorio_vortx(p_id uuid,p_lease text,p_estado text,p_protocolo uuid DEFAULT NULL,p_http integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.vortx_relatorio_transicionar(p_id,p_lease,p_estado,p_protocolo,p_http);
$$;

CREATE FUNCTION public.admin_listar_relatorios_vortx(p_fundo_id uuid,p_pagina integer DEFAULT 1)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object('total',(SELECT count(id) FROM public.vortx_relatorio_solicitacoes WHERE fundo_id=p_fundo_id),
    'solicitacoes',COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.criada_em DESC,q.id DESC) FROM (
      SELECT id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,estado,protocolo_externo,codigo_http,solicitada_por,criada_em,envio_iniciado_em,concluida_em
      FROM public.vortx_relatorio_solicitacoes WHERE fundo_id=p_fundo_id
      ORDER BY criada_em DESC,id DESC LIMIT 20 OFFSET (greatest(1,least(10000,coalesce(p_pagina,1)))-1)*20
    ) q),'[]'::jsonb));
$$;

REVOKE ALL ON FUNCTION private.vortx_relatorio_reservar(uuid,uuid,text,date,date,date,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.vortx_relatorio_transicionar(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_reservar_relatorio_vortx(uuid,uuid,text,date,date,date,integer,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_transicionar_relatorio_vortx(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.admin_listar_relatorios_vortx(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.vortx_relatorio_reservar(uuid,uuid,text,date,date,date,integer,text,text),
  private.vortx_relatorio_transicionar(uuid,text,text,uuid,integer),
  public.admin_reservar_relatorio_vortx(uuid,uuid,text,date,date,date,integer,text,text),
  public.admin_transicionar_relatorio_vortx(uuid,text,text,uuid,integer),
  public.admin_listar_relatorios_vortx(uuid,integer) TO authenticated;
COMMENT ON TABLE public.vortx_relatorio_solicitacoes IS 'Pedidos assincronos Vortx; aceite e protocolo nao representam arquivo recebido, importacao ou publicacao financeira. Sem retry automatico.';
COMMIT;
