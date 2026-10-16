-- Read-only batch equivalent of fiscal_intake_get_original for approval gates.
-- Callers must first load the authorized NFs through their authenticated client.
-- Only retained canonical objects that still exist in Storage are returned.
CREATE FUNCTION public.fiscal_intake_get_originals(p_nf_ids uuid[])
RETURNS TABLE (nota_fiscal_id uuid, bucket text, path text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT n.id, original.ref->>'bucket', original.ref->>'path'
  FROM public.notas_fiscais n
  CROSS JOIN LATERAL public.fiscal_intake_get_original(n.id) AS original(ref)
  JOIN storage.objects o
    ON o.bucket_id = original.ref->>'bucket' AND o.name = original.ref->>'path'
  WHERE n.id = ANY(p_nf_ids) AND n.fiscal_reservation_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.fiscal_intake_get_originals(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_get_originals(uuid[]) TO service_role;
