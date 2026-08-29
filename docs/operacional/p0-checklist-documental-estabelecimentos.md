# P0/P1 — Checklist documental correto para Matriz/Filial + Configurar requisito

## Resultado

`P0_CHECKLIST_DOCUMENTAL_ESTABELECIMENTOS = PASS`

- Ambiente validado: homologação.
- Projeto Supabase: `fhgkmggthxikfpogrvaa`.
- Produção: não acessada nem alterada.
- Branch: `homolog`.

## Causa raiz

**Catálogo errado no dropdown.** `EstabelecimentosGestor.tsx` consultava `documento_tipos` filtrando apenas `.eq('ativo', true)`, sem nenhum filtro de domínio. `documento_tipos` já possui o campo estrutural `dominio` (`CHECK IN ('nf', 'operacao', 'juridico', 'entrega', 'integracao')`), usado para classificar tipos de lastro/logística/jurídico — mas nunca existiu um valor para documentos cadastrais de estabelecimento. Resultado: o dropdown mostrava literalmente todo o catálogo ativo (XML da NF-e, DANFE, Pedido de Compra, CT-e, Canhoto etc.).

**"Configurar requisito" não persistia.** A RPC `configurar_requisito_estabelecimento_gestor` (criada em `20260818200641_multi_cnpj_cedente_estabelecimentos.sql`) já chamava `private.gestor_tem_acesso_cedente(cedente_id)` para autorização — mas essa função **não existia** até ser criada, coincidentemente, pelo P0 anterior desta mesma sessão (`20260819140000_p0_mutacoes_cadastro_cedente_gestor.sql`, aplicado momentos antes deste escopo). Ou seja, toda chamada a `configurar_requisito_estabelecimento_gestor` (e também `decidir_estabelecimento_gestor`, que usa a mesma função) falhava com `function private.gestor_tem_acesso_cedente(uuid) does not exist` desde que a funcionalidade de Multi-CNPJ foi introduzida — coerente com o relato de "não persiste/funciona corretamente". Este escopo **confirmou ao vivo** que a RPC já funciona corretamente agora; nenhuma mudança de código foi necessária para esse ponto especificamente.

Classificação:

| Código | Resultado | Evidência |
| --- | --- | --- |
| `WRONG_DOCUMENT_CATALOG_SCOPE` | Confirmado | Dropdown sem filtro de `dominio`; `documento_tipos` já tinha o campo, mas sem valor cadastral. |
| `MISSING_DOCUMENT_PURPOSE_CLASSIFICATION` | Parcialmente confirmado | O campo de classificação já existia (`dominio`); faltava apenas o valor `cadastro` e as linhas de catálogo — não foi necessário criar coluna nova. |
| `REQUIREMENT_WRITE_AFTER_ACL_HARDENING` | Não confirmado como causa ativa | Grants/RLS de `cedente_estabelecimento_requisitos` já estavam corretos desde a migration de Multi-CNPJ; a falha era a dependência ausente (`private.gestor_tem_acesso_cedente`), já sanada por outro escopo. |
| `RLS_GAP` | Não encontrado | A regra multifundo já estava corretamente implementada na RPC. |
| `UNRESOLVED` | Zero | Confirmado ao vivo antes de declarar a persistência como já resolvida. |

## Catálogo antes/depois

Antes: dropdown mostrava todo `documento_tipos` ativo, incluindo `nf_xml`, `nf_danfe_pdf`, `nf_pedido_compra` e demais tipos de lastro/logística/jurídico cadastrados por outras fases do projeto.

Depois: dropdown filtra por `dominio = 'cadastro'`, mostrando exclusivamente:

- Cartão CNPJ do Estabelecimento (`estabelecimento_cartao_cnpj`)
- Comprovante de Endereço do Estabelecimento (`estabelecimento_comprovante_endereco`)
- Contrato Social / Alteração Contratual (`estabelecimento_contrato_social`)
- Comprovante de Faturamento (`estabelecimento_comprovante_faturamento`)

Este conjunto foi definido em conjunto com o solicitante antes da implementação.

