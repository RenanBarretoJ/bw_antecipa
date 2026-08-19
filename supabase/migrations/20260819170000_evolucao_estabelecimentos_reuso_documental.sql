-- Evolucao de Estabelecimentos: reuso documental da Matriz, workflow de
-- analise de documentos de Filial/Matriz e gate de aprovacao de Filial.
--
-- Contexto: cedente_estabelecimento_requisitos (checklist cadastral por
-- estabelecimento) nao tem coluna de status propria -- "satisfeito" e
-- sempre derivado, nunca armazenado, para nao poder ficar desatualizado.
-- listar_requisitos_estabelecimento() e essa derivacao central; e usada
-- pela UI (Cedente/Gestor) e pelo gate de aprovacao de Filial abaixo.
--
-- Reuso documental da Matriz (2 do ticket): os 4 tipos cadastro_* do
-- catalogo (20260819150000) tem equivalentes exatos na tabela legada
-- documentos (onboarding do Cedente). Quando a Matriz nao tem upload
-- proprio para um requisito mas o Cedente ja tem o documento legado
-- aprovado, o requisito aparece satisfeito com origem 'cadastro_inicial'
-- -- sem copiar bytes, sem nova linha em documentos_repositorio/versoes.
-- Filial nunca herda documentos da Matriz (apenas Matriz reusa do
-- onboarding), conforme especificado.

BEGIN;

DROP FUNCTION IF EXISTS public.listar_requisitos_estabelecimento(uuid);

