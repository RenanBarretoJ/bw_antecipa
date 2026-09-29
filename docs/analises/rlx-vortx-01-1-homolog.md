# RLX-VORTX-01.1 ? identidade e layout de remessa

## Diagn?stico e escopo

Base da implementa??o: main 83ece9c676a4f39ff130a8885847735c8b1da17d.
Worktree exclusivo: bw_antecipa_vortx_remessa. Nenhuma migration.

`nota_fiscal_parcelas.numero_parcela` ? integer positivo e ?nico por NF
(migration 20260819210000; confirmado no schema de homolog em 29/09/2026).
O loader usa esse campo ap?s filtrar `operacoes_nf_parcelas`, sem renumerar.
O parser de XML possui regra hist?rica para nDup inv?lido na entrada; esta entrega
n?o a modifica e usa exclusivamente o n?mero j? persistido.

Identidade VRS centralizada em `src/lib/remessas/vrs/chaves.ts`:
ATIVO = UUID persistido da NF; FLUXO refer?ncia = mesmo UUID;
FLUXO parcela = UUID + `_` + n?mero original com tr?s d?gitos.
Inteiros 1?999 s?o aceitos; 01/001 normalizam para 001; valores fora do contrato
bloqueiam. Colis?es no lote bloqueiam. Nenhum UUID de neg?cio ? alterado.
Helpers antigos do Excel de confer?ncia CNAB permanecem compat?veis.
CSV, XLSX e trilha persistida compartilham o mesmo mapeamento.

ATIVO f?sico 28 e 37 recebem n?mero NF; 38 recebe chave fiscal de 44 d?gitos;
39?41 vazios. XLSX segue o modelo fornecido (HEADER/ATIVO/FLUXO/PAGAMENTO),
com 5/40/14/7 colunas, sem a coluna tipo do CSV (6/41/15/8).
As lacunas da numera??o do TXT n?o existem no XLSX de refer?ncia; prevalece o modelo.
Valores s?o texto como no modelo, preservando zeros e datas DD/MM/AAAA.

## Endere?o e idempot?ncia

XML ? priorit?rio. O cadastro interno `sacados` s? cont?m id, user_id, cnpj,
razao_social, email e timestamps (schema homolog conferido); n?o h? endere?o
interno dispon?vel para a segunda etapa. Usa-se ent?o a consulta CNPJ existente,
somente para obrigat?rios ausentes/inv?lidos, com cache por gera??o e concorr?ncia 4.
Falha ou endere?o ainda incompleto bloqueia. N?o altera XML nem cadastros.

O payload enriquecido entra no hash existente: mudan?as de endere?o na mesma
cess?o bloqueiam o replay; n?o h? substitui??o silenciosa. Vers?o do layout
`inclusao_v3_chaves_estaveis_xlsx` separa artefatos antigos. Remessas hist?ricas
permanecem dispon?veis. Datas internas ZIP/XLSX VRS s?o fixadas em
1980-01-01T00:00:00Z: metadado t?cnico sem significado de data da cess?o,
necess?rio para bytes e hashes reproduz?veis. CSV e conte?do de c?lulas n?o
recebem timestamp vari?vel. Download ZIP VRS tamb?m usa datas fixas.

## Valida??o local

- TypeScript: PASS.
- Su?te completa: 2325 PASS, 12 skipped (275 arquivos PASS, 3 skipped).
- Testes de uma parcela 001; tr?s 001/002/003; parcial 002/004; duas NFs;
  colis?o; paridade integral CSV/XLSX; XML priorit?rio; falhas de CNPJ;
  regenera??o em datas diferentes e conflito de payload: PASS.
- Lint: PASS (0 erros; warning preexistente em liquidacao.ts).
- Build webpack: PASS. git diff --check: PASS.
- Exemplos CSV/XLSX fict?cios atualizados com UUID e parcelas 002/004.

## Pend?ncias externas

VRS_PARTIAL_CESSION_VALUE_RULE = PENDING_VORTX_VALIDATION
VRS_DEBTOR_EMAIL_PHONE = PENDING_VORTX_VALIDATION

N?o h? envio autom?tico nem importa??o no ambiente V?rtx neste escopo.
Produ??o n?o autorizada. C2.1, C5, CERC, RLX Email e P16 fora do delta.
