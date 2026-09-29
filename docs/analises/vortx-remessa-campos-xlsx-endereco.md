# Vortx — campos da NF, XLSX de inclusão e endereço do sacado

Implementação local em 29/09/2026, na branch
`fix/vortx-remessa-xlsx-endereco`, baseada em `origin/main` no commit
`83ece9c676a4f39ff130a8885847735c8b1da17d`.
Sem commit, push, migration, escrita em ambiente remoto ou deploy nesta etapa.

## Resultado

- ATIVO no CSV: posição física 37 (índice 36) recebe o número da NF; posição
  38 (índice 37) recebe a chave de acesso. Número mantém zeros à esquerda;
  chave deve ter 44 dígitos, sem conversão para número. Ausência ou formato
  inválido bloqueiam a geração.
- XLSX VRS: quatro abas `HEADER`, `ATIVO`, `FLUXO`, `PAGAMENTO`, com cabeçalhos
  e ordem do modelo local `ModelosRemessa-vert/inclusao/excel/inclusao_modelo.xlsx`.
  O XLSX não inclui a coluna de tipo de registro do CSV. Os customizados ficam
  em `ATIVO!AJ` (número) e `ATIVO!AK` (chave). Todas as células de dados são texto,
  como no modelo, protegendo CNPJs, CEPs e chaves longas.
- Um Cedente: download `.xlsx`. Vários Cedentes: download `.zip`, com um XLSX
  por Cedente; cada workbook mantém um HEADER. O pacote CSV continua separado.
- Endereço: campos obrigatórios válidos do XML têm prioridade. Se algum faltar,
  consulta server-side do CNPJ do sacado completa somente esses campos. Usa o
  serviço BrasilAPI já existente, sem nova dependência. Não consulta por ausência
  exclusiva de telefone/e-mail/complemento opcionais.
- Uma consulta por CNPJ por geração, no máximo quatro simultâneas, com timeout
  de oito segundos por consulta herdado do serviço. Consulta indisponível,
  resposta incompleta ou de outro CNPJ bloqueiam a geração; nada é inventado.
- Nenhuma alteração em cadastros ou no XML histórico. Fonte e campos consultados
  ficam no modelo usado no hash e na auditoria de geração, sem copiar a resposta
  cadastral para o log.

## Compatibilidade

O XLSX de referência foi inspecionado diretamente e preservado como fixture
sintética. O TXT acompanhante menciona lacunas de colunas inexistentes no XLSX
real; a implementação segue os cabeçalhos contíguos do workbook (5/40/14/7).
O SHA-256 da referência está em `src/lib/remessas/vrs/xlsx-layout.ts`.

A chave de idempotência VRS inclui `inclusao_v3_chaves_estaveis_xlsx`. Remessas anteriores
permanecem disponíveis com seus arquivos originais. Clicar em Gerar Remessa
produz a nova versão sem sobrescrever a antiga; repetições com o mesmo payload
reutilizam a nova remessa. Payload diferente continua bloqueado. Como a consulta
externa pode mudar, alterações cadastrais entre tentativas podem exigir revisão
antes do reprocessamento, preservando essa proteção existente.

O integrador Sinqia/CNAB mantém seu Excel de conferência, sua chave de idempotência
e não passa a consultar CNPJ para o endereço. Autorizações de Gestor, MFA, RLS e
grants não foram alteradas. O envio automático VRS continua bloqueado.

## Validação

- Suíte geral: **2.303 testes passaram; 12 ignorados**, em 274 arquivos aprovados
  e três ignorados.
- Verificação final focada em remessas: **47 testes passaram**, incluindo o
  carregamento VRS e a preservação do comportamento Sinqia.
- TypeScript: PASS.
- ESLint: zero erros; um aviso preexistente em `actions/liquidacao.ts`.
- Build Next.js com webpack: PASS.
- `git diff --check`: PASS.
- CSV: comparação das posições físicas 37/38, mantendo 41 campos.
- XLSX: comparação dos cabeçalhos de todas as abas com o workbook de referência;
  conferência de chaves como texto, parcelas selecionadas e separação por Cedente.
- Fallback: XML completo, XML ausente/PDF, preenchimento parcial, concorrência,
  deduplicação, timeout, indisponibilidade, cadastro incompleto e CNPJ divergente.
- Exemplo gerado conferido independentemente com parser XML/ZIP Python: quatro
  abas, contagens de colunas e células AJ2/AK2 correspondentes ao CSV.

Arquivos fictícios para inspeção, sem dados operacionais e impróprios para envio:
[XLSX](../integracoes/exemplos/vrs-inclusao-ficticia.xlsx) e
[CSV](../integracoes/exemplos/vrs-inclusao-ficticia.csv).

Não executados: geração autenticada em homolog/produção com esta versão nem
importação/aceite do arquivo pela Vortx. A conformidade local com o modelo não
equivale a homologação externa da importação.

## Código

- `remessas/vrs/mapper.ts`: novos campos e validação de chave da NF.
- `remessas/vrs/xlsx-layout.ts` e `xlsx.ts`: contrato de abas e saída VRS.
- `remessas/xlsx.ts`: serialização OOXML compartilhada, preservando conferência CNAB.
- `remessas/vrs/endereco-sacado.server.ts`: complemento tipado e limitado por CNPJ.
- `remessas/loader.server.ts`: aplicação do fallback somente para VRS.
- `remessas/service.server.ts`: artefatos, versão de layout e auditoria.
- `app/api/contratos/gerar-remessa/route.ts`: MIME de XLSX ou ZIP conforme artefato.

As fontes completas ficam sob `src/lib/`, exceto a rota explicitada acima.
