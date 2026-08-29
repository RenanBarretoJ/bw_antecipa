-- Multi-CNPJ do Cedente: Matriz, Filiais, contas, checklist e origem de NFs.
-- Compatibilidade: public.cedentes.cnpj permanece como CNPJ principal/Matriz.
-- FUTURE_DECISION_RULE_1: esta migration nao decide se uma operacao pode conter
-- NFs de estabelecimentos diferentes do mesmo Cedente.

BEGIN;

CREATE TABLE public.cedente_estabelecimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  cnpj text NOT NULL,
  razao_social text NOT NULL,
  nome_fantasia text,
  tipo text NOT NULL,
  matriz_estabelecimento_id uuid REFERENCES public.cedente_estabelecimentos(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pendente',
  motivo_status text,
  aprovado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  aprovado_em timestamptz,
  suspenso_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  suspenso_em timestamptz,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cedente_estabelecimentos_cnpj_formato_check CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT cedente_estabelecimentos_tipo_check CHECK (tipo IN ('matriz', 'filial')),
  CONSTRAINT cedente_estabelecimentos_status_check CHECK (status IN ('rascunho', 'pendente', 'aprovado', 'rejeitado', 'suspenso')),
  CONSTRAINT cedente_estabelecimentos_hierarquia_check CHECK (
    (tipo = 'matriz' AND matriz_estabelecimento_id IS NULL)
    OR (tipo = 'filial' AND matriz_estabelecimento_id IS NOT NULL)
  ),
  CONSTRAINT cedente_estabelecimentos_decisao_check CHECK (
    (status = 'aprovado' AND aprovado_em IS NOT NULL)
    OR status <> 'aprovado'
  ),
  CONSTRAINT cedente_estabelecimentos_suspensao_check CHECK (
    (status = 'suspenso' AND suspenso_em IS NOT NULL AND length(trim(coalesce(motivo_status, ''))) > 0)
    OR status <> 'suspenso'
  ),
  CONSTRAINT cedente_estabelecimentos_rejeicao_check CHECK (
    (status = 'rejeitado' AND length(trim(coalesce(motivo_status, ''))) > 0)
    OR status <> 'rejeitado'
  )
);

CREATE UNIQUE INDEX cedente_estabelecimentos_cnpj_unique
  ON public.cedente_estabelecimentos(cnpj);
CREATE UNIQUE INDEX cedente_estabelecimentos_uma_matriz_por_cedente
  ON public.cedente_estabelecimentos(cedente_id) WHERE tipo = 'matriz';
CREATE INDEX cedente_estabelecimentos_cedente_status_idx
  ON public.cedente_estabelecimentos(cedente_id, status, ativo);
CREATE INDEX cedente_estabelecimentos_matriz_idx
  ON public.cedente_estabelecimentos(matriz_estabelecimento_id) WHERE matriz_estabelecimento_id IS NOT NULL;

CREATE TRIGGER cedente_estabelecimentos_updated_at
  BEFORE UPDATE ON public.cedente_estabelecimentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION private.validar_cedente_estabelecimento()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_matriz public.cedente_estabelecimentos%ROWTYPE;
BEGIN
  NEW.cnpj := regexp_replace(coalesce(NEW.cnpj, ''), '\D', '', 'g');
  IF NOT private.cnpj_valido(NEW.cnpj) THEN
    RAISE EXCEPTION 'CNPJ do estabelecimento e invalido';
  END IF;

  IF NEW.tipo = 'filial' THEN
    SELECT * INTO v_matriz
    FROM public.cedente_estabelecimentos
    WHERE id = NEW.matriz_estabelecimento_id;
    IF v_matriz.id IS NULL OR v_matriz.tipo <> 'matriz' OR v_matriz.cedente_id <> NEW.cedente_id THEN
      RAISE EXCEPTION 'A filial deve apontar para a Matriz do mesmo Cedente';
    END IF;
  ELSIF NEW.matriz_estabelecimento_id IS NOT NULL THEN
    RAISE EXCEPTION 'A Matriz nao pode apontar para outro estabelecimento';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER cedente_estabelecimentos_validar
  BEFORE INSERT OR UPDATE OF cedente_id, cnpj, tipo, matriz_estabelecimento_id
  ON public.cedente_estabelecimentos
  FOR EACH ROW EXECUTE FUNCTION private.validar_cedente_estabelecimento();

