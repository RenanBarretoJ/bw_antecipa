-- P0 Claude: melhora observabilidade dos eventos do webhook de comprovante
-- de transportadora (request/response sanitizados para diagnostico de
-- MIME_REAL_INCOMPATIVEL e afins) e corrige o horario exibido na UI (o
-- banco ja armazena timestamptz/UTC corretamente -- o bug e so na
-- formatacao client-side, sem timeZone explicito; corrigido em TS, nao
-- aqui).
--
-- request_payload/response_payload sao construidos e sanitizados no
-- backend TS (construirRequestPayloadSanitizado em
-- webhook-comprovante-transportadora-payload.ts) ANTES de chegar aqui --
-- nunca contem imagem_base64 completa, Authorization/Bearer, cookies ou
-- qualquer segredo. As colunas em si nao adicionam nenhuma restricao nova
-- de conteudo (jsonb generico), a garantia de sanitizacao e uma
-- responsabilidade do codigo que escreve, coberta por testes dedicados.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.integracao_logistica_webhook_eventos') IS NULL
    OR to_regprocedure('public.admin_obter_webhook_evento_transportadora(uuid)') IS NULL
  THEN
    RAISE EXCEPTION 'Dependencias obrigatorias ausentes: integracao_logistica_webhook_eventos ou admin_obter_webhook_evento_transportadora (aplicar migrations do webhook de transportadora primeiro).';
  END IF;
END $$;

ALTER TABLE public.integracao_logistica_webhook_eventos
  ADD COLUMN IF NOT EXISTS request_payload jsonb,
  ADD COLUMN IF NOT EXISTS response_payload jsonb,
  ADD COLUMN IF NOT EXISTS response_http_status integer,
  ADD COLUMN IF NOT EXISTS respondido_em timestamptz;

COMMENT ON COLUMN public.integracao_logistica_webhook_eventos.request_payload IS
  'Snapshot sanitizado do request recebido (chaves/CNPJs/datas/tamanhos/hash/magic bytes/headers em allowlist) -- nunca imagem_base64 completa nem Authorization/Bearer/cookies. Somente Super Admin le via admin_obter_webhook_evento_transportadora.';
COMMENT ON COLUMN public.integracao_logistica_webhook_eventos.response_payload IS
  'Copia sanitizada do JSON efetivamente devolvido ao carrier (mesmo contrato de resposta da rota) -- nunca stack trace ou segredo.';

-- Espelha exatamente o retorno ao carrier: somente a resposta FINAL da
-- rota (apos processarWebhookComprovanteTransportadora resolver um
-- webhook_evento_id real) e persistida -- respostas de autenticacao/
-- validacao anteriores ao INSERT do inbox (401/400 sem evento criado) nao
-- tem linha para anexar e continuam so no log de aplicacao, como hoje.
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
  -- request_payload/response_payload ja chegam sanitizados de fabrica.
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
    'respondido_em', v_evento.respondido_em,
    'evidencia_retida', (v_evento.bucket IS NOT NULL AND v_evento.path IS NOT NULL),
    'persisted_at', v_evento.persisted_at,
    'request_payload', v_evento.request_payload,
    'response_payload', v_evento.response_payload,
    'response_http_status', v_evento.response_http_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_obter_webhook_evento_transportadora(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_obter_webhook_evento_transportadora(uuid) TO authenticated;

COMMIT;
