# P3 — Runbook de rollback de produção

## Princípio

Não criar down-migrations improvisadas durante incidente. A aplicação volta por redeploy do commit anterior. Para esta janela, o banco volta pelo backup lógico final da opção B quando uma alteração material não puder ser corrigida com segurança.

## Gatilhos objetivos

Iniciar rollback se ocorrer qualquer condição:

- contagem diferente de 46 operações históricas;
- contagem diferente de 910 NFs;
- perda dos 123 documentos ou 1.644 metadados Storage;
- RLS impede histórico legítimo ou expõe outro fundo/Cedente;
- login de Gestor, Cedente, Sacado ou Super Admin falha;
- MFA/AAL2 não pode ser concluído;
- integração/configuração publicada não carrega;
- histórico das 26 operações Fromtis fica indisponível;
- nova operação falha depois das configurações aprovadas;
- erro de migration sem transação/compensação comprovada;
- qualquer saída externa indevida durante o smoke.
- migration falha depois de iniciar a cadeia material;
- postflight diverge da baseline aprovada;
- Storage histórico fica indisponível;
- configuração DLZ falha ou fica parcialmente aplicável;
- rollback da aplicação não resolve porque o banco já mudou.

## Aplicação

1. manter novas operações congeladas;
2. redeployar o commit imediatamente anterior;
3. validar login e leitura histórica;
4. não reabrir operação enquanto o banco estiver em avaliação.

## Banco

1. manter o freeze de DML e interromper a aplicação nova;
2. registrar correlation ID, migration/etapa exata, horário e evidência da falha;
3. confirmar que o backup final pré-cutover existe, está fora do Git e possui checksums válidos;
4. obter a decisão de restore do owner formalmente designado para a janela;
5. restaurar o dump em destino controlado conforme o procedimento certificado, sem down-migrations improvisadas;
6. validar 12 Cedentes, 46 operações, 910 NFs, 123 documentos, 1.644 metadados Storage, 23 usuários/profiles, 26 operações Fromtis e zero órfãos críticos;
7. validar schema, migration history, grants, RLS, Auth e acessibilidade do histórico de Storage;
8. redeployar o commit anterior da aplicação;
9. executar smoke autenticado de Super Admin, Gestor, Cedente e Sacado, além da leitura histórica multifundo;
10. reabrir operações somente após aprovação conjunta do owner do restore, responsável técnico e responsável de negócio;
11. registrar incidente e nova janela; não continuar a cadeia no mesmo estado incerto.

## Opção B — backup e restore alternativo

### RPO

O RPO proposto é o estado capturado no backup final imediatamente anterior ao cutover. Ele só é válido quando o freeze de DML estiver ativo antes do início do dump e permanecer ativo até o término validado do backup.

### RTO

O RTO máximo formalmente aceito é de **30 minutos**. A evidência técnica inclui restore de aproximadamente 4,6 segundos, drill completo de aproximadamente 5,3 segundos e exercício amplo anterior de aproximadamente 36,9 segundos; a margem restante cobre decisão, validações, redeploy e smoke. O RTO cobre banco lógico, metadata de Storage e validações, mas não representa restauração de binários físicos do Storage removidos externamente. A janela de fim de semana reduz o impacto operacional, sem relaxar o RTO ou qualquer gate.

### Owner

O owner do restore é o **usuário responsável pelo cutover**, disponível durante toda a janela e com autoridade para acionar ou decidir o restore conforme os gatilhos deste runbook. O canal de acionamento deve ser o log operacional/war room da janela, associado ao correlation ID e sem PII desnecessária. A identidade nominal do executor deve ser registrada no log efêmero da janela, não neste documento versionado.

### Limitações

- o dump lógico cobre banco e metadata de Storage, não os objetos binários;
- credenciais de roles customizadas podem exigir restauração por fonte segura;
- configurações externas, Secrets e Edge Functions não são revertidos pelo dump;
- Auth e links de e-mail devem ser revalidados depois da restauração;
- o restore deve ocorrer com a aplicação indisponível para escrita.

### Drill local certificado

Executar somente contra `127.0.0.1:55322`:

```powershell
node rehearsal/p4-7/rollback-drill-local.mjs
```

O drill verifica checksums do clone-base, aplica mutação sintética local, comprova a divergência, restaura o snapshot e exige o retorno ao hash e às invariantes originais.

## Critério para desistência do rollback

Somente cancelar o rollback se o problema for comprovadamente restrito à aplicação, o redeploy anterior restaurar o serviço e as invariantes do banco permanecerem idênticas ao baseline.