CREATE TABLE public.cedente_estabelecimento_contas_bancarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estabelecimento_id uuid NOT NULL REFERENCES public.cedente_estabelecimentos(id) ON DELETE RESTRICT,
  banco text NOT NULL,
  agencia text NOT NULL,
  conta text NOT NULL,
  tipo_conta text,
  principal boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estabelecimento_contas_banco_check CHECK (length(trim(banco)) > 0),
  CONSTRAINT estabelecimento_contas_agencia_check CHECK (length(trim(agencia)) > 0),
  CONSTRAINT estabelecimento_contas_conta_check CHECK (length(trim(conta)) > 0)
);

CREATE UNIQUE INDEX estabelecimento_conta_principal_unique
  ON public.cedente_estabelecimento_contas_bancarias(estabelecimento_id)
  WHERE principal AND ativo;
CREATE INDEX estabelecimento_contas_estabelecimento_idx
  ON public.cedente_estabelecimento_contas_bancarias(estabelecimento_id, ativo);
CREATE TRIGGER cedente_estabelecimento_contas_updated_at
  BEFORE UPDATE ON public.cedente_estabelecimento_contas_bancarias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.cedente_estabelecimento_requisitos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estabelecimento_id uuid NOT NULL REFERENCES public.cedente_estabelecimentos(id) ON DELETE RESTRICT,
  documento_tipo_id uuid NOT NULL REFERENCES public.documento_tipos(id) ON DELETE RESTRICT,
  obrigatorio boolean NOT NULL DEFAULT true,
  ativo boolean NOT NULL DEFAULT true,
  observacoes text,
  configurado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estabelecimento_requisito_unique UNIQUE (estabelecimento_id, documento_tipo_id)
);

CREATE INDEX estabelecimento_requisitos_estabelecimento_idx
  ON public.cedente_estabelecimento_requisitos(estabelecimento_id, ativo);
CREATE TRIGGER cedente_estabelecimento_requisitos_updated_at
  BEFORE UPDATE ON public.cedente_estabelecimento_requisitos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.notas_fiscais
  ADD COLUMN estabelecimento_id uuid REFERENCES public.cedente_estabelecimentos(id) ON DELETE RESTRICT;
CREATE INDEX notas_fiscais_estabelecimento_idx
  ON public.notas_fiscais(estabelecimento_id, status);

ALTER TABLE public.documento_vinculos
  ADD COLUMN estabelecimento_id uuid REFERENCES public.cedente_estabelecimentos(id) ON DELETE RESTRICT;
ALTER TABLE public.documento_vinculos
  DROP CONSTRAINT IF EXISTS documento_vinculos_um_contexto_check;
ALTER TABLE public.documento_vinculos
  ADD CONSTRAINT documento_vinculos_um_contexto_check
  CHECK (num_nonnulls(nota_fiscal_id, operacao_id, nota_fiscal_entrega_id, cte_id, estabelecimento_id) = 1);
CREATE INDEX documento_vinculos_estabelecimento_idx
  ON public.documento_vinculos(estabelecimento_id) WHERE estabelecimento_id IS NOT NULL;

-- Backfill idempotente da Matriz e da conta principal legada.
INSERT INTO public.cedente_estabelecimentos (
  cedente_id, cnpj, razao_social, nome_fantasia, tipo, status, motivo_status,
  aprovado_em, suspenso_em, ativo, created_at, updated_at
)
SELECT
  c.id,
  regexp_replace(c.cnpj, '\D', '', 'g'),
  c.razao_social,
  c.nome_fantasia,
  'matriz',
  CASE c.status::text
    WHEN 'ativo' THEN 'aprovado'
    WHEN 'reprovado' THEN 'rejeitado'
    WHEN 'bloqueado' THEN 'suspenso'
    ELSE 'pendente'
  END,
  CASE
    WHEN c.status::text = 'reprovado' THEN 'Cedente reprovado antes da migracao Multi-CNPJ'
    WHEN c.status::text = 'bloqueado' THEN 'Cedente bloqueado antes da migracao Multi-CNPJ'
    ELSE NULL
  END,
  CASE WHEN c.status::text = 'ativo' THEN coalesce(c.updated_at, c.created_at, now()) END,
  CASE WHEN c.status::text = 'bloqueado' THEN coalesce(c.updated_at, c.created_at, now()) END,
  c.status::text NOT IN ('reprovado', 'bloqueado'),
  c.created_at,
  c.updated_at
