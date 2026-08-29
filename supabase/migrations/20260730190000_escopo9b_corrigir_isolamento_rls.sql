-- Escopo 9B: corrige o isolamento multi-fundo e a carteira do consultor.
--
-- Causa corrigida:
-- policies antigas FOR ALL/FOR SELECT autorizavam qualquer linha apenas pela
-- role gestor/consultor. Como policies permissivas sao combinadas por OR, elas
-- anulavam as policies mais restritivas adicionadas posteriormente.
--
-- Fonte de autorizacao do gestor:
--   usuario_fundos(usuario_id = auth.uid(), fundo_id, status = ativo)
-- Fonte de autorizacao do consultor:
--   consultor_cedente(consultor_id = auth.uid(), cedente_id)
-- Fonte de contexto operacional:
--   operacoes.cedente_fundo_id -> cedente_fundos.fundo_id
--   notas_fiscais.fundo_id + notas_fiscais.cedente_fundo_id
--
-- A migration nao altera dados de negocio, snapshots, status ou regras
-- financeiras. Ela somente substitui policies e cria helpers privados para
-- que as consultas de autorizacao nao entrem em recursao de RLS.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
     OR to_regclass('public.usuario_fundos') IS NULL
     OR to_regclass('public.cedente_fundos') IS NULL
     OR to_regclass('public.consultor_cedente') IS NULL
     OR to_regclass('public.operacoes') IS NULL
     OR to_regclass('public.operacoes_nfs') IS NULL
     OR to_regclass('public.notas_fiscais') IS NULL THEN
    RAISE EXCEPTION 'Pre-condicoes do Escopo 9B ausentes: tabelas de isolamento nao encontradas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operacoes'
      AND column_name = 'cedente_fundo_id'
  ) THEN
    RAISE EXCEPTION 'Pre-condicao do Escopo 9B ausente: operacoes.cedente_fundo_id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notas_fiscais'
      AND column_name IN ('fundo_id', 'cedente_fundo_id')
    GROUP BY table_schema, table_name
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'Pre-condicao do Escopo 9B ausente: contexto multifundo de notas_fiscais.';
  END IF;
END;
$$;

ALTER TABLE public.fundos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuario_fundos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cedente_fundos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultor_cedente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacoes_nfs ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER e indispensavel apenas para consultar as tabelas de
-- autorizacao enquanto elas mesmas estao protegidas por RLS. Os helpers nao
-- aceitam usuario externo, usam auth.uid(), nao usam SQL dinamico e ficam em
-- schema privado, fora do Data API.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.usuario_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT public.get_user_role()) = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.usuario_fundos uf
      WHERE uf.usuario_id = (SELECT auth.uid())
        AND uf.fundo_id = p_fundo_id
        AND uf.status = 'ativo'
    );
$$;

CREATE OR REPLACE FUNCTION private.consultor_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    (SELECT public.get_user_role()) = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.consultor_cedente cc
      WHERE cc.consultor_id = (SELECT auth.uid())
        AND cc.cedente_id = p_cedente_id
    );
$$;

REVOKE ALL ON FUNCTION private.usuario_tem_acesso_fundo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.consultor_tem_acesso_cedente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.usuario_tem_acesso_fundo(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.consultor_tem_acesso_cedente(uuid) TO authenticated;

-- Fundos: leitura/alteracao somente no fundo explicitamente autorizado.
-- INSERT e mantido separado como bootstrap de cadastro: o fundo ainda nao
-- possui usuario_fundos no momento da primeira insercao. Apos inserido, toda
-- leitura, alteracao e exclusao exigem o vinculo ativo.
DROP POLICY IF EXISTS fundos_gestor_all ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_select ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_authorized_select ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_bootstrap_insert ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_authorized_update ON public.fundos;
DROP POLICY IF EXISTS fundos_gestor_authorized_delete ON public.fundos;
DROP POLICY IF EXISTS fundos_cedente_vinculado_select ON public.fundos;
DROP POLICY IF EXISTS fundos_consultor_vinculado_select ON public.fundos;

CREATE POLICY fundos_gestor_authorized_select ON public.fundos
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(fundos.id)));

CREATE POLICY fundos_gestor_bootstrap_insert ON public.fundos
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_user_role()) = 'gestor');

