-- P0: backfill dos documentos existentes de residencia do Representante
-- (armazenados como 'comprovante_endereco' com representante_id preenchido)
-- para o novo codigo canonico 'representante_comprovante_residencia', e
-- constraint estrutural que impede a colisao de escopo voltar a existir.
--
-- 'comprovante_endereco' mantem o significado atual (Empresa, sem
-- representante_id) em todo o restante do sistema; nao ha renomeacao do
-- lado da Empresa, apenas a criacao do codigo que faltava para o
-- Representante.

BEGIN;

UPDATE public.documentos
   SET tipo = 'representante_comprovante_residencia'::public.documento_tipo
 WHERE tipo = 'comprovante_endereco'::public.documento_tipo
   AND representante_id IS NOT NULL;

ALTER TABLE public.documentos
  ADD CONSTRAINT documentos_escopo_endereco_residencia_check
  CHECK (
    (tipo <> 'comprovante_endereco'::public.documento_tipo OR representante_id IS NULL)
    AND (tipo <> 'representante_comprovante_residencia'::public.documento_tipo OR representante_id IS NOT NULL)
  );

COMMIT;
