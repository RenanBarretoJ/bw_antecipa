# P4 — Remessas operacionais por adapter e VRS

## Objetivo

O P4 remove do núcleo operacional a premissa de que toda remessa é CNAB. A operação passa a solicitar uma **remessa operacional** e a versão publicada da integração do fundo determina formato, agrupamento e disponibilidade de envio.

```text
Operação/lote
  -> modelo canônico (NF = ATIVO; parcela selecionada = FLUXO)
  -> integração CESSAO_ENVIO publicada do fundo
  -> definição do adapter
  -> estratégia de agrupamento
  -> arquivo(s) + XLSX VRS por Cedente (conferência genérica apenas no CNAB)
  -> Storage + trilha genérica e idempotente
```

As fontes principais são `operacoes_nf_parcelas`, `nota_fiscal_parcelas` e `operacao_calculo_nfs.parcela_id`. Parcelas não selecionadas não são reconstruídas por inferência e não entram na remessa.

## Declarações dos adapters

| Adapter | Formato | Agrupamento | Envio automático |
|---|---|---|---|
| `vortx_vrs` | `VRS_CSV` | `POR_CEDENTE` | Bloqueado até confirmação contratual do método, URL e headers de upload |
| `sinqia_portal_fidc` | `CNAB444` | `POR_LOTE` | Mantém o envio SOAP atual do Portal FIDC |

O core não aplica a regra “um arquivo por Cedente”. Ela pertence exclusivamente ao adapter VRS. O adapter Sinqia continua declarado `POR_LOTE`; o gerador legado atualmente recebe uma operação por chamada, sem ganhar um particionamento por Cedente.

## Contrato CSV VRS de Inclusão

Fonte de referência: material oficial local `ModelosRemessa-vert/inclusao/csv`. A saída utiliza:

- UTF-8 com BOM;
- delimitador `;`;
- fim de linha CRLF;
- um `HEADER` por arquivo;
- 41 colunas em `ATIVO`;
- 15 colunas no `FLUXO` do CSV de exemplo oficial;
- 8 colunas em `PAGAMENTO`.

O documento textual numera 16 posições para `FLUXO`, mas omite o índice 10; o CSV oficial contém 15 colunas. O serializador preserva o CSV de referência e não inventa a coluna ausente. No `PAGAMENTO`, a descrição limita o dígito da conta a um caractere, embora o exemplo mostre oito; a validação segue a descrição do campo e não o valor contraditório do exemplo.

### HEADER

| Índice | Campo VRS | Fonte BW/regra |
|---:|---|---|
| 0 | tipo_registro | Fixo `HEADER` |
| 1 | tipo | Fixo `Inclusão` |
| 2 | termo | `integracao_fundo_versoes.configuracao_nao_sensivel.vrs_inclusao.termo`; bloqueante |
| 3 | codigo_carteira | `configuracao_nao_sensivel.codigo_carteira`; bloqueante |
| 4 | cpf_cnpj_cedente | `cedentes.cnpj`, somente dígitos; bloqueante |
| 5 | coobrigacao | `cedentes.coobrigacao`, serializado como `Sim`/`Não` |

### ATIVO

| Índice | Campo VRS | Fonte BW/regra |
|---:|---|---|
| 0 | tipo_registro | Fixo `ATIVO` |
| 1 | chave_unica_do_ativo | `ATIVO_<notas_fiscais.id>` normalizado; persistida e estável |
| 2 | cnpj_do_originador | `configuracao_nao_sensivel.vrs_inclusao.cnpj_originador`; bloqueante |
| 3 | cpf_cnpj_do_emissor | Estabelecimento da própria NF; fallback para snapshot `notas_fiscais.cnpj_emitente`; bloqueante |
| 4 | cpf_cnpj_do_devedor | `notas_fiscais.cnpj_destinatario`; bloqueante |
| 5 | nome_devedor | `notas_fiscais.razao_social_destinatario`; bloqueante |
| 6–14 | endereço/contato do devedor | XML original, com complemento dos campos obrigatórios de endereço ausentes/inválidos pela consulta server-side de CNPJ; CEP, logradouro, número, bairro, município e UF continuam bloqueantes; complemento, e-mail e telefone são opcionais |
| 15 | tipo_do_ativo | Fixo `DM` |
| 16 | tipo_preco | `vrs_inclusao.tipo_preco`; `POSFIXADO` ou `PREFIXADO`; bloqueante |
| 17 | metodo_de_preco | `vrs_inclusao.metodo_preco`; bloqueante |
| 18 | valor_de_emissao | `notas_fiscais.valor_bruto` |
| 19 | valor_de_compra | Soma de `operacao_calculo_nfs.valor_presente` das parcelas selecionadas |
| 20 | valor_de_vencimento | Soma de `nota_fiscal_parcelas.valor_nominal` das parcelas selecionadas |
| 21 | data_de_emissao | `notas_fiscais.data_emissao` |
| 22 | data_de_inicio_vigencia | Igual à data de emissão, conforme mapeamento atual |
| 23–24 | vencimento/original | Maior vencimento entre as parcelas selecionadas |
| 25–26 | spread/percentual de índice | Vazios; não há fonte contratualmente confirmada |
| 27 | numero_da_emissao_do_ativo | `notas_fiscais.numero_nf`, somente dígitos |
| 28–30 | unidades/provisão/taxa | Vazios; não há fonte contratualmente confirmada |
| 31 | modalidade_operacao | `vrs_inclusao.modalidade_operacao`, quatro dígitos; bloqueante |
| 32 | quantidade_original_parcelas | Contagem em `nota_fiscal_parcelas` para a NF |
| 33 | valor_liquido_credito | Soma do valor presente das parcelas selecionadas |
| 34 | valor_total_credito | `notas_fiscais.valor_bruto` |
| 35 | nome_registradora | `vrs_inclusao.registradora`; `B3` ou `CERC`; bloqueante |
| 36 (posição física 37) | campo_customizado1 | Número da NF, somente dígitos, preservando zeros à esquerda |
| 37 (posição física 38) | campo_customizado2 | Chave de acesso da NF como texto; exige 44 dígitos |
| 38–40 | campos customizados 3–5 | Vazios |