CREATE POLICY fundos_gestor_authorized_update ON public.fundos
  FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(fundos.id)))
  WITH CHECK ((SELECT private.usuario_tem_acesso_fundo(fundos.id)));

CREATE POLICY fundos_gestor_authorized_delete ON public.fundos
  FOR DELETE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(fundos.id)));

CREATE POLICY fundos_cedente_vinculado_select ON public.fundos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.fundo_id = fundos.id
        AND cf.cedente_id = (SELECT public.get_user_cedente_id())
        AND cf.status = 'ativo'
    )
  );

CREATE POLICY fundos_consultor_vinculado_select ON public.fundos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.fundo_id = fundos.id
        AND cf.status = 'ativo'
        AND (SELECT private.consultor_tem_acesso_cedente(cf.cedente_id))
    )
  );

-- Associacoes de usuario: um gestor so administra usuarios de fundos que ele
-- proprio possui; cada usuario continua podendo ler seus proprios vinculos.
DROP POLICY IF EXISTS usuario_fundos_select_own ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_manage ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_insert ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_update ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_delete ON public.usuario_fundos;

CREATE POLICY usuario_fundos_select_own ON public.usuario_fundos
  FOR SELECT TO authenticated
  USING (
    usuario_fundos.usuario_id = (SELECT auth.uid())
    OR (SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id))
  );

CREATE POLICY usuario_fundos_gestor_insert ON public.usuario_fundos
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)));

CREATE POLICY usuario_fundos_gestor_update ON public.usuario_fundos
  FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)))
  WITH CHECK ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)));

CREATE POLICY usuario_fundos_gestor_delete ON public.usuario_fundos
  FOR DELETE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)));

-- Vinculos cedente-fundo: o gestor precisa possuir o fundo de origem e o
-- fundo de destino. Isso impede mover uma linha autorizada de A para B.
DROP POLICY IF EXISTS cedente_fundos_gestor_all ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_cedente_select ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_consultor_select ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_select ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_insert ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_update ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_delete ON public.cedente_fundos;

CREATE POLICY cedente_fundos_gestor_select ON public.cedente_fundos
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id)));

CREATE POLICY cedente_fundos_gestor_insert ON public.cedente_fundos
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.fundos f
      WHERE f.id = cedente_fundos.fundo_id
        AND f.ativo IS TRUE
    )
  );

CREATE POLICY cedente_fundos_gestor_update ON public.cedente_fundos
  FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id)))
  WITH CHECK (
    (SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.fundos f
      WHERE f.id = cedente_fundos.fundo_id
        AND f.ativo IS TRUE
    )
  );

CREATE POLICY cedente_fundos_gestor_delete ON public.cedente_fundos
  FOR DELETE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id)));

CREATE POLICY cedente_fundos_cedente_select ON public.cedente_fundos
  FOR SELECT TO authenticated
  USING (cedente_id = (SELECT public.get_user_cedente_id()));

CREATE POLICY cedente_fundos_consultor_select ON public.cedente_fundos
  FOR SELECT TO authenticated
  USING ((SELECT private.consultor_tem_acesso_cedente(cedente_fundos.cedente_id)));

-- Carteira do consultor: gestores administram somente cedentes presentes em
-- fundos que possuem; consultores leem somente a propria carteira.
DROP POLICY IF EXISTS consultor_cedente_gestor_all ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_select_own ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_select ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_insert ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_update ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_delete ON public.consultor_cedente;

CREATE POLICY consultor_cedente_gestor_select ON public.consultor_cedente
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_gestor_insert ON public.consultor_cedente
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_gestor_update ON public.consultor_cedente
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_gestor_delete ON public.consultor_cedente
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_select_own ON public.consultor_cedente
  FOR SELECT TO authenticated
  USING (consultor_id = (SELECT auth.uid()));

-- Notas fiscais: gestores leem e alteram apenas NF com contexto completo no
-- fundo autorizado. Nenhuma policy de gestor permite INSERT direto; o fluxo
-- de entrada usa o cedente e as RPCs atomicas existentes.
DROP POLICY IF EXISTS notas_fiscais_gestor_all ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_gestor_select ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_gestor_update ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_gestor_delete ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_consultor_select ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_cedente_select ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_cedente_insert ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_cedente_update ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_cedente_delete ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_sacado_select ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_sacado_aceitar ON public.notas_fiscais;
DROP POLICY IF EXISTS notas_fiscais_sacado_contestar ON public.notas_fiscais;