## Classificação documental adotada

Reaproveitado o campo já existente `documento_tipos.dominio`, ampliando o `CHECK` para incluir `'cadastro'`, em vez de criar coluna ou tabela paralela. Não foi criada distinção formal `CADASTRO_CEDENTE` vs `CADASTRO_ESTABELECIMENTO`: o cadastro do Cedente já usa um mecanismo totalmente separado (`documentos` + enum `documento_tipo`), não a tabela `documento_tipos`; portanto o valor `'cadastro'` em `documento_tipos` é usado exclusivamente pelo checklist de Estabelecimento, sem ambiguidade.

## Fluxo de configuração antes/depois

Antes (nunca funcionou desde a introdução do Multi-CNPJ):

```text
Gestor -> Server Action -> RPC configurar_requisito_estabelecimento_gestor
  -> chama private.gestor_tem_acesso_cedente(cedente_id)
     -> function private.gestor_tem_acesso_cedente(uuid) does not exist
  -> erro, nada persiste
```

Depois (confirmado ao vivo):

```text
Gestor autenticado
  -> Server Action configurarRequisitoEstabelecimento (inalterada)
  -> RPC configurar_requisito_estabelecimento_gestor (inalterada)
       -> valida auth.uid()
       -> valida vinculo do gestor ao fundo do cedente do estabelecimento
          (private.gestor_tem_acesso_cedente, agora existente)
       -> valida tipo documental ativo
       -> INSERT ... ON CONFLICT (estabelecimento_id, documento_tipo_id) DO UPDATE
  -> persiste corretamente; UI recarrega e mostra o requisito configurado
```

## Segurança e autorização

- Nenhuma alteração de grants/RLS foi necessária nas tabelas de requisito — já estavam corretas (`SELECT` para `authenticated`, DML bloqueado, `EXECUTE` apenas nas RPCs).
- `configurar_requisito_estabelecimento_gestor` e `decidir_estabelecimento_gestor` continuam validando exclusivamente `auth.uid()` e o vínculo do gestor ao fundo do cedente do estabelecimento — nenhum campo de autoridade (`cedente_id`, `fundo_id`, `estabelecimento_id` de terceiro, status de aprovação) é aceito do cliente.
- Confirmado ao vivo: Super Admin puro, Cedente, Consultor (implícito, sem contrato), gestor sem vínculo, gestor de outro fundo e anônimo — todos `DENY` tanto para Matriz quanto para Filial.

## UX

- Placeholder trocado de `Adicionar requisito documental...` para `Adicionar documento cadastral obrigatorio...`.
- Adicionada listagem dos requisitos já configurados por estabelecimento, exibindo: nome do tipo documental, badge Obrigatório/Opcional, badge Ativo/Inativo, e botão Desativar/Reativar (reutiliza a mesma RPC, alternando `p_ativo`). Antes, a tela só continha o formulário de adicionar, sem nenhuma visibilidade do que já estava configurado.

## Arquivos alterados

- `src/components/cedentes/EstabelecimentosGestor.tsx`
- `src/components/cedentes/checklist-documental-estabelecimentos-architecture.test.ts` (novo)
- `scripts/homologacao/p0-checklist-documental-estabelecimentos/apply-migration.mjs` (novo)
- `scripts/homologacao/p0-checklist-documental-estabelecimentos/verify.mjs` (novo)
- `supabase/migrations/20260819150000_p0_catalogo_documental_cadastro_estabelecimento.sql` (novo)
- `package.json` (dois scripts novos de homologação)

Nenhuma RPC nova foi criada neste escopo — `configurar_requisito_estabelecimento_gestor` e `decidir_estabelecimento_gestor` já existiam e já estavam corretas; apenas o catálogo (`documento_tipos`) e a tela foram ajustados.

## Migration aplicada em homologação

`20260819150000_p0_catalogo_documental_cadastro_estabelecimento.sql`

