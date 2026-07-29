# BW Antecipa — padrões de engenharia

Este é o documento compartilhado de regras permanentes para Codex, Claude e
agentes compatíveis. AGENTS.md e CLAUDE.md contêm apenas o resumo e as
instruções específicas de cada agente; em caso de dúvida, este documento é a
referência comum.

## 1. Objetivo e escopo

Toda implementação deve ser limpa, modular, reutilizável, tipada, testável,
segura, performática, compatível com a arquitetura atual e fácil de manter.

Cada tarefa deve ser executada em um escopo pequeno e controlado:

- implementar uma funcionalidade ou correção por vez;
- não agrupar alterações independentes;
- não antecipar fases não solicitadas;
- não refatorar áreas não relacionadas sem autorização;
- após cada escopo, parar e entregar para validação.

Fluxo obrigatório: diagnóstico → plano curto → implementação → testes →
revisão do diff → relatório → aguardar validação → próximo escopo.

## 2. Diagnóstico antes de programar

Antes de alterar código:

- mapear o fluxo atual e a fonte de verdade;
- localizar regras de domínio, componentes, actions, RPCs, migrations e RLS;
- pesquisar funções, tipos e componentes reutilizáveis;
- verificar testes existentes e compatibilidade legada;
- identificar impactos em gestor, cedente, sacado e consultor;
- verificar snapshots, versionamento, auditoria e histórico;
- não presumir arquitetura nem começar por código novo sem pesquisar o projeto.

## 3. Arquitetura

Manter responsabilidades separadas:

- Domínio: regras de negócio puras, tipadas e reutilizáveis.
- Aplicação: orquestração, actions e casos de uso.
- Infraestrutura: Supabase, Storage, e-mail, integrações e serviços externos.
- Apresentação: páginas, componentes e interação visual.
- Persistência: migrations, tabelas, views, RPCs, constraints e RLS.

Não colocar regra de negócio em componente React, page.tsx, botão, hook visual,
CSS, middleware genérico ou query isolada de uma tela. Regras usadas por mais
de um portal devem ficar em módulo central; a diferença entre portais deve estar
na apresentação e autorização, não na duplicação do domínio.

## 4. Fontes de verdade do BW Antecipa

Usar as fontes canônicas e não fallbacks silenciosos:

- cedente_fundos: vínculo operacional entre cedente e fundo;
- usuario_fundos: autorização de usuário por fundo;
- snapshots de política: regra imutável aplicada à operação;
- eventos_dominio: histórico operacional em linguagem humana;
- auditoria: rastreabilidade técnica e de segurança;
- documentos_repositorio e documento_versoes: documentos e versionamento;
- instâncias documentais: estado dos requisitos aplicáveis.

Não consultar política viva para alterar operação histórica. Não usar campo legado
quando a arquitetura nova já definiu uma fonte canônica.

## 5. Reutilização e centralização

Antes de criar função, componente, helper ou tipo:

- pesquise equivalentes;
- evolua a abstração existente quando apropriado;
- evite forks de regra por portal;
- centralize autorização, contexto, capacidades, estado documental, validação,
  formatação, auditoria, eventos, datas, valores e tratamento de erros.

## 6. Clean Code

Obrigatório:

- nomes claros, funções pequenas e uma responsabilidade principal;
- retornos tipados e objetos nomeados em vez de booleanos ambíguos;
- early return quando melhorar a leitura;
- remoção de código morto e comentários que apenas repetem a sintaxe;
- comentários somente para decisões de domínio, compatibilidade ou riscos.

Evitar arquivos gigantes, múltiplos efeitos colaterais, condicionais por nome de
fundo/cedente, magic strings, magic numbers, casts excessivos, any,
as unknown as, erros ignorados, console.log permanente e TODO sem contexto.

## 7. TypeScript

Usar TypeScript estrito:

- não introduzir any; prefira unknown com narrowing;
- use unions discriminadas para estados e resultados;
- tipar retornos de domínio;
- validar dados externos em runtime;
- não confiar apenas nos tipos gerados;
- nunca aceitar payload do frontend como fonte de verdade.

