-- Operational reset deletes document versions. Drop the corresponding
-- transport record with its canonical version, without relaxing FINALIZED.
ALTER TABLE public.documento_upload_intents
  DROP CONSTRAINT documento_upload_intents_documento_id_fkey,
  DROP CONSTRAINT documento_upload_intents_documento_versao_id_fkey;
ALTER TABLE public.documento_upload_intents
  ADD CONSTRAINT documento_upload_intents_documento_id_fkey
    FOREIGN KEY (documento_id) REFERENCES public.documentos(id) ON DELETE CASCADE,
  ADD CONSTRAINT documento_upload_intents_documento_versao_id_fkey
    FOREIGN KEY (documento_versao_id) REFERENCES public.documentos(id) ON DELETE CASCADE;
CREATE INDEX documento_upload_intents_cedente_idx ON public.documento_upload_intents(cedente_id);
CREATE INDEX documento_upload_intents_representante_idx ON public.documento_upload_intents(representante_id)
  WHERE representante_id IS NOT NULL;
CREATE INDEX documento_upload_intents_documento_idx ON public.documento_upload_intents(documento_id)
  WHERE documento_id IS NOT NULL;
