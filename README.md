# agent

Experimento para controlar o Claude Code pelo Python e, no futuro, montar um sistema com vários agentes.

## Como rodar (app desktop Dunder Mifflin - Agent Branch)

```bash
pip install python-dotenv      # única dependência (tkinter vem com o Python)
python home.py                 # abre a janela do app
```

Gerar o executável:

```bash
pip install pyinstaller
pyinstaller --noconfirm --onefile --windowed --name AgentBranch home.py
# resultado: dist/AgentBranch.exe
```

Copie `AgentBranch.exe` para a pasta do projeto (a que contém `.claude/agents/` e `.env`) ou execute-o com essa pasta como diretório atual: o app procura esses arquivos na pasta do exe e, em seguida, no cwd.

Pré-requisitos: o comando `claude` precisa estar no PATH e logado. A variável `route_terminal` no `.env` define a pasta onde o Claude roda.

O app (tkinter + Canvas, sem servidor HTTP) mostra um escritório pixelado no estilo The Office, com um personagem e uma mesa para cada agente de `.claude/agents/`. No painel **NOVA TAREFA** você escreve o prompt e escolhe o modelo, o esforço e o agente (ou clica na mesa). **ENVIAR** ou Ctrl+Enter dispara o `claude -p` em uma thread; enquanto isso o personagem se mexe e o monitor dele pisca. A resposta aparece no monitor CRT com efeito de máquina de escrever, e o histórico fica na lista (clique em um item para revê-lo).

Arquivos: `home.py` (app desktop) e `terminalContact.py` (backend).

## Análise do projeto

- **`terminalContact.py`**: chama o `claude -p` via `subprocess`, escolhendo o modelo, o effort e o agente. A pasta de trabalho vem da variável `route_terminal` no `.env`. A classe `TerminalContact` guarda o histórico de prompts e respostas.
- **`home.py`**: ponto de entrada. Sobe o servidor web local com o front pixelado (veja acima).
- **`.claude/agents/`**: tem dois subagentes, `agent-007` (coordena e repassa tarefas) e `agent-coder` (escreve código). Os dois mencionam conversar via FIPA-ACL, mas isso ainda não existe no código.
- **`testes-agents/`**: arquivos gerados pelos agentes, pedidos através do `terminalContact`. São só testes e não fazem parte do núcleo do projeto.

**Pontos de atenção:**
- `TerminalContact.teste()` não tem o parâmetro `self`. Isso funciona apenas porque o `home.py` chama a classe sem criar uma instância (`obj = tc`).
- A ordem dos parâmetros não é a mesma: `enviar(prompt, effort, model, agent)` repassa para `actionClaude(prompt, model, effort, agent)`. É fácil trocar os dois sem querer.
- Quando dá erro, `actionClaude` agora retorna uma string que começa com `[ERRO]` (antes retornava `None`). O front mostra essa mensagem na tela.
- Cada chamada abre uma sessão nova do Claude, então os agentes não compartilham contexto entre si.
- O `--permission-mode acceptEdits` deixa os agentes editarem arquivos sem pedir confirmação. Use com cuidado.

## Sugestão para prosseguir

Crie um **orquestrador simples** em `home.py`. Ele recebe uma tarefa, envia para o `agent-007` e, se a resposta indicar que é preciso escrever código, repassa para o `agent-coder`. A troca de mensagens deve usar um formato JSON parecido com o FIPA-ACL (`performative`, `sender`, `receiver`, `content`) e ficar registrada em log. Para manter o contexto entre as chamadas, use `--output-format json` com `--resume <session_id>`.
