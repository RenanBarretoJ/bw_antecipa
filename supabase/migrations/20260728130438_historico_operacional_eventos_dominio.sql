CREATE TABLE IF NOT EXISTS public.eventos_dominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  fundo_id uuid REFERENCES public.fundos(id) ON DELETE SET NULL,
  cedente_id uuid REFERENCES public.cedentes(id) ON DELETE SET NULL,
  cedente_fundo_id uuid REFERENCES public.cedente_fundos(id) ON DELETE SET NULL,
  nota_fiscal_id uuid REFERENCES public.notas_fiscais(id) ON DELETE SET NULL,
  operacao_id uuid REFERENCES public.operacoes(id) ON DELETE SET NULL,
  tipo_evento text NOT NULL,
  categoria text NOT NULL,
  ator_usuario_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ator_nome_snapshot text NOT NULL DEFAULT 'Sistema',
  ator_perfil_snapshot text NOT NULL DEFAULT 'Sistema',
  origem text NOT NULL DEFAULT 'app',
  descricao text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibilidade text NOT NULL DEFAULT 'ambos',
  correlation_id text,
  origem_evento text,
  origem_registro_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eventos_dominio_categoria_check CHECK (
    categoria IN ('documento', 'analise', 'aprovacao', 'reprovacao', 'operacao', 'integracao', 'desembolso', 'logistica', 'conclusao', 'sistema')
  ),
  CONSTRAINT eventos_dominio_visibilidade_check CHECK (
    visibilidade IN ('interno', 'cedente', 'ambos')
  ),
  CONSTRAINT eventos_dominio_entidade_check CHECK (
    num_nonnulls(nota_fiscal_id, operacao_id) >= 1
  )
);

COMMENT ON TABLE public.eventos_dominio IS 'Historico operacional unificado de Notas Fiscais e Operacoes. Nao substitui logs_auditoria, que permanece como trilha tecnica.';
COMMENT ON COLUMN public.eventos_dominio.metadata IS 'Resumo estruturado do evento. Nao armazenar segredo, token, senha, URL assinada ou stacktrace.';
COMMENT ON COLUMN public.eventos_dominio.visibilidade IS 'interno: somente gestor; cedente: somente cedente envolvido; ambos: gestor e cedente envolvido.';

CREATE INDEX IF NOT EXISTS idx_eventos_dominio_nf_created
  ON public.eventos_dominio(nota_fiscal_id, created_at DESC, id DESC)
  WHERE nota_fiscal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eventos_dominio_operacao_created
  ON public.eventos_dominio(operacao_id, created_at DESC, id DESC)
  WHERE operacao_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eventos_dominio_fundo_created
  ON public.eventos_dominio(fundo_id, created_at DESC, id DESC)
  WHERE fundo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eventos_dominio_cedente_created
  ON public.eventos_dominio(cedente_id, created_at DESC, id DESC)
  WHERE cedente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eventos_dominio_categoria_created
  ON public.eventos_dominio(categoria, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_eventos_dominio_correlation
  ON public.eventos_dominio(correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_eventos_dominio_origem
  ON public.eventos_dominio(origem_evento, origem_registro_id, tipo_evento)
  WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL;

ALTER TABLE public.eventos_dominio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eventos_dominio_gestor_select ON public.eventos_dominio;
CREATE POLICY eventos_dominio_gestor_select
  ON public.eventos_dominio
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'gestor'
    AND visibilidade IN ('interno', 'ambos')
    AND (
      fundo_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.usuario_fundos uf
        WHERE uf.usuario_id = (SELECT auth.uid())
          AND uf.fundo_id = eventos_dominio.fundo_id
          AND uf.status = 'ativo'
      )
    )
  );

DROP POLICY IF EXISTS eventos_dominio_cedente_select ON public.eventos_dominio;
CREATE POLICY eventos_dominio_cedente_select
  ON public.eventos_dominio
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'cedente'
    AND visibilidade IN ('cedente', 'ambos')
    AND cedente_id = public.get_user_cedente_id()
  );

DROP POLICY IF EXISTS eventos_dominio_insert ON public.eventos_dominio;
CREATE POLICY eventos_dominio_insert
  ON public.eventos_dominio
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.get_user_role() = 'gestor'
      AND (
        fundo_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.usuario_fundos uf
          WHERE uf.usuario_id = (SELECT auth.uid())
            AND uf.fundo_id = eventos_dominio.fundo_id
            AND uf.status = 'ativo'
        )
      )
    )
    OR (
      public.get_user_role() = 'cedente'
      AND cedente_id = public.get_user_cedente_id()
      AND visibilidade IN ('cedente', 'ambos')
    )
  );

GRANT SELECT, INSERT ON public.eventos_dominio TO authenticated;
GRANT ALL ON public.eventos_dominio TO service_role;

