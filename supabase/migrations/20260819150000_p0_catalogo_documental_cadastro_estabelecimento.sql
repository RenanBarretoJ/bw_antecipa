-- P0: catalogo documental correto para o checklist cadastral de
-- Matriz/Filial. O dropdown de "Configurar requisito" consultava
-- documento_tipos sem filtrar por dominio, mostrando tipos de
-- lastro/logistica (CT-e, DANFE, XML da NF-e, Pedido de Compra etc.).
--
-- documento_tipos.dominio ja e o campo estrutural de classificacao
-- (CHECK IN ('nf','operacao','juridico','entrega','integracao')); esta
-- migration reaproveita esse campo, adicionando o valor 'cadastro' para
-- os tipos documentais especificos do cadastro de estabelecimento
-- (Matriz/Filial), sem criar uma coluna paralela.

BEGIN;

ALTER TABLE public.documento_tipos DROP CONSTRAINT documento_tipos_dominio_check;
ALTER TABLE public.documento_tipos ADD CONSTRAINT documento_tipos_dominio_check
  CHECK (dominio IN ('nf', 'operacao', 'juridico', 'entrega', 'integracao', 'cadastro'));

INSERT INTO public.documento_tipos (codigo, nome, dominio, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes)
VALUES
  ('estabelecimento_cartao_cnpj', 'Cartao CNPJ do Estabelecimento', 'cadastro',
    ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520),
  ('estabelecimento_comprovante_endereco', 'Comprovante de Endereco do Estabelecimento', 'cadastro',
    ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520),
  ('estabelecimento_contrato_social', 'Contrato Social / Alteracao Contratual', 'cadastro',
    ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520),
  ('estabelecimento_comprovante_faturamento', 'Comprovante de Faturamento', 'cadastro',
    ARRAY['application/pdf', 'image/jpeg', 'image/png'], ARRAY['pdf', 'jpg', 'jpeg', 'png'], 20971520)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
