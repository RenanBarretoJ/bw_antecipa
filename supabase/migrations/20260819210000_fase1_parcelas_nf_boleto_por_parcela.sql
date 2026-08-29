-- Fase 1 (Parcelas de NF + Boleto por Parcela + Precificacao por Vencimento):
-- modelo canonico de parcelas, extracao do XML e boleto por parcela.
--
-- Contexto: uma NF-e pode trazer varias <dup> (duplicata) no XML, cada uma
-- com vencimento e valor proprios. Ate aqui o parser (src/lib/nf-parser.ts)
-- so aproveitava a data da ULTIMA <dup> como data_vencimento agregada da
-- NF; nDup/vDup de cada parcela eram descartados. notas_fiscais continua
-- com um unico valor_bruto/data_vencimento (compatibilidade), mas a partir
-- desta migration a granularidade real fica em nota_fiscal_parcelas.
--
-- Decisao de diagnostico: existe hoje um modulo adjacente "duplicatas"
-- (20260811120000_p2_0_duplicata_ativo_financeiro.sql) com forma parecida
-- (parcela/vencimento/valor por linha), mas e um conceito DIFERENTE --
-- alimentado por upload manual de PDF + OCR de uma Duplicata Mercantil,
-- ativo so quando a politica usa tipo_ativo_financeiro='DUPLICATA_MERCANTIL'
-- (modo alternativo), sem nenhum vinculo com documento_vinculos, precificacao,
-- CNAB, liquidacao, conciliacao ou exposicao. Nao e reaproveitavel sem
-- conflar dois conceitos distintos; por isso esta migration cria a entidade
-- canonica nova pedida no ticket, sem tocar em "duplicatas".

BEGIN;

-- ============================================================
-- 1. Entidade canonica de parcela
-- ============================================================

CREATE TABLE public.nota_fiscal_parcelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  numero_parcela integer NOT NULL,
  valor_nominal numeric(15,2) NOT NULL,
  data_vencimento date NOT NULL,
  origem text NOT NULL DEFAULT 'xml_nfe',
  status text NOT NULL DEFAULT 'disponivel',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nota_fiscal_parcelas_numero_check CHECK (numero_parcela > 0),
  CONSTRAINT nota_fiscal_parcelas_valor_check CHECK (valor_nominal > 0),
  CONSTRAINT nota_fiscal_parcelas_origem_check CHECK (origem IN ('xml_nfe', 'manual')),
  CONSTRAINT nota_fiscal_parcelas_status_check CHECK (status IN ('disponivel', 'em_operacao', 'liquidada', 'cancelada')),
  CONSTRAINT nota_fiscal_parcelas_unique UNIQUE (nota_fiscal_id, numero_parcela)
);

CREATE INDEX idx_nota_fiscal_parcelas_nf ON public.nota_fiscal_parcelas(nota_fiscal_id, status);

CREATE TRIGGER nota_fiscal_parcelas_updated_at
  BEFORE UPDATE ON public.nota_fiscal_parcelas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.nota_fiscal_parcelas ENABLE ROW LEVEL SECURITY;

-- Mesmo padrao de leitura ja usado em notas_fiscais: Cedente ve as proprias,
-- Gestor multifundo via helper ja existente, consultor vinculado.
CREATE POLICY nota_fiscal_parcelas_cedente_select ON public.nota_fiscal_parcelas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = nota_fiscal_parcelas.nota_fiscal_id
        AND (
          nf.cedente_id = (SELECT public.get_user_cedente_id())
          OR ((SELECT public.get_user_role()) = 'consultor' AND EXISTS (
            SELECT 1 FROM public.consultor_cedente cc WHERE cc.consultor_id = (SELECT auth.uid()) AND cc.cedente_id = nf.cedente_id
          ))
        )
    )
  );

CREATE POLICY nota_fiscal_parcelas_gestor_multifundo_select ON public.nota_fiscal_parcelas
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notas_fiscais nf
      WHERE nf.id = nota_fiscal_parcelas.nota_fiscal_id
        AND (SELECT public.get_user_role()) = 'gestor'
        AND private.gestor_tem_acesso_cedente(nf.cedente_id)
    )
  );

GRANT SELECT ON public.nota_fiscal_parcelas TO authenticated;
GRANT ALL ON public.nota_fiscal_parcelas TO service_role;

-- ============================================================
-- 2. RPC de registro em lote (bulk insert com tolerancia monetaria)
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_parcelas_nota_fiscal(
  p_nota_fiscal_id uuid,
  p_parcelas jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nf public.notas_fiscais%ROWTYPE;
  v_item jsonb;
  v_soma numeric(15,2) := 0;
  v_tolerancia numeric(15,2);
  v_inseridas integer := 0;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR (SELECT public.get_user_role()) NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar parcelas';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF v_nf.id IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF (SELECT public.get_user_role()) = 'cedente' AND v_nf.cedente_id <> (SELECT public.get_user_cedente_id()) THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF (SELECT public.get_user_role()) = 'gestor' AND NOT private.gestor_tem_acesso_cedente(v_nf.cedente_id) THEN
    RAISE EXCEPTION 'Gestor sem vinculo ativo com o fundo desta nota fiscal';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas WHERE nota_fiscal_id = p_nota_fiscal_id) THEN
    RAISE EXCEPTION 'Nota fiscal ja possui parcelas registradas';
  END IF;
  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Lista de parcelas invalida';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    IF NOT (v_item ? 'numero_parcela' AND v_item ? 'valor_nominal' AND v_item ? 'data_vencimento') THEN
      RAISE EXCEPTION 'Parcela com campos obrigatorios ausentes';
    END IF;
    INSERT INTO public.nota_fiscal_parcelas (nota_fiscal_id, numero_parcela, valor_nominal, data_vencimento, origem)
    VALUES (
      p_nota_fiscal_id,
      (v_item->>'numero_parcela')::integer,
      (v_item->>'valor_nominal')::numeric,
      (v_item->>'data_vencimento')::date,
      coalesce(v_item->>'origem', 'xml_nfe')
    );
    v_soma := v_soma + (v_item->>'valor_nominal')::numeric;
    v_inseridas := v_inseridas + 1;
  END LOOP;

  -- Tolerancia monetaria segura: 1 centavo por parcela (absorve arredondamento
  -- de vDup no XML), com piso de 1 centavo.
  v_tolerancia := greatest(v_inseridas * 0.01, 0.01);
  IF abs(v_soma - v_nf.valor_bruto) > v_tolerancia THEN
    RAISE EXCEPTION 'Soma das parcelas (%) nao corresponde ao valor bruto da nota fiscal (%)', v_soma, v_nf.valor_bruto;
  END IF;

  RETURN jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id, 'parcelas_inseridas', v_inseridas, 'soma', v_soma);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_parcelas_nota_fiscal(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_parcelas_nota_fiscal(uuid, jsonb) TO authenticated;

COMMIT;
