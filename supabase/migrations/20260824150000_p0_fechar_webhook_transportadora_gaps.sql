-- P0 Claude: fechar 2 gaps do webhook de comprovante de transportadora
-- antes do PASS definitivo (ticket P0_Claude_Fechar_Webhook_Transportadora).
--
-- Esta e uma migration CORRETIVA/incremental -- a migration
-- 20260824100000_p0_webhook_comprovante_transportadora.sql JA FOI aplicada
-- em homolog (fhgkmggthxikfpogrvaa), portanto nao pode ser editada
-- (docs/development/engineering-standards.md: "Nunca editar migration ja
-- aplicada para corrigir ambiente existente; crie nova migration
-- corretiva"). Tudo abaixo e feito via CREATE OR REPLACE FUNCTION (mesmas
-- assinaturas, exceto onde indicado) + CREATE TABLE novo.
--
-- Gap 1 -- NF identificada, mas ainda sem nota_fiscal_entregas (pre-
-- desembolso): antes, o comprovante caia em AGUARDANDO_ENTREGA e o arquivo
-- era descartado (so o inbox sobrevivia). Agora o arquivo/metadados sao
-- preservados em webhook_comprovantes_entrega_pendentes (nova tabela) e
-- reconciliados AUTOMATICAMENTE quando a entrega nascer -- nunca depende
-- de reenvio da transportadora. O gancho de reconciliacao fica dentro de
-- desembolsar_operacao_com_logistica (unica funcao que cria linhas em
-- nota_fiscal_entregas), logo apos o loop de requisitos pos-cessao (para
-- que, quando aplicavel, a instancia de requisito ja exista e possa ser
-- vinculada). A logica de "vincular comprovante a uma entrega existente"
-- (antes duplicada dentro de registrar_comprovante_entrega_webhook) foi
-- extraida para private.vincular_comprovante_webhook_entrega, reutilizada
-- tanto no caminho em tempo real (entrega ja existe) quanto na
-- reconciliacao tardia (entrega acabou de nascer) -- mesma sequencia de
-- inserts (documento_vinculos -> canhotos -> requisito opcional ->
-- evento -> notificacao), nunca duplicada.
--
-- Gap 2 -- provisionamento passa de gestor-only para Super Admin-only
-- (papel de plataforma `super_admin`, ver private.usuario_e_super_admin(),
-- ja existente desde 20260812143000_sa1_admin_fundos.sql). Gestor deixa de
-- poder criar/desativar integracao de transportadora; continua podendo
-- analisar comprovantes normalmente (nenhuma mudanca nesse fluxo). Base
-- pronta para a UI dedicada de Super Admin no P1 -- essa UI NAO e
-- implementada aqui.

BEGIN;

-- 1. Provisionamento agora exige Super Admin -------------------------------

