# BW Antecipa — CNAB field mapping

Este documento descreve o mapeamento implementado na Fase 7 para o layout `cnab444`.

Fonte do layout em código: `src/lib/cnab/layouts/cnab444.ts`.

## Arquitetura

O fluxo técnico separa:

1. carregamento de dados: `src/lib/cnab/gerarCnab444.ts`;
2. resolução da configuração versionada: `src/lib/cnab/resolver-configuracao.ts`;
3. modelo intermediário: `src/lib/cnab/domain.ts`;
4. serialização posicional: `src/lib/cnab/layouts/cnab444.ts`;
5. validação posicional: `src/lib/cnab/validar-remessa.ts` e `layouts/cnab444.ts`;
6. persistência da remessa: `src/app/api/contratos/gerar-cnab/route.ts`.

A configuração CNAB é cadastro do fundo. A interface principal fica em `src/app/gestor/fundos/[id]/page.tsx`, aba `CNAB`. A rota `src/app/gestor/configuracoes-cnab/page.tsx` apenas redireciona para `/gestor/fundos` para evitar duas telas independentes editando a mesma configuração.

## Configuração CNAB versionada

Campos normalizados usados na geração:

| Campo | Origem |
|---|---|
| `layout` | `configuracao_cnab_versoes.layout` |
| `versaoLayout` | `configuracao_cnab_versoes.versao_layout` |
| `codigoBanco` | `configuracao_cnab_versoes.codigo_banco` |
| `banco` | `configuracao_cnab_versoes.banco` |
| `agencia` | `configuracao_cnab_versoes.agencia` |
| `conta` | `configuracao_cnab_versoes.conta` |
| `digitoConta` | `configuracao_cnab_versoes.digito_conta` |
| `carteira` | `configuracao_cnab_versoes.carteira` |
| `convenio` | `configuracao_cnab_versoes.convenio` |
| `codigoOriginador` | `configuracao_cnab_versoes.codigo_originador` |
| `codigoEmpresa` | `configuracao_cnab_versoes.codigo_empresa` |
| `tipoInscricao` | `configuracao_cnab_versoes.tipo_inscricao` |
| `numeroInscricao` | `configuracao_cnab_versoes.numero_inscricao` |
| `especieTitulo` | `configuracao_cnab_versoes.especie_titulo` |
| `tipoRecebivel` | `configuracao_cnab_versoes.tipo_recebivel` |
| opções específicas | `configuracao_cnab_versoes.configuracao` |

O hash canônico é calculado em `calcularHashConfiguracaoCnab`.

## Integração por fundo

CNAB e integração são conceitos separados:

- CNAB define formato, posições, códigos, banco, conta, layout e serialização.
- Fromtis define destino de envio, ambiente, identificação do cliente, referência de credencial e parâmetros não sensíveis da API.

A modelagem da integração fica em `integracoes_fundo` e `integracao_fundo_versoes`. A remessa registra `integracao_fundo_versao_id` somente quando for efetivamente enviada. Segredos não são armazenados nessas tabelas; elas guardam apenas `credential_ref`, `secret_name` ou `vault_key`.

## Header

| Campo CNAB | Origem | Transformação | Posição | Tam. | Tipo | Alinhamento | Preenchimento | Validação |
|---|---|---|---:|---:|---|---|---|---|
| identificação do registro | literal `0` | literal | 1 | 1 | alfa | - | literal | sempre `0` |
| identificação do arquivo | literal `1` | literal | 2 | 1 | alfa | - | literal | sempre `1` |
| literal remessa | configuração `literalRemessa` | `alfa(7)` | 3-9 | 7 | alfa | esquerda | espaço | default `REMESSA` |
| código serviço | configuração `codigoServico` | `num(2)` | 10-11 | 2 | num | direita | zero | default `01` |
| literal serviço | configuração `literalServico` | `alfa(15)` | 12-26 | 15 | alfa | esquerda | espaço | default `COBRANCA` |
| código originador | `configuracao_cnab_versoes.codigo_originador` | texto numérico com `padStart(20, "0")`, sem conversão para número | 27-46 | 20 | num textual | direita | zero | obrigatório; somente dígitos; máximo 20 caracteres; preserva zeros à esquerda |
| nome originador | `cedente.razaoSocial` | `alfa(30)` | 47-76 | 30 | alfa | esquerda | espaço | obrigatório |
| código banco | `codigoBanco` | `num(3)` | 77-79 | 3 | num | direita | zero | obrigatório |
| nome banco | `banco` | `alfa(15)` | 80-94 | 15 | alfa | esquerda | espaço | obrigatório |
| data gravação | data da remessa | `DDMMAA` | 95-100 | 6 | num | direita | zero | data válida |
| identificação sistema | configuração `identificacaoSistema` | `alfa(2)` | 109-110 | 2 | alfa | esquerda | espaço | default `MX` |
| sequencial arquivo | sequência reservada no banco | `num(7)` | 111-117 | 7 | num | direita | zero | transacional |
| sequência registro | índice da linha | `num(6)` | 439-444 | 6 | num | direita | zero | deve ser `000001` |

