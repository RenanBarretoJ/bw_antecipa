-- P0: cria o codigo canonico proprio para o comprovante de residencia do
-- Representante Legal, hoje colidindo com 'comprovante_endereco' (mesmo
-- codigo usado pela Empresa, distinguido apenas por representante_id).
--
-- ALTER TYPE ... ADD VALUE nao pode ser usado na mesma transacao em que o
-- valor novo e referenciado; por isso esta migration so adiciona o valor.
-- O backfill e a constraint estrutural ficam na migration seguinte.

BEGIN;

ALTER TYPE public.documento_tipo ADD VALUE 'representante_comprovante_residencia';

COMMIT;
