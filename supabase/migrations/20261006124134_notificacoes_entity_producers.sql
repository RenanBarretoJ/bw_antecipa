-- R2 continuation: trusted, entity-derived producers. No historical row updates.
-- Recipient lookup must read canonical ACLs independently of the event actor.
-- These private definers are not executable by browser/database API roles.
CREATE FUNCTION private.notificacao_destinatarios_entidade(
  p_entidade_tipo text, p_entidade_id uuid, p_destino text,
  p_somente_admin boolean DEFAULT false
) RETURNS TABLE(usuario_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH contexto AS (
    SELECT ctx.* FROM private.notificacao_contexto_entidade(p_entidade_tipo,p_entidade_id) ctx
    JOIN public.fundos f ON f.id=ctx.fundo_id AND f.ativo
    JOIN public.cedente_fundos cf ON cf.id=ctx.cedente_fundo_id AND cf.status='ativo'
      AND cf.vigente_desde<=now() AND (cf.vigente_ate IS NULL OR cf.vigente_ate>now())
  ), candidatos AS (
    SELECT uf.usuario_id FROM contexto ctx
    JOIN public.usuario_fundos uf ON uf.fundo_id=ctx.fundo_id AND uf.status='ativo'
    JOIN public.profiles p ON p.id=uf.usuario_id
    WHERE p_destino='gestor' AND (p.role::text='gestor' OR EXISTS (
      SELECT 1 FROM public.usuario_papeis up WHERE up.usuario_id=p.id AND up.papel::text='gestor' AND up.ativo))
    UNION
    SELECT ca.user_id FROM contexto ctx JOIN public.cedente_acessos ca ON ca.cedente_id=ctx.cedente_id
    WHERE p_destino='cedente' AND ca.status='ATIVO' AND (NOT p_somente_admin OR ca.perfil='ADMIN')
    UNION
    SELECT c.user_id FROM contexto ctx JOIN public.cedentes c ON c.id=ctx.cedente_id
    WHERE p_destino='cedente' AND NOT EXISTS (SELECT 1 FROM public.cedente_acessos ca WHERE ca.cedente_id=c.id)
    UNION
    SELECT cu.user_id FROM contexto ctx
    JOIN public.consultor_cedentes cc ON cc.cedente_id=ctx.cedente_id AND cc.status='ativo'
    JOIN public.consultores co ON co.id=cc.consultor_id AND co.status='ativo'
    JOIN public.consultor_fundos cf ON cf.consultor_id=co.id AND cf.fundo_id=ctx.fundo_id AND cf.status='ativo'
    JOIN public.consultor_usuarios cu ON cu.consultor_id=co.id AND cu.status='ativo'
      AND cu.papel IN ('OWNER','ADMIN','OPERADOR','LEITOR')
    WHERE p_destino='consultor'
    UNION
    SELECT sa.user_id FROM contexto ctx
    JOIN public.notas_fiscais nf ON nf.fundo_id=ctx.fundo_id AND nf.cedente_fundo_id=ctx.cedente_fundo_id
    JOIN public.sacados s ON regexp_replace(s.cnpj,'\D','','g')=regexp_replace(nf.cnpj_destinatario,'\D','','g')
    JOIN public.sacado_acessos sa ON sa.sacado_id=s.id AND sa.fundo_id=ctx.fundo_id AND sa.status='ativo'
    WHERE p_destino='sacado' AND (
      (p_entidade_tipo='nota_fiscal' AND nf.id=p_entidade_id)
      OR (p_entidade_tipo='operacao' AND EXISTS (SELECT 1 FROM public.operacoes_nfs onf
        WHERE onf.operacao_id=p_entidade_id AND onf.nota_fiscal_id=nf.id))
      OR (p_entidade_tipo='entrega' AND EXISTS (SELECT 1 FROM public.nota_fiscal_entregas e
        WHERE e.id=p_entidade_id AND e.nota_fiscal_id=nf.id))
    )
  )
  SELECT DISTINCT c.usuario_id FROM candidatos c JOIN public.profiles p ON p.id=c.usuario_id
  WHERE p.status::text='ativo'
    AND (p_destino='gestor' OR p.role::text=p_destino)
    AND EXISTS (SELECT 1 FROM contexto ctx WHERE private.notificacao_usuario_acessa_fundo(p.id,ctx.fundo_id));
$$;
REVOKE ALL ON FUNCTION private.notificacao_destinatarios_entidade(text,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- Defense in depth for every producer, including the already migrated R1/R2
-- helpers: fund membership alone does not grant access to another cedente/CNPJ.
CREATE FUNCTION private.validar_destinatario_entidade_notificacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.scope_type='FUNDO' THEN
    IF NEW.entidade_tipo IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM (VALUES ('gestor'),('cedente'),('sacado'),('consultor')) roles(papel)
      CROSS JOIN LATERAL private.notificacao_destinatarios_entidade(NEW.entidade_tipo,NEW.entidade_id,roles.papel,false) d
      WHERE d.usuario_id=NEW.usuario_id
    ) THEN RAISE EXCEPTION 'NOTIFICACAO_DESTINATARIO_ENTIDADE_NEGADO' USING ERRCODE='42501'; END IF;
    -- A single authenticated resolver checks own notification, fund and entity
    -- again when opening. No caller-controlled destination can bypass that guard.
    NEW.href:='/notificacoes/abrir/'||NEW.id::text||'?fundo='||NEW.fundo_id::text;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validar_destinatario_entidade_notificacao() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER notificacoes_destinatario_guard BEFORE INSERT ON public.notificacoes
FOR EACH ROW EXECUTE FUNCTION private.validar_destinatario_entidade_notificacao();

CREATE FUNCTION private.notificar_entidade(
  p_entidade_tipo text, p_entidade_id uuid, p_destino text,
  p_titulo text, p_mensagem text, p_tipo text, p_dedupe_key text,
  p_usuario_id uuid DEFAULT NULL, p_somente_admin boolean DEFAULT false
) RETURNS TABLE(usuario_id uuid,notificacao_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx record; destinatario uuid; nova uuid;
BEGIN
  IF p_destino IS NULL OR p_destino NOT IN ('gestor','cedente','sacado','consultor')
    OR nullif(btrim(p_dedupe_key),'') IS NULL OR length(p_dedupe_key)>500
    OR nullif(btrim(p_titulo),'') IS NULL OR nullif(btrim(p_mensagem),'') IS NULL
    OR nullif(btrim(p_tipo),'') IS NULL THEN
    RAISE EXCEPTION 'NOTIFICACAO_EVENTO_INVALIDO' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ctx FROM private.notificacao_contexto_entidade(p_entidade_tipo,p_entidade_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'NOTIFICACAO_ENTIDADE_SEM_CONTEXTO' USING ERRCODE='23514'; END IF;
  IF p_usuario_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.notificacao_destinatarios_entidade(p_entidade_tipo,p_entidade_id,p_destino,p_somente_admin) d
    WHERE d.usuario_id=p_usuario_id
  ) THEN RAISE EXCEPTION 'NOTIFICACAO_DESTINATARIO_NEGADO' USING ERRCODE='42501'; END IF;
  FOR destinatario IN
    SELECT d.usuario_id FROM private.notificacao_destinatarios_entidade(p_entidade_tipo,p_entidade_id,p_destino,p_somente_admin) d
    WHERE p_usuario_id IS NULL OR d.usuario_id=p_usuario_id
  LOOP
    nova := private.criar_notificacao_fundo(destinatario,ctx.fundo_id,p_titulo,p_mensagem,p_tipo,
      p_dedupe_key,ctx.cedente_fundo_id,ctx.cedente_id,p_entidade_tipo,p_entidade_id);
    IF nova IS NOT NULL THEN usuario_id:=destinatario; notificacao_id:=nova; RETURN NEXT; END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.notificar_entidade(text,uuid,text,text,text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

-- One backend bridge; browser actors cannot send arbitrary messages/recipients.
CREATE FUNCTION public.notificar_entidade(
  p_entidade_tipo text, p_entidade_id uuid, p_destino text,
  p_titulo text, p_mensagem text, p_tipo text, p_dedupe_key text,
  p_usuario_id uuid DEFAULT NULL, p_somente_admin boolean DEFAULT false
) RETURNS TABLE(usuario_id uuid,notificacao_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM private.notificar_entidade(p_entidade_tipo,p_entidade_id,p_destino,
    p_titulo,p_mensagem,p_tipo,p_dedupe_key,p_usuario_id,p_somente_admin);
$$;
REVOKE ALL ON FUNCTION public.notificar_entidade(text,uuid,text,text,text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.notificar_entidade(text,uuid,text,text,text,text,text,uuid,boolean),
  public.notificar_entidade(text,uuid,text,text,text,text,text,uuid,boolean) TO service_role;

-- Shared cadastral decisions have no single source fund. Same confirmed rule as
-- uploads: emit one notification per active canonical link, never choose a fund.
CREATE FUNCTION private.notificar_cedente_cadastro(
  p_cedente_id uuid,p_titulo text,p_mensagem text,p_tipo text,p_dedupe_key text,
  p_somente_admin boolean DEFAULT false
) RETURNS TABLE(usuario_id uuid,notificacao_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE vinculo uuid;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('cadastro_aprovado','cadastro_reprovado',
    'documento_aprovado','documento_reprovado','alteracao_cadastral_aprovada','alteracao_cadastral_reprovada',
    'documento_atualizacao_solicitada','estabelecimento_pendencia_pos_aprovacao',
    'documento_estabelecimento_aprovado','documento_estabelecimento_rejeitado','documento_estabelecimento_requer_ajuste') THEN
    RAISE EXCEPTION 'NOTIFICACAO_CADASTRO_TIPO_INVALIDO' USING ERRCODE='22023';
  END IF;
  FOR vinculo IN SELECT cf.id FROM public.cedente_fundos cf JOIN public.fundos f ON f.id=cf.fundo_id AND f.ativo
    WHERE cf.cedente_id=p_cedente_id AND cf.status='ativo' AND cf.vigente_desde<=now()
      AND (cf.vigente_ate IS NULL OR cf.vigente_ate>now())
  LOOP
    RETURN QUERY SELECT * FROM private.notificar_entidade('cedente_fundo',vinculo,'cedente',
      p_titulo,p_mensagem,p_tipo,p_dedupe_key,NULL,p_somente_admin);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.notificar_cedente_cadastro(uuid,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.notificar_cedente_cadastro(
  p_cedente_id uuid,p_titulo text,p_mensagem text,p_tipo text,p_dedupe_key text,
  p_somente_admin boolean DEFAULT false
) RETURNS TABLE(usuario_id uuid,notificacao_id uuid)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM private.notificar_cedente_cadastro(p_cedente_id,p_titulo,p_mensagem,p_tipo,p_dedupe_key,p_somente_admin);
$$;
REVOKE ALL ON FUNCTION public.notificar_cedente_cadastro(uuid,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.notificar_cedente_cadastro(uuid,text,text,text,text,boolean),
  public.notificar_cedente_cadastro(uuid,text,text,text,text,boolean) TO service_role;

-- Security events are the only existing global producers. Keep that explicit.
CREATE FUNCTION private.notificar_seguranca_global(p_usuario_id uuid,p_titulo text,p_mensagem text,p_tipo text,p_dedupe_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE nova uuid;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('mfa_reset_administrativo','seguranca_senha_alterada')
    OR nullif(btrim(p_dedupe_key),'') IS NULL THEN
    RAISE EXCEPTION 'NOTIFICACAO_GLOBAL_TIPO_INVALIDO' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_usuario_id AND status::text='ativo') THEN RETURN NULL; END IF;
  INSERT INTO public.notificacoes(usuario_id,titulo,mensagem,tipo,dedupe_key,scope_type)
  VALUES(p_usuario_id,p_titulo,p_mensagem,p_tipo,'global:'||p_tipo||':'||p_dedupe_key,'GLOBAL')
  ON CONFLICT(usuario_id,dedupe_key) DO NOTHING RETURNING id INTO nova;
  RETURN nova;
END;
$$;
REVOKE ALL ON FUNCTION private.notificar_seguranca_global(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.notificar_seguranca_global(p_usuario_id uuid,p_titulo text,p_mensagem text,p_tipo text,p_dedupe_key text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.notificar_seguranca_global(p_usuario_id,p_titulo,p_mensagem,p_tipo,p_dedupe_key);
$$;
REVOKE ALL ON FUNCTION public.notificar_seguranca_global(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.notificar_seguranca_global(uuid,text,text,text,text),
  public.notificar_seguranca_global(uuid,text,text,text,text) TO service_role;

-- Patch only notification statements in the 11 inventoried signatures. Preserve
-- domain bodies, signatures, owners and ACLs. Fail on drift or residual writers.
DO $migration$
DECLARE fn oid; definition text; original text; old_fragment text; new_fragment text;
BEGIN
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname='notificar_cedente_ativos' AND p.pronargs=6;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$
DECLARE
  v_inseridos integer := 0;
BEGIN
  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT destinatarios.user_id,
         p_titulo,
         p_mensagem,
         p_tipo,
         p_dedupe_base || ':' || destinatarios.user_id::text
  FROM (
    SELECT ca.user_id
      FROM public.cedente_acessos ca
      JOIN public.profiles p ON p.id = ca.user_id AND p.status::text = 'ativo'
     WHERE ca.cedente_id = p_cedente_id
       AND ca.status = 'ATIVO'
       AND (NOT p_somente_admin OR ca.perfil = 'ADMIN')
    UNION
    SELECT c.user_id
      FROM public.cedentes c
      JOIN public.profiles p ON p.id = c.user_id AND p.status::text = 'ativo'
     WHERE c.id = p_cedente_id
       AND NOT EXISTS (
         SELECT 1 FROM public.cedente_acessos ca WHERE ca.cedente_id = p_cedente_id
       )
  ) destinatarios
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;
  RETURN v_inseridos;
END;
$old$;
  new_fragment:=$new$
BEGIN
  RAISE EXCEPTION 'NOTIFICACAO_ENTIDADE_OBRIGATORIA' USING ERRCODE='23514';
END;
$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: private.notificar_cedente_ativos/6';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname='vincular_comprovante_webhook_entrega' AND p.pronargs=7;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT pf.id, 'Comprovante de entrega recebido', 'Um comprovante foi recebido automaticamente da transportadora e aguarda analise.', 'canhoto_enviado',
         'canhoto:' || v_canhoto_id::text || ':enviado:' || pf.id::text
  FROM public.profiles pf WHERE pf.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('entrega',p_entrega_id,'gestor',
    'Comprovante de entrega recebido','Um comprovante foi recebido automaticamente da transportadora e aguarda analise.','canhoto_enviado','canhoto:'||v_canhoto_id::text||':enviado');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: private.vincular_comprovante_webhook_entrega/7';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='comunicar_postergacao_upload_canhoto' AND p.pronargs=3;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (
    usuario_id,
    titulo,
    mensagem,
    tipo,
    dedupe_key,
    entidade_tipo,
    entidade_id,
    href
  )
  SELECT DISTINCT
    uf.usuario_id,
    'Nova previsao de upload do canhoto',
    'O cedente ' || COALESCE(NULLIF(v_perfil.nome_completo, ''), NULLIF(v_perfil.email, ''), 'não identificado') ||
      ' comunicou nova previsão para upload do canhoto da NF ' || v_nf.numero_nf ||
      '. Prazo original: ' || to_char(v_prazo_original, 'DD/MM/YYYY') ||
      '. Nova previsão: ' || to_char(p_nova_previsao, 'DD/MM/YYYY') ||
      '. Motivo: ' || v_motivo ||
      '. Comunicada em: ' || to_char(CURRENT_TIMESTAMP, 'DD/MM/YYYY HH24:MI') || '.',
    'info',
    'nf:' || v_nf.id::text || ':canhoto_postergacao:' || uf.usuario_id::text,
    'notas_fiscais',
    v_nf.id,
    '/gestor/notas-fiscais/' || v_nf.id::text
  FROM public.usuario_fundos uf
  JOIN public.profiles p ON p.id = uf.usuario_id
  WHERE uf.fundo_id = v_nf.fundo_id
    AND uf.status = 'ativo'
    AND p.role = 'gestor'
    AND p.status = 'ativo'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('nota_fiscal',v_nf.id,'gestor',
    'Nova previsao de upload do canhoto',
    'O cedente ' || COALESCE(NULLIF(v_perfil.nome_completo, ''), NULLIF(v_perfil.email, ''), 'não identificado') ||
      ' comunicou nova previsão para upload do canhoto da NF ' || v_nf.numero_nf ||
      '. Prazo original: ' || to_char(v_prazo_original, 'DD/MM/YYYY') ||
      '. Nova previsão: ' || to_char(p_nova_previsao, 'DD/MM/YYYY') ||
      '. Motivo: ' || v_motivo ||
      '. Comunicada em: ' || to_char(CURRENT_TIMESTAMP, 'DD/MM/YYYY HH24:MI') || '.','info',
    'nf:'||v_nf.id::text||':canhoto_postergacao:'||v_postergacao.id::text);$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.comunicar_postergacao_upload_canhoto/3';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='desembolsar_operacao_com_logistica' AND p.pronargs=1;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$private.notificar_cedente_ativos(
    op.cedente_id,$old$;
  new_fragment:=$new$private.notificar_entidade('operacao',p_operacao_id,'cedente',$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.desembolsar_operacao_com_logistica/1';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='processar_aceite_sacado' AND p.pronargs=3;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$private.notificar_cedente_ativos(
      v_nf.cedente_id,$old$;
  new_fragment:=$new$private.notificar_entidade('nota_fiscal',v_nf.id,'cedente',$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.processar_aceite_sacado/3';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:=$old$FOR v_recipient IN SELECT DISTINCT p.id FROM public.profiles p
      JOIN public.usuario_fundos uf ON uf.usuario_id = p.id AND uf.status = 'ativo'
      WHERE p.role = 'gestor' AND p.status = 'ativo' AND uf.fundo_id = v_nf.fundo_id
    LOOP
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (
        v_recipient,
        v_title,
        CASE WHEN p_acao = 'contestar' THEN v_message ELSE v_message || format(' (emitente: %s).', v_nf.razao_social_emitente) END,
        CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
        v_dedupe || ':gestor:' || v_recipient::text
      ) ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
    END LOOP;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('nota_fiscal',v_nf.id,'gestor',v_title,
      CASE WHEN p_acao = 'contestar' THEN v_message ELSE v_message || format(' (emitente: %s).', v_nf.razao_social_emitente) END,
      CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
      v_dedupe || ':gestor');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.processar_aceite_sacado/3';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='processar_prazos_entrega' AND p.pronargs=1;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$private.notificar_cedente_ativos(entrega.cedente_id,$old$;
  new_fragment:=$new$private.notificar_entidade('entrega',entrega.id,'cedente',$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>4 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.processar_prazos_entrega/1';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='registrar_canhoto_documento' AND p.pronargs=13;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'Canhoto enviado', 'Um canhoto foi enviado para analise.', 'canhoto_enviado',
         'canhoto:' || canhoto_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('entrega',p_nota_fiscal_entrega_id,'gestor',
    'Canhoto enviado','Um canhoto foi enviado para analise.','canhoto_enviado','canhoto:'||canhoto_id::text||':enviado');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.registrar_canhoto_documento/13';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='registrar_canhoto_documento' AND p.pronargs=14;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'Canhoto enviado', 'Um canhoto foi enviado para analise.', 'canhoto_enviado',
         'canhoto:' || canhoto_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('entrega',p_nota_fiscal_entrega_id,'gestor',
    'Canhoto enviado','Um canhoto foi enviado para analise.','canhoto_enviado','canhoto:'||canhoto_id::text||':enviado');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.registrar_canhoto_documento/14';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='registrar_canhoto_documento' AND p.pronargs=15;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'Canhoto enviado', 'Um canhoto foi enviado para analise.', 'canhoto_enviado',
         'canhoto:' || canhoto_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('entrega',p_nota_fiscal_entrega_id,'gestor',
    'Canhoto enviado','Um canhoto foi enviado para analise.','canhoto_enviado','canhoto:'||canhoto_id::text||':enviado');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.registrar_canhoto_documento/15';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='registrar_cte_documento' AND p.pronargs=18;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'CT-e enviado', 'Um CT-e foi enviado para analise.', 'cte_enviado',
         'cte:' || v_cte_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('cedente_fundo',cedente_fundo,'gestor',
    'CT-e enviado','Um CT-e foi enviado para analise.','cte_enviado','cte:'||v_cte_id::text||':enviado');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.registrar_cte_documento/18';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
  SELECT p.oid INTO STRICT fn FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='registrar_cte_documento' AND p.pronargs=21;
  definition:=replace(pg_catalog.pg_get_functiondef(fn),E'\r\n',E'\n'); original:=definition;
  old_fragment:=$old$INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'CT-e enviado', 'Um CT-e foi enviado para analise.', 'cte_enviado',
         'cte:' || v_cte_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;$old$;
  new_fragment:=$new$PERFORM private.notificar_entidade('cedente_fundo',cedente_fundo,'gestor',
    'CT-e enviado','Um CT-e foi enviado para analise.','cte_enviado','cte:'||v_cte_id::text||':enviado');$new$;
  IF (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_DIVERGENTE: public.registrar_cte_documento/21';
  END IF;
  definition:=replace(definition,old_fragment,new_fragment);
  IF definition=original OR definition ~* 'INSERT\s+INTO\s+public.notificacoes' OR definition ~ 'PERFORM private.notificar_cedente_ativos' THEN
    RAISE EXCEPTION 'NOTIFICACAO_PRODUTOR_NAO_ADAPTADO';
  END IF;
  EXECUTE definition;
END;
$migration$;
