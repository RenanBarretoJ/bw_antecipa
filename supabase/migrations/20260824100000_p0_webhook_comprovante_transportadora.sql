-- P0 Claude: webhook provider-agnostic de transportadora para ingestao
-- automatica de comprovante de entrega (ticket
-- P0_Claude_Webhook_Transportadora_Comprovante_Entrega).
--
-- Reutiliza integralmente a camada canonica de comprovante/canhoto ja
-- existente (canhotos, documento_requisito_instancias, documento_versoes) --
-- nenhum modelo paralelo. So foi necessario criar:
--   1. integracoes_transportadoras: identidade minima (fundo + provider +
--      hash do token) -- nao existia NENHUM mecanismo de autenticacao de
--      chamador externo por token neste repositorio (o sistema de
--      integracoes_fundo existente e todo para chamadas DE SAIDA ao
--      Sinqia/Portal FIDC, nao para autenticar quem chama a plataforma).
--   2. integracao_logistica_webhook_eventos: inbox/idempotencia (nenhuma
--      infraestrutura de fila/outbox existe neste repositorio -- todo
--      processamento aqui e sincrono dentro da mesma requisicao, ver
--      docs/integracoes/webhook-comprovante-transportadora.md secao
--      "Processamento" para o trade-off documentado).
--   3. registrar_comprovante_entrega_webhook: um NOVO ponto de entrada na
--      MESMA camada canonica (canhotos/documento_requisito_instancias),
--      necessario porque registrar_canhoto_documento exige auth.uid() +
--      actor_role IN ('cedente','gestor') -- inexistente numa chamada de
--      service_role sem sessao de usuario. O corpo desta funcao e
--      deliberadamente o MESMO insert (documentos_repositorio ->
--      documento_versoes -> documento_vinculos -> canhotos ->
--      documento_requisito_instancias) de registrar_canhoto_documento,
--      apenas com a checagem de autorizacao trocada (integracao ativa do
--      MESMO fundo da venda, nao auth.uid()) e SEM o bloqueio por
--      status_entrega (regra explicita do ticket: nao bloquear por status
--      da NF/operacao -- um comprovante de transportadora frequentemente
--      chega DEPOIS da entrega ja estar 'entregue', que e exatamente o
--      caso mais comum, nao uma excecao).
--
-- criado_por/enviado_por (NOT NULL nas tabelas canonicas, sem precedente de
-- ator "sistema" nesta base) sao preenchidos com
-- integracoes_transportadoras.created_by -- o gestor que provisionou a
-- integracao -- nunca NULL, nunca um perfil sintetico novo. A origem real
-- (INTEGRACAO_TRANSPORTADORA + provider + webhook_evento_id) fica
-- registrada em eventos_entrega.dados (ator_tipo='integracao', valor ja
-- suportado pelo CHECK existente de eventos_entrega).

BEGIN;

-- 1. Identidade da integracao (fundo + provider + token) -------------------

CREATE TABLE IF NOT EXISTS public.integracoes_transportadoras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE CASCADE,
  provider text NOT NULL,
  nome text,
  token_hash text NOT NULL,
  cnpj_transportadora text,
  ativo boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracoes_transportadoras_provider_check CHECK (provider ~ '^[a-z0-9_-]{2,64}$'),
  CONSTRAINT integracoes_transportadoras_cnpj_check CHECK (cnpj_transportadora IS NULL OR cnpj_transportadora ~ '^[0-9]{14}$'),
  CONSTRAINT integracoes_transportadoras_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_integracoes_transportadoras_fundo_provider
  ON public.integracoes_transportadoras (fundo_id, provider)
  WHERE ativo;

COMMENT ON TABLE public.integracoes_transportadoras IS
  'Identidade minima de uma integracao de webhook de transportadora: um token (hash SHA-256, nunca plaintext apos a criacao) escopado a exatamente um fundo e um provider. Toda escrita de comprovante via webhook precisa resolver uma linha ativa aqui antes de tocar qualquer NF -- e o que garante cross-fund deny.';