CREATE FUNCTION public.listar_requisitos_estabelecimento(p_estabelecimento_id uuid)
RETURNS TABLE (
  requisito_id uuid,
  documento_tipo_id uuid,
  documento_tipo_codigo text,
  documento_tipo_nome text,
  obrigatorio boolean,
  ativo boolean,
  status text,
  origem text,
  documento_versao_id uuid,
  numero_versao integer,
  nome_arquivo text,
  motivo text,
  analisado_por uuid,
  analisado_em timestamptz,
  documento_legado_id uuid,
  pendencia_pos_aprovacao boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estab public.cedente_estabelecimentos%ROWTYPE;
BEGIN
  SELECT * INTO v_estab FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id;
  IF v_estab.id IS NULL OR NOT (
    private.usuario_tem_acesso_cedente(v_estab.cedente_id)
    OR private.gestor_tem_acesso_cedente(v_estab.cedente_id)
  ) THEN RAISE EXCEPTION 'Estabelecimento nao encontrado'; END IF;

  RETURN QUERY
  SELECT
    r.id,
    dt.id,
    dt.codigo,
    dt.nome,
    r.obrigatorio,
    r.ativo,
    coalesce(dv.status, CASE WHEN legado.id IS NOT NULL THEN 'aprovado' ELSE 'pendente' END),
    CASE WHEN dv.status IS NOT NULL THEN 'estabelecimento' WHEN legado.id IS NOT NULL THEN 'cadastro_inicial' ELSE NULL END,
    dv.id,
    dv.numero_versao,
    dv.nome_original,
    ultima_analise.observacoes,
    ultima_analise.analisado_por,
    ultima_analise.analisado_em,
    legado.id,
    (
      -- O gate de aprovacao de Filial (decidir_estabelecimento_gestor) exige
      -- todo requisito obrigatorio/ativo satisfeito antes de aprovar; logo,
      -- um requisito obrigatorio insatisfeito num estabelecimento ja
      -- aprovado so pode existir se foi configurado (ou deixou de ser
      -- satisfeito) depois da aprovacao -- nao depende de comparar
      -- timestamps, que colapsam dentro de uma unica transacao.
      v_estab.status = 'aprovado'
      AND r.obrigatorio
      AND r.ativo
      AND dv.status IS DISTINCT FROM 'aprovado'
      AND legado.id IS NULL
    )
  FROM public.cedente_estabelecimento_requisitos r
  JOIN public.documento_tipos dt ON dt.id = r.documento_tipo_id
  LEFT JOIN LATERAL (
    SELECT dv2.*
    FROM public.documento_vinculos vinc
    JOIN public.documentos_repositorio dr ON dr.id = vinc.documento_id AND dr.documento_tipo_id = r.documento_tipo_id
    JOIN public.documento_versoes dv2 ON dv2.documento_id = dr.id
    WHERE vinc.estabelecimento_id = r.estabelecimento_id
    ORDER BY dv2.numero_versao DESC
    LIMIT 1
  ) dv ON true
  LEFT JOIN LATERAL (
    SELECT da.*
    FROM public.documento_analises da
    WHERE dv.id IS NOT NULL AND da.documento_versao_id = dv.id
    ORDER BY da.analisado_em DESC
    LIMIT 1
  ) ultima_analise ON true
  LEFT JOIN LATERAL (
    SELECT d.id
    FROM public.documentos d
    WHERE v_estab.tipo = 'matriz'
      AND dv.id IS NULL
      AND d.cedente_id = v_estab.cedente_id
      AND d.representante_id IS NULL
      AND d.status::text = 'aprovado'
      AND d.tipo::text = CASE dt.codigo
        WHEN 'estabelecimento_cartao_cnpj' THEN 'cartao_cnpj'
        WHEN 'estabelecimento_comprovante_endereco' THEN 'comprovante_endereco'
        WHEN 'estabelecimento_contrato_social' THEN 'contrato_social'
        WHEN 'estabelecimento_comprovante_faturamento' THEN 'extrato_bancario'
        ELSE NULL
      END
    ORDER BY d.versao DESC
    LIMIT 1
  ) legado ON true
  WHERE r.estabelecimento_id = p_estabelecimento_id
  ORDER BY r.ativo DESC, dt.nome;
END;
$function$;

REVOKE ALL ON FUNCTION public.listar_requisitos_estabelecimento(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.listar_requisitos_estabelecimento(uuid) TO authenticated;

-- Analise (aprovar/rejeitar/pedir ajuste) de documentos de Estabelecimento.
-- Reaproveita o motor generico ja existente (documento_analises, append-only,
-- resultado in aprovado/rejeitado/pendente/requer_ajuste) em vez de inventar
-- um segundo contrato: mesma tabela de auditoria, mesmas colunas
-- analisado_por/analisado_em/observacoes. Nao reaproveita a RPC
-- analisar_documento_versao diretamente porque essa RPC (a) so verifica
-- role='gestor' sem escopo de fundo e (b) tem efeitos colaterais especificos
-- de NF/entrega que nao se aplicam a este contexto.
CREATE OR REPLACE FUNCTION public.analisar_documento_estabelecimento_gestor(
  p_documento_versao_id uuid,
  p_resultado text,
  p_observacoes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_versao public.documento_versoes%ROWTYPE;
  v_vinculo public.documento_vinculos%ROWTYPE;
  v_analise_id uuid;
  v_novo_status text;
  v_evento text;
BEGIN
  IF (SELECT public.get_user_role()) <> 'gestor' THEN RAISE EXCEPTION 'Apenas gestor pode analisar documentos'; END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado', 'requer_ajuste') THEN RAISE EXCEPTION 'Resultado de analise invalido'; END IF;
  IF p_resultado IN ('rejeitado', 'requer_ajuste') AND length(trim(coalesce(p_observacoes, ''))) = 0 THEN
    RAISE EXCEPTION 'Motivo obrigatorio para rejeicao ou solicitacao de ajuste';
  END IF;

  SELECT * INTO v_versao FROM public.documento_versoes WHERE id = p_documento_versao_id;
  IF v_versao.id IS NULL THEN RAISE EXCEPTION 'Versao documental nao encontrada'; END IF;

  SELECT * INTO v_vinculo FROM public.documento_vinculos
  WHERE documento_id = v_versao.documento_id AND estabelecimento_id IS NOT NULL;
  IF v_vinculo.id IS NULL THEN RAISE EXCEPTION 'Documento nao pertence a um estabelecimento'; END IF;
  IF NOT private.gestor_tem_acesso_cedente(v_vinculo.cedente_id) THEN RAISE EXCEPTION 'Acesso negado a este Cedente'; END IF;
  IF v_versao.status = 'aprovado' THEN RAISE EXCEPTION 'Versao aprovada e imutavel'; END IF;

  INSERT INTO public.documento_analises (documento_versao_id, resultado, analisado_por, observacoes)
  VALUES (p_documento_versao_id, p_resultado, auth.uid(), p_observacoes)
  RETURNING id INTO v_analise_id;

  v_novo_status := CASE p_resultado WHEN 'aprovado' THEN 'aprovado' WHEN 'rejeitado' THEN 'rejeitado' ELSE 'em_analise' END;
  UPDATE public.documento_versoes SET status = v_novo_status WHERE id = p_documento_versao_id;
  UPDATE public.documentos_repositorio SET status = v_novo_status WHERE id = v_versao.documento_id;

  v_evento := CASE p_resultado
    WHEN 'aprovado' THEN 'DOCUMENTO_ESTABELECIMENTO_APROVADO'
    WHEN 'rejeitado' THEN 'DOCUMENTO_ESTABELECIMENTO_REJEITADO'
    ELSE 'DOCUMENTO_ESTABELECIMENTO_AJUSTE_SOLICITADO'
  END;
  INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (auth.uid(), 'usuario', 'gestor_estabelecimentos', v_evento, 'documento_versoes', p_documento_versao_id,
    jsonb_build_object('cedente_id', v_vinculo.cedente_id, 'estabelecimento_id', v_vinculo.estabelecimento_id,
      'resultado', p_resultado, 'motivo', p_observacoes));

  RETURN jsonb_build_object('analise_id', v_analise_id, 'versao_id', p_documento_versao_id, 'status', v_novo_status,
    'cedente_id', v_vinculo.cedente_id, 'estabelecimento_id', v_vinculo.estabelecimento_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.analisar_documento_estabelecimento_gestor(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analisar_documento_estabelecimento_gestor(uuid, text, text) TO authenticated;

-- configurar_requisito_estabelecimento_gestor passa a informar se a
-- configuracao criou uma pendencia documental pos-aprovacao (estabelecimento
-- ja aprovado + requisito obrigatorio/ativo ainda nao satisfeito), para a
-- action TypeScript decidir se notifica o Cedente. Assinatura de retorno
-- muda de ROWTYPE para jsonb: precisa DROP porque CREATE OR REPLACE nao
-- permite alterar o tipo de retorno.
DROP FUNCTION IF EXISTS public.configurar_requisito_estabelecimento_gestor(uuid, uuid, boolean, boolean, text);

CREATE FUNCTION public.configurar_requisito_estabelecimento_gestor(
  p_estabelecimento_id uuid,
  p_documento_tipo_id uuid,
  p_obrigatorio boolean,
  p_ativo boolean,
  p_observacoes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estab public.cedente_estabelecimentos%ROWTYPE;
  v_result public.cedente_estabelecimento_requisitos%ROWTYPE;
  v_pendencia boolean;
BEGIN
  SELECT * INTO v_estab FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id;
  IF v_estab.id IS NULL OR NOT private.gestor_tem_acesso_cedente(v_estab.cedente_id) THEN RAISE EXCEPTION 'Estabelecimento nao encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documento_tipos WHERE id = p_documento_tipo_id AND ativo) THEN RAISE EXCEPTION 'Tipo documental invalido'; END IF;

  INSERT INTO public.cedente_estabelecimento_requisitos (
    estabelecimento_id, documento_tipo_id, obrigatorio, ativo, observacoes, configurado_por
  ) VALUES (p_estabelecimento_id, p_documento_tipo_id, p_obrigatorio, p_ativo, p_observacoes, auth.uid())
  ON CONFLICT (estabelecimento_id, documento_tipo_id) DO UPDATE
    SET obrigatorio = EXCLUDED.obrigatorio, ativo = EXCLUDED.ativo,
        observacoes = EXCLUDED.observacoes, configurado_por = EXCLUDED.configurado_por
  RETURNING * INTO v_result;

  SELECT req.pendencia_pos_aprovacao INTO v_pendencia
  FROM public.listar_requisitos_estabelecimento(p_estabelecimento_id) req
  WHERE req.requisito_id = v_result.id;

  RETURN jsonb_build_object(
    'requisito', to_jsonb(v_result),
    'pendencia_pos_aprovacao', coalesce(v_pendencia, false),
    'cedente_id', v_estab.cedente_id,
    'estabelecimento_status', v_estab.status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.configurar_requisito_estabelecimento_gestor(uuid, uuid, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configurar_requisito_estabelecimento_gestor(uuid, uuid, boolean, boolean, text) TO authenticated;

-- Gate de aprovacao de Filial (5 do ticket): decidir_estabelecimento_gestor
-- ja checava Matriz aprovada+ativa; passa a exigir tambem Cedente ativo,
-- checklist obrigatorio satisfeito e conta bancaria principal ativa antes de
-- aprovar uma Filial. Mensagens prefixadas com codigo estavel (ANTES do
-- ':') para a UI distinguir o motivo do bloqueio sem parsing fragil.
-- Aprovacao de Matriz mantem o gate original (Cedente ativo apenas): a
-- Matriz costuma ser aprovada antes do checklist ser configurado pelo
-- Gestor (fluxo de onboarding ja validado em tickets anteriores), e este
-- ticket especifica o gate apenas para Filial.
CREATE OR REPLACE FUNCTION public.decidir_estabelecimento_gestor(
  p_estabelecimento_id uuid,
  p_acao text,
  p_motivo text DEFAULT NULL
)
RETURNS public.cedente_estabelecimentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_atual public.cedente_estabelecimentos%ROWTYPE;
  v_result public.cedente_estabelecimentos%ROWTYPE;
  v_evento text;
BEGIN
  SELECT * INTO v_atual FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id FOR UPDATE;
  IF v_atual.id IS NULL OR NOT private.gestor_tem_acesso_cedente(v_atual.cedente_id) THEN RAISE EXCEPTION 'Estabelecimento nao encontrado'; END IF;
  IF p_acao NOT IN ('aprovar', 'rejeitar', 'suspender', 'reativar') THEN RAISE EXCEPTION 'Acao invalida'; END IF;
  IF p_acao IN ('rejeitar', 'suspender') AND length(trim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Motivo obrigatorio'; END IF;

  IF v_atual.tipo = 'matriz' AND p_acao = 'aprovar' AND NOT EXISTS (
    SELECT 1 FROM public.cedentes c WHERE c.id = v_atual.cedente_id AND c.status::text = 'ativo'
  ) THEN RAISE EXCEPTION 'CEDENTE_INATIVO: O Cedente precisa estar ativo para aprovar a Matriz'; END IF;

  IF p_acao IN ('aprovar', 'reativar') AND v_atual.tipo = 'filial' AND NOT EXISTS (
    SELECT 1 FROM public.cedente_estabelecimentos m
    WHERE m.id = v_atual.matriz_estabelecimento_id AND m.status = 'aprovado' AND m.ativo
  ) THEN RAISE EXCEPTION 'MATRIZ_NAO_APROVADA: A Matriz precisa estar aprovada e ativa'; END IF;

  IF v_atual.tipo = 'filial' AND p_acao = 'aprovar' THEN
    IF NOT EXISTS (SELECT 1 FROM public.cedentes c WHERE c.id = v_atual.cedente_id AND c.status::text = 'ativo') THEN
      RAISE EXCEPTION 'CEDENTE_INATIVO: O Cedente precisa estar ativo para aprovar a Filial';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.listar_requisitos_estabelecimento(p_estabelecimento_id) req
      WHERE req.ativo AND req.obrigatorio AND req.status <> 'aprovado'
    ) THEN RAISE EXCEPTION 'DOCUMENTOS_OBRIGATORIOS_PENDENTES: Existem documentos obrigatorios pendentes de aprovacao'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.cedente_estabelecimento_contas_bancarias
      WHERE estabelecimento_id = p_estabelecimento_id AND principal AND ativo
    ) THEN RAISE EXCEPTION 'CONTA_BANCARIA_PENDENTE: E necessario cadastrar a conta bancaria principal da Filial'; END IF;
  END IF;

  UPDATE public.cedente_estabelecimentos
  SET status = CASE p_acao WHEN 'aprovar' THEN 'aprovado' WHEN 'rejeitar' THEN 'rejeitado' WHEN 'suspender' THEN 'suspenso' ELSE 'aprovado' END,
      ativo = p_acao NOT IN ('rejeitar', 'suspender'),
      motivo_status = CASE WHEN p_acao IN ('rejeitar', 'suspender') THEN trim(p_motivo) ELSE NULL END,
      aprovado_por = CASE WHEN p_acao IN ('aprovar', 'reativar') THEN auth.uid() ELSE aprovado_por END,
      aprovado_em = CASE WHEN p_acao IN ('aprovar', 'reativar') THEN now() ELSE aprovado_em END,
      suspenso_por = CASE WHEN p_acao = 'suspender' THEN auth.uid() ELSE NULL END,
      suspenso_em = CASE WHEN p_acao = 'suspender' THEN now() ELSE NULL END
  WHERE id = p_estabelecimento_id RETURNING * INTO v_result;

  v_evento := CASE p_acao WHEN 'aprovar' THEN 'ESTABELECIMENTO_APROVADO' WHEN 'rejeitar' THEN 'ESTABELECIMENTO_REJEITADO'
    WHEN 'suspender' THEN 'ESTABELECIMENTO_SUSPENSO' ELSE 'ESTABELECIMENTO_REATIVADO' END;
  INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois)
  VALUES (auth.uid(), 'usuario', 'gestor_estabelecimentos', v_evento, 'cedente_estabelecimentos', v_result.id,
    jsonb_build_object('cedente_id', v_atual.cedente_id, 'status', v_atual.status, 'ativo', v_atual.ativo),
    jsonb_build_object('cedente_id', v_result.cedente_id, 'status', v_result.status, 'ativo', v_result.ativo, 'motivo', p_motivo));
  RETURN v_result;
END;
$function$;

COMMIT;
