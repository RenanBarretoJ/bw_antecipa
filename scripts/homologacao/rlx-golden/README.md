# RLX Golden Dataset V1

Massa sintética, determinística e exclusiva de homologação usada como contrato de entrada para os futuros motores financeiros da RLX.

As fixtures de Carteira são canônicas de QA e **não representam o layout definitivo da Administradora**. Estoque, Aquisições e Liquidações são inspirados no SC1/Sinqia conhecido, mas continuam sendo `GOLDEN TEST INPUTS`, não um contrato externo homologado.

## Segurança

- somente `.env.homolog` é carregado;
- `NEXT_PUBLIC_APP_ENV` deve ser `homolog` ou `homologacao`;
- a referência da API e do banco deve coincidir com `--expected-project-ref`;
- referências encontradas nos arquivos de produção são bloqueadas;
- `NODE_ENV=production` é bloqueado;
- seed e cleanup são dry-run por padrão;
- não existe opção de execução em produção.

## Comandos

```bash
npm run homolog:rlx:golden:fixtures -- --check
npm run homolog:rlx:golden:seed -- --expected-project-ref <REF>
npm run homolog:rlx:golden:seed -- --execute --expected-project-ref <REF> --confirm SEED_RLX_GOLDEN_HOMOLOG_<REF>
npm run homolog:rlx:golden:verify -- --expected-project-ref <REF>
npm run homolog:rlx:golden:cleanup -- --expected-project-ref <REF>
```

O cleanup real exige adicionalmente `--execute --confirm CLEANUP_RLX_GOLDEN_HOMOLOG_<REF>`. Ele usa somente IDs determinísticos do manifest; nunca usa busca por nome ou `LIKE`.

`RLX_GOLDEN_GESTOR_EMAIL` é opcional. Quando informado, o seed valida um perfil Gestor existente e concede acesso apenas ao fundo QA principal, sem alterar senha ou MFA.

O P2.1 não cria tabelas de Carteira, Estoque, Aquisições ou Liquidações, não executa conciliação, não define a regra de 40% e não modifica o domínio de Duplicata Mercantil do P2.0.
