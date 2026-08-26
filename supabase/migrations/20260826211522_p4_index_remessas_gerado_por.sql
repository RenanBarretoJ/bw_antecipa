-- P4 - cobre a FK de auditoria para consultas por usuario gerador.
-- Migration incremental porque o schema principal da P4 ja foi aplicado em homolog.

CREATE INDEX remessas_operacionais_gerado_por_idx
  ON public.remessas_operacionais (gerado_por)
  WHERE gerado_por IS NOT NULL;
