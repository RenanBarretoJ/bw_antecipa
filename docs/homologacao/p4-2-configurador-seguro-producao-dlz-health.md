# P4.2 — Configurador seguro de produção DLZ/HEALTH

Data da certificação local: 27/08/2026  
Alvo executado: clone local isolado  
Produção real: integralmente `READ-ONLY`; nenhuma escrita executada

## Resultado executivo

```text
P4_2_CONFIGURADOR_DLZ = PASS

DLZ_CONFIG_MANIFEST = PASS
DLZ_CONFIG_GUARDS = PASS
DLZ_CONFIG_PRECONDITIONS = PASS
DLZ_CONFIG_ATOMICITY = PASS
DLZ_CONFIG_IDEMPOTENT = PASS
POLITICA_DLZ_CONFIGURADOR = PASS
GATE_SACADO_CONFIGURADOR = PASS
RISCO_FINANCEIRO_DLZ = NAO_APLICAVEL
TEMPLATES_DLZ_CONFIGURADOR = COMPAT_LEGADO
CNAB_DLZ_CONFIGURADOR = PASS
INTEGRACAO_DLZ_CONFIGURADOR = LEGACY_ENV_SINQIA_TERRA
IMPULSE_INALTERADO = PASS
DLZ_READINESS = READY
P4_2_DRY_RUN = DETERMINISTICO

DLZ_CUTOVER_CONFIG_READY = PASS
CUTOVER_PRODUCAO = NO_GO
```

O P4.2 elimina exclusivamente o bloqueio de configuração operacional do DLZ. O cutover continua proibido porque `P4_1_INFRA_PRODUCAO = FAIL`.

## Artefatos e hashes

| Artefato | Identidade |
|---|---|
| Manifesto DLZ | `rehearsal/manifests/dlz-production-config.json` |
| SHA-256 manifesto DLZ | `886a8346426ecda2f473dc2d768aacd6d62b1cca47663eac3fff1aa38e51e749` |
| Manifesto migrations | `cc708283d55bae027ec3d1cd47ed47edb955bcd47bd84a64049008692628a318` |
| Preflight SQL | `4a0e319714c64c562b3baef86a20a15d757062f7c371fd9a4d6d7285981c62ad` |
| Hash semântico final | `1b55d710a0079cc957057271c21247e25c0c72c7c0b3e6e188dee2b7c592b7be` |
| Hash dos dois ciclos | `d53678ecf11a1cbe619cbd05342949ec8b8b4a4339bff411dc17db5ddc6f3ea5` |

O manifesto contém somente IDs, flags e metadados não sensíveis. Não contém usuário/senha Sinqia, tokens, SMTP, service role, strings de conexão ou certificados.

## Arquitetura do executor

```text
Manifesto DLZ + manifesto de migrations + preflight aprovado
                         ↓
            guardas fail-closed de alvo
                         ↓
          precondições históricas/schema
                         ↓
       transação única + advisory lock por DLZ
                         ↓
 política → 12 vínculos → CNAB → metadata integração
                         ↓
         verificação semântica + auditoria
                         ↓
                  COMMIT ou ROLLBACK
```

Modos:

- `--plan`: transação read-only; informa `create` ou `identify_equivalent`;
- `--apply`: DML transacional, com lock por fundo e auditoria sanitizada;
- `--verify`: read-only; exige o estado completo e retorna `READY`.

O executor não usa upsert silencioso. Estado equivalente vira no-op; estado divergente falha antes de qualquer overwrite.

## Guardas de produção

O apply futuro em produção exige simultaneamente:

1. ambiente explicitamente `production`;
2. project ref `wwsndnuvnjuabpbjwlck` detectado na conexão e confirmado na CLI;
3. fundo `7a114257-7816-468e-adf4-d796b93364df`;
4. hash exato do manifesto de migrations;
5. hash exato do manifesto DLZ;
6. preflight explicitamente aprovado e hash coincidente;
7. `ALLOW_DLZ_PRODUCTION_CONFIG=true`;
8. frase `DLZ_HEALTH_PRODUCTION_CUTOVER`;
9. URL de banco fornecida somente no ambiente de execução.