CREATE OR REPLACE FUNCTION public.admin_criar_integracao_transportadora(
  p_fundo_id uuid,
  p_provider text,
  p_nome text DEFAULT NULL,
  p_cnpj_transportadora text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_token text;
  v_hash text;
  v_id uuid;
  v_cnpj_limpo text := NULLIF(regexp_replace(coalesce(p_cnpj_transportadora, ''), '\D', '', 'g'), '');
BEGIN
  IF actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF p_provider !~ '^[a-z0-9_-]{2,64}$' THEN
    RAISE EXCEPTION 'Provider invalido -- use apenas letras minusculas, digitos, hifen e underscore';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos WHERE id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado';
  END IF;

  -- Entropia forte: dois UUIDs aleatorios + timestamp de alta resolucao,
  -- reduzidos por SHA-256 -- mesmo idioma ja usado neste repositorio.
  v_token := encode(digest(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.integracoes_transportadoras (fundo_id, provider, nome, token_hash, cnpj_transportadora, created_by)
  VALUES (p_fundo_id, p_provider, p_nome, v_hash, v_cnpj_limpo, actor_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('integracao_id', v_id, 'token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desativar_integracao_transportadora(p_integracao_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
BEGIN
  IF actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integracoes_transportadoras WHERE id = p_integracao_id) THEN
    RAISE EXCEPTION 'Integracao nao encontrada';
  END IF;
  UPDATE public.integracoes_transportadoras SET ativo = false, updated_at = now() WHERE id = p_integracao_id;
END;
$$;

-- 2. Evidencia pendente (pre-desembolso, sem nota_fiscal_entregas ainda) ---

CREATE TABLE IF NOT EXISTS public.webhook_comprovantes_entrega_pendentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id uuid NOT NULL REFERENCES public.integracoes_transportadoras(id) ON DELETE RESTRICT,
  webhook_evento_id uuid NOT NULL REFERENCES public.integracao_logistica_webhook_eventos(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  nota_fiscal_venda_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  nota_fiscal_remessa_id uuid REFERENCES public.nota_fiscal_remessas(id) ON DELETE SET NULL,
  tipo_vinculo text NOT NULL,
  documento_id uuid NOT NULL REFERENCES public.documentos_repositorio(id) ON DELETE RESTRICT,
  documento_versao_id uuid NOT NULL REFERENCES public.documento_versoes(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDENTE',
  canhoto_id uuid REFERENCES public.canhotos(id) ON DELETE SET NULL,
  erro_detalhe text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  reconciliado_em timestamptz,
  CONSTRAINT webhook_comprovantes_pendentes_tipo_vinculo_check CHECK (tipo_vinculo IN ('DIRETO_VENDA', 'VIA_REMESSA')),
  CONSTRAINT webhook_comprovantes_pendentes_status_check CHECK (status IN ('PENDENTE', 'RECONCILIADO', 'ERRO_RECONCILIACAO'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_comprovantes_pendentes_nf_status
  ON public.webhook_comprovantes_entrega_pendentes (nota_fiscal_venda_id, status);

COMMENT ON TABLE public.webhook_comprovantes_entrega_pendentes IS
  'Evidencia de comprovante de entrega recebida via webhook ANTES de nota_fiscal_entregas existir (pre-desembolso). O arquivo/documento ja foi persistido (documentos_repositorio/documento_versoes); falta apenas vincular a uma entrega, o que private.reconciliar_comprovantes_pendentes_webhook faz automaticamente quando desembolsar_operacao_com_logistica cria a entrega. Nunca depende de reenvio da transportadora.';

ALTER TABLE public.webhook_comprovantes_entrega_pendentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_comprovantes_pendentes_gestor_select ON public.webhook_comprovantes_entrega_pendentes;
CREATE POLICY webhook_comprovantes_pendentes_gestor_select ON public.webhook_comprovantes_entrega_pendentes
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(webhook_comprovantes_entrega_pendentes.fundo_id)));

REVOKE ALL ON public.webhook_comprovantes_entrega_pendentes FROM PUBLIC, anon;
GRANT SELECT ON public.webhook_comprovantes_entrega_pendentes TO authenticated;
GRANT INSERT, UPDATE ON public.webhook_comprovantes_entrega_pendentes TO service_role;

-- 3. Logica de vinculo extraida (reaproveitada por tempo-real + reconciliacao tardia) ---

CREATE OR REPLACE FUNCTION private.vincular_comprovante_webhook_entrega(
  p_entrega_id uuid,
  p_documento_id uuid,
  p_documento_versao_id uuid,
  p_nota_fiscal_remessa_id uuid,
  p_cedente_id uuid,
  p_provider text,
  p_webhook_evento_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entrega record;
  v_canhoto_aprovado_id uuid;
  v_requisito_id uuid;
  v_canhoto_id uuid;
BEGIN
  SELECT * INTO v_entrega FROM public.nota_fiscal_entregas WHERE id = p_entrega_id FOR UPDATE;
  IF v_entrega.id IS NULL THEN
    RAISE EXCEPTION 'Entrega nao encontrada para vincular comprovante do webhook';
  END IF;

  -- Ja existe canhoto aprovado? Nunca substitui, nunca cria versao nova.
  SELECT id INTO v_canhoto_aprovado_id FROM public.canhotos WHERE nota_fiscal_entrega_id = v_entrega.id AND status = 'aprovado' LIMIT 1;
  IF v_canhoto_aprovado_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'IGNORADO_CANHOTO_JA_APROVADO', 'canhoto_id', v_canhoto_aprovado_id, 'requisito_id', NULL);
  END IF;

  -- Requisito do checklist e opcional -- a politica pode nao ter
  -- configurado comprovante_entrega/canhoto para esta NF.
  SELECT id INTO v_requisito_id
  FROM public.documento_requisito_instancias
  WHERE nota_fiscal_entrega_id = v_entrega.id
    AND tipo_documento_codigo_snapshot IN ('canhoto', 'comprovante_entrega', 'comprovante_de_entrega')
    AND status NOT IN ('cancelado', 'dispensado')
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id)
  VALUES (p_documento_id, v_entrega.id, p_cedente_id);

  -- Nunca 'aprovado' -- so a gestora aprova, via analisar_canhoto_documento
  -- (inalterado).
  INSERT INTO public.canhotos (
    nota_fiscal_entrega_id, status, recebido_em, documento_id, documento_versao_atual_id, nota_fiscal_remessa_id
  ) VALUES (
    v_entrega.id, 'em_analise', now(), p_documento_id, p_documento_versao_id, p_nota_fiscal_remessa_id
  ) RETURNING id INTO v_canhoto_id;

  IF v_requisito_id IS NOT NULL THEN
    UPDATE public.documento_requisito_instancias
    SET documento_id = p_documento_id, status = 'pendente', versao_aprovada_id = NULL, satisfeito_em = NULL
    WHERE id = v_requisito_id;
  END IF;

  PERFORM public.registrar_evento_entrega(
    v_entrega.id, 'canhoto_enviado', v_entrega.status_entrega, v_entrega.status_entrega, 'integracao',
    jsonb_build_object(
      'canhoto_id', v_canhoto_id, 'documento_versao_id', p_documento_versao_id, 'nota_fiscal_remessa_id', p_nota_fiscal_remessa_id,
      'origem', 'INTEGRACAO_TRANSPORTADORA', 'provider', p_provider, 'webhook_evento_id', p_webhook_evento_id
    )
  );

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT pf.id, 'Comprovante de entrega recebido', 'Um comprovante foi recebido automaticamente da transportadora e aguarda analise.', 'canhoto_enviado',
         'canhoto:' || v_canhoto_id::text || ':enviado:' || pf.id::text
  FROM public.profiles pf WHERE pf.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('status', 'PROCESSADO', 'canhoto_id', v_canhoto_id, 'requisito_id', v_requisito_id);
END;
$$;

REVOKE ALL ON FUNCTION private.vincular_comprovante_webhook_entrega(uuid, uuid, uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- 4. registrar_comprovante_entrega_webhook: preserva evidencia quando nao ha entrega ---

CREATE OR REPLACE FUNCTION public.registrar_comprovante_entrega_webhook(
  p_integracao_id uuid,
  p_webhook_evento_id uuid,
  p_nota_fiscal_venda_id uuid,
  p_nota_fiscal_remessa_id uuid,
  p_tipo_vinculo text,
  p_bucket text,
  p_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_provider text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_integracao record;
  v_venda record;
  v_entrega record;
  v_canhoto_aprovado_id uuid;
  v_tipo record;
  v_doc_id uuid;
  v_version_id uuid;
BEGIN
  IF p_tipo_vinculo NOT IN ('DIRETO_VENDA', 'VIA_REMESSA') THEN
    RAISE EXCEPTION 'Tipo de vinculo invalido';
  END IF;
  IF p_tipo_vinculo = 'VIA_REMESSA' AND p_nota_fiscal_remessa_id IS NULL THEN
    RAISE EXCEPTION 'VIA_REMESSA exige nota_fiscal_remessa_id';
  END IF;
  IF p_tipo_vinculo = 'DIRETO_VENDA' AND p_nota_fiscal_remessa_id IS NOT NULL THEN
    RAISE EXCEPTION 'DIRETO_VENDA nao pode informar nota_fiscal_remessa_id';
  END IF;

  SELECT * INTO v_integracao FROM public.integracoes_transportadoras WHERE id = p_integracao_id AND ativo = true;
  IF v_integracao.id IS NULL THEN
    RAISE EXCEPTION 'Integracao de transportadora invalida ou inativa';
  END IF;
  IF v_integracao.provider <> p_provider THEN
    RAISE EXCEPTION 'Provider informado nao corresponde a integracao';
  END IF;

  -- Cross-fund deny: revalida aqui (defesa em profundidade), nunca confia
  -- no que o chamador (rota HTTP) ja calculou.
  SELECT id, fundo_id, cedente_id INTO v_venda FROM public.notas_fiscais WHERE id = p_nota_fiscal_venda_id FOR UPDATE;
  IF v_venda.id IS NULL THEN
    RAISE EXCEPTION 'NF de venda nao encontrada';
  END IF;
  IF v_venda.fundo_id IS DISTINCT FROM v_integracao.fundo_id THEN
    RAISE EXCEPTION 'NF de venda fora do fundo da integracao (cross-fund deny)';
  END IF;

  IF p_nota_fiscal_remessa_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.nota_fiscal_remessas r
    WHERE r.id = p_nota_fiscal_remessa_id
      AND r.nota_fiscal_venda_id = p_nota_fiscal_venda_id
      AND r.status_validacao = 'VALIDADA'
  ) THEN
    RAISE EXCEPTION 'NF de remessa informada invalida para esta venda';
  END IF;

  -- Entrega mais recente da venda -- pode nao existir ainda (pre-
  -- desembolso). Nunca bloqueia por status_entrega (regra do ticket
  -- original): um comprovante pode legitimamente chegar depois da entrega
  -- ja estar 'entregue'.
  SELECT * INTO v_entrega
  FROM public.nota_fiscal_entregas
  WHERE nota_fiscal_id = p_nota_fiscal_venda_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_entrega.id IS NOT NULL THEN
    SELECT id INTO v_canhoto_aprovado_id FROM public.canhotos WHERE nota_fiscal_entrega_id = v_entrega.id AND status = 'aprovado' LIMIT 1;
    IF v_canhoto_aprovado_id IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'IGNORADO_CANHOTO_JA_APROVADO', 'canhoto_id', v_canhoto_aprovado_id, 'requisito_id', NULL);
    END IF;
  END IF;

  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  SELECT * INTO v_tipo FROM public.documento_tipos WHERE codigo = 'canhoto' AND ativo = true;
  IF v_tipo.id IS NULL OR lower(p_mime_type) <> ALL (SELECT lower(unnest(v_tipo.mime_types_aceitos))) THEN
    RAISE EXCEPTION 'Arquivo de comprovante em formato invalido';
  END IF;

  -- O arquivo e SEMPRE persistido a partir daqui -- com entrega ou sem
  -- (evidencia pre-desembolso), o comprovante nunca e descartado
  -- silenciosamente.
  INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
  VALUES (v_tipo.id, 'enviado', v_integracao.created_by)
  RETURNING id INTO v_doc_id;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256, status, enviado_por
  ) VALUES (
    v_doc_id, 1, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), 'em_analise', v_integracao.created_by
  ) RETURNING id INTO v_version_id;

  IF v_entrega.id IS NULL THEN
    -- Sem entrega ainda: preserva como evidencia pendente. Reconciliada
    -- automaticamente por private.reconciliar_comprovantes_pendentes_webhook
    -- quando desembolsar_operacao_com_logistica criar a entrega -- nunca
    -- depende de reenvio da transportadora.
    INSERT INTO public.webhook_comprovantes_entrega_pendentes (
      integracao_id, webhook_evento_id, fundo_id, provider, nota_fiscal_venda_id,
      nota_fiscal_remessa_id, tipo_vinculo, documento_id, documento_versao_id, cedente_id
    ) VALUES (
      p_integracao_id, p_webhook_evento_id, v_integracao.fundo_id, p_provider, p_nota_fiscal_venda_id,
      p_nota_fiscal_remessa_id, p_tipo_vinculo, v_doc_id, v_version_id, v_venda.cedente_id
    );
    RETURN jsonb_build_object('status', 'AGUARDANDO_ENTREGA', 'canhoto_id', NULL, 'requisito_id', NULL);
  END IF;

  RETURN private.vincular_comprovante_webhook_entrega(
    v_entrega.id, v_doc_id, v_version_id, p_nota_fiscal_remessa_id, v_venda.cedente_id, p_provider, p_webhook_evento_id
  );
END;
$$;

-- 5. Reconciliacao automatica das evidencias pendentes ---------------------

CREATE OR REPLACE FUNCTION private.reconciliar_comprovantes_pendentes_webhook(
  p_nota_fiscal_venda_id uuid,
  p_entrega_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pendente record;
  v_resultado jsonb;
  v_reconciliados integer := 0;
  v_erros integer := 0;
BEGIN
  FOR pendente IN
    SELECT * FROM public.webhook_comprovantes_entrega_pendentes
    WHERE nota_fiscal_venda_id = p_nota_fiscal_venda_id AND status = 'PENDENTE'
    ORDER BY criado_em ASC
    FOR UPDATE
  LOOP
    BEGIN
      v_resultado := private.vincular_comprovante_webhook_entrega(
        p_entrega_id, pendente.documento_id, pendente.documento_versao_id,
        pendente.nota_fiscal_remessa_id, pendente.cedente_id, pendente.provider, pendente.webhook_evento_id
      );
      UPDATE public.webhook_comprovantes_entrega_pendentes
      SET status = 'RECONCILIADO', canhoto_id = (v_resultado->>'canhoto_id')::uuid, reconciliado_em = now()
      WHERE id = pendente.id;
      v_reconciliados := v_reconciliados + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Um erro em uma evidencia pendente nunca aborta o desembolso nem as
      -- demais evidencias -- registra o erro e segue.
      UPDATE public.webhook_comprovantes_entrega_pendentes
      SET status = 'ERRO_RECONCILIACAO', erro_detalhe = SQLERRM, reconciliado_em = now()
      WHERE id = pendente.id;
      v_erros := v_erros + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('reconciliados', v_reconciliados, 'erros', v_erros);
END;
$$;

REVOKE ALL ON FUNCTION private.reconciliar_comprovantes_pendentes_webhook(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- 6. Gancho automatico: desembolsar_operacao_com_logistica -----------------
-- Corpo IDENTICO ao de 20260723165651_corrigir_requisitos_pos_cessao_snapshot.sql
-- (a versao atual/live), com UMA linha adicionada (reconciliacao) logo
-- apos o loop de requisitos pos-cessao de cada NF.

CREATE OR REPLACE FUNCTION public.desembolsar_operacao_com_logistica(p_operacao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  op record;
  escrow_saldo numeric;
  novo_saldo numeric;
  now_ts timestamptz := now();
  cria_entrega boolean;
  cte_prazo integer;
  comprovante_prazo integer;
  nf record;
  entrega_id uuid;
  inserted_deliveries integer := 0;
  inserted_requirements integer := 0;
  req record;
  req_prazo_limite date;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode desembolsar operacao';
  END IF;

  SELECT * INTO op FROM public.operacoes WHERE id = p_operacao_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Operacao nao encontrada'; END IF;
  IF op.status <> 'aprovada' THEN RAISE EXCEPTION 'Operacao nao esta aprovada para desembolso'; END IF;
  IF op.termo_assinado_url IS NULL THEN RAISE EXCEPTION 'Termo de cessao assinado ausente'; END IF;
  IF op.comprovante_pagamento_url IS NULL THEN RAISE EXCEPTION 'Comprovante de desembolso ausente'; END IF;
  IF op.politica_snapshot IS NULL OR op.politica_operacional_versao_id IS NULL THEN
    RAISE EXCEPTION 'Operacao sem snapshot de politica operacional';
  END IF;

  SELECT saldo_disponivel INTO escrow_saldo FROM public.contas_escrow WHERE id = op.conta_escrow_id FOR UPDATE;
  IF escrow_saldo IS NULL THEN RAISE EXCEPTION 'Conta escrow nao encontrada'; END IF;
  novo_saldo := escrow_saldo + op.valor_liquido_desembolso;

  cria_entrega := COALESCE((op.politica_snapshot->>'cria_acompanhamento_entrega')::boolean, false);

  SELECT min(NULLIF(item->>'prazo_dias_corridos', '')::integer)
    INTO cte_prazo
  FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
  WHERE COALESCE((item->>'ativo')::boolean, false)
    AND item->>'escopo' IN ('pos_cessao', 'entrega')
    AND COALESCE(item->>'tipo_documento_codigo', item->>'codigo') = 'cte'
    AND NULLIF(item->>'prazo_dias_corridos', '') IS NOT NULL;

  SELECT min(NULLIF(item->>'prazo_dias_corridos', '')::integer)
    INTO comprovante_prazo
  FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
  WHERE COALESCE((item->>'ativo')::boolean, false)
    AND item->>'escopo' IN ('pos_cessao', 'entrega')
    AND COALESCE(item->>'tipo_documento_codigo', item->>'codigo') IN ('canhoto', 'comprovante_entrega')
    AND NULLIF(item->>'prazo_dias_corridos', '') IS NOT NULL;

  UPDATE public.operacoes
  SET status = 'em_andamento',
      cessao_efetivada_em = COALESCE(cessao_efetivada_em, now_ts)
  WHERE id = p_operacao_id;

  UPDATE public.contas_escrow SET saldo_disponivel = novo_saldo WHERE id = op.conta_escrow_id;

  INSERT INTO public.movimentos_escrow (
    conta_escrow_id, tipo, descricao, valor, saldo_apos, operacao_id
  )
  VALUES (
    op.conta_escrow_id, 'credito',
    'Desembolso antecipacao - Operacao ' || substring(p_operacao_id::text from 1 for 8),
    op.valor_liquido_desembolso, novo_saldo, p_operacao_id
  );

  FOR nf IN
    SELECT n.id, n.cedente_id
    FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais n ON n.id = onf.nota_fiscal_id
    WHERE onf.operacao_id = p_operacao_id
    ORDER BY n.id
  LOOP
    INSERT INTO public.nota_fiscal_entregas (
      operacao_id, nota_fiscal_id, status_entrega, cessao_efetivada_em,
      data_limite_cte, data_limite_canhoto
    )
    VALUES (
      p_operacao_id, nf.id,
      CASE WHEN cria_entrega THEN 'em_transito' ELSE 'nao_aplicavel' END,
      now_ts,
      CASE WHEN cria_entrega AND cte_prazo IS NOT NULL THEN (now_ts::date + cte_prazo) ELSE NULL END,
      CASE WHEN cria_entrega AND comprovante_prazo IS NOT NULL THEN (now_ts::date + comprovante_prazo) ELSE NULL END
    )
    ON CONFLICT (operacao_id, nota_fiscal_id) DO UPDATE
      SET status_entrega = public.nota_fiscal_entregas.status_entrega
    RETURNING id INTO entrega_id;

    inserted_deliveries := inserted_deliveries + 1;
    PERFORM public.registrar_evento_entrega(
      entrega_id,
      'cessao_efetivada',
      NULL,
      CASE WHEN cria_entrega THEN 'em_transito' ELSE 'nao_aplicavel' END,
      'sistema',
      jsonb_build_object('operacao_id', p_operacao_id)
    );

    IF cria_entrega THEN
      FOR req IN
        SELECT
          COALESCE(NULLIF(item->>'id', '')::uuid, pr.id) AS politica_requisito_id,
          pr.politica_operacional_id,
          pr.politica_operacional_versao_id,
          COALESCE(NULLIF(item->>'documento_tipo_id', '')::uuid, pr.documento_tipo_id, dt.id) AS documento_tipo_id,
          item->>'codigo' AS codigo,
          COALESCE(item->>'tipo_documento_codigo', item->>'codigo') AS tipo_documento_codigo,
          item->>'escopo' AS escopo,
          COALESCE((item->>'obrigatorio')::boolean, pr.obrigatorio) AS obrigatorio,
          NULLIF(item->>'prazo_dias_corridos', '')::integer AS prazo_dias_corridos,
          COALESCE(
            CASE
              WHEN jsonb_typeof(item->'formatos_aceitos') = 'array'
                THEN ARRAY(SELECT jsonb_array_elements_text(item->'formatos_aceitos'))
              ELSE NULL
            END,
            pr.formatos_aceitos
          ) AS formatos_aceitos,
          COALESCE(NULLIF(item->>'nivel_validacao', ''), pr.nivel_validacao) AS nivel_validacao,
          COALESCE(NULLIF(item->>'quantidade_minima', '')::integer, pr.quantidade_minima) AS quantidade_minima,
          COALESCE(NULLIF(item->>'responsavel_upload', ''), pr.responsavel_upload) AS responsavel_upload,
          COALESCE(NULLIF(item->>'responsavel_aprovacao', ''), pr.responsavel_aprovacao) AS responsavel_aprovacao
        FROM jsonb_array_elements(COALESCE(op.politica_snapshot->'requisitos', '[]'::jsonb)) item
        JOIN public.politica_requisitos_documentais pr
          ON pr.politica_operacional_versao_id = op.politica_operacional_versao_id
         AND (
           pr.id = NULLIF(item->>'id', '')::uuid
           OR pr.codigo = item->>'codigo'
           OR pr.tipo_documento_codigo = COALESCE(item->>'tipo_documento_codigo', item->>'codigo')
         )
        LEFT JOIN public.documento_tipos dt
          ON dt.codigo = COALESCE(item->>'tipo_documento_codigo', item->>'codigo')
         AND dt.ativo = true
        WHERE COALESCE((item->>'ativo')::boolean, false)
          AND item->>'escopo' IN ('pos_cessao', 'entrega')
      LOOP
        req_prazo_limite := CASE
          WHEN req.prazo_dias_corridos IS NOT NULL THEN now_ts::date + req.prazo_dias_corridos
          ELSE NULL
        END;

        INSERT INTO public.documento_requisito_instancias (
          politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
          documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_entrega_id,
          cedente_id, status, obrigatorio, prazo_limite, formatos_aceitos_snapshot,
          nivel_validacao_snapshot, quantidade_minima_snapshot, responsavel_upload_snapshot,
          responsavel_aprovacao_snapshot
        )
        VALUES (
          req.politica_requisito_id, req.politica_operacional_id, req.politica_operacional_versao_id, op.politica_versao,
          req.documento_tipo_id, req.tipo_documento_codigo, req.escopo, entrega_id,
          op.cedente_id, 'pendente', req.obrigatorio, req_prazo_limite,
          req.formatos_aceitos, req.nivel_validacao, req.quantidade_minima,
          req.responsavel_upload, req.responsavel_aprovacao
        )
        ON CONFLICT (politica_requisito_id, nota_fiscal_entrega_id) DO UPDATE
          SET documento_tipo_id = COALESCE(documento_requisito_instancias.documento_tipo_id, EXCLUDED.documento_tipo_id),
              prazo_limite = COALESCE(documento_requisito_instancias.prazo_limite, EXCLUDED.prazo_limite);

        inserted_requirements := inserted_requirements + 1;

        PERFORM public.registrar_evento_entrega(
          entrega_id,
          CASE WHEN req.tipo_documento_codigo = 'cte' THEN 'cte_pendente' ELSE 'canhoto_pendente' END,
          'em_transito',
          'em_transito',
          'sistema',
          jsonb_build_object(
            'tipo_documento_codigo', req.tipo_documento_codigo,
            'prazo_limite', req_prazo_limite,
            'codigo_requisito', req.codigo,
            'fonte', 'politica_snapshot'
          )
        );
      END LOOP;
    END IF;

    -- Gap 1 (P0_Claude_Fechar_Webhook_Transportadora): reconcilia
    -- automaticamente qualquer evidencia de comprovante de transportadora
    -- que chegou ANTES desta entrega existir -- nunca depende de reenvio.
    PERFORM private.reconciliar_comprovantes_pendentes_webhook(nf.id, entrega_id);
  END LOOP;

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT c.user_id, 'Cessao efetivada',
         'A operacao ' || substring(p_operacao_id::text from 1 for 8) || ' foi desembolsada e a cessao foi efetivada.',
         'cessao_efetivada',
         'operacao:' || p_operacao_id::text || ':cessao_efetivada:' || c.user_id::text
  FROM public.cedentes c WHERE c.id = op.cedente_id
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object(
    'operacao_id', p_operacao_id,
    'saldo_apos', novo_saldo,
    'entregas', inserted_deliveries,
    'requisitos_pos_cessao', inserted_requirements,
    'cria_acompanhamento_entrega', cria_entrega,
    'fonte_requisitos', 'politica_snapshot'
  );
END;
$$;

COMMIT;