FROM public.cedentes c
WHERE private.cnpj_valido(regexp_replace(c.cnpj, '\D', '', 'g'))
ON CONFLICT (cnpj) DO NOTHING;

INSERT INTO public.cedente_estabelecimento_contas_bancarias (
  estabelecimento_id, banco, agencia, conta, tipo_conta, principal, ativo, criado_por, created_at, updated_at
)
SELECT e.id, c.banco, c.agencia, c.conta, c.tipo_conta::text, true, true, c.user_id, c.created_at, c.updated_at
FROM public.cedentes c
JOIN public.cedente_estabelecimentos e ON e.cedente_id = c.id AND e.tipo = 'matriz'
WHERE nullif(trim(c.banco), '') IS NOT NULL
  AND nullif(trim(c.agencia), '') IS NOT NULL
  AND nullif(trim(c.conta), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.cedente_estabelecimento_contas_bancarias cb
    WHERE cb.estabelecimento_id = e.id AND cb.principal AND cb.ativo
  );

UPDATE public.notas_fiscais nf
SET estabelecimento_id = e.id
FROM public.cedente_estabelecimentos e
WHERE nf.estabelecimento_id IS NULL
  AND e.cedente_id = nf.cedente_id
  AND e.cnpj = regexp_replace(nf.cnpj_emitente, '\D', '', 'g');

