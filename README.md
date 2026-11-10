# agent

Experimento para controlar o Claude Code pelo Python e, no futuro, montar um sistema com vários agentes.

## Análise do projeto

- **`terminalContact.py`**: chama o `claude -p` via `subprocess`, escolhendo o modelo, o effort e o agente. A pasta de trabalho vem da variável `route_terminal` no `.env`. A classe `TerminalContact` guarda o histórico de prompts e respostas.
- **`home.py`**: ponto de entrada. Por enquanto só chama `teste()`.
- **`.claude/agents/`**: tem dois subagentes, `agent-007` (coordena e repassa tarefas) e `agent-coder` (escreve código). Os dois mencionam conversar via FIPA-ACL, mas isso ainda não existe no código.
- **`testes-agents/`**: arquivos gerados pelos agentes, pedidos através do `terminalContact`. São só testes e não fazem parte do núcleo do projeto.

**Pontos de atenção:**
- `TerminalContact.teste()` não tem o parâmetro `self`. Isso funciona apenas porque o `home.py` chama a classe sem criar uma instância (`obj = tc`).
- A ordem dos parâmetros não é a mesma: `enviar(prompt, effort, model, agent)` repassa para `actionClaude(prompt, model, effort, agent)`. É fácil trocar os dois sem querer.
- Quando dá erro, `actionClaude` retorna `None` e só imprime a mensagem. Seria melhor lançar uma exceção ou retornar o erro.
- Cada chamada abre uma sessão nova do Claude, então os agentes não compartilham contexto entre si.
- O `--permission-mode acceptEdits` deixa os agentes editarem arquivos sem pedir confirmação. Use com cuidado.

## Sugestão para prosseguir

Crie um **orquestrador simples** em `home.py`. Ele recebe uma tarefa, envia para o `agent-007` e, se a resposta indicar que é preciso escrever código, repassa para o `agent-coder`. A troca de mensagens deve usar um formato JSON parecido com o FIPA-ACL (`performative`, `sender`, `receiver`, `content`) e ficar registrada em log. Para manter o contexto entre as chamadas, use `--output-format json` com `--resume <session_id>`.
