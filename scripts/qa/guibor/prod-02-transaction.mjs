import assert from 'node:assert/strict'
import { envelope, fingerprintSql } from './prod-02-control.mjs'

// Same transaction exercised in Docker and sent to production. SQL source files
// stay byte-for-byte immutable; transaction wrappers are removed only in memory.
export function applicationTransaction(pending, end='COMMIT') {
  assert(['COMMIT','ROLLBACK'].includes(end))
  return `BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE guibor_prod02_before ON COMMIT DROP AS ${fingerprintSql};
${envelope(pending)}
DO $guard$ DECLARE actual jsonb; previous jsonb; BEGIN
  SELECT value INTO previous FROM guibor_prod02_before;
  SELECT value INTO actual FROM (${fingerprintSql}) state;
  IF actual IS DISTINCT FROM previous THEN RAISE EXCEPTION 'GUIBOR_HISTORICAL_MUTATION_STOP'; END IF;
  IF EXISTS(SELECT 1 FROM public.notas_fiscais WHERE fiscal_proveniencia IS NOT NULL OR tipo_documento_fiscal IS NOT NULL OR valor_liquido_origem IS NOT NULL OR vencimento_origem IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.operacoes WHERE base_antecipacao_snapshot IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.cedente_fundos WHERE base_valor_antecipacao<>'BRUTO')
    OR EXISTS(SELECT 1 FROM public.consultor_fundos WHERE comissao_habilitada) THEN
    RAISE EXCEPTION 'GUIBOR_DEFAULTS_OR_BACKFILL_STOP';
  END IF;
  IF to_regprocedure('private.consultor_usuario_pode_visualizar_cedente(uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'C5_UNEXPECTED_STOP'; END IF;
END $guard$;
SELECT value AS before, (${fingerprintSql}) AS after FROM guibor_prod02_before;
NOTIFY pgrst,'reload schema'; ${end};`
}
