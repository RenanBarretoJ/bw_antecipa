# R1.1 — contrato de identidade fiscal (antes da migration)

Fontes: migration HEALTH 20261002205122; nfse/municipal-visual-contract.ts;
nfse/review-facts.ts; nfse/persistence.ts; RPCs RLX 20260929214436/220304/221000.

| Documento | Material canônico | Persistência / rejeição |
| --- | --- | --- |
| NF-e | chave nacional de 44 dígitos, validada no parser; RPC conserva vínculo com CNPJ da chave | chave obrigatória; ausente rejeitada |
| NFS-e nacional | chave nacional de 50 dígitos, não repetitiva | chave obrigatória; estratégias nacionais preservadas |
| NFS-e municipal | JSON compacto `["NFSE_MUNICIPAL", CNPJ, orgao_emissor, numero_nf]` | chave_acesso NULL; todos os componentes obrigatórios |
| Sem identidade suficiente | nenhum material substituto | rejeitar; não reservar por arquivo, valor, data ou hash binário |

O CNPJ é completo, com 14 dígitos, validado pelo parser. O órgão é normalizado
por NFD, remoção de diacríticos, espaços colapsados, trim e maiúsculas. O SQL
exige a forma já normalizada (8–200 caracteres, prefixo PREFEITURA/MUNICIPIO/
SECRETARIA e alfabeto ASCII restrito). O número remove pontos e zeros à
esquerda no parser; a forma persistida é positiva, de 1 a 15 dígitos.

Unicidade municipal é global, no índice parcial `nfse_municipal_identity_unique`:
CNPJ emitente + órgão + número, somente NFSE/strategy nfse_municipal_visual.
Não inclui fundo, código de verificação, valor ou vencimento. O código de
verificação permanece obrigatório na proveniência, mas não muda a identidade.

O hash existente é SHA-256 UTF-8 do material acima, tanto nos review intents
quanto na reserva. Não mudar hashes nacionais nem serialização municipal.
`p_fiscal_key` permanece com sua assinatura por compatibilidade e passa a
transportar esse material municipal; não é gravado como chave_acesso.

Plano: helpers privados sem grants novos, CREATE OR REPLACE apenas nas três
funções conflitantes; mesmos guards de ator/MFA/fundo/lease, locks, journal e
ACL. HEALTH e RLX devem existir antes da forward, em qualquer ordem. Sem DML
histórico, novas colunas, replay A6/P14 ou alteração remota.
