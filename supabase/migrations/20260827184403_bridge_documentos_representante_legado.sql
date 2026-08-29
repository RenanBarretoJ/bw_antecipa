-- Reconcilia documentos cadastrais legados de representantes que foram
-- persistidos sem representante_id, embora o caminho do Storage preserve o
-- representante correto. A atualizacao exige correspondencia com um
-- representante pertencente ao mesmo cedente e nao altera arquivo, versao,
-- status, analise ou identidade do documento.

BEGIN;

ALTER TABLE public.documentos DISABLE TRIGGER documentos_updated_at;

WITH candidatos AS (
  SELECT
    documento.id AS documento_id,
    documento.cedente_id,
    substring(
      documento.url_arquivo
      FROM '/representantes/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/'
    )::uuid AS representante_legado_id
  FROM public.documentos documento
  WHERE documento.representante_id IS NULL
    AND documento.url_arquivo ~ '/representantes/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/'
), correspondencias_diretas AS (
  SELECT candidato.documento_id, representante.id AS representante_id
  FROM candidatos candidato
  JOIN public.representantes representante
    ON representante.id = candidato.representante_legado_id
   AND representante.cedente_id = candidato.cedente_id
), identidades_historicas AS (
  SELECT DISTINCT
    candidato.documento_id,
    candidato.cedente_id,
    regexp_replace(representante_anterior ->> 'cpf', '\D', '', 'g') AS cpf
  FROM candidatos candidato
  JOIN public.solicitacoes_alteracao_cedente solicitacao
    ON solicitacao.cedente_id = candidato.cedente_id
   AND solicitacao.status = 'aprovada'
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(solicitacao.representantes_atuais, '[]'::jsonb)
  ) representante_anterior
  WHERE representante_anterior ->> 'id' = candidato.representante_legado_id::text
), correspondencias_historicas AS (
  SELECT identidade.documento_id, representante.id AS representante_id
  FROM identidades_historicas identidade
  JOIN public.representantes representante
    ON representante.cedente_id = identidade.cedente_id
   AND regexp_replace(COALESCE(representante.cpf, ''), '\D', '', 'g') = identidade.cpf
  WHERE length(identidade.cpf) = 11
), correspondencias AS (
  SELECT * FROM correspondencias_diretas
  UNION
  SELECT * FROM correspondencias_historicas
), validados AS (
  SELECT
    correspondencia.documento_id,
    min(correspondencia.representante_id::text)::uuid AS representante_id
  FROM correspondencias correspondencia
  GROUP BY correspondencia.documento_id
  HAVING count(DISTINCT correspondencia.representante_id) = 1
)
UPDATE public.documentos documento
SET representante_id = validado.representante_id
FROM validados validado
WHERE documento.id = validado.documento_id
  AND documento.representante_id IS NULL;

-- Alguns documentos foram reenviados depois que o representante ganhou um novo
-- UUID e ambos ficaram registrados como v1. Somente contextos ainda colidentes
-- sao reordenados cronologicamente; nenhum documento ou arquivo e descartado.
WITH contextos_colidentes AS (
  SELECT DISTINCT
    documento.cedente_id,
    documento.tipo,
    documento.representante_id
  FROM public.documentos documento
  GROUP BY documento.cedente_id,
           documento.tipo,
           documento.representante_id,
           documento.versao
  HAVING count(*) > 1
), documentos_ordenados AS (
  SELECT
    documento.id,
    row_number() OVER (
      PARTITION BY documento.cedente_id,
                   documento.tipo,
                   documento.representante_id
      ORDER BY documento.created_at, documento.id
    )::integer AS versao_reconciliada
  FROM public.documentos documento
  JOIN contextos_colidentes contexto
    ON contexto.cedente_id = documento.cedente_id
   AND contexto.tipo = documento.tipo
   AND contexto.representante_id IS NOT DISTINCT FROM documento.representante_id
)
UPDATE public.documentos documento
SET versao = ordenado.versao_reconciliada
FROM documentos_ordenados ordenado
WHERE documento.id = ordenado.id
  AND documento.versao IS DISTINCT FROM ordenado.versao_reconciliada;

ALTER TABLE public.documentos ENABLE TRIGGER documentos_updated_at;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.documentos documento
    GROUP BY documento.cedente_id,
             documento.tipo,
             documento.representante_id,
             documento.versao
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Bridge documental bloqueada: ainda existem versoes duplicadas sem contexto comprovavel';
  END IF;
END;
$$;

COMMIT;