CREATE POLICY notas_fiscais_gestor_select ON public.notas_fiscais
  FOR SELECT TO authenticated
  USING (
    notas_fiscais.fundo_id IS NOT NULL
    AND (SELECT private.usuario_tem_acesso_fundo(notas_fiscais.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.cedente_fundos cf
      WHERE cf.id = notas_fiscais.cedente_fundo_id
        AND cf.cedente_id = notas_fiscais.cedente_id
        AND cf.fundo_id = notas_fiscais.fundo_id
    )
  );

CREATE POLICY notas_fiscais_gestor_update ON public.notas_fiscais
  FOR UPDATE TO authenticated
  USING (
    notas_fiscais.fundo_id IS NOT NULL
    AND (SELECT private.usuario_tem_acesso_fundo(notas_fiscais.fundo_id))
  )
  WITH CHECK (
    notas_fiscais.fundo_id IS NOT NULL
    AND (SELECT private.usuario_tem_acesso_fundo(notas_fiscais.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.cedente_fundos cf
      WHERE cf.id = notas_fiscais.cedente_fundo_id
        AND cf.cedente_id = notas_fiscais.cedente_id
        AND cf.fundo_id = notas_fiscais.fundo_id
    )
  );

CREATE POLICY notas_fiscais_gestor_delete ON public.notas_fiscais
  FOR DELETE TO authenticated
  USING (
    notas_fiscais.fundo_id IS NOT NULL
    AND (SELECT private.usuario_tem_acesso_fundo(notas_fiscais.fundo_id))
  );

CREATE POLICY notas_fiscais_consultor_select ON public.notas_fiscais
  FOR SELECT TO authenticated
  USING ((SELECT private.consultor_tem_acesso_cedente(notas_fiscais.cedente_id)));

CREATE POLICY notas_fiscais_cedente_select ON public.notas_fiscais
  FOR SELECT TO authenticated
  USING (cedente_id = (SELECT public.get_user_cedente_id()));

CREATE POLICY notas_fiscais_cedente_insert ON public.notas_fiscais
  FOR INSERT TO authenticated
  WITH CHECK (
    cedente_id = (SELECT public.get_user_cedente_id())
    AND cedente_fundo_id IS NOT NULL
    AND fundo_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE cf.id = notas_fiscais.cedente_fundo_id
        AND cf.cedente_id = notas_fiscais.cedente_id
        AND cf.fundo_id = notas_fiscais.fundo_id
        AND cf.status = 'ativo'
        AND f.ativo IS TRUE
    )
  );

CREATE POLICY notas_fiscais_cedente_update ON public.notas_fiscais
  FOR UPDATE TO authenticated
  USING (cedente_id = (SELECT public.get_user_cedente_id()))
  WITH CHECK (cedente_id = (SELECT public.get_user_cedente_id()));

CREATE POLICY notas_fiscais_cedente_delete ON public.notas_fiscais
  FOR DELETE TO authenticated
  USING (cedente_id = (SELECT public.get_user_cedente_id()) AND status = 'rascunho');

CREATE POLICY notas_fiscais_sacado_select ON public.notas_fiscais
  FOR SELECT TO authenticated
  USING (cnpj_destinatario = (SELECT public.get_user_sacado_cnpj()));

CREATE POLICY notas_fiscais_sacado_aceitar ON public.notas_fiscais
  FOR UPDATE TO authenticated
  USING (cnpj_destinatario = (SELECT public.get_user_sacado_cnpj()) AND status = 'em_antecipacao')
  WITH CHECK (status = 'aceita');

CREATE POLICY notas_fiscais_sacado_contestar ON public.notas_fiscais
  FOR UPDATE TO authenticated
  USING (cnpj_destinatario = (SELECT public.get_user_sacado_cnpj()) AND status = 'em_antecipacao')
  WITH CHECK (status = 'contestada');

-- Operacoes: contexto canonico e cedente_fundo_id. Linhas legadas sem esse
-- contexto nao sao expostas ao gestor/consultor por esta camada.
DROP POLICY IF EXISTS operacoes_gestor_all ON public.operacoes;
DROP POLICY IF EXISTS operacoes_gestor_select ON public.operacoes;
DROP POLICY IF EXISTS operacoes_gestor_update ON public.operacoes;
DROP POLICY IF EXISTS operacoes_gestor_delete ON public.operacoes;
DROP POLICY IF EXISTS operacoes_consultor_select ON public.operacoes;
DROP POLICY IF EXISTS operacoes_cedente_select ON public.operacoes;
DROP POLICY IF EXISTS operacoes_cedente_insert ON public.operacoes;
DROP POLICY IF EXISTS operacoes_sacado_select ON public.operacoes;

CREATE POLICY operacoes_gestor_select ON public.operacoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = operacoes.cedente_fundo_id
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY operacoes_gestor_update ON public.operacoes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = operacoes.cedente_fundo_id
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = operacoes.cedente_fundo_id
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY operacoes_gestor_delete ON public.operacoes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = operacoes.cedente_fundo_id
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY operacoes_consultor_select ON public.operacoes
  FOR SELECT TO authenticated
  USING ((SELECT private.consultor_tem_acesso_cedente(operacoes.cedente_id)));

CREATE POLICY operacoes_cedente_select ON public.operacoes
  FOR SELECT TO authenticated
  USING (cedente_id = (SELECT public.get_user_cedente_id()));

CREATE POLICY operacoes_cedente_insert ON public.operacoes
  FOR INSERT TO authenticated
  WITH CHECK (cedente_id = (SELECT public.get_user_cedente_id()));

CREATE POLICY operacoes_sacado_select ON public.operacoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.operacoes_nfs onf
      JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
      WHERE onf.operacao_id = operacoes.id
        AND nf.cnpj_destinatario = (SELECT public.get_user_sacado_cnpj())
    )
  );