### FLUXO

Cada linha corresponde a um registro real de `operacoes_nf_parcelas` e à memória financeira da mesma `parcela_id`.

| Índice | Campo VRS | Fonte BW/regra |
|---:|---|---|
| 0 | tipo_registro | Fixo `FLUXO` |
| 1 | chave_unica_ativo | Mesma chave do ATIVO da NF |
| 2 | chave_unica_parcela | `FLUXO_<nota_fiscal_parcelas.id>` normalizado; persistida e estável |
| 3 | cpf_cnpj_emissor_bancarizador | CNPJ do estabelecimento emissor da NF |
| 4–5 | vencimento/original | `nota_fiscal_parcelas.data_vencimento` |
| 6 | data_pagamento | Vazio; fluxo ainda não liquidado |
| 7 | tipo_evento | Fixo `Amortizacao` |
| 8 | taxa_evento | Vazio; não inferido |
| 9 | valor_no_vencimento | `nota_fiscal_parcelas.valor_nominal` |
| 10–14 no CSV real | reservados/customizados | Vazios |

### PAGAMENTO

| Índice | Campo VRS | Fonte BW/regra |
|---:|---|---|
| 0 | tipo_registro | Fixo `PAGAMENTO` |
| 1 | codigo_banco | Conta principal ativa do estabelecimento emissor da NF: `cedente_estabelecimento_contas_bancarias.banco_codigo`, COMPE com três dígitos; bloqueante |
| 2 | codigo_agencia | Conta principal ativa do estabelecimento emissor da NF: `agencia`, quatro caracteres aceitos; bloqueante |
| 3–4 | conta e dígito | Conta principal ativa do estabelecimento emissor da NF: `conta` no formato `numero-digito`; bloqueante |
| 5 | cpf_cnpj_favorecido | CNPJ normalizado do `titular_estabelecimento_id` da conta resolvida |
| 6 | nome_do_favorecido | Razão social do `titular_estabelecimento_id` da conta resolvida |
| 7 | valor_da_transacao | Soma dos valores presentes das parcelas selecionadas do arquivo |

Valores são serializados com duas casas e vírgula decimal. Datas usam `dd/MM/yyyy`. Conteúdo com `;`, CR ou LF é rejeitado para impedir alteração estrutural do CSV.

A fonte bancária é resolvida individualmente pelo `estabelecimento_id` emissor de cada NF, sem inferência por tipo Matriz/Filial e sem fallback para os campos bancários legados de `cedentes`. O favorecido vem exclusivamente do titular explicitamente vinculado à conta. Assim, uma Filial com conta própria usa a própria Filial como favorecida, enquanto uma Filial que utiliza a conta da Matriz usa a Matriz. Titular ausente ou pertencente a outro Cedente bloqueia a geração.

Matriz e Filial podem compartilhar o mesmo destino bancário e titular. Se as NFs de uma mesma sub-remessa `POR_CEDENTE` resolverem destinos distintos, a geração é bloqueada com `REMESSA_VRS_MULTIPLAS_CONTAS_NAO_SUPORTADA`, pois o layout homologado não comprova a associação de múltiplos registros `PAGAMENTO` aos respectivos ativos.

## Persistência

- `remessas_operacionais`: agregado do lote, fundo, versão da integração, adapter, agrupamento, hash do payload, idempotência e Excel.
- `remessa_operacional_arquivos`: uma sub-remessa por saída real do adapter, com Cedente quando aplicável, formato, Storage, hash e estado individual.
- `remessa_operacional_operacoes`: relação N:N entre lote e operações.
- `remessa_operacional_chaves`: vínculo auditável de ATIVO/FLUXO com operação, NF e parcela.

