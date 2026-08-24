-- P1 Claude: Super Admin -- gestao da integracao de transportadora e
-- Bearer Token (ticket P1_Claude_Super_Admin_Integracao_Transportadora).
--
-- Migration corretiva/incremental (as duas anteriores do webhook ja foram
-- aplicadas em homolog). Nao edita nada anterior no lugar -- so
-- CREATE OR REPLACE FUNCTION, ALTER TABLE, e CREATE TABLE novo.
--
-- 1. HISTORICO DE TOKEN: antes, o hash do token vivia direto em
--    integracoes_transportadoras.token_hash (1 token, sem historico, sem
--    revogacao/rotacao dedicada). Agora integracoes_transportadoras_tokens
--    guarda uma linha por token (ativo/substituido/revogado), no MESMO
--    formato de historico de credenciais_integracao (rascunho->ativa->
--    substituida/revogada, uma unica linha 'ativo' por integracao via
--    indice unico parcial) -- mas com uma diferenca deliberada: o token
--    continua SHA-256 one-way (nunca criptografado/reversivel, ao
--    contrario de usuario_criptografado/senha_criptografada de
--    credenciais_integracao, que sao AES-256-GCM porque precisam ser
--    reenviadas a APIs externas). O token webhook nunca precisa ser
--    "relembrado" pela plataforma -- so validado por igualdade de hash.
--    token_display (ultimos 4 caracteres do token em texto puro,
--    calculado uma unica vez na criacao/rotacao) permite a UI mostrar
--    "•••• ab12" sem nunca reter nada recuperavel.
--
-- 2. PROVISIONAMENTO GLOBAL: novas RPCs
--    admin_ativar_integracao_transportadora,
--    admin_rotacionar_token_integracao_transportadora,
--    admin_revogar_token_integracao_transportadora,
--    admin_listar_integracoes_transportadoras,
--    admin_listar_webhook_eventos_transportadora,
--    admin_obter_webhook_evento_transportadora -- todas Super Admin-only
--    (private.usuario_e_super_admin()), GRANT EXECUTE TO authenticated
--    (mesmo padrao de todo o resto da superficie admin: o gate real e
--    dentro do corpo da funcao, nao no GRANT).
--
-- 3. FRESH TOTP: as acoes sensiveis (criar/ativar/desativar integracao,
--    rotacionar/revogar token, reprocessar evento) precisam do mesmo
--    step-up de TOTP fresco (autorizarEConsumirAcaoSensivel) usado em
--    SA1/SA2/SA3 -- adicionadas a lista fechada de
--    autorizacoes_acoes_sensiveis.action_type e ao IN-list espelhado
--    dentro de criar_autorizacao_acao_sensivel (terceiro espelho e o
--    array TypeScript ACAO_SENSIVEL_TIPOS em src/lib/auth/mfa.ts).
--
-- 4. REPROCESSAMENTO REAL (corrigido pelo ticket
--    P0_Claude_Retencao_Reprocessamento_Webhook_Transportadora, ainda
--    dentro desta mesma migration -- ela NUNCA chegou a ser aplicada em
--    homolog, entao foi ajustada no lugar em vez de virar uma 4a
--    migration corretiva, por instrucao explicita do ticket). A versao
--    original deste arquivo retinha o arquivo so DEPOIS da resolucao —
--    ou seja, nunca para NAO_IDENTIFICADO/REVISAO_MATCH (resolvidos antes
--    do upload) nem para ERRO_REPROCESSAVEL (o path de erro generico
--    sempre limpava o objeto orfao) — reduzindo "reprocessar" a um
--    diagnostico sem arquivo (EVIDENCIA_INDISPONIVEL). Corrigido: o
--    orquestrador agora envia o arquivo para o Storage e grava
--    bucket/path/tamanho_bytes/persisted_at no PROPRIO evento do inbox
--    IMEDIATAMENTE apos o insert idempotente -- ANTES de qualquer
--    matching. Nunca depende do sucesso do matching para preservar o
--    arquivo. Ver colunas novas em integracao_logistica_webhook_eventos
--    abaixo. `EVIDENCIA_INDISPONIVEL` deixa de ser um resultado normal de
--    reprocessamento -- fica so como fallback para eventos legados
--    (anteriores a esta correcao) que genuinamente nao tem arquivo
--    retido.
--
-- 5. RETRY EXTERNO x IDEMPOTENCIA (corrigido pelo ticket
--    P0_Claude_Fechar_Retry_Webhook_Transportadora, mesma migration ainda
--    nao aplicada). O tratamento de 23505 (unique_violation na
--    idempotency_key) antes SEMPRE devolvia DUPLICADO, mesmo quando o
--    evento existente estava travado em NAO_IDENTIFICADO/REVISAO_MATCH/
--    ERRO_REPROCESSAVEL -- um retry legitimo da transportadora nunca
--    chegava a se beneficiar de uma NF cadastrada depois, por exemplo.
--    Corrigido: esses tres status agora acionam
--    reprocessarWebhookComprovanteTransportadora no MESMO evento (nunca
--    cria uma segunda inbox, nunca reenvia o arquivo) antes de responder
--    ao retry. PROCESSADO/AGUARDANDO_ENTREGA/IGNORADO_CANHOTO_JA_APROVADO/
--    ERRO_FINAL continuam so devolvendo o resultado existente (nunca
--    reprocessados -- o primeiro e o ultimo sao permanentes, os dois do
--    meio ja tem o vinculo/evidencia registrados e reprocessar de novo
--    nao mudaria nada).
--
-- 6. `evidencia_retida` agora reflete bucket/path (nao mais so
--    persisted_at). Quando IGNORADO_CANHOTO_JA_APROVADO remove o binario
--    do Storage (arquivo redundante -- ja ha canhoto aprovado por outra
--    via), bucket/path do evento sao zerados nesse mesmo instante (TS) --
--    sha256/mime/tamanho/persisted_at permanecem intactos para
--    auditoria. Sem isso, evidencia_retida ficaria `true` mesmo com o
--    arquivo fisicamente apagado (persisted_at nunca era limpo).

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.usuario_e_super_admin()') IS NULL
     OR to_regclass('public.integracoes_transportadoras') IS NULL
     OR to_regclass('public.integracao_logistica_webhook_eventos') IS NULL THEN
    RAISE EXCEPTION 'P1 depende de SA1 (private.usuario_e_super_admin) e do P0 do webhook de transportadora.';
  END IF;
