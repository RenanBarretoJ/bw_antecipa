-- Amplia o catálogo controlado de documentos aceitos em requisitos de política operacional.
-- Não altera versionamento, snapshots, triggers ou RLS.

ALTER TABLE public.politica_requisitos_documentais
  DROP CONSTRAINT IF EXISTS politica_requisitos_tipo_check;

ALTER TABLE public.politica_requisitos_documentais
  ADD CONSTRAINT politica_requisitos_tipo_check
  CHECK (tipo_documento_codigo IN (
    'nf_xml',
    'nf_danfe_pdf',
    'nf_pedido_compra',
    'contrato',
    'comprovante_entrega',
    'cte',
    'canhoto',
    'boleto',
    'duplicata',
    'comprovante_aceite',
    'outro'
  ));