As tabelas possuem RLS. Usuários autenticados recebem somente `SELECT`, condicionado ao acesso ao fundo; mutações são restritas ao backend com `service_role`. As rotas exigem Gestor, sessão MFA elevada e fazem uma leitura RLS da operação/remessa antes de chamar serviços administrativos.

## Downloads

Para VRS, `Baixar Excel` produz um XLSX por Cedente nas abas `HEADER`, `ATIVO`,
`FLUXO` e `PAGAMENTO`, com os cabeçalhos do arquivo de referência
`inclusao_modelo.xlsx`. Cada aba contém cabeçalho na primeira linha e dados a
partir da segunda; o tipo de registro não ocupa uma coluna. O número da NF e a
chave ficam em `ATIVO!AJ` e `ATIVO!AK`. Chaves, CNPJs, CEPs e contas permanecem
texto, preservando zeros e os 44 dígitos. Os valores usam o mesmo mapeamento do
CSV, sem novo cálculo financeiro.

Se houver mais de um Cedente no lote, esse download retorna um ZIP contendo um
XLSX por Cedente, preservando um único HEADER por workbook. O MIME e a extensão
do download acompanham o arquivo gerado. O integrador CNAB mantém o Excel de
conferência genérico do lote.

`Baixar pacote de remessas` produz um ZIP com exatamente as sub-remessas persistidas. O conteúdo é relido do Storage e validado contra SHA-256 antes da entrega; o Excel de conferência não é inserido no pacote.

## Envio automático VRS

O envio Vórtx permanece deliberadamente bloqueado. A geração, persistência, Excel e ZIP estão disponíveis, mas não existe implementação de upload até que método HTTP, URL e headers sejam confirmados formalmente. Nenhum endpoint foi inferido a partir do teste mTLS. O envio Sinqia/Portal FIDC continua usando o contrato SOAP existente.

## Complemento de endereço e histórico de arquivos

O fallback de endereço é exclusivo da geração VRS e reutiliza
`cadastro/cnpj.server.ts` (BrasilAPI, timeout de 8 segundos). Preserva os campos
válidos do XML e consulta somente quando algum campo obrigatório está ausente
ou inválido; não consulta apenas para preencher telefone, e-mail ou complemento
opcionais. A resolução compartilha uma consulta por CNPJ dentro do lote e limita
a quatro consultas concorrentes. Erro, timeout ou resposta ainda incompleta
bloqueiam a geração com indicação da NF e dos campos pendentes.

Não há UPDATE na NF, no sacado ou em cadastros históricos. A origem (`xml`,
`cnpj` ou `xml_cnpj`) e os campos complementados entram no modelo usado no hash;
o evento de geração registra IDs das NFs e campos consultados, sem copiar o
endereço ou a resposta da API para o log.

A versão `inclusao_v3_chaves_estaveis_xlsx` integra a chave de idempotência VRS. Isso
permite gerar o novo layout sem sobrescrever remessas anteriores. A mesma
versão e o mesmo payload reutilizam o arquivo existente; alteração de payload
continua bloqueando reprocessamento. Downloads de remessas antigas preservam
seus arquivos originais (inclusive o Excel genérico antigo).

O XLSX de referência foi preservado como fixture sintética de teste. Seu TXT
acompanhante possui lacunas de colunas que não existem no workbook real; o
serializador segue o workbook real, com 5/40/14/7 colunas por aba, respectivamente.
Exemplo somente para inspeção: [XLSX fictício](exemplos/vrs-inclusao-ficticia.xlsx)
e [CSV fictício](exemplos/vrs-inclusao-ficticia.csv). Não são arquivos operacionais.

## Arquivos centrais

- `src/lib/remessas/domain.ts`: contrato canônico, agrupamento e chaves estáveis.
- `src/lib/remessas/loader.server.ts`: resolução das fontes reais e versão publicada da integração.
- `src/lib/remessas/vrs/mapper.ts`: mapeamento BW → VRS e bloqueios.
- `src/lib/remessas/vrs/csv.ts`: serialização oficial do CSV.
- `src/lib/remessas/service.server.ts`: idempotência, Storage, persistência, downloads e despacho.
- `src/lib/remessas/adapters/cnab444.server.ts`: compatibilidade do gerador CNAB legado.
- `src/lib/integracoes/registry.server.ts`: formato e agrupamento declarados por adapter.
- `src/app/api/contratos/gerar-remessa/route.ts`: geração e downloads autorizados.
- `src/app/api/contratos/enviar-remessa/route.ts`: envio autorizado ou bloqueio contratual explícito.
- `supabase/migrations/20260826211301_p4_remessas_operacionais_adapter.sql`: schema genérico, índices, grants e RLS.
- `supabase/migrations/20260826211522_p4_index_remessas_gerado_por.sql`: índice incremental da FK de auditoria.