END;
$$;

-- 1. Historico de token -----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integracoes_transportadoras_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id uuid NOT NULL REFERENCES public.integracoes_transportadoras(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  token_display text,
  status text NOT NULL DEFAULT 'ativo',
  criado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  criado_em timestamptz NOT NULL DEFAULT now(),
  substituido_por uuid REFERENCES public.integracoes_transportadoras_tokens(id) ON DELETE SET NULL,
  revogado_em timestamptz,
  revogado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  motivo_revogacao text,
  CONSTRAINT integracoes_transportadoras_tokens_status_check CHECK (status IN ('ativo', 'substituido', 'revogado')),
  CONSTRAINT integracoes_transportadoras_tokens_hash_unique UNIQUE (token_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_integracoes_transportadoras_tokens_ativo
  ON public.integracoes_transportadoras_tokens (integracao_id) WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_integracoes_transportadoras_tokens_integracao
  ON public.integracoes_transportadoras_tokens (integracao_id);

COMMENT ON TABLE public.integracoes_transportadoras_tokens IS
  'Historico de tokens de webhook por integracao de transportadora -- uma linha por token gerado (ativo/substituido/revogado), no formato de credenciais_integracao. token_hash e SHA-256 one-way (nunca criptografia reversivel: o token nunca precisa ser relembrado pela plataforma). Leitura restrita a RPCs Super Admin (metadados mascarados apenas); nenhuma policy de SELECT direta para authenticated -- gestor nunca ve nem hash nem display.';

ALTER TABLE public.integracoes_transportadoras_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integracoes_transportadoras_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.integracoes_transportadoras_tokens TO service_role;

-- Migra qualquer token_hash existente para o historico antes de remover a
-- coluna antiga (defensivo -- este repositorio nunca chegou a provisionar
-- uma integracao real via admin_criar_integracao_transportadora ainda,
-- mas a migracao dos dados nunca deve depender dessa suposicao).
INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, status, criado_por, criado_em)
SELECT id, token_hash, CASE WHEN ativo THEN 'ativo' ELSE 'revogado' END, created_by, created_at
FROM public.integracoes_transportadoras
WHERE token_hash IS NOT NULL
ON CONFLICT (token_hash) DO NOTHING;

ALTER TABLE public.integracoes_transportadoras DROP CONSTRAINT IF EXISTS integracoes_transportadoras_token_hash_unique;
ALTER TABLE public.integracoes_transportadoras DROP COLUMN IF EXISTS token_hash;

-- 2. Provisionamento: criar (atualizado para o historico), ativar, desativar (inalterado) --

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
  v_display text;
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

  v_token := encode(digest(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_display := right(v_token, 4);

  INSERT INTO public.integracoes_transportadoras (fundo_id, provider, nome, cnpj_transportadora, created_by)
  VALUES (p_fundo_id, p_provider, p_nome, v_cnpj_limpo, actor_id)
  RETURNING id INTO v_id;

  INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, token_display, status, criado_por)
  VALUES (v_id, v_hash, v_display, 'ativo', actor_id);

  RETURN jsonb_build_object('integracao_id', v_id, 'token', v_token, 'token_display', v_display);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_ativar_integracao_transportadora(p_integracao_id uuid)
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
  UPDATE public.integracoes_transportadoras SET ativo = true, updated_at = now() WHERE id = p_integracao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ativar_integracao_transportadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ativar_integracao_transportadora(uuid) TO authenticated;

-- 3. Ciclo de vida do token: rotacionar / revogar ---------------------------

CREATE OR REPLACE FUNCTION public.admin_rotacionar_token_integracao_transportadora(p_integracao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_token text;
  v_hash text;
  v_display text;
  v_old_id uuid;
  v_new_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integracoes_transportadoras WHERE id = p_integracao_id) THEN
    RAISE EXCEPTION 'Integracao nao encontrada';
  END IF;

  v_token := encode(digest(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_display := right(v_token, 4);

  -- Libera o slot 'ativo' (indice unico parcial) ANTES de inserir o novo
  -- token -- nunca ha dois tokens ativos simultaneos, nem por 1 instrucao.
  UPDATE public.integracoes_transportadoras_tokens
  SET status = 'substituido'
  WHERE integracao_id = p_integracao_id AND status = 'ativo'
  RETURNING id INTO v_old_id;

  INSERT INTO public.integracoes_transportadoras_tokens (integracao_id, token_hash, token_display, status, criado_por)
  VALUES (p_integracao_id, v_hash, v_display, 'ativo', actor_id)
  RETURNING id INTO v_new_id;

  IF v_old_id IS NOT NULL THEN
    UPDATE public.integracoes_transportadoras_tokens SET substituido_por = v_new_id WHERE id = v_old_id;
  END IF;

  RETURN jsonb_build_object('token', v_token, 'token_display', v_display);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_rotacionar_token_integracao_transportadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_rotacionar_token_integracao_transportadora(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revogar_token_integracao_transportadora(
  p_integracao_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.integracoes_transportadoras_tokens
  SET status = 'revogado', revogado_em = now(), revogado_por = actor_id, motivo_revogacao = p_motivo
  WHERE integracao_id = p_integracao_id AND status = 'ativo'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Nao ha token ativo para revogar nesta integracao';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revogar_token_integracao_transportadora(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revogar_token_integracao_transportadora(uuid, text) TO authenticated;

-- 4. Listagem/observabilidade (Super Admin) ---------------------------------

CREATE OR REPLACE FUNCTION public.admin_listar_integracoes_transportadoras()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'nome_fundo', item->>'provider'), '[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', it.id,
      'fundo_id', it.fundo_id,
      'nome_fundo', f.nome,
      'provider', it.provider,
      'nome', it.nome,
      'cnpj_transportadora', it.cnpj_transportadora,
      'ativo', it.ativo,
      'created_at', it.created_at,
      'token_status', tok.status,
      'token_display', tok.token_display,
      'token_criado_em', tok.criado_em,
      'ultimo_recebimento_em', ev.ultimo_recebimento_em,
      'ultimo_processamento_ok_em', ev.ultimo_processamento_ok_em,
      'eventos_com_erro_7d', coalesce(ev.eventos_com_erro_7d, 0)
    ) AS item
    FROM public.integracoes_transportadoras it
    JOIN public.fundos f ON f.id = it.fundo_id
    LEFT JOIN public.integracoes_transportadoras_tokens tok
      ON tok.integracao_id = it.id AND tok.status = 'ativo'
    LEFT JOIN LATERAL (
      SELECT
        max(e.recebido_em) AS ultimo_recebimento_em,
        max(e.processado_em) FILTER (WHERE e.status = 'PROCESSADO') AS ultimo_processamento_ok_em,
        count(*) FILTER (
          WHERE e.status IN ('ERRO_REPROCESSAVEL', 'ERRO_FINAL', 'REVISAO_MATCH', 'NAO_IDENTIFICADO', 'EVIDENCIA_INDISPONIVEL')
            AND e.recebido_em > now() - interval '7 days'
        ) AS eventos_com_erro_7d
      FROM public.integracao_logistica_webhook_eventos e
      WHERE e.integracao_id = it.id
    ) ev ON true
  ) rows;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_integracoes_transportadoras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_integracoes_transportadoras() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_listar_webhook_eventos_transportadora(
  p_fundo_id uuid DEFAULT NULL,
  p_integracao_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_chave_nfe text DEFAULT NULL,
  p_chave_cte text DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_ate timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(coalesce(p_offset, 0), 0);
  v_items jsonb;
  v_total bigint;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.integracao_logistica_webhook_eventos e
  WHERE (p_fundo_id IS NULL OR e.fundo_id = p_fundo_id)
    AND (p_integracao_id IS NULL OR e.integracao_id = p_integracao_id)
    AND (p_status IS NULL OR e.status = p_status)
    AND (p_chave_nfe IS NULL OR e.chave_nfe = p_chave_nfe)
    AND (p_chave_cte IS NULL OR e.chave_cte = p_chave_cte)
    AND (p_desde IS NULL OR e.recebido_em >= p_desde)
    AND (p_ate IS NULL OR e.recebido_em <= p_ate);

  SELECT coalesce(jsonb_agg(item), '[]'::jsonb) INTO v_items
  FROM (
    SELECT jsonb_build_object(
      'id', e.id,
      'recebido_em', e.recebido_em,
      'processado_em', e.processado_em,
      'provider', e.provider,
      'fundo_id', e.fundo_id,
      'integracao_id', e.integracao_id,
      'chave_nfe', e.chave_nfe,
      'chave_cte', e.chave_cte,
      'status', e.status,
      'nota_fiscal_venda_id', e.nota_fiscal_venda_id,
      'nota_fiscal_remessa_id', e.nota_fiscal_remessa_id,
      'match_metodo', e.match_metodo,
      'erro_codigo', e.erro_codigo,
      'erro_detalhe', e.erro_detalhe,
      'evidencia_retida', (e.bucket IS NOT NULL AND e.path IS NOT NULL)
    ) AS item
    FROM public.integracao_logistica_webhook_eventos e
    WHERE (p_fundo_id IS NULL OR e.fundo_id = p_fundo_id)
      AND (p_integracao_id IS NULL OR e.integracao_id = p_integracao_id)
      AND (p_status IS NULL OR e.status = p_status)
      AND (p_chave_nfe IS NULL OR e.chave_nfe = p_chave_nfe)
      AND (p_chave_cte IS NULL OR e.chave_cte = p_chave_cte)
      AND (p_desde IS NULL OR e.recebido_em >= p_desde)
      AND (p_ate IS NULL OR e.recebido_em <= p_ate)
    ORDER BY e.recebido_em DESC
    LIMIT v_limit OFFSET v_offset
  ) rows;

  RETURN jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_listar_webhook_eventos_transportadora(uuid, uuid, text, text, text, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_listar_webhook_eventos_transportadora(uuid, uuid, text, text, text, timestamptz, timestamptz, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_obter_webhook_evento_transportadora(p_webhook_evento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento record;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_evento FROM public.integracao_logistica_webhook_eventos WHERE id = p_webhook_evento_id;
  IF v_evento.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Nunca inclui Base64/token -- nenhuma dessas colunas existe nesta
  -- tabela (o payload nunca e persistido, so metadados e hashes).
  RETURN jsonb_build_object(
    'id', v_evento.id,
    'integracao_id', v_evento.integracao_id,
    'fundo_id', v_evento.fundo_id,
    'provider', v_evento.provider,
    'external_event_id', v_evento.external_event_id,
    'status', v_evento.status,
    'tentativa_count', v_evento.tentativa_count,
    'chave_nfe', v_evento.chave_nfe,
    'chave_cte', v_evento.chave_cte,
    'cnpj_cliente', v_evento.cnpj_cliente,
    'cnpj_emitente', v_evento.cnpj_emitente,
    'cnpj_transportadora', v_evento.cnpj_transportadora,
    'data_emissao_nfe', v_evento.data_emissao_nfe,
    'data_entrega_nfe', v_evento.data_entrega_nfe,
    'content_type', v_evento.content_type,
    'nota_fiscal_venda_id', v_evento.nota_fiscal_venda_id,
    'nota_fiscal_remessa_id', v_evento.nota_fiscal_remessa_id,
    'cte_id', v_evento.cte_id,
    'tipo_vinculo', v_evento.tipo_vinculo,
    'match_metodo', v_evento.match_metodo,
    'match_confianca', v_evento.match_confianca,
    'canhoto_id', v_evento.canhoto_id,
    'erro_codigo', v_evento.erro_codigo,
    'erro_detalhe', v_evento.erro_detalhe,
    'recebido_em', v_evento.recebido_em,
    'processado_em', v_evento.processado_em,
    'evidencia_retida', (v_evento.bucket IS NOT NULL AND v_evento.path IS NOT NULL),
    'persisted_at', v_evento.persisted_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_obter_webhook_evento_transportadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_webhook_evento_transportadora(uuid) TO authenticated;

-- 5. Retencao de evidencia no proprio evento + novo status de fallback ----
--
-- bucket/path/tamanho_bytes/persisted_at guardam ONDE o arquivo recebido
-- foi salvo -- preenchidos pelo orquestrador logo apos o insert
-- idempotente do evento, ANTES do matching. imagem_sha256 (P0) e
-- content_type (P0) ja cobrem hash/mime; nome_original e recalculado
-- deterministicamente (comprovante-<id>.<ext>) e nao precisa de coluna
-- propria. Nulos = evento legado sem retencao (anterior a esta correcao)
-- OU evento que nunca chegou a ter arquivo valido (ERRO_FINAL antes do
-- upload -- mime real incompativel, verificado antes de qualquer escrita).

ALTER TABLE public.integracao_logistica_webhook_eventos
  ADD COLUMN IF NOT EXISTS bucket text,
  ADD COLUMN IF NOT EXISTS path text,
  ADD COLUMN IF NOT EXISTS tamanho_bytes bigint,
  ADD COLUMN IF NOT EXISTS persisted_at timestamptz;

ALTER TABLE public.integracao_logistica_webhook_eventos
  DROP CONSTRAINT IF EXISTS integracao_logistica_webhook_eventos_status_check;
ALTER TABLE public.integracao_logistica_webhook_eventos
  ADD CONSTRAINT integracao_logistica_webhook_eventos_status_check CHECK (status IN (
    'RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'DUPLICADO', 'NAO_IDENTIFICADO',
    'REVISAO_MATCH', 'IGNORADO_CANHOTO_JA_APROVADO', 'AGUARDANDO_ENTREGA',
    'ERRO_REPROCESSAVEL', 'ERRO_FINAL', 'EVIDENCIA_INDISPONIVEL'
  ));

-- 6. Fresh TOTP: registra as novas acoes sensiveis na lista fechada --------

ALTER TABLE public.autorizacoes_acoes_sensiveis
  DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis
  ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (
    action_type = ANY (ARRAY[
      'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
      'encerrar_outras_sessoes', 'reset_mfa_administrativo',
      'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
      'ativar_credencial_integracao', 'revogar_credencial_integracao',
      'criar_fundo', 'atualizar_fundo_estrutural',
      'ativar_fundo', 'desativar_fundo',
      'convidar_usuario_admin', 'vincular_gestor_fundo',
      'revogar_gestor_fundo', 'reativar_gestor_fundo',
      'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin',
      'criar_integracao_versao', 'publicar_integracao',
      'desativar_integracao', 'testar_integracao',
      'atualizar_cnab', 'atualizar_codigo_originador',
      'publicar_base_financeira', 'confirmar_match_manual',
      'revogar_match_manual', 'revisar_risco_operacao',
      'criar_integracao_transportadora', 'ativar_integracao_transportadora',
      'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
      'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora'
    ])
  );

CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
RETURNS TABLE (expira_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  BEGIN
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao Supabase invalida';
  END;

  IF p_action_type IS NULL OR p_action_type NOT IN (
    'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao', 'revogar_credencial_integracao',
    'criar_fundo', 'atualizar_fundo_estrutural',
    'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo',
    'revogar_gestor_fundo', 'reativar_gestor_fundo',
    'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin',
    'criar_integracao_versao', 'publicar_integracao',
    'desativar_integracao', 'testar_integracao',
    'atualizar_cnab', 'atualizar_codigo_originador',
    'publicar_base_financeira', 'confirmar_match_manual',
    'revogar_match_manual', 'revisar_risco_operacao',
    'criar_integracao_transportadora', 'ativar_integracao_transportadora',
    'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
    'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de acao sensivel invalido';
  END IF;

  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nonce invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
     WHERE estado.status = 'valid' AND estado.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao MFA de 24 horas invalida';
  END IF;

  INSERT INTO public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) VALUES (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );

  RETURN QUERY SELECT v_agora + interval '5 minutes';
END;
$$;

COMMIT;