CREATE OR REPLACE FUNCTION private.criar_matriz_apos_cedente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estabelecimento_id uuid;
BEGIN
  INSERT INTO public.cedente_estabelecimentos (
    cedente_id, cnpj, razao_social, nome_fantasia, tipo, status, aprovado_em, ativo
  ) VALUES (
    NEW.id,
    regexp_replace(NEW.cnpj, '\D', '', 'g'),
    NEW.razao_social,
    NEW.nome_fantasia,
    'matriz',
    CASE WHEN NEW.status::text = 'ativo' THEN 'aprovado' ELSE 'pendente' END,
    CASE WHEN NEW.status::text = 'ativo' THEN now() ELSE NULL END,
    NEW.status::text NOT IN ('reprovado', 'bloqueado')
  )
  ON CONFLICT (cnpj) DO NOTHING
  RETURNING id INTO v_estabelecimento_id;

  IF v_estabelecimento_id IS NULL THEN
    SELECT e.id INTO v_estabelecimento_id
    FROM public.cedente_estabelecimentos e
    WHERE e.cnpj = regexp_replace(NEW.cnpj, '\D', '', 'g')
      AND e.cedente_id = NEW.id
      AND e.tipo = 'matriz';

    IF v_estabelecimento_id IS NULL THEN
      RAISE EXCEPTION 'CNPJ do novo Cedente ja pertence a outro estabelecimento';
    END IF;
  END IF;

  IF nullif(trim(NEW.banco), '') IS NOT NULL
     AND nullif(trim(NEW.agencia), '') IS NOT NULL
     AND nullif(trim(NEW.conta), '') IS NOT NULL THEN
    INSERT INTO public.cedente_estabelecimento_contas_bancarias (
      estabelecimento_id, banco, agencia, conta, tipo_conta, principal, criado_por
    ) VALUES (
      v_estabelecimento_id, NEW.banco, NEW.agencia, NEW.conta, NEW.tipo_conta::text, true, NEW.user_id
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cedentes_criar_matriz
  AFTER INSERT ON public.cedentes
  FOR EACH ROW EXECUTE FUNCTION private.criar_matriz_apos_cedente();

CREATE OR REPLACE FUNCTION private.sincronizar_status_matriz_cedente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  UPDATE public.cedente_estabelecimentos
  SET status = CASE NEW.status::text
      WHEN 'ativo' THEN 'aprovado'
      WHEN 'reprovado' THEN 'rejeitado'
      WHEN 'bloqueado' THEN 'suspenso'
      ELSE status
    END,
    ativo = NEW.status::text NOT IN ('reprovado', 'bloqueado'),
    motivo_status = CASE
      WHEN NEW.status::text = 'reprovado' THEN coalesce(motivo_status, 'Cedente reprovado')
      WHEN NEW.status::text = 'bloqueado' THEN coalesce(motivo_status, 'Cedente bloqueado')
      WHEN NEW.status::text = 'ativo' THEN NULL
      ELSE motivo_status
    END,
    aprovado_por = CASE WHEN NEW.status::text = 'ativo' THEN auth.uid() ELSE aprovado_por END,
    aprovado_em = CASE WHEN NEW.status::text = 'ativo' THEN now() ELSE aprovado_em END,
    suspenso_por = CASE WHEN NEW.status::text = 'bloqueado' THEN auth.uid() ELSE NULL END,
    suspenso_em = CASE WHEN NEW.status::text = 'bloqueado' THEN now() ELSE NULL END
  WHERE cedente_id = NEW.id AND tipo = 'matriz';
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cedentes_sincronizar_status_matriz
  AFTER UPDATE OF status ON public.cedentes
  FOR EACH ROW EXECUTE FUNCTION private.sincronizar_status_matriz_cedente();

CREATE OR REPLACE FUNCTION private.sincronizar_cadastro_matriz_cedente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.cedente_estabelecimentos
  SET cnpj = regexp_replace(NEW.cnpj, '\D', '', 'g'),
      razao_social = NEW.razao_social,
      nome_fantasia = NEW.nome_fantasia
  WHERE cedente_id = NEW.id AND tipo = 'matriz';
  RETURN NEW;
END;
$function$;

CREATE TRIGGER cedentes_sincronizar_cadastro_matriz
  AFTER UPDATE OF cnpj, razao_social, nome_fantasia ON public.cedentes
  FOR EACH ROW EXECUTE FUNCTION private.sincronizar_cadastro_matriz_cedente();

CREATE OR REPLACE FUNCTION private.usuario_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.cedentes c
    WHERE c.id = p_cedente_id
      AND (
        c.user_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.cedente_acessos ca
          WHERE ca.cedente_id = c.id AND ca.user_id = (SELECT auth.uid()) AND ca.ativo
        )
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.cedente_fundos cf
    WHERE cf.cedente_id = p_cedente_id
      AND cf.status = 'ativo'
      AND private.usuario_tem_acesso_fundo(cf.fundo_id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.estabelecimento_pode_originar(
  p_estabelecimento_id uuid,
  p_cedente_id uuid,
  p_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.cedente_estabelecimentos e
    JOIN public.cedentes c ON c.id = e.cedente_id
    JOIN public.cedente_estabelecimentos matriz
      ON matriz.cedente_id = e.cedente_id AND matriz.tipo = 'matriz'
    JOIN public.cedente_fundos cf
      ON cf.cedente_id = e.cedente_id AND cf.fundo_id = p_fundo_id
    JOIN public.fundos f ON f.id = cf.fundo_id
    WHERE e.id = p_estabelecimento_id
      AND e.cedente_id = p_cedente_id
      AND e.status = 'aprovado' AND e.ativo
      AND matriz.status = 'aprovado' AND matriz.ativo
      AND c.status::text = 'ativo'
      AND cf.status = 'ativo'
      AND cf.vigente_desde <= now()
      AND (cf.vigente_ate IS NULL OR cf.vigente_ate > now())
      AND coalesce(f.ativo, false)
  );
$function$;

CREATE OR REPLACE FUNCTION public.estabelecimento_pode_originar(
  p_estabelecimento_id uuid,
  p_cedente_id uuid,
  p_fundo_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.estabelecimento_pode_originar(p_estabelecimento_id, p_cedente_id, p_fundo_id)
    AND (
      private.usuario_tem_acesso_cedente(p_cedente_id)
      OR private.gestor_tem_acesso_cedente(p_cedente_id)
    );
$function$;

CREATE OR REPLACE FUNCTION private.vincular_estabelecimento_nota_fiscal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estabelecimento public.cedente_estabelecimentos%ROWTYPE;
  v_cnpj text;
BEGIN
  v_cnpj := regexp_replace(coalesce(NEW.cnpj_emitente, ''), '\D', '', 'g');
  SELECT * INTO v_estabelecimento
  FROM public.cedente_estabelecimentos
  WHERE cnpj = v_cnpj;

  IF v_estabelecimento.id IS NULL THEN
    RAISE EXCEPTION 'CNPJ emitente nao esta cadastrado como estabelecimento deste Cedente';
  END IF;
  IF v_estabelecimento.cedente_id <> NEW.cedente_id THEN
    RAISE EXCEPTION 'CNPJ emitente nao pertence a este Cedente';
  END IF;
  IF NEW.estabelecimento_id IS NOT NULL AND NEW.estabelecimento_id <> v_estabelecimento.id THEN
    RAISE EXCEPTION 'O estabelecimento da NF e derivado pelo CNPJ emitente';
  END IF;
  IF NEW.fundo_id IS NULL OR NOT private.estabelecimento_pode_originar(v_estabelecimento.id, NEW.cedente_id, NEW.fundo_id) THEN
    RAISE EXCEPTION 'CNPJ emitente ainda nao esta aprovado para originar recebiveis';
  END IF;
  NEW.estabelecimento_id := v_estabelecimento.id;
  NEW.cnpj_emitente := v_cnpj;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER notas_fiscais_vincular_estabelecimento
  BEFORE INSERT OR UPDATE OF cedente_id, fundo_id, cedente_fundo_id, cnpj_emitente, estabelecimento_id
  ON public.notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION private.vincular_estabelecimento_nota_fiscal();

CREATE OR REPLACE FUNCTION private.validar_origem_nf_ao_vincular_operacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nf record;
  v_operacao record;
BEGIN
  SELECT nf.estabelecimento_id, nf.cedente_id, nf.fundo_id
  INTO v_nf FROM public.notas_fiscais nf WHERE nf.id = NEW.nota_fiscal_id;
  SELECT o.cedente_id, cf.fundo_id
  INTO v_operacao
  FROM public.operacoes o
  JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
  WHERE o.id = NEW.operacao_id;

  IF v_nf.estabelecimento_id IS NULL OR v_nf.cedente_id <> v_operacao.cedente_id
     OR v_nf.fundo_id <> v_operacao.fundo_id
     OR NOT private.estabelecimento_pode_originar(v_nf.estabelecimento_id, v_nf.cedente_id, v_nf.fundo_id) THEN
    RAISE EXCEPTION 'O estabelecimento da NF nao esta apto a originar nesta operacao';
  END IF;
  -- FUTURE_DECISION_RULE_1: nao validar composicao entre estabelecimentos aqui.
  RETURN NEW;
END;
$function$;

CREATE TRIGGER operacoes_nfs_validar_origem_estabelecimento
  BEFORE INSERT ON public.operacoes_nfs
  FOR EACH ROW EXECUTE FUNCTION private.validar_origem_nf_ao_vincular_operacao();

CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente(
  p_cnpj text,
  p_razao_social text,
  p_nome_fantasia text DEFAULT NULL
)
RETURNS public.cedente_estabelecimentos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cedente_id uuid;
  v_matriz public.cedente_estabelecimentos%ROWTYPE;
  v_result public.cedente_estabelecimentos%ROWTYPE;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
BEGIN
  v_cedente_id := public.get_user_cedente_id();
  IF (SELECT auth.uid()) IS NULL OR v_cedente_id IS NULL THEN RAISE EXCEPTION 'Cedente autenticado nao encontrado'; END IF;
  IF NOT private.usuario_tem_acesso_cedente(v_cedente_id) THEN RAISE EXCEPTION 'Acesso negado ao Cedente'; END IF;
  IF NOT private.cnpj_valido(v_cnpj) THEN RAISE EXCEPTION 'CNPJ da filial e invalido'; END IF;
  IF length(trim(coalesce(p_razao_social, ''))) < 3 THEN RAISE EXCEPTION 'Razao social da filial e obrigatoria'; END IF;

  SELECT e.* INTO v_matriz
  FROM public.cedente_estabelecimentos e
  JOIN public.cedentes c ON c.id = e.cedente_id
  WHERE e.cedente_id = v_cedente_id AND e.tipo = 'matriz'
    AND e.status = 'aprovado' AND e.ativo AND c.status::text = 'ativo';
  IF v_matriz.id IS NULL THEN RAISE EXCEPTION 'A Matriz precisa estar aprovada antes do cadastro de Filiais'; END IF;

  SELECT * INTO v_result
  FROM public.cedente_estabelecimentos
  WHERE cnpj = v_cnpj;
  IF v_result.id IS NOT NULL THEN
    IF v_result.cedente_id <> v_cedente_id OR v_result.tipo <> 'filial' THEN
      RAISE EXCEPTION 'CNPJ ja cadastrado para outro Cedente';
    END IF;
    RETURN v_result;
  END IF;

  INSERT INTO public.cedente_estabelecimentos (
    cedente_id, cnpj, razao_social, nome_fantasia, tipo, matriz_estabelecimento_id, status, ativo
  ) VALUES (
    v_cedente_id, v_cnpj, trim(p_razao_social), nullif(trim(coalesce(p_nome_fantasia, '')), ''),
    'filial', v_matriz.id, 'pendente', true
  )
  RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois
  ) VALUES (
    auth.uid(), 'usuario', 'cedente_meus_cnpjs', 'ESTABELECIMENTO_SUBMETIDO',
    'cedente_estabelecimentos', v_result.id,
    jsonb_build_object('cedente_id', v_cedente_id, 'estabelecimento_id', v_result.id, 'tipo', 'filial', 'status', v_result.status)
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_conta_estabelecimento_cedente(
  p_estabelecimento_id uuid,
  p_banco text,
  p_agencia text,
  p_conta text,
  p_tipo_conta text DEFAULT NULL,
  p_principal boolean DEFAULT true
)
RETURNS public.cedente_estabelecimento_contas_bancarias
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estabelecimento public.cedente_estabelecimentos%ROWTYPE;
  v_result public.cedente_estabelecimento_contas_bancarias%ROWTYPE;
BEGIN
  SELECT * INTO v_estabelecimento FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id;
  IF v_estabelecimento.id IS NULL OR NOT private.usuario_tem_acesso_cedente(v_estabelecimento.cedente_id) THEN
    RAISE EXCEPTION 'Estabelecimento nao encontrado';
  END IF;
  IF v_estabelecimento.status IN ('rejeitado', 'suspenso') OR NOT v_estabelecimento.ativo THEN
    RAISE EXCEPTION 'Conta nao pode ser alterada para este estabelecimento';
  END IF;

  -- Serializa a substituicao da conta principal do mesmo estabelecimento.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_estabelecimento_id::text, 0));

  IF p_principal THEN
    UPDATE public.cedente_estabelecimento_contas_bancarias
    SET principal = false
    WHERE estabelecimento_id = p_estabelecimento_id AND principal AND ativo;
  END IF;
  INSERT INTO public.cedente_estabelecimento_contas_bancarias (
    estabelecimento_id, banco, agencia, conta, tipo_conta, principal, criado_por
  ) VALUES (
    p_estabelecimento_id, trim(p_banco), trim(p_agencia), trim(p_conta), nullif(trim(coalesce(p_tipo_conta, '')), ''), p_principal, auth.uid()
  ) RETURNING * INTO v_result;

  INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (auth.uid(), 'usuario', 'cedente_meus_cnpjs', 'CONTA_ESTABELECIMENTO_ALTERADA',
    'cedente_estabelecimento_contas_bancarias', v_result.id,
    jsonb_build_object('cedente_id', v_estabelecimento.cedente_id, 'estabelecimento_id', p_estabelecimento_id, 'principal', p_principal));
  RETURN v_result;
END;
$function$;

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
  ) THEN RAISE EXCEPTION 'O Cedente precisa estar ativo para aprovar a Matriz'; END IF;
  IF p_acao IN ('aprovar', 'reativar') AND v_atual.tipo = 'filial' AND NOT EXISTS (
    SELECT 1 FROM public.cedente_estabelecimentos m
    WHERE m.id = v_atual.matriz_estabelecimento_id AND m.status = 'aprovado' AND m.ativo
  ) THEN RAISE EXCEPTION 'A Matriz precisa estar aprovada e ativa'; END IF;

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