Prefira uma união discriminada a um retorno vago como { success: boolean;
data?: any; error?: string } quando estados aprovados, rejeitados ou bloqueados
puderem ser modelados explicitamente.

## 8. Next.js e React

Preferir Server Components para leitura e composição, Client Components somente
para interação e Server Actions para mutações controladas. Validar novamente no
servidor, manter loading/erro explícitos e usar URL para filtros/paginação quando
aplicável.

Não carregar dados sensíveis no cliente sem necessidade, expor service_role,
duplicar queries, depender de estado React para segurança, usar useEffect para
lógica que pertence ao servidor ou transformar uma página inteira em Client
Component sem necessidade.

Antes de alterar Next.js, ler o guia relevante em
node_modules/next/dist/docs/ e respeitar deprecações da versão instalada.

## 9. Supabase e banco de dados

Toda mudança de banco deve considerar migration incremental e do zero,
idempotência, constraints, índices, RLS, grants, triggers, funções, rollback ou
compensação e dados existentes.

- Nunca editar migration já aplicada para corrigir ambiente existente; crie nova
  migration corretiva.
- Evitar SECURITY DEFINER; quando inevitável, validar autorização na função,
  definir search_path, restringir grants e documentar a justificativa.
- Não usar service_role para contornar RLS em rotas operacionais comuns.
- Validar SQL real quando o ambiente estiver disponível.

## 10. RLS e autorização

Proteger cada funcionalidade em camadas: interface → server action/API →
domínio → RLS → constraints do banco.

Toda action sensível deve validar autenticação, tenant, fundo, vínculo,
papel/permissão, contexto operacional, AAL2 quando exigido, pertencimento da
entidade e status válido para transição.

Testar tentativas de alterar arbitrariamente user_id, fundo_id, cedente_id,
nota_fiscal_id, operacao_id, documento_id, requisito_id e cookies de contexto.
O frontend nunca é camada de segurança.

## 11. Snapshots e histórico

Regras publicadas e aplicadas devem ser preservadas. Nunca alterar snapshot
histórico, recalcular operação antiga pela política viva, sobrescrever versão
publicada, criar requisito retrospectivo sem regra formal ou apagar evento para
“corrigir” histórico.

Quando necessário, crie nova versão, evento corretivo ou migration de reparo,
preservando before/after e registrando auditoria.

## 12. Transações, Storage e consistência

Operações compostas devem seguir, quando aplicável: validar → persistir entidade
→ persistir relacionamento → registrar evento → registrar auditoria.

Se uma etapa falhar, faça rollback ou compensação explícita. Para Storage,
valide antes do upload, persista após a validação e remova o arquivo se a
persistência posterior falhar. Nunca deixe documento, NF ou vínculo órfão.

## 13. Idempotência

Actions e RPCs sujeitas a retry devem ser idempotentes, especialmente uploads,
integrações, reconciliações, migrations, eventos, notificações, geração
documental, CNAB, Portal FIDC, backfills e triggers.

Use unique constraints, idempotency keys, origem_evento, correlation_id, upsert
controlado e verificação do estado anterior. Não dependa apenas do frontend.

## 14. Erros e exposição de dados

Diferenciar erro de domínio, autorização, validação, infraestrutura e erro
inesperado. A mensagem para o usuário deve ser amigável; logs e auditoria podem
conter contexto técnico controlado.

Nunca expor stack trace, SQL, bucket, path, tokens, senhas, OTPs, chaves,
secrets, payload sensível ou UUID interno sem necessidade. Não engolir erro
silenciosamente.

## 15. Auditoria e eventos

Separar conceitos:

- eventos_dominio: histórico operacional humano, com visibilidade por público;
- auditoria: segurança, before/after, contexto técnico, tentativas e falhas.

Actions relevantes devem registrar ambos quando aplicável, usando o mesmo
correlation_id e evitando duplicidade em retries.

## 16. Testes

Toda alteração de domínio deve ter testes. Priorizar unidade para regras puras,
integração para banco/RPC, RLS para autorização e E2E para fluxos críticos.

