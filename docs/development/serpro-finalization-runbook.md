# SERPRO NF-e — fechamento local e gates de ativação

## Escopo e autoridade

Esta implementação prepara a recuperação limitada e a observabilidade. Não ativa
SERPRO nem autoriza publicação, QA hospedado, main sync, SQL ou chamadas pagas.
O rascunho `scripts/qa/serpro/finalization-draft.json` não é executável nem é GO.
Flags locais/CI continuam OFF. A/B e os pilotos históricos não são editados.

Todos os Fundos; somente NF-e modelo 55. Importações novas elegíveis recebem
execução automática pós-cutover. O legado fica bloqueado, com consultas novas
somente por solicitação manual autorizada; nunca liberar execuções antigas.
Reconsulta mantém MFA da sessão, sem novo challenge TOTP. Não aprovar/reprovar
operações nem modificar dados fiscais com base em retorno externo.

## Recuperação e métricas

O hint de importação continua chamando o worker uma vez. O cron usa até 15
execuções sequenciais, cada uma com claim individual e o mesmo fencing SQL.
Janela de admissão de 120s, reserva de 65s antes de iniciar outra execução,
maxDuration da rota preservado em 180s. Não abortar/repetir um GET admitido.
Parar sem claim, em OFF, erro de infraestrutura ou falha terminal de execução.
`NO_JOB_CLAIMED` não certifica fila vazia: o circuito também pode negar claim.

Cron proposto: `* * * * *`, usando o CRON_SECRET já existente. Configuração no
repositório não comprova job instalado nem suporte do plano; Pro/Enterprise
comprovado é gate de publicação. Não fazer upgrade nem reduzir frequência
silenciosamente. Não alterar os demais agendamentos.

Leitura interna de métricas antes/depois da rodada, restrita à coorte operacional
e às ACLs existentes: pendentes, em processamento, falhas, idade da pendência,
circuito e contadores de autorização HTTP. Alerta estruturado acima de cinco
minutos, sem cancelamento, notificações externas ou reenfileiramento. Clock skew
fica explícito. Erro de métricas produz 503, sem retry e com contagens parciais
quando disponíveis. A rota rejeita corpo/query, não aceita ator ou IDs do cliente
e não expõe credenciais, chave de NF ou dados por Fundo.

Autorizações de GET podem anteceder envio/queda: não são prova de transmissão
nem de faturamento. Custo desconhecido é NULL/indisponível, nunca zero.

## Coletor offline sanitizado

`observe-release.mjs --errors-stdin` recebe a observação em stdin e retorna apenas
status, contagem e formato. Aceita JSON com total explícito e grupos completos,
ou formatos Markdown restritos; erro, truncamento ou formato desconhecido é
INCONCLUSIVE (exit 2), nunca limpo. Erros presentes: exit 1. Nenhum erro informado
no formato reconhecido: exit 0, mas `scopeVerified=false`; é obrigatório vincular
projeto, deployment e janela da chamada autoritativa antes de certificá-los.

`--metadata-stdin` projeta somente a lista permitida de campos. Nunca enumerar
ou serializar env/protectionBypass: o segredo pode estar na própria chave do
objeto. Metadados bwApprovedCommit/tree são rótulos, não prova Git independente.
Nenhum comando do coletor autentica, chama Vercel, busca URL ou persiste entrada.

## Sequência remota futura — GOs separados

1. Conferir a Preview existente `preview/serpro-s22-certificacao` /
   `fgttffyrkabpycmbnppi`. MIGRATIONS_FAILED é sinal de diagnóstico: comparar
   catálogo/histórico real, sem reparar, recriar ou aplicar a pasta inteira.
   Divergência exige plano seletivo próprio. QA usa apenas identidades sintéticas,
   sessão/MFA reais de QA e nenhum segredo SERPRO de produção.
2. Certificar Gestor/Super Admin, Cedente, Consultor, Sacado, sem MFA e outro Fundo
   sem vínculo. Nenhum teste hospedado é substituído por mock/local ou dispensado
   pela promoção anterior. Não habilitar endpoint falso/egress real para testar.
3. Commit/push na branch existente somente com GO, cercas e CI de árvore exata.
   Main sync por fluxo protegido e sem force/bypass; cercas temporárias aprovadas,
   antes/depois sanitizados e restauração condicional, sem build/domínio adicional.
   Exigir também CI da main resultante e árvore igual à certificada.
4. Preparar manifesto final vinculado ao candidato, validade, ator Breno Alvim,
   projeto e SQL exatos. Certificar separadamente o aplicador DML de configuração;
   não ampliar o aplicador R53/A-B para SQL arbitrário nem reutilizar GO expirado.
5. Novo staged Production protegido com flags runtime propostas ON, modo
   UNLIMITED_WITH_METERING e banco ainda OFF; nenhuma consulta deve sair. Flags
   Vercel não alteram o deployment anterior. Promover somente o candidato testado
   sob GO próprio, com verificação de domínio/runtime/proteção e banco OFF.
6. GO específico de ativação/consumo: transação auditada, corte obtido no banco,
   provider habilitado/circuito fechado/modo ilimitado. Sem reset de contadores,
   leases ou fencing. Verificação independente; COMMIT incerto implica STOP.

## Aceite real, cobertura e contenção

Manifesto privado deve identificar uma NF existente e uma nova importação real,
fundamento, owner e janela. Smoke prevê dois GETs intencionais, não teto global:
tráfego normal autorizado de todos os Fundos também está incluído no consumo.
Conferir fila, resultado, histórico, identidade e medição; observar primeiros
30min e cron real. Recuperação positiva é provada no QA; cron ocioso em produção
não a comprova. Sem preço contratual confirmado, não inventar custo estimado.

Cobertura de eventos é PARTIAL. Ausência de procEventosNFe não prova inexistência
de eventos. INCONCLUSIVO pode ser resultado técnico correto; nunca exigir verde
artificialmente, ocultar divergências ou alterar o mapper para passar o smoke.

Contenção autorizada deve bloquear novas autorizações HTTP no banco (circuito
OPEN, sem prazo automático de reabertura, modo OFF). Preservar cutover, histórico,
leases e fences: chamadas já autorizadas podem estar em trânsito. Não limpar
incerteza nem repetir GET. Restaurar flags OFF em deployment separado sob GO.
Não prometer que alterar env do projeto desliga imediatamente instâncias antigas.

Encerramento depende de CI/proveniência, matriz hospedada, fluxos reais, cron,
backlog preservado, monitoramento interpretável e evidências sanitizadas. Limites
e FAILs históricos permanecem identificados e não são reclassificados como PASS.