Qualquer ausência aborta antes da transação de escrita. Hostname isolado nunca é suficiente.

## Estado operacional configurado

### Política

- versão 1 publicada para novas operações;
- aceite do Sacado obrigatório;
- cessão no desembolso;
- risco financeiro, PL, exposição e gate financeiro desativados;
- nenhuma exigência documental/logística não certificada;
- 12 atribuições ativas, uma por `cedente_fundo` DLZ;
- zero alteração retroativa nas 45 operações e 903 NFs.

### Templates

Modo `COMPAT_LEGADO`, com validação da presença dos três templates homologados no repositório. Nenhum conteúdo jurídico foi criado ou convertido.

### CNAB

Layout `cnab444`, versão `H/D/T`, banco `001` e código originador textual `00000000000000500497`, preservando zeros à esquerda. O golden test certificado valida o posicionamento; nenhum arquivo foi enviado.

### Integração

Somente metadata não sensível:

```text
DLZ → CESSAO_ENVIO → sinqia_portal_fidc → legacy_env_sinqia_terra
```

O schema legado exige `credential_ref NOT NULL`; por isso é usado o marcador não secreto `legacy-env:FROMTIS`. `credencial_integracao_id` permanece nulo, `credential_required=false`, e os valores `FROMTIS_*` continuam exclusivamente no ambiente da aplicação.

## Precondições validadas

- cadeia de 3 bridges + 175 migrations promovíveis aplicada;
- cinco migrations exclusivas de homologação ausentes;
- patch P3.1 comprovado por 12 Cedentes ativos no DLZ;
- 45 operações, 903 NFs, 123 documentos, 1.635 objetos Storage, 23 users/profiles e 26 remessas legadas preservados;
- DLZ ativo e ator certificado ativo;
- histórico sem snapshot inventado;
- IMPULSE sem configuração operacional.

## Atomicidade, idempotência e conflito

Uma falha foi injetada após os inserts e antes da validação final. O rollback removeu política, CNAB, integração, vínculos e auditoria parciais. O primeiro apply criou o estado; o segundo retornou `changed=false`, mantendo o mesmo hash.

Foram executados e revertidos cenários de:

- política publicada divergente;
- CNAB divergente;
- patch de Cedentes incompleto;
- migration bloqueada presente;
- tentativa de configurar IMPULSE;
- ambiente, project ref, fundo, manifests, preflight, flag de janela e confirmação incorretos.

Todos falharam de forma fechada e sem DML parcial.

## Rehearsal e evidências

Dois ciclos completos reconstruíram o clone original, aplicaram a cadeia, o patch, plan/apply/apply/verify, readiness e E2E Sacado. Ambos produziram o mesmo hash final. A identidade semântica dos vínculos usa `cedente_id + fundo_id + política`; UUIDs surrogate de `cedente_fundos` podem ser regenerados pelo restore sem alterar o negócio.

Evidências principais:

- `rehearsal/reports/P4_2_DLZ_DRY_RUN.json`;
- `rehearsal/reports/P4_2_DLZ_VERIFY.json`;
- `rehearsal/reports/P3_1_DLZ_READINESS.json`;
- `rehearsal/reports/P3_1_DLZ_SACADO_E2E.json`.

## Limitações e decisão

O configurador está pronto para a janela, mas não autoriza a janela. Permanecem bloqueantes os itens P4.1: Vercel Production Environment, Auth/MFA/SMTP, backup/PITR, restore/RTO e rollback comprovado. Não houve apply, migration, deploy, alteração de secret ou chamada externa em produção neste ticket.

Decisão final: `DLZ_CUTOVER_CONFIG_READY = PASS`, mantendo `CUTOVER_PRODUCAO = NO_GO`.
