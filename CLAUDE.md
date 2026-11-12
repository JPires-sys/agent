# Agent Branch — resumo para os agentes

App desktop (pywebview) com um escritório em pixel art onde cada personagem é um agente do Claude Code.

- `home.py`: janela + classe `Api` chamada pelo JavaScript (config, send, cancel, poll, pasta de trabalho).
- `terminalContact.py`: roteador. Roda cada agente num `claude -p` (stream-json), lê a mensagem FIPA-ACL no fim da resposta e aciona o próximo. Também grava a memória em `.agentbranch/memoria.md`.
- `front/game.js`: mundo pixel art (mapa, móveis, personagens, câmera). `front/app.js`: painel, linha do tempo, demo. `front/index.html`, `front/style.css`.
- `.claude/agents/*.md`: definição dos agentes (007 orquestra; decider, architect, coder, tester, reviewer, docs).
- `README.md`: documentação completa. Leia só a seção de que precisar.

Regras:
- Python sem dependências além de `pywebview` e `python-dotenv`. JS puro, sem build.
- Não faça commit nem push. Não edite `dist/`, `build/` nem `.agentbranch/`.
- Depois de editar: `python -m py_compile home.py terminalContact.py` e `node --check front/game.js front/app.js`.