CREATE OR REPLACE FUNCTION public.configurar_requisito_estabelecimento_gestor(
  p_estabelecimento_id uuid,
  p_documento_tipo_id uuid,
  p_obrigatorio boolean,
  p_ativo boolean,
  p_observacoes text DEFAULT NULL
)
RETURNS public.cedente_estabelecimento_requisitos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_cedente_id uuid;
  v_result public.cedente_estabelecimento_requisitos%ROWTYPE;
BEGIN
  SELECT cedente_id INTO v_cedente_id FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id;
  IF v_cedente_id IS NULL OR NOT private.gestor_tem_acesso_cedente(v_cedente_id) THEN RAISE EXCEPTION 'Estabelecimento nao encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.documento_tipos WHERE id = p_documento_tipo_id AND ativo) THEN RAISE EXCEPTION 'Tipo documental invalido'; END IF;
  INSERT INTO public.cedente_estabelecimento_requisitos (
    estabelecimento_id, documento_tipo_id, obrigatorio, ativo, observacoes, configurado_por
  ) VALUES (p_estabelecimento_id, p_documento_tipo_id, p_obrigatorio, p_ativo, p_observacoes, auth.uid())
  ON CONFLICT (estabelecimento_id, documento_tipo_id) DO UPDATE
    SET obrigatorio = EXCLUDED.obrigatorio, ativo = EXCLUDED.ativo,
        observacoes = EXCLUDED.observacoes, configurado_por = EXCLUDED.configurado_por
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_documento_estabelecimento_upload(
  p_estabelecimento_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_substitui_versao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_estabelecimento public.cedente_estabelecimentos%ROWTYPE;
  v_requisito public.cedente_estabelecimento_requisitos%ROWTYPE;
  v_documento_id uuid;
  v_versao_id uuid;
  v_numero integer;
BEGIN
  SELECT * INTO v_estabelecimento FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_id;
  IF v_estabelecimento.id IS NULL OR NOT (
    private.usuario_tem_acesso_cedente(v_estabelecimento.cedente_id)
    OR private.gestor_tem_acesso_cedente(v_estabelecimento.cedente_id)
  ) THEN RAISE EXCEPTION 'Estabelecimento nao encontrado'; END IF;
  SELECT * INTO v_requisito FROM public.cedente_estabelecimento_requisitos
  WHERE id = p_requisito_id AND estabelecimento_id = p_estabelecimento_id AND ativo;
  IF v_requisito.id IS NULL OR v_requisito.documento_tipo_id <> p_documento_tipo_id THEN RAISE EXCEPTION 'Requisito documental invalido'; END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN RAISE EXCEPTION 'Metadados de armazenamento invalidos'; END IF;

  SELECT dv.documento_id INTO v_documento_id
  FROM public.documento_vinculos vinc
  JOIN public.documentos_repositorio dr ON dr.id = vinc.documento_id AND dr.documento_tipo_id = p_documento_tipo_id
  JOIN public.documento_versoes dv ON dv.documento_id = dr.id
  WHERE vinc.estabelecimento_id = p_estabelecimento_id
  ORDER BY dv.numero_versao DESC LIMIT 1;

  IF v_documento_id IS NULL THEN
    INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
    VALUES (p_documento_tipo_id, 'pendente', auth.uid()) RETURNING id INTO v_documento_id;
    INSERT INTO public.documento_vinculos (documento_id, estabelecimento_id, cedente_id)
    VALUES (v_documento_id, p_estabelecimento_id, v_estabelecimento.cedente_id);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_documento_id::text, 0));
  SELECT coalesce(max(numero_versao), 0) + 1 INTO v_numero FROM public.documento_versoes WHERE documento_id = v_documento_id;
  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por
  ) VALUES (
    v_documento_id, v_numero, p_bucket, p_path, p_nome_original, p_mime_type, p_tamanho_bytes,
    lower(p_sha256), 'enviado', p_substitui_versao_id, auth.uid()
  ) RETURNING id INTO v_versao_id;
  UPDATE public.documentos_repositorio SET status = 'enviado', deleted_at = NULL WHERE id = v_documento_id;
  INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (auth.uid(), 'usuario', 'estabelecimento_documentos', 'DOCUMENTO_ESTABELECIMENTO_ENVIADO',
    'documento_versoes', v_versao_id,
    jsonb_build_object('cedente_id', v_estabelecimento.cedente_id, 'estabelecimento_id', p_estabelecimento_id,
      'documento_id', v_documento_id, 'numero_versao', v_numero));
  RETURN jsonb_build_object('documento_id', v_documento_id, 'versao_id', v_versao_id, 'numero_versao', v_numero);