- amplia `documento_tipos_dominio_check` para incluir `'cadastro'`;
- insere os 4 tipos documentais cadastrais listados acima (`ON CONFLICT (codigo) DO NOTHING`, idempotente);
- não altera nenhuma migration histórica; não houve `migration repair`.

## E2E autenticado em homologação

O verificador `scripts/homologacao/p0-checklist-documental-estabelecimentos/verify.mjs` reproduziu o fluxo real (onboarding do cedente via `concluir_onboarding_cedente`, aprovação do cadastro e da Matriz pelo gestor, cadastro da Filial via `cadastrar_filial_cedente`) com sessões reais do Supabase Auth, executou a matriz completa (13 verificações) e removeu toda a massa ao final. Insercao direta via `service_role` não foi usada para `cedentes`/`cedente_estabelecimentos`: os gatilhos de validação de CNPJ (`private.cnpj_valido`) são revogados até de `service_role`, então qualquer fixture precisa passar pelas RPCs reais — o que também serviu como confirmação adicional de que essas RPCs (usadas pelo fluxo real do Cedente) funcionam corretamente.

Resultados:

- catálogo: domínio `cadastro` contém exatamente os 4 tipos esperados; tipos de `nf_xml`/`nf_danfe_pdf`/`nf_pedido_compra` não aparecem nele: `PASS`;
- gestor do fundo correto configura requisito na Matriz: `ALLOW`;
- gestor do fundo correto configura requisito na Filial: `ALLOW`;
- gestor de outro fundo, vínculo revogado, Super Admin puro, Cedente, anônimo: `DENY` (Matriz e Filial);
- requisito persiste após releitura (equivalente a reload de página): `PASS`;
- desativação do requisito: `ALLOW` e persiste;
- zero cross-fund leak: gestor de outro fundo não lê os requisitos destes estabelecimentos.

Comandos:

```bash
npm run homolog:p0:checklist-documental:apply-migration
npm run homolog:p0:checklist-documental:verify
```

Os scripts possuem trava explícita para o project ref de homologação e bloqueiam o project ref configurado como produção.

### Pendente de validação manual

O percurso visual completo no navegador (Gestor → Cedente → CNPJs/Estabelecimentos → selecionar Filial → abrir dropdown → confirmar catálogo → adicionar requisito → reload → repetir para Matriz) não foi executado por este agente — requer interação de navegador. O E2E acima cobre banco, RPCs, catálogo e autorização com sessões reais. Como não houve commit/push (restrição deste escopo), o percurso manual pode ser reproduzido com `npm run dev:homolog` a partir deste mesmo diretório de trabalho.

## Riscos residuais

- Os 4 tipos documentais cadastrais foram definidos com o solicitante nesta sessão; qualquer ajuste futuro na lista (adicionar/remover tipo) deve seguir o mesmo padrão de migration idempotente (`ON CONFLICT (codigo) DO NOTHING`), nunca editar as linhas já inseridas por script ad-hoc.
- A dependência silenciosa entre `20260818200641` (RPCs de estabelecimento) e uma função `private.*` que só passou a existir em um P0 posterior não relacionado é um risco de processo (uma migration referenciou uma função inexistente sem falhar na aplicação, por causa da validação tardia do PL/pgSQL). Vale considerar, em um futuro passo de qualidade, adicionar smoke tests pós-migration que chamem cada RPC nova pelo menos uma vez em ambiente de homologação para detectar esse tipo de dependência ausente imediatamente.
- O percurso visual completo no navegador não foi executado por este agente (ver seção acima).

## Gates de qualidade executados

- `npx tsc --noEmit`: `PASS`.
- `npm test -- --run`: `PASS` — 155 arquivos e 1.081 testes aprovados; 1 arquivo e 3 testes ignorados pela suíte (pré-existentes).
- `npm run lint`: `PASS` sem erros; seis warnings preexistentes fora deste escopo.
- `git diff --check`: `PASS`.
- `npx next build --webpack`: `PASS`.
- `npm audit --omit=dev`: `PASS` — zero vulnerabilidades.
- secret scan: `PASS` — 1.163 arquivos textuais examinados, zero achados.
