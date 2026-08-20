BEGIN;

-- P0 (achado ao vivo pelo usuario, mesma raiz do ticket de acesso
-- delegado): dashboard_cedente_resumo (20260730152328_performance_
-- escopo7_dashboards_relatorios.sql:145) trava a autorizacao em
-- "c.user_id = auth.uid()" -- so o DONO do cedente. Um usuario convidado
-- via cedente_acessos (perfil administrador/operador) chegava ao
-- dashboard (apos o fix de middleware/CedenteLayout/carregarDashboardCedente),
-- mas a RPC lancava "Vinculo cedente-fundo nao autorizado" e a pagina
-- quebrava com "This page couldn't load".
--
-- Corpo reproduzido integralmente da versao vigente (lida por completo
-- antes de editar); a UNICA mudanca e a condicao de autorizacao, que passa
-- a aceitar tambem o cedente resolvido por get_user_cedente_id() (RPC
-- SECURITY DEFINER, ja usada nos demais pontos corrigidos neste mesmo
-- incidente -- resolve owner OU cedente_acessos ativo, sem depender de
-- GRANT em cedente_acessos, que e restrito a service_role).

CREATE OR REPLACE FUNCTION public.dashboard_cedente_resumo(p_cedente_fundo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF public.get_user_role() <> 'cedente'
     OR NOT EXISTS (
       SELECT 1
       FROM public.cedente_fundos cf
       JOIN public.cedentes c ON c.id = cf.cedente_id
       JOIN public.fundos f ON f.id = cf.fundo_id
       WHERE cf.id = p_cedente_fundo_id
         AND cf.status = 'ativo'
         AND c.id = public.get_user_cedente_id()
         AND f.ativo IS NOT FALSE
     )
  THEN
    RAISE EXCEPTION 'Vinculo cedente-fundo nao autorizado'
      USING ERRCODE = '42501';
  END IF;

  WITH contexto AS (
    SELECT cf.id AS cedente_fundo_id, c.id AS cedente_id, c.habilitar_escrow
    FROM public.cedente_fundos cf
    JOIN public.cedentes c ON c.id = cf.cedente_id
    WHERE cf.id = p_cedente_fundo_id
  ),
  operacoes_escopo AS (
    SELECT o.*
    FROM public.operacoes o
    JOIN contexto c ON c.cedente_fundo_id = o.cedente_fundo_id
  ),
  latest_docs AS (
    SELECT DISTINCT ON (d.tipo, d.representante_id)
      d.tipo, d.representante_id, d.status
    FROM public.documentos d
    JOIN contexto c ON c.cedente_id = d.cedente_id
    ORDER BY d.tipo, d.representante_id, d.versao DESC, d.id DESC
  ),
  escrow AS (
    SELECT ce.*
    FROM public.contas_escrow ce
    JOIN contexto c ON c.cedente_id = ce.cedente_id
    ORDER BY ce.created_at, ce.id
    LIMIT 1
  ),
  recentes AS (
    SELECT o.*
    FROM operacoes_escopo o
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'saldoDisponivel', COALESCE((SELECT saldo_disponivel FROM escrow), 0),
    'contaEscrow', (SELECT identificador FROM escrow),
    'habilitarEscrow', COALESCE((SELECT habilitar_escrow FROM contexto), FALSE),
    'nfsAprovadas', (
      SELECT count(*)
      FROM public.notas_fiscais nf
      WHERE nf.cedente_fundo_id = p_cedente_fundo_id
        AND nf.status::text = 'aprovada'
    ),
    'nfsTotal', (
      SELECT count(*)
      FROM public.notas_fiscais nf
      WHERE nf.cedente_fundo_id = p_cedente_fundo_id
    ),
    'opsAtivas', (SELECT count(*) FROM operacoes_escopo WHERE status::text = 'em_andamento'),
    'volumeAtivo', COALESCE((
      SELECT sum(valor_liquido_desembolso)
      FROM operacoes_escopo
      WHERE status::text = 'em_andamento'
    ), 0),
    'docsReprovados', (SELECT count(*) FROM latest_docs WHERE status::text = 'reprovado'),
    'operacoesRecentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'cedenteNome', '',
        'valorBruto', r.valor_bruto_total,
        'status', r.status::text,
        'aceiteSacadoExigido', r.aceite_sacado_exigido,
        'aceiteSacadoStatus', r.aceite_sacado_status::text,
        'dataVencimento', r.data_vencimento,
        'createdAt', r.created_at
      ) ORDER BY r.created_at DESC, r.id DESC)
      FROM recentes r
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMIT;
