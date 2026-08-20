BEGIN;

-- Achado colateral durante o diagnostico do ticket de rejeicao/parcelas:
-- cancelarOperacao (src/lib/actions/operacao.ts), usado pelo botao "Cancelar"
-- do Cedente em OperacoesPaginadas.tsx, faz
--   supabase.from('operacoes').update({status:'cancelada'}).eq('id', operacaoId)
-- sem nenhum filtro de cedente_id, contando com RLS para restringir ao dono.
-- Confirmado ao vivo em homolog (pg_policies): a tabela operacoes so tem
-- policy de UPDATE para 'gestor' (operacoes_gestor_update); nunca existiu uma
-- policy de UPDATE para cedente em nenhuma migration anterior. Sem policy
-- que autorize, o UPDATE do cedente afeta 0 linhas silenciosamente (RLS
-- filtra, nao lanca erro) -- o Server Action le { error } (null) e retorna
-- sucesso, mas a operacao NUNCA muda de status no banco. Mesma classe de
-- falha silenciosa do bug principal deste ticket (escrita sem autorizacao,
-- sem checagem de efeito real), so que aqui e RLS em vez de GRANT.
--
-- Corrige adicionando a policy simetrica as ja existentes
-- (operacoes_cedente_select/operacoes_cedente_insert): cedente pode
-- atualizar apenas a propria operacao (cedente_id = get_user_cedente_id()),
-- e apenas enquanto ainda nao foi analisada (solicitada/em_analise) --
-- mesma janela ja validada em codigo por cancelarOperacao antes de chamar
-- o update; aqui e reforcada tambem via RLS (defesa em profundidade).

CREATE POLICY operacoes_cedente_update ON public.operacoes
  FOR UPDATE TO authenticated
  USING (
    cedente_id = (SELECT public.get_user_cedente_id())
    AND status IN ('solicitada', 'em_analise')
  )
  WITH CHECK (
    cedente_id = (SELECT public.get_user_cedente_id())
  );

COMMIT;
