-- P0 Claude: inclui "NF de Remessa" no catalogo de tipos de documento
-- aceitos como requisito de politica operacional.
--
-- NF de Remessa continua sendo documento auxiliar/logistico -- esta
-- migration so amplia o catalogo controlado de
-- politica_requisitos_documentais.tipo_documento_codigo (o mesmo
-- catalogo estendido em 20260722183107_ampliar_catalogo_requisitos_
-- politica_operacional.sql). Nao cria requisito obrigatorio globalmente:
-- a obrigatoriedade continua 100% definida pela propria politica
-- (campo `obrigatorio` de cada requisito). Nao altera
-- nota_fiscal_remessas, nem qualquer integracao financeira.

BEGIN;

ALTER TABLE public.politica_requisitos_documentais
  DROP CONSTRAINT IF EXISTS politica_requisitos_tipo_check;

ALTER TABLE public.politica_requisitos_documentais
  ADD CONSTRAINT politica_requisitos_tipo_check
  CHECK (tipo_documento_codigo IN (
    'nf_xml',
    'nf_danfe_pdf',
    'nf_pedido_compra',
    'nf_remessa',
    'contrato',
    'comprovante_entrega',
    'cte',
    'canhoto',
    'boleto',
    'duplicata',
    'comprovante_aceite',
    'outro'
  ));

COMMIT;