## Detalhe

| Campo CNAB | Origem | Transformação | Posição | Tam. | Tipo | Alinhamento | Preenchimento | Validação |
|---|---|---|---:|---:|---|---|---|---|
| tipo registro | literal `1` | literal | 1 | 1 | alfa | - | literal | sempre `1` |
| débito automático | literal legado | literal | 2-20 | 19 | alfa | - | literal | preserva gerador legado |
| coobrigação | `cedente.coobrigacao` | `01`/`02` | 21-22 | 2 | num | direita | zero | boolean |
| característica especial | configuração | `num(2)` | 23-24 | 2 | num | direita | zero | default `00` |
| modalidade operação | configuração | `num(4)` | 25-28 | 4 | num | direita | zero | default `0000` |
| natureza operação | configuração | `num(2)` | 29-30 | 2 | num | direita | zero | default `00` |
| origem recurso | configuração | `num(4)` | 31-34 | 4 | num | direita | zero | default `0000` |
| seu número | cedente + NF + operação | `alfa(25)` | 38-62 | 25 | alfa | esquerda | espaço | determinístico |
| ocorrência | configuração | `num(2)` | 109-110 | 2 | num | direita | zero | default `01` |
| documento | número NF | últimos 10 + `alfa(10)` | 111-120 | 10 | alfa | esquerda | espaço | obrigatório |
| vencimento | NF | `DDMMAA` | 121-126 | 6 | num | direita | zero | data válida |
| valor título | NF valor face | centavos `num(13)` | 127-139 | 13 | num | direita | zero | > 0 |
| espécie título | configuração | `num(2)` | 148-149 | 2 | num | direita | zero | obrigatório |
| emissão | NF | `DDMMAA` | 151-156 | 6 | num | direita | zero | data válida |
| valor presente | NF valor antecipado/liquido | centavos `num(13)` | 193-205 | 13 | num | direita | zero | > 0 |
| tipo inscrição sacado | configuração | `num(2)` | 219-220 | 2 | num | direita | zero | default `02` |
| inscrição sacado | NF CNPJ destinatário | digits `num(14)` | 221-234 | 14 | num | direita | zero | 14 dígitos |
| nome sacado | NF razão destinatário | `alfa(40)` | 235-274 | 40 | alfa | esquerda | espaço | obrigatório |
| número NF | NF | últimos 9 + `alfa(9)` | 315-323 | 9 | alfa | esquerda | espaço | obrigatório |
| CEP sacado | configuração default | `num(8)` | 327-334 | 8 | num | direita | zero | default `00000000` |
| nome cedente | cedente | `alfa(46)` | 335-380 | 46 | alfa | esquerda | espaço | obrigatório |
| inscrição cedente | cedente CNPJ | digits `num(14)` | 381-394 | 14 | num | direita | zero | 14 dígitos |
| chave NF-e | NF chave acesso | digits `padStart(44)` | 395-438 | 44 | num | direita | zero | até 44 dígitos |
| sequência registro | índice da linha | `num(6)` | 439-444 | 6 | num | direita | zero | crescente |

## Trailer

| Campo CNAB | Origem | Transformação | Posição | Tam. | Tipo | Alinhamento | Preenchimento | Validação |
|---|---|---|---:|---:|---|---|---|---|
| tipo registro | literal `9` | literal | 1 | 1 | alfa | - | literal | sempre `9` |
| sequência último registro | total de linhas | `num(6)` | 439-444 | 6 | num | direita | zero | igual a header + detalhes + trailer |

## Validações implementadas

- cada linha deve ter exatamente 444 caracteres;
- sequência de registros deve ser header `0`, detalhes `1`, trailer `9`;
- sequência final da linha deve coincidir com a posição da linha;
- quantidade de linhas deve ser `titulos + 2`;
- CNPJs de cedente e sacado devem ter 14 dígitos;
- valores de face/presente devem ser maiores que zero;
- datas de emissão/vencimento devem ser válidas;
- conteúdo final deve conter apenas ASCII imprimível nas linhas posicionais.

## Compatibilidade

A configuração importada por `importarConfiguracaoCnabLegado` usa os valores do gerador legado:

- banco `611`;
- nome banco `BBBBBBBBBBBBBBB`;
- código originador `00000000000000500497`, registrado em `configuracao_cnab_versoes.codigo_originador`;
- código empresa `00000000000000500497`, registrado separadamente em `configuracao_cnab_versoes.codigo_empresa`;
- espécie título `61`;
- tipo recebível `01`;
- sistema `MX`;
- serviço `COBRANCA`.

Essa compatibilidade é explícita e versionada; o gerador em si recebe esses valores pela configuração resolvida.
