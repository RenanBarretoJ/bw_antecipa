# Diretrizes do projeto

## Idioma e comunicação
- Responder sempre em português do Brasil.
- Ser direto, técnico e objetivo.
- Ao explicar mudanças, priorizar impacto, causa e solução.
- Não alternar para inglês, exceto em nomes de arquivos, comandos, APIs, erros, mensagens do compilador e trechos de código.

## Objetivo ao trabalhar neste repositório
- Respeitar a arquitetura e a organização já existentes.
- Preferir mudanças pequenas, localizadas e reversíveis.
- Reutilizar padrões já adotados antes de introduzir novos.
- Evitar criar abstrações, dependências ou camadas novas sem necessidade clara.

## Antes de implementar
- Ler os arquivos diretamente relacionados à tarefa antes de editar.
- Identificar o padrão já usado na área afetada e segui-lo.
- Em caso de ambiguidade, escolher a solução mais consistente com o restante do projeto.
- Se houver mais de uma opção razoável, explicar brevemente a escolhida.

## Estrutura do projeto
- Preservar a separação de responsabilidades entre camadas, módulos e pastas.
- Criar arquivos novos apenas quando houver ganho real de organização ou reutilização.
- Não mover ou renomear arquivos sem necessidade funcional.
- Manter cada alteração no menor escopo possível.

## Convenções de código
- Seguir o estilo, nomenclatura e organização já presentes no projeto.
- Não misturar padrões diferentes no mesmo módulo.
- Preferir consistência com o código existente em vez de “reescrever melhor”.
- Evitar comentários óbvios; comentar apenas decisões, trade-offs ou comportamento não trivial.

## Segurança e robustez
- Validar entradas externas.
- Não expor segredos, tokens ou credenciais.
- Não alterar configurações sensíveis sem explicar o motivo.
- Em mudanças com risco, apontar efeitos colaterais e pontos de atenção.

## Testes e validação
- Toda mudança de lógica deve considerar testes.
- Quando possível, executar ou sugerir os testes mais próximos da alteração.
- Não encerrar uma tarefa assumindo que tudo funciona sem verificar o que for viável verificar.

## Formato esperado das respostas
- Para análise: descrever problema, causa e recomendação.
- Para implementação: resumir o que foi alterado e onde.
- Para refatoração: justificar por que a nova estrutura está mais alinhada ao projeto.
- Sempre citar caminhos de arquivos relevantes ao explicar mudanças.

## Restrições
- Não introduzir dependências novas sem justificativa explícita.
- Não criar arquivos temporários desnecessários.
- Não aplicar mudanças amplas fora do escopo pedido.