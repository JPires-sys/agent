# Agent Branch

Um escritório em pixel art onde cada personagem é um agente do Claude Code. Você escreve uma tarefa e assiste **ao vivo** a equipe trabalhando. O agente acionado corre até o computador dele e começa a digitar. Quando ele passa o trabalho para outro agente, um envelope voa até o colega, e esse colega passa a ser o agente **AO VIVO**.

```
VOCE → agent-007 → agent-coder → agent-tester → agent-docs → agent-007 → VOCE
                    (ao vivo)      (ao vivo)       (ao vivo)
```

É um experimento para controlar o Claude Code pelo Python e montar um sistema multi-agentes de verdade, com cada agente rodando no próprio processo.

---

## Sumário
1. [Requisitos](#requisitos)
2. [Como rodar](#como-rodar)
3. [Usando o app](#usando-o-app)
4. [O escritório](#o-escritório)
5. [Os agentes](#os-agentes)
6. [Como o "ao vivo" funciona](#como-o-ao-vivo-funciona)
7. [Arquitetura e arquivos](#arquitetura-e-arquivos)
8. [Criar um agente novo](#criar-um-agente-novo)
9. [Contexto entre execuções](#contexto-entre-execuções)
10. [Gerar o executável](#gerar-o-executável)
11. [Problemas comuns](#problemas-comuns)
12. [Pontos de atenção](#pontos-de-atenção)
13. [Próximos passos](#próximos-passos)

---

## Requisitos

- Windows 10/11 (a janela usa o WebView2, que já vem no Windows 11).
- Python 3.10 ou mais novo.
- [Claude Code](https://claude.com/claude-code) instalado, no PATH e logado. Teste com `claude --version`.
- Dependências Python:

```bash
pip install pywebview python-dotenv
```

Arquivo `.env` na raiz (não vai para o git):

```
route_terminal=C:\caminho\da\pasta\onde\os\agentes\vao\trabalhar
```

Se `route_terminal` estiver vazio, os agentes trabalham na pasta do projeto.

## Como rodar

```bash
python home.py
```

Também dá para usar o executável, depois de gerá-lo (veja [Gerar o executável](#gerar-o-executável)):

```bash
dist\AgentBranch.exe
```

Para depurar a interface (abre o DevTools da janela):

```bash
python home.py --debug
```

**Sem gastar tokens:** o botão **Demo** simula uma cadeia completa (007 → decider → coder → tester → docs → 007). Você também pode abrir `front/index.html` direto no navegador. Sem o backend Python, o app entra em modo demonstração.

## Usando o app

| Área | O que faz |
|---|---|
| **Escritório** | O mundo em pixel art. **Arraste com o mouse** para andar pelo cenário, use a **roda do mouse** para zoom (2x a 6x) e **WASD/setas** para mover a câmera. Clicar num agente o escolhe como agente principal. Passar o mouse mostra a descrição dele. |
| **Barra do topo** | A cadeia da tarefa atual (`VOCE → 007 → CODER ●`). O nó pulsando é o agente ao vivo. Botões: **Seguir ao vivo** (a câmera acompanha o agente ativo; arrastar desliga), **Nomes** e zoom. |
| **Minimapa** | Canto inferior esquerdo. Clique ou arraste para pular a câmera. O ponto vermelho piscando é o agente ao vivo. |
| **NOVA TAREFA** | Prompt, modelo, esforço, agente principal e permissões. **ENVIAR** ou `Ctrl+Enter`. **Cancelar** encerra o processo do agente que está rodando. |
| **AO VIVO** | Retrato do agente ativo, o que ele está fazendo agora (`Edit home.py`, `Bash pytest`...), há quanto tempo e em qual troca da cadeia. |
| **LINHA DO TEMPO** | Tudo o que aconteceu: quem foi acionado, cada mensagem FIPA (`request`/`inform`/`failure`) com o conteúdo, ferramentas usadas, tempo e custo de cada agente. |
| **HISTÓRICO** | Tarefas enviadas. Clique para rever a resposta. |
| **SAÍDA** | Resposta final, com efeito de máquina de escrever. Clique no texto para pular a animação. |

Se o agente ao vivo estiver fora da tela, uma **seta vermelha** na borda aponta para ele.

## O escritório

O mapa tem 60×40 tiles (960×640 pixels lógicos), ampliados sem suavização. São 7 ambientes ligados por portas:

| Ambiente | Detalhes |
|---|---|
| **Recepção** | Balcão com robô recepcionista, elevador com portas e indicador de andar, sofá, poltrona, revistas, porta de vidro. **VOCÊ** fica aqui: o envelope com o seu pedido sai daqui e a resposta volta para cá. |
| **Escritório** | 15 mesas (uma por agente, com monitor, teclado, caneca e decoração), kanban na parede (as tarefas mudam de coluna), relógio com a hora real, impressora (imprime quando uma tarefa termina), quadro branco, mesa de pé e arquivos. |
| **Sala de reunião** | Parede de vidro, mesa grande com notebook, quadro branco que vai sendo rabiscado e TV com gráfico animado. |
| **Servidores** | Racks com LEDs piscando, ar-condicionado com display e nobreak. A sala tem uma luz azul. |
| **Copa** | Cafeteira (faz café e solta vapor), pia, micro-ondas com relógio, geladeira, máquina de lanches, bebedouro com bolhas, mesas e lixeiras de reciclagem. |
| **Lounge** | Sofá virado para a TV (que troca de programa), estante de livros, fliperamas, mesa de ping-pong (a bolinha só aparece quando há dois jogadores), puffs, aquário com peixes e bolhas, luminárias. |
| **Jardim** | Árvores balançando, lago com carpas e ondas, canteiro de flores, banco, postes, caminho de pedras e borboletas. |

**Vida própria:** quando não estão trabalhando, os agentes passeiam. Eles tomam café, bebem água, leem na estante, jogam fliperama ou ping-pong, assistem TV, cochilam nos puffs, regam as flores, olham o lago, desenham no quadro, conferem os servidores e às vezes sentam na própria mesa. Pelo escritório também circulam um **gato** que dorme em vários cantos e um **robô aspirador**.

**Hora real:** o céu nas janelas segue o relógio do seu PC (dia, entardecer e noite estrelada). À noite o escritório escurece e acendem as luminárias, os postes, o aquário, os fliperamas e os monitores de quem está trabalhando.

**Estados de cada agente:**

| Estado | Como aparece |
|---|---|
| Livre | Passeia e faz atividades. De vez em quando aparece um balão com um ícone (café, coração, música...). |
| Acionado | Aparece um `!`, ele larga o que estava fazendo e **corre** até o computador. |
| **AO VIVO** | Anel vermelho pulsando, etiqueta `● AO VIVO`, uma luz em cima dele, o monitor rolando código e um balão com a ferramenta atual. |
| Aguardando | Sentado, com o monitor mostrando uma ampulheta e o balão `AGUARDANDO <agente>`. |
| Terminou | O monitor mostra ✓ (ou ✗), ele pula de alegria com confete (ou põe a mão no rosto) e volta a passear. |

## Os agentes

Ficam em `.claude/agents/*.md`:

| Agente | Papel | Ferramentas |
|---|---|---|
| `agent-007` | **Orquestrador.** Recebe o pedido, decide quem faz cada parte e encaminha. Não escreve código. | Read, Grep, Glob |
| `agent-decider` | Lê o README/código e devolve um plano em etapas. | Read, Grep, Glob |
| `agent-architect` | Define a estrutura (módulos, interfaces) antes do código. | Read, Grep, Glob |
| `agent-coder` | Implementa. Não faz commit. | todas |
| `agent-tester` | Escreve e roda testes. Se algo falhar, devolve para o coder. | todas |
| `agent-reviewer` | Revisa o `git diff`. Se achar um bug sério, devolve para o coder. | Read, Grep, Glob, Bash |
| `agent-docs` | Atualiza o README. | todas |

O `agent-007` só consegue ler arquivos, então precisa delegar. Assim, todo trabalho aparece ao vivo no escritório. Ele também pode pedir que um agente **repasse direto** para o próximo, por exemplo: "coder, quando terminar, mande para o tester, e o tester manda para o docs".

### Protocolo (FIPA-ACL)

Cada agente termina a resposta com **uma** mensagem:

```
(request :sender agent-007 :receiver agent-coder :content "Implemente X; depois envie para agent-tester")
(inform  :sender agent-coder :receiver agent-007 :content "Alterei home.py; rode pytest")
(failure :sender agent-tester :receiver agent-coder :content "test_x falhou: ...")
(inform  :sender agent-007 :receiver usuario :content "Pronto: ...")
```

| Mensagem | O roteador faz |
|---|---|
| `request` para outro agente | Acorda esse agente (ele vira o AO VIVO). Quem enviou fica **aguardando**. |
| `inform`/`failure` para outro agente | Devolve o resultado. O destinatário volta a trabalhar e lembra da conversa dele (`--resume`). |
| qualquer mensagem para `usuario` | Encerra a tarefa e mostra a resposta na SAÍDA. |
| resposta sem mensagem FIPA | O roteador devolve o texto automaticamente para quem fez o pedido. |

O limite é de **14 trocas** por tarefa, para evitar ciclos infinitos.

## Como o "ao vivo" funciona

```
 front (Canvas/JS)  ── poll a cada 150 ms ──►  home.py (pywebview Api)
        ▲                                             │
        └──────────── eventos numerados ◄──── terminalContact.TerminalContact
                                                      │ thread por tarefa
                                                      ▼
                                       executar_tarefa (roteador)
                                          │  para cada salto:
                                          ▼
                       claude -p --agent <atual> --output-format stream-json --verbose
                              (prompt via stdin, --resume se já falou antes)
```

1. **`executar_tarefa`** começa com o agente principal e, a cada salto, emite `ao_vivo` com quem está rodando agora.
2. **`executar_agente`** lê o `stream-json` linha por linha enquanto o processo roda. Cada `tool_use` vira o evento `ferramenta`, cada texto vira `fala` e o `result` traz a resposta, o custo e a duração.
3. No fim de cada agente, **`parse_fipa`** encontra a última mensagem FIPA. O roteador emite `mensagem` (que vira o envelope voando) e acorda o destinatário.
4. A interface busca os eventos (`poll`) e repassa cada um para o `Game.event`, que move os personagens, e para o painel.

A ferramenta `Agent`/`Task` do Claude Code fica **desabilitada** (`--disallowedTools Agent Task`). Assim, toda delegação passa pelo roteador e aparece no escritório. Isso também resolve uma limitação do Claude Code: dentro dele, um subagente não consegue chamar outro.

Eventos (`tipo`):

| tipo | campos | quando |
|---|---|---|
| `tarefa_inicio` | `agente`, `prompt` | Você enviou a tarefa. |
| `mensagem` | `de`, `para`, `performativa`, `conteudo` | Um agente mandou uma mensagem FIPA. |
| `ao_vivo` | `agente`, `de`, `salto` | Esse agente começou a rodar. |
| `ferramenta` | `agente`, `ferramenta`, `texto` | Ele usou Read/Edit/Bash/... |
| `fala` / `pensando` | `agente`, `texto` | Ele escreveu um texto ou está pensando. |
| `agente_fim` | `agente`, `ok`, `custo`, `duracao` | O processo dele terminou. |
| `tarefa_fim` | `ok`, `resposta`, `custo`, `duracao` | A cadeia acabou. |

Para usar sem interface:

```python
from terminalContact import executar_tarefa, ler_agentes
ok, resposta, custo = executar_tarefa("crie hello.py e teste", "claude-sonnet-5-5", "low",
                                      "agent-007", print, ler_agentes(".claude/agents"))
```

## Arquitetura e arquivos

```
agent/
├── home.py              # app desktop: janela pywebview + Api exposta ao JavaScript
├── terminalContact.py   # backend: roteador FIPA, processo claude -p, fila de eventos
├── front/
│   ├── index.html       # layout (palco + painel)
│   ├── style.css        # tema escuro
│   ├── game.js          # mundo pixel art: mapa, móveis, personagens, IA, câmera, minimapa
│   └── app.js           # painel, linha do tempo, ponte com o Python e modo Demo
├── .claude/agents/      # definição dos agentes (markdown + frontmatter)
├── testes-agents/       # arquivos criados pelos agentes em testes (não são o núcleo)
├── .env                 # route_terminal (ignorado pelo git)
└── README.md
```

**`game.js`**, por dentro:
- **Render:** o piso é gerado pixel a pixel uma única vez (`ImageData`), junto com paredes e decoração fixa. A cada quadro, desenha num buffer pequeno na resolução lógica e amplia com `imageSmoothingEnabled = false`.
- **Profundidade:** móveis e personagens são ordenados pela linha do pé (`base`), então dá para passar atrás de mesas e árvores. Quem senta de costas é desenhado antes do encosto da cadeira.
- **Personagens:** desenhados por código, em 4 direções, com ciclo de caminhada, piscada e poses (`type`, `sit`, `drink`, `read`, `play`, `pingpong`, `water`, `draw`, `jump`, `facepalm`...). Cada agente tem cabelo, roupa e acessórios próprios: terno e óculos escuros, capacete de obra, jaleco, moletom com fone...
- **IA:** um pathfinding A* nos tiles e pontos de interesse com reserva, para dois agentes não ocuparem o mesmo lugar.
- **Simulação:** usa sub-passos de 50 ms. Se a janela ficar minimizada, tudo se atualiza quando ela voltar.

**`terminalContact.py`**:
- `ler_agentes(pasta)`: lê nome, descrição e ferramentas do frontmatter.
- `parse_fipa(texto)`: parser tolerante de FIPA-ACL (aspas, blocos de código, `usuário/user`).
- `executar_agente(...)`: um processo `claude -p` com stream ao vivo.
- `executar_tarefa(...)`: o roteador.
- `TerminalContact`: fila de tarefas com eventos numerados (`poll`), `cancelar` e `historico`.

## Criar um agente novo

Crie `.claude/agents/agent-<nome>.md`:

```markdown
---
name: agent-<nome>
description: Uma frase dizendo quando este agente deve ser chamado (os outros leem isso).
tools: Read, Grep, Glob   # opcional; sem esta linha o agente pode usar todas
---

Você é o **agent-<nome>**. Regras...
```

O roteador já explica o protocolo FIPA para cada agente e lista a equipe com as descrições. O novo agente ganha uma mesa e um visual próprio na próxima vez que o app abrir. Para o `agent-007` saber quando usá-lo, cite-o no `agent-007.md`.

## Contexto entre execuções

Cada tarefa começa sessões novas. **Dentro de uma tarefa**, cada agente lembra das próprias falas: quando o resultado volta para o `agent-007`, ele é retomado com `--resume`. Já **entre tarefas**, e ao fechar o app, a conversa se perde.

O que sempre persiste: os arquivos do projeto, os prompts dos agentes e um `CLAUDE.md` na raiz (o Claude Code lê esse arquivo automaticamente em toda sessão).

Formas de ter mais memória:
1. Manter um `CLAUDE.md` ou o README com o resumo do projeto e as decisões tomadas. O `agent-docs` pode atualizar isso no fim de cada tarefa.
2. Salvar os `session_id` de cada agente num arquivo e usar `--resume` na próxima tarefa (ainda não implementado).

## Gerar o executável

```bash
pip install pyinstaller pywebview python-dotenv
pyinstaller --noconfirm --onefile --windowed --name AgentBranch --add-data "front;front" home.py
```

O resultado é `dist/AgentBranch.exe` (cerca de 13 MB). O exe procura a pasta `.claude/agents` e o `.env` em quatro lugares: na pasta dele, no diretório atual, na pasta acima (o que permite rodar direto de `dist/`) e duas pastas acima.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| A janela abre, mas "Modo navegador" aparece | O `pywebview` não carregou a API. Rode `python home.py --debug` e veja o console. |
| `[ERRO] comando 'claude' nao encontrado` | O Claude Code não está no PATH. |
| Nenhum agente aparece | O app não achou `.claude/agents/`. Rode-o na pasta do projeto. |
| O agente quer rodar um comando e não consegue | No modo `editar arquivos (padrao)`, comandos de terminal que pedem aprovação são negados. Use **tudo liberado** (cuidado) ou faça a parte do terminal você mesmo. |
| A cadeia para com "limite de 14 trocas" | Os agentes entraram em ciclo. Deixe o pedido mais específico. |
| `pip install json/threading/argparse` falha | Esses módulos já vêm com o Python. |

## Pontos de atenção

- **Permissões:** `acceptEdits` deixa os agentes **editarem arquivos sem pedir confirmação**. `bypassPermissions` libera **tudo**, inclusive comandos no terminal. Use as duas só em pastas versionadas pelo git.
- Cada salto da cadeia é um processo `claude -p` novo, que leva alguns segundos para iniciar e custa tokens. O custo de cada agente aparece na linha do tempo.
- O formato FIPA-ACL é uma convenção de texto. Se o modelo errar o formato, o roteador tenta entender e, em último caso, devolve o texto para quem pediu.
- Fechar a janela cancela as tarefas em andamento.

## Próximos passos

1. **Memória entre tarefas:** guardar os `session_id` por agente (`sessions.json`) e retomar com `--resume`.
2. **Log persistente:** salvar os eventos em `logs/AAAA-MM-DD.jsonl` e criar um modo "replay" no escritório.
3. **Painel de custo:** um total por dia e por agente (os eventos já trazem `custo`).
4. **Agentes em paralelo:** permitir `request` para dois agentes ao mesmo tempo. O escritório já suporta vários agentes ao vivo; falta o roteador.
5. **Reuniões:** quando três ou mais agentes estiverem na mesma tarefa, juntá-los na sala de reunião.