END;
$function$;

ALTER TABLE public.cedente_estabelecimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cedente_estabelecimento_contas_bancarias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cedente_estabelecimento_requisitos ENABLE ROW LEVEL SECURITY;

CREATE POLICY cedente_estabelecimentos_select ON public.cedente_estabelecimentos
  FOR SELECT TO authenticated
  USING (
    private.usuario_tem_acesso_cedente(cedente_id)
    OR private.gestor_tem_acesso_cedente(cedente_id)
  );
CREATE POLICY estabelecimento_contas_select ON public.cedente_estabelecimento_contas_bancarias
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cedente_estabelecimentos e WHERE e.id = estabelecimento_id
      AND (private.usuario_tem_acesso_cedente(e.cedente_id) OR private.gestor_tem_acesso_cedente(e.cedente_id))
  ));
CREATE POLICY estabelecimento_requisitos_select ON public.cedente_estabelecimento_requisitos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cedente_estabelecimentos e WHERE e.id = estabelecimento_id
      AND (private.usuario_tem_acesso_cedente(e.cedente_id) OR private.gestor_tem_acesso_cedente(e.cedente_id))
  ));

REVOKE ALL ON public.cedente_estabelecimentos FROM PUBLIC, anon;
REVOKE ALL ON public.cedente_estabelecimento_contas_bancarias FROM PUBLIC, anon;
REVOKE ALL ON public.cedente_estabelecimento_requisitos FROM PUBLIC, anon;
GRANT SELECT ON public.cedente_estabelecimentos TO authenticated;
GRANT SELECT ON public.cedente_estabelecimento_contas_bancarias TO authenticated;
GRANT SELECT ON public.cedente_estabelecimento_requisitos TO authenticated;
GRANT ALL ON public.cedente_estabelecimentos, public.cedente_estabelecimento_contas_bancarias,
  public.cedente_estabelecimento_requisitos TO service_role;

REVOKE ALL ON FUNCTION public.estabelecimento_pode_originar(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cadastrar_filial_cedente(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid, text, text, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decidir_estabelecimento_gestor(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configurar_requisito_estabelecimento_gestor(uuid, uuid, boolean, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_documento_estabelecimento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estabelecimento_pode_originar(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cadastrar_filial_cedente(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_conta_estabelecimento_cedente(uuid, text, text, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decidir_estabelecimento_gestor(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configurar_requisito_estabelecimento_gestor(uuid, uuid, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_documento_estabelecimento_upload(uuid, uuid, uuid, text, text, bigint, text, text, text, uuid) TO authenticated;

-- As tabelas permanecem sem INSERT/UPDATE/DELETE direto para authenticated.
-- Todas as mutacoes passam pelas RPCs acima.

COMMIT;