INSERT INTO public.eventos_dominio (
  tenant_id,
  fundo_id,
  cedente_id,
  cedente_fundo_id,
  nota_fiscal_id,
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
SELECT
  nf.fundo_id,
  nf.fundo_id,
  nf.cedente_id,
  nf.cedente_fundo_id,
  nf.id,
  'nota_fiscal_cadastrada',
  'operacao',
  NULL,
  'Sistema',
  'Sistema',
  'backfill',
  'Nota fiscal cadastrada no sistema.',
  jsonb_build_object(
    'numero_nf', nf.numero_nf,
    'valor_bruto', nf.valor_bruto,
    'status', nf.status
  ),
  'ambos',
  'notas_fiscais',
  nf.id::text,
  COALESCE(nf.created_at, now())
FROM public.notas_fiscais nf
ON CONFLICT (origem_evento, origem_registro_id, tipo_evento) WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
DO NOTHING;

INSERT INTO public.eventos_dominio (
  tenant_id,
  fundo_id,
  cedente_id,
  cedente_fundo_id,
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
SELECT
  nf_ctx.fundo_id,
  nf_ctx.fundo_id,
  o.cedente_id,
  o.cedente_fundo_id,
  o.id,
  'operacao_criada',
  'operacao',
  NULL,
  'Sistema',
  'Sistema',
  'backfill',
  'Operacao de antecipacao criada.',
  jsonb_build_object(
    'valor_bruto_total', o.valor_bruto_total,
    'valor_liquido_desembolso', o.valor_liquido_desembolso,
    'status', o.status,
    'quantidade_nfs', nf_ctx.quantidade_nfs
  ),
  'ambos',
  'operacoes',
  o.id::text,
  COALESCE(o.created_at, now())
FROM public.operacoes o
LEFT JOIN LATERAL (
  SELECT
    (array_agg(nf.fundo_id) FILTER (WHERE nf.fundo_id IS NOT NULL))[1] AS fundo_id,
    COUNT(*) AS quantidade_nfs
  FROM public.operacoes_nfs onf
  JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
  WHERE onf.operacao_id = o.id
) nf_ctx ON true
ON CONFLICT (origem_evento, origem_registro_id, tipo_evento) WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
DO NOTHING;

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
SELECT
  COALESCE(nf.fundo_id, nf_entrega.fundo_id, nf_operacao.fundo_id),
  COALESCE(nf.fundo_id, nf_entrega.fundo_id, nf_operacao.fundo_id),
  v.cedente_id,
  COALESCE(nf.cedente_fundo_id, nf_entrega.cedente_fundo_id, op.cedente_fundo_id),
  COALESCE(v.nota_fiscal_id, entrega.nota_fiscal_id),
  v.operacao_id,
  CASE
    WHEN dt.codigo = 'nf_xml' THEN 'xml_nfe_enviado'
    WHEN dt.codigo = 'nf_danfe_pdf' THEN 'danfe_enviado'
    WHEN dt.codigo = 'cte_xml' THEN 'cte_xml_enviado'
    WHEN dt.codigo = 'cte_dacte_pdf' THEN 'dacte_enviado'
    WHEN dt.codigo = 'canhoto' THEN 'canhoto_enviado'
    ELSE 'documento_enviado'
  END,
  CASE
    WHEN v.nota_fiscal_entrega_id IS NOT NULL OR dt.codigo IN ('cte_xml', 'cte_dacte_pdf', 'canhoto') THEN 'logistica'
    ELSE 'documento'
  END,
  dv.enviado_por,
  COALESCE(p.nome_completo, 'Usuario'),
  COALESCE(p.role::text, 'usuario'),
  'backfill',
  COALESCE(dt.nome, 'Documento') || ' enviado.',
  jsonb_build_object(
    'documento', COALESCE(dt.nome, dt.codigo),
    'tipo_documento', dt.codigo,
    'numero_versao', dv.numero_versao,
    'nome_arquivo', dv.nome_original,
    'status', dv.status
  ),
  'ambos',
  'documento_versoes',
  dv.id::text,
  COALESCE(dv.enviado_em, dv.created_at, now())
FROM public.documento_versoes dv
JOIN public.documentos_repositorio dr ON dr.id = dv.documento_id
JOIN public.documento_tipos dt ON dt.id = dr.documento_tipo_id
JOIN public.documento_vinculos v ON v.documento_id = dr.id
LEFT JOIN public.nota_fiscal_entregas entrega ON entrega.id = v.nota_fiscal_entrega_id
LEFT JOIN public.notas_fiscais nf ON nf.id = v.nota_fiscal_id
LEFT JOIN public.notas_fiscais nf_entrega ON nf_entrega.id = entrega.nota_fiscal_id
LEFT JOIN public.operacoes op ON op.id = v.operacao_id
LEFT JOIN LATERAL (
  SELECT (array_agg(nfo.fundo_id) FILTER (WHERE nfo.fundo_id IS NOT NULL))[1] AS fundo_id
  FROM public.operacoes_nfs onf
  JOIN public.notas_fiscais nfo ON nfo.id = onf.nota_fiscal_id
  WHERE onf.operacao_id = v.operacao_id
) nf_operacao ON true
LEFT JOIN public.profiles p ON p.id = dv.enviado_por
ON CONFLICT (origem_evento, origem_registro_id, tipo_evento) WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
DO NOTHING;