Cobrir caminho feliz, estados vazios, erros, autorização, concorrência,
idempotência, dados legados, múltiplos fundos/tenants, snapshots antigos,
transições inválidas e payload adulterado. Build aprovado não substitui teste
funcional.

## 17. Validação obrigatória por escopo

Quando aplicável, executar:

    npx tsc --noEmit
    npm test -- --run
    npm run lint
    git diff --check
    npx next build --webpack

Quando houver banco, validar migration incremental e do zero, SQL real, RLS,
grants, triggers e RPCs. Informar explicitamente qualquer validação não
executada; nunca afirmar validação sem execução real.

## 18. Relatório de entrega

Toda entrega deve informar escopo, causa raiz quando houver, arquitetura,
arquivos alterados, migrations, funções/RPCs, autorização, testes, comandos e
resultados, riscos e validações manuais pendentes. Alterações fora do escopo
devem ser destacadas.

## 19. Compatibilidade e performance

Ao encontrar legado, identificar, documentar e criar plano de transição. Evitar
fallback silencioso permanente, remoção sem backfill e duas fontes de verdade.
Compatibilidade deve ser explícita, temporária, testada, observável e removível.

Evitar N+1, tabelas completas, joins desnecessários, JSON processado repetidamente,
queries duplicadas, timeline sem paginação, filtros somente no cliente e listas
sem limite. Usar paginação server-side, cursor, índices, selects específicos,
agregações no banco e cache somente quando seguro, com invalidação explícita.

## 20. UX operacional

A interface deve refletir o domínio real. Não mostrar módulo não aplicável,
contador zero como pendência, etapa opcional como incompleta, termos técnicos,
ações sem contexto ou alertas para situações normais. Distinguir não aplicável,
pendente, concluído, bloqueado, erro administrativo e erro técnico. A UI não
deve inventar status.

## 21. Proibição de hardcodes

Não criar regras por nome de fundo, CNPJ, razão social ou texto de documento.
Usar códigos estáveis, capacidades, políticas, snapshots, permissões, tipos
documentais e enums/unions controladas.

Hardcode temporário só é aceitável com justificativa, isolamento, teste, TODO
com plano de remoção e aprovação explícita.

## 22. Alterações de regras e commits

Antes de mudar regra de negócio, identificar operações históricas impactadas,
snapshots, backfill, migration e se a mudança vale para novas ou antigas
operações. Mudanças de política devem ocorrer por nova versão.

Não misturar feature, refatoração, migration, formatação ampla e correção não
relacionada no mesmo diff. Não executar formatação global sem solicitação. Não
remover código aparentemente não usado sem verificar referências dinâmicas,
RPCs, triggers e migrations.

## 23. Comportamento dos agentes

Codex e Claude devem questionar inconsistências relevantes, não inventar
requisitos, não ampliar escopo silenciosamente, não afirmar sucesso sem teste,
não mascarar falhas, não tratar solução provisória como definitiva, não duplicar
arquitetura, não contornar RLS e não usar produção sem autorização.

Se a ambiguidade alterar regra de negócio, parar, apresentar opções e aguardar
decisão. Se puder ser resolvida por código, banco, documentação ou testes,
investigar primeiro.

## 24. Especificidades preservadas do BW Antecipa

Manter os princípios atuais:

- multi-tenant e multi-fundo;
- fundo ativo validado no servidor;
- cedente_fundos como vínculo operacional;
- políticas reutilizáveis por fundo e vinculadas manualmente pelo gestor;
- snapshots imutáveis e documentos versionados;
- eventos operacionais separados da auditoria;
- MFA obrigatório e AAL2 para ações sensíveis;
- RLS como camada obrigatória;
- Portal FIDC com credenciais protegidas;
- CNAB configurável;
- logística dependente da política;
- UI derivada das capacidades da operação.

## 25. Ordem de carregamento

Para toda tarefa futura:

1. ler AGENTS.md ou CLAUDE.md;
2. ler este documento compartilhado;
3. diagnosticar o fluxo;
4. pesquisar implementações existentes;
5. definir escopo e comunicar plano curto;
6. implementar;
7. testar e revisar o diff;
8. entregar relatório;
9. parar e aguardar validação.