-- Relacao operacao-NF: leitura segue o mesmo contexto do pai. Insercoes do
-- fluxo atomico continuam protegidas pela RPC SECURITY DEFINER ja existente.
DROP POLICY IF EXISTS operacoes_nfs_gestor_all ON public.operacoes_nfs;
DROP POLICY IF EXISTS operacoes_nfs_gestor_select ON public.operacoes_nfs;
DROP POLICY IF EXISTS operacoes_nfs_consultor_select ON public.operacoes_nfs;
DROP POLICY IF EXISTS operacoes_nfs_cedente_select ON public.operacoes_nfs;
DROP POLICY IF EXISTS operacoes_nfs_cedente_insert ON public.operacoes_nfs;
DROP POLICY IF EXISTS operacoes_nfs_sacado_select ON public.operacoes_nfs;

CREATE POLICY operacoes_nfs_gestor_select ON public.operacoes_nfs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
      WHERE o.id = operacoes_nfs.operacao_id
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY operacoes_nfs_consultor_select ON public.operacoes_nfs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.operacoes o
      WHERE o.id = operacoes_nfs.operacao_id
        AND (SELECT private.consultor_tem_acesso_cedente(o.cedente_id))
    )
  );

CREATE POLICY operacoes_nfs_cedente_select ON public.operacoes_nfs
  FOR SELECT TO authenticated
  USING (operacao_id IN (SELECT public.get_user_operacao_ids()));

CREATE POLICY operacoes_nfs_cedente_insert ON public.operacoes_nfs
  FOR INSERT TO authenticated
  WITH CHECK (operacao_id IN (SELECT public.get_user_operacao_ids()));

CREATE POLICY operacoes_nfs_sacado_select ON public.operacoes_nfs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = operacoes_nfs.nota_fiscal_id
        AND nf.cnpj_destinatario = (SELECT public.get_user_sacado_cnpj())
    )
  );

-- Grants da Data API: nenhum dos objetos afetados fica acessivel a anon.
REVOKE ALL ON TABLE
  public.fundos,
  public.usuario_fundos,
  public.cedente_fundos,
  public.consultor_cedente,
  public.notas_fiscais,
  public.operacoes,
  public.operacoes_nfs
FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.fundos,
  public.usuario_fundos,
  public.cedente_fundos,
  public.consultor_cedente,
  public.notas_fiscais,
  public.operacoes,
  public.operacoes_nfs
TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