ALTER TABLE public.integracoes_transportadoras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integracoes_transportadoras_gestor_select ON public.integracoes_transportadoras;
CREATE POLICY integracoes_transportadoras_gestor_select ON public.integracoes_transportadoras
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(integracoes_transportadoras.fundo_id)));

REVOKE ALL ON public.integracoes_transportadoras FROM PUBLIC, anon;
GRANT SELECT ON public.integracoes_transportadoras TO authenticated;

-- RPC de provisionamento: gestor com acesso ao fundo cria uma integracao e
-- recebe o token em texto puro EXATAMENTE uma vez (no retorno desta
-- chamada) -- depois disso, apenas o hash persiste, nunca recuperavel.
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
  IF actor_id IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode provisionar integracao de transportadora';
  END IF;
  IF NOT private.usuario_tem_acesso_fundo(p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
  END IF;
  IF p_provider !~ '^[a-z0-9_-]{2,64}$' THEN
    RAISE EXCEPTION 'Provider invalido -- use apenas letras minusculas, digitos, hifen e underscore';
  END IF;

  -- Entropia forte: dois UUIDs aleatorios + timestamp de alta resolucao,
  -- reduzidos por SHA-256 -- mesmo idioma de gen_random_uuid()+digest()
  -- ja usado neste repositorio para tokens/hashes (nao ha precedente de
  -- gen_random_bytes aqui, entao seguimos o padrao existente).
  v_token := encode(digest(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'sha256'), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO public.integracoes_transportadoras (fundo_id, provider, nome, token_hash, cnpj_transportadora, created_by)
  VALUES (p_fundo_id, p_provider, p_nome, v_hash, v_cnpj_limpo, actor_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('integracao_id', v_id, 'token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_criar_integracao_transportadora(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_criar_integracao_transportadora(uuid, text, text, text) TO authenticated;

-- RPC de desativacao (revogar sem apagar historico/auditoria).
CREATE OR REPLACE FUNCTION public.admin_desativar_integracao_transportadora(p_integracao_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  v_fundo_id uuid;
BEGIN
  IF actor_id IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode desativar integracao de transportadora';
  END IF;
  SELECT fundo_id INTO v_fundo_id FROM public.integracoes_transportadoras WHERE id = p_integracao_id;
  IF v_fundo_id IS NULL THEN
    RAISE EXCEPTION 'Integracao nao encontrada';
  END IF;
  IF NOT private.usuario_tem_acesso_fundo(v_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao autorizado para o gestor autenticado';
  END IF;
  UPDATE public.integracoes_transportadoras SET ativo = false, updated_at = now() WHERE id = p_integracao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_desativar_integracao_transportadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desativar_integracao_transportadora(uuid) TO authenticated;

-- 2. Inbox / idempotencia ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integracao_logistica_webhook_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_id uuid NOT NULL REFERENCES public.integracoes_transportadoras(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provider text NOT NULL,
  external_event_id text,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  imagem_sha256 text,
  chave_nfe text,
  chave_cte text,
  cnpj_cliente text,
  cnpj_emitente text,
  cnpj_transportadora text,
  data_emissao_nfe date,
  data_entrega_nfe date,
  content_type text,
  status text NOT NULL DEFAULT 'RECEBIDO',
  tentativa_count integer NOT NULL DEFAULT 0,
  nota_fiscal_venda_id uuid REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
  nota_fiscal_remessa_id uuid REFERENCES public.nota_fiscal_remessas(id) ON DELETE SET NULL,
  cte_id uuid REFERENCES public.ctes(id) ON DELETE SET NULL,
  tipo_vinculo text,
  match_metodo text,
  match_confianca text,
  canhoto_id uuid REFERENCES public.canhotos(id) ON DELETE SET NULL,
  erro_codigo text,
  erro_detalhe text,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  CONSTRAINT integracao_logistica_webhook_eventos_status_check CHECK (status IN (
    'RECEBIDO', 'PROCESSANDO', 'PROCESSADO', 'DUPLICADO', 'NAO_IDENTIFICADO',
    'REVISAO_MATCH', 'IGNORADO_CANHOTO_JA_APROVADO', 'AGUARDANDO_ENTREGA',
    'ERRO_REPROCESSAVEL', 'ERRO_FINAL'
  )),
  CONSTRAINT integracao_logistica_webhook_eventos_tipo_vinculo_check CHECK (
    tipo_vinculo IS NULL OR tipo_vinculo IN ('DIRETO_VENDA', 'VIA_REMESSA')
  ),
  CONSTRAINT integracao_logistica_webhook_eventos_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT integracao_logistica_webhook_eventos_external_unique UNIQUE (integracao_id, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_integracao_logistica_webhook_eventos_chave_nfe
  ON public.integracao_logistica_webhook_eventos (chave_nfe);
CREATE INDEX IF NOT EXISTS idx_integracao_logistica_webhook_eventos_chave_cte
  ON public.integracao_logistica_webhook_eventos (chave_cte);
CREATE INDEX IF NOT EXISTS idx_integracao_logistica_webhook_eventos_venda
  ON public.integracao_logistica_webhook_eventos (nota_fiscal_venda_id);
CREATE INDEX IF NOT EXISTS idx_integracao_logistica_webhook_eventos_fundo_status
  ON public.integracao_logistica_webhook_eventos (fundo_id, status);

COMMENT ON TABLE public.integracao_logistica_webhook_eventos IS
  'Inbox/idempotencia dos webhooks de comprovante de entrega recebidos de transportadoras. UNIQUE(idempotency_key) garante que um retry nunca cria um segundo documento; UNIQUE(integracao_id, external_event_id) reforca isso quando o provider manda um id de evento (NULLs nao colidem entre si, permitindo eventos sem external_event_id).';

ALTER TABLE public.integracao_logistica_webhook_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integracao_logistica_webhook_eventos_gestor_select ON public.integracao_logistica_webhook_eventos;
CREATE POLICY integracao_logistica_webhook_eventos_gestor_select ON public.integracao_logistica_webhook_eventos
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(integracao_logistica_webhook_eventos.fundo_id)));

REVOKE ALL ON public.integracao_logistica_webhook_eventos FROM PUBLIC, anon;
GRANT SELECT ON public.integracao_logistica_webhook_eventos TO authenticated;
-- Escrita (INSERT/UPDATE) so via service_role (o endpoint do webhook usa o
-- client admin) -- nenhuma policy de escrita para authenticated/anon.
GRANT INSERT, UPDATE ON public.integracao_logistica_webhook_eventos TO service_role;

-- 3. Registro canonico do comprovante, via service_role ---------------------
--
-- Mesma sequencia de inserts de registrar_canhoto_documento (documentos_
-- repositorio -> documento_versoes -> documento_vinculos -> canhotos ->
-- documento_requisito_instancias), com 3 diferencas deliberadas:
--   a) autorizacao por integracao ativa do mesmo fundo, nao auth.uid();
--   b) NUNCA bloqueia por status_entrega (regra explicita do ticket);
--   c) se nao existe NENHUMA entrega para a venda ainda (comum pre-
--      desembolso), retorna AGUARDANDO_ENTREGA sem criar nada -- nao
--      inventa uma entrega nova aqui (fora de escopo deste ticket, ver
--      docs/integracoes/webhook-comprovante-transportadora.md).
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
  v_requisito_id uuid;
  v_tipo record;
  v_doc_id uuid;
  v_version_id uuid;
  v_canhoto_id uuid;
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

  -- Cross-fund deny: a venda tem que pertencer ao MESMO fundo da
  -- integracao que autenticou a chamada -- nunca confia no que o chamador
  -- (rota HTTP) ja calculou, revalida aqui (defesa em profundidade, mesmo
  -- padrao dos demais RPCs deste dominio).
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
  -- desembolso). Nunca bloqueia por status_entrega (regra do ticket): um
  -- comprovante pode legitimamente chegar depois da entrega ja estar
  -- 'entregue', que e o caso mais comum, nao uma excecao.
  SELECT * INTO v_entrega
  FROM public.nota_fiscal_entregas
  WHERE nota_fiscal_id = p_nota_fiscal_venda_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_entrega.id IS NULL THEN
    RETURN jsonb_build_object('status', 'AGUARDANDO_ENTREGA', 'canhoto_id', NULL, 'requisito_id', NULL);
  END IF;

  -- Ja existe canhoto aprovado? Nunca substitui, nunca cria versao nova.
  SELECT id INTO v_canhoto_aprovado_id FROM public.canhotos WHERE nota_fiscal_entrega_id = v_entrega.id AND status = 'aprovado' LIMIT 1;
  IF v_canhoto_aprovado_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'IGNORADO_CANHOTO_JA_APROVADO', 'canhoto_id', v_canhoto_aprovado_id, 'requisito_id', NULL);
  END IF;

  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  SELECT * INTO v_tipo FROM public.documento_tipos WHERE codigo = 'canhoto' AND ativo = true;
  IF v_tipo.id IS NULL OR lower(p_mime_type) <> ALL (SELECT lower(unnest(v_tipo.mime_types_aceitos))) THEN
    RAISE EXCEPTION 'Arquivo de comprovante em formato invalido';
  END IF;

  -- Requisito do checklist e opcional aqui -- a politica pode nao ter
  -- configurado comprovante_entrega/canhoto para esta NF; o comprovante e
  -- registrado mesmo assim (auditavel), so nao ha requisito para vincular.
  SELECT id INTO v_requisito_id
  FROM public.documento_requisito_instancias
  WHERE nota_fiscal_entrega_id = v_entrega.id
    AND tipo_documento_codigo_snapshot IN ('canhoto', 'comprovante_entrega', 'comprovante_de_entrega')
    AND status NOT IN ('cancelado', 'dispensado')
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
  VALUES (v_tipo.id, 'enviado', v_integracao.created_by)
  RETURNING id INTO v_doc_id;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256, status, enviado_por
  ) VALUES (
    v_doc_id, 1, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), 'em_analise', v_integracao.created_by
  ) RETURNING id INTO v_version_id;

  INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id)
  VALUES (v_doc_id, v_entrega.id, v_venda.cedente_id);

  -- Nunca 'aprovado' -- um comprovante vindo da transportadora sempre
  -- entra como 'em_analise', igual a qualquer outro canhoto; so a gestora
  -- aprova, via analisar_canhoto_documento (inalterado).
  INSERT INTO public.canhotos (
    nota_fiscal_entrega_id, status, recebido_em, documento_id, documento_versao_atual_id, nota_fiscal_remessa_id
  ) VALUES (
    v_entrega.id, 'em_analise', now(), v_doc_id, v_version_id, p_nota_fiscal_remessa_id
  ) RETURNING id INTO v_canhoto_id;

  IF v_requisito_id IS NOT NULL THEN
    UPDATE public.documento_requisito_instancias
    SET documento_id = v_doc_id, status = 'pendente', versao_aprovada_id = NULL, satisfeito_em = NULL
    WHERE id = v_requisito_id;
  END IF;

  PERFORM public.registrar_evento_entrega(
    v_entrega.id, 'canhoto_enviado', v_entrega.status_entrega, v_entrega.status_entrega, 'integracao',
    jsonb_build_object(
      'canhoto_id', v_canhoto_id, 'versao_id', v_version_id, 'nota_fiscal_remessa_id', p_nota_fiscal_remessa_id,
      'origem', 'INTEGRACAO_TRANSPORTADORA', 'provider', p_provider, 'webhook_evento_id', p_webhook_evento_id
    )
  );

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT pf.id, 'Comprovante de entrega recebido', 'Um comprovante foi recebido automaticamente da transportadora e aguarda analise.', 'canhoto_enviado',
         'canhoto:' || v_canhoto_id::text || ':enviado:' || pf.id::text
  FROM public.profiles pf WHERE pf.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object(
    'status', 'PROCESSADO', 'canhoto_id', v_canhoto_id, 'documento_id', v_doc_id,
    'versao_id', v_version_id, 'requisito_id', v_requisito_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_comprovante_entrega_webhook(uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_comprovante_entrega_webhook(uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, text)
  TO service_role;

COMMIT;
