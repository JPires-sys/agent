# agents0.7

Um mundo em pixel art onde cada personagem é um agente do Claude Code. Dá para escolher entre **3 mapas** (escritório, quartel espião e cidade gótica). Você escreve uma tarefa e assiste **ao vivo** a equipe trabalhando. O agente acionado corre até o computador dele e começa a digitar. Quando ele passa o trabalho para outro agente, um envelope voa até o colega, e esse colega passa a ser o agente **AO VIVO**.

```
VOCE → agent-007 → agent-coder → agent-tester → agent-docs → agent-007 → VOCE
                    (ao vivo)      (ao vivo)       (ao vivo)
```

É um experimento para controlar o Claude Code pelo Python e montar um sistema multi-agentes de verdade, com cada agente rodando no próprio processo. O app abre numa **tela inicial**, onde você escolhe o mapa, vê a equipe e gerencia os agentes. No fim de cada tarefa dá para baixar o **relatório em Word ou TXT**.

---

## Sumário
1. [Requisitos](#requisitos)
2. [Como rodar](#como-rodar)
3. [Usando o app](#usando-o-app)
4. [Os mapas](#os-mapas)
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

A pasta onde os agentes trabalham **não vem do `.env`**: ela é escolhida na própria interface (veja [Pasta de trabalho](#pasta-de-trabalho)). O `.env` na raiz é opcional e não vai para o git. Ele serve para dizer **onde estão as definições dos agentes**:

```bash
# .env
path_agent=.claude/agents        # relativo conta a partir da pasta do projeto
# path_agent="D:/meus-agentes"   # absoluto também vale; aspas são removidas
```

- Caminho relativo conta a partir da pasta base do app (a que tem o `.env` ou o `.claude/agents`).
- Sem a variável (ou vazia), vale `.claude/agents`.
- O `claude -p --agent` só procura agentes no `.claude/agents` do `cwd`. Por isso o roteador passa a definição do agente atual (descrição, instruções e ferramentas) no `--agents`, em JSON. Assim a pasta dos agentes pode ficar em qualquer lugar.

## Como rodar

```bash
python home.py
```

Também dá para usar o executável, depois de gerá-lo (veja [Gerar o executável](#gerar-o-executável)):

```bash
dist\agents0.7.exe
```

Para depurar a interface (abre o DevTools da janela):

```bash
python home.py --debug
```

**Sem gastar tokens:** o botão **Demo** simula uma cadeia completa (007 → decider → coder → tester → docs → 007). Você também pode abrir `front/index.html` direto no navegador. Sem o backend Python, o app entra em modo demonstração.

## Usando o app

### Tela inicial

É a primeira coisa que aparece. Atrás dela, a câmera passeia pelo mapa.

- **Escolha o mapa:** três cartões com a miniatura de cada mapa. Clicar troca o mapa na hora, e a escolha fica salva para a próxima vez.
- **Sua equipe:** o retrato de cada agente. Clicar num retrato abre o gerenciador já nesse agente. **Gerenciar agentes** abre o gerenciador.
- **Pasta de trabalho:** a pasta onde os agentes vão trabalhar, com o botão **Escolher**.
- **ENTRAR** (ou `Enter`) vai para o app. **Entrar e ver uma demonstração** entra e já roda o Demo.

Para voltar à tela inicial, clique no logo **AGENTS0.7** no canto superior esquerdo.

| Área | O que faz |
|---|---|
| **Mapa** | O mundo em pixel art. **Arraste com o mouse** para andar pelo cenário, use a **roda do mouse** para zoom (2x a 6x) e **WASD/setas** para mover a câmera. Clicar num agente o escolhe como agente principal. Passar o mouse mostra a descrição dele. |
| **Barra do topo** | A cadeia da tarefa atual (`VOCE → 007 → CODER ●`). O nó pulsando é o agente ao vivo. Botões: seletor de **Mapa** (troca na hora, mesmo com uma tarefa rodando), **Seguir ao vivo** (a câmera acompanha o agente ativo; arrastar desliga), **Nomes** e zoom. O logo volta para a tela inicial. |
| **Minimapa** | Canto inferior esquerdo. Clique ou arraste para pular a câmera. O ponto vermelho piscando é o agente ao vivo. |
| **NOVA TAREFA** | Pasta de trabalho, prompt, modelo, esforço, agente principal e permissões. **ENVIAR** ou `Ctrl+Enter`. **Cancelar** encerra o processo do agente que está rodando. |
| **AO VIVO** | Retrato do agente ativo, o que ele está fazendo agora (`Edit home.py`, `Bash pytest`...), há quanto tempo e em qual troca da cadeia. |
| **LINHA DO TEMPO** | Tudo o que aconteceu: quem foi acionado, cada mensagem FIPA (`request`/`inform`/`failure`) com o conteúdo, ferramentas usadas, tempo e custo de cada agente. |
| **HISTÓRICO** | Tarefas enviadas. Clique para rever a resposta. Nas tarefas que já terminaram aparecem os botões **Word** e **TXT**, que baixam o relatório. No título ficam os botões **Agentes** e **PC**. |
| **SAÍDA** | Resposta final, com efeito de máquina de escrever. Clique no texto para pular a animação. Quando a tarefa termina, aparecem os botões **Relatório: Word / TXT**. |

Se o agente ao vivo estiver fora da tela, uma **seta vermelha** na borda aponta para ele.

### Pasta de trabalho

No card **NOVA TAREFA** há o campo **Pasta de trabalho** (só leitura) e o botão **Escolher pasta**.

- O botão abre o seletor de pastas do sistema. A pasta escolhida vira o diretório (`cwd`) do `claude -p` nos **próximos envios**. Assim os agentes podem ler e alterar arquivos de outros projetos.
- Se houver uma tarefa rodando, ela continua na pasta antiga até terminar.
- A escolha fica salva em `.agentbranch.json`, na pasta do projeto, no formato `{"pasta": "..."}`. Esse arquivo é ignorado pelo git.
- Se o arquivo não existir, estiver inválido ou a pasta salva não existir mais, vale a pasta do projeto.
- Os agentes vêm da pasta de `path_agent` (ou de `.claude/agents` **do projeto agents0.7**), não da pasta escolhida.

Para testar essa parte (não precisa de pytest):

```bash
python tests/test_pasta.py
```

### Relatório do que foi feito (Word ou TXT)

Toda tarefa terminada tem dois botões, no HISTÓRICO e na barra da SAÍDA:

- **Word** gera `relatorio-<id>.docx`;
- **TXT** gera `relatorio-<id>.txt` (UTF-8, abre em qualquer editor).

Os dois abrem a janela **Salvar como** e têm o mesmo conteúdo:

1. **Conversa completa** entre os agentes: hora, quem mandou, para quem, performativa e texto.
2. **Relatório:** pedido, status, resposta final, cadeia de agentes, o que cada agente fez (a última mensagem dele), arquivos alterados, ferramentas por agente, custo e tokens por agente e o total.

O `relatorio.py` monta os dois só com a biblioteca padrão: o `.docx` usa `zipfile` e escape de XML, sem dependências novas. Além disso, ao fim de cada tarefa o app grava automaticamente uma cópia em `.agentbranch/relatorios/` na pasta de trabalho. Tarefas do Demo não têm relatório.

### Gerenciar agentes (criar, editar, excluir)

O botão **Agentes** (no HISTÓRICO) ou **Gerenciar agentes** (na tela inicial) abre o gerenciador. À esquerda fica a lista de agentes, com retrato e descrição. À direita, o editor tem três abas:

| Aba | O que dá para fazer |
|---|---|
| **Perfil** | Nome do arquivo (`a-z`, `0-9` e `-`, de 2 a 41 caracteres), **modelo do Claude** só deste agente (herdar o da tela, Opus, Sonnet, Haiku ou Fable), descrição de uma linha (os outros agentes leem isso para saber quando chamá-lo), **ferramentas** marcadas uma a uma (ou "todas") e as instruções. |
| **Aparência** | Cores de pele, cabelo, camisa, calça, sapato e gravata, penteado e acessórios (óculos, terno, moletom, fone, jaleco, capacete...), com uma prévia grande. **Sortear aparência** gera uma aleatória. |
| **Arquivo .md** | Edita o `.md` direto, para quem quer controle total. O cabeçalho precisa ter `name:` igual ao nome do arquivo e `description:`. Mudanças no corpo e em chaves extras (como `color:`) são preservadas. |

- **Novo agente:** comece de um **modelo pronto** ou em branco. Os modelos são Designer de front-end, Pesquisador (web), Auditor de segurança, DevOps / build, Analista de dados e Tradutor / revisor, e cada um já vem com descrição, ferramentas, modelo, instruções e aparência. **CRIAR AGENTE** grava `<nome>.md` na pasta dos agentes, e ele ganha uma mesa no mapa na hora. Um arquivo que já existe **não é sobrescrito**.
- **Editar:** escolha o agente na lista, mude o que quiser e clique em **SALVAR**. Mudar o nome **renomeia o arquivo** e leva a aparência junto.
- **Excluir:** clique em **Excluir** e depois em **Confirmar exclusão**. O `.md` vai para `.lixeira-agentes/` (com data e hora no nome), então dá para recuperar. O último agente não pode ser excluído.
- **Modelo por agente:** o roteador usa o `model:` do `.md` só para aquele agente. Assim dá para deixar, por exemplo, o tester no Haiku (mais barato) e o coder no Opus. Sem `model:`, ou com `inherit`, vale o modelo escolhido na tela.
- As aparências ficam em `.agentbranch.json`, na chave `skins`, junto com `pasta` e `tema` (o mapa).

### Computador (PC)

Clique no terminal verde da sala de servidores (que muda de nome em cada mapa: SERVIDORES, COFRE ou ESCONDERIJO) ou no botão **PC** do HISTÓRICO para abrir o **TERMINAL · AO VIVO**:

- quem está rodando agora e há quanto tempo;
- a ferramenta atual (`Edit home.py`, `Bash ...`);
- **tokens** (entrada / saída / cache) e custo da tarefa, atualizados enquanto o agente roda;
- tokens por agente;
- arquivos alterados, do mais novo para o mais antigo, com a hora e o agente.

O painel zera quando uma nova tarefa começa.

Para testar as novidades (path_agent, FIPA obrigatório, relatório Word e TXT, criar, editar, renomear e excluir agente, modelo por agente e skin):

```bash
python tests/test_novos.py
python tests/test_pasta.py
```

## Os mapas

Os três mapas têm 60×40 tiles (960×640 pixels lógicos), ampliados sem suavização, e a **mesma planta**: 7 ambientes ligados por portas, 15 mesas e o terminal no mesmo lugar. Assim os agentes sabem andar em todos. O que muda é o piso, as paredes, os móveis, a luz, o clima e os bichos. Troque pelo cartão da tela inicial ou pelo seletor **Mapa** da barra do topo. Os agentes vão para as mesas novas, e quem estava trabalhando continua trabalhando.

### Escritório

| Ambiente | Detalhes |
|---|---|
| **Recepção** | Balcão com robô recepcionista, elevador com portas e indicador de andar, sofá, poltrona, revistas, porta de vidro. **VOCÊ** fica aqui: o envelope com o seu pedido sai daqui e a resposta volta para cá. |
| **Escritório** | 15 mesas (uma por agente, com monitor, teclado, caneca e decoração), kanban na parede (as tarefas mudam de coluna), relógio com a hora real, impressora (imprime quando uma tarefa termina), quadro branco, mesa de pé e arquivos. |
| **Sala de reunião** | Parede de vidro, mesa grande com notebook, quadro branco que vai sendo rabiscado e TV com gráfico animado. |
| **Servidores** | Racks com LEDs piscando, ar-condicionado com display e nobreak. A sala tem uma luz azul. O **terminal** da sala é clicável e abre o [PC](#computador-pc). |
| **Copa** | Cafeteira (faz café e solta vapor), pia, micro-ondas com relógio, geladeira, máquina de lanches, bebedouro com bolhas, mesas e lixeiras de reciclagem. |
| **Lounge** | Sofá virado para a TV (que troca de programa), estante de livros, fliperamas, mesa de ping-pong (a bolinha só aparece quando há dois jogadores), puffs, aquário com peixes e bolhas, luminárias. |
| **Jardim** | Árvores balançando, lago com carpas e ondas, canteiro de flores, banco, postes, caminho de pedras e borboletas. |

### Quartel Espião

Um QG de espionagem com piso de metal, paredes em painéis com luzes ciano e detalhes dourados. No lugar do robô aspirador circula um **drone**, e o gato é branco.

| Ambiente | Detalhes |
|---|---|
| **Entrada** | Balcão de segurança com câmeras (CCTV) ao vivo e robô-guarda, **detector de metais** que pisca vermelho quando alguém passa, poltronas de couro, globo que gira, passadeira vermelha e elevador. |
| **Operações** | Mesas viram **consoles** com dois monitores, um deles com radar girando. Na parede ficam um **mapa-mundi** com alvos piscando e uma linha de varredura, e **3 relógios** (Londres, Nova York e Tóquio). Também tem um decodificador que imprime fita, uma mesa tática com mapa e uma vitrine de gadgets. |
| **Briefing** | Mesa oval com **holograma de globo**, painel de dossiê "SECRETO" e TV de satélite com mira se movendo. |
| **Cofre** | **Porta redonda de cofre** na parede, cofres de aluguel que se abrem de vez em quando, pilhas de **barras de ouro** que brilham e **feixes de laser** varrendo o corredor. |
| **Laboratório** | Bancada com microscópio, solda soltando faíscas, maleta de gadgets e braço robótico. Também tem um **carro esportivo** de capô aberto, manequim de tiro, armário de gadgets, osciloscópio e frascos borbulhando. |
| **Cassino** | **Roleta** girando com a bolinha, mesa de pôquer com fichas, 5 caça-níqueis com os rolos girando, bar com taças, poltronas de veludo e um **aquário com tubarão**. |
| **Heliponto** | **Helicóptero** com a hélice girando, lancha balançando no cais, biruta ao vento, radar giratório, barris, caixas e holofotes. |

### Cidade Gótica

Uma cidade noir, **sempre à noite**, com **chuva** no telhado, **relâmpagos** que clareiam tudo e **morcegos**. As paredes são de tijolo e o gato é preto.

| Ambiente | Detalhes |
|---|---|
| **Delegacia** | Balcão do sargento com abajur verde e rádio, **cela** com grades e luz piscando, banco de espera, cafeteira e cartazes de "procurado". |
| **Detetives** | Mesas de madeira escura com **abajur verde** sempre aceso e monitor CRT de fósforo verde. Na parede ficam um quadro de **casos** com uma ficha por tarefa e as janelas com persiana, chuva e prédios ao fundo. Também tem um quadro de cortiça com fotos e barbante vermelho, uma mesa de evidências com lupa e cabideiros com chapéu. |
| **Interrogatório** | Mesa de metal com duas cadeiras, **lâmpada pendurada** balançando com o cone de luz e espelho falso na parede. |
| **Esconderijo** | Caverna com chão de pedra, **paredão de monitores**, carro preto, estalactites e morcegos voando. |
| **Lanchonete** | Piso xadrez, balcão com banquinhos vermelhos, **jukebox** colorida, cabine telefônica, mesas-cabine e um letreiro de neon "LANCHES" que falha. |
| **Clube de jazz** | Palco com **piano** (o agente senta e toca) e microfone, mesinhas com **velas** tremulando, bar e um letreiro de neon "JAZZ". |
| **Telhado** | Caixa d'água, **holofote girando** para o céu, chaminés soltando fumaça, ar-condicionado, casinha de acesso, antena com luz vermelha, poças com gotas e parapeito com **gárgulas**. |

**Vida própria:** quando não estão trabalhando, os agentes passeiam. Eles tomam café, bebem água, leem na estante, jogam fliperama ou ping-pong, assistem TV, cochilam nos puffs, regam as flores, olham o lago, desenham no quadro, conferem os servidores e às vezes sentam na própria mesa. Pelo mapa também circulam um **gato**, que dorme em vários cantos, e um **robô aspirador** (no quartel, um drone).

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

Ficam na pasta de `path_agent` do `.env` (padrão: `.claude/agents/*.md`):

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

A mensagem FIPA-ACL é **obrigatória**: é a única forma de um agente falar com outro. Cada agente termina a resposta com **uma** mensagem:

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
| resposta sem mensagem FIPA | O roteador **cobra** o agente na mesma sessão, até **2 vezes** (`MAX_COBRAR_FIPA`), e emite `fipa_cobrar`. Se ainda faltar, manda um `failure` em nome dele para quem fez o pedido. |

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
                       claude -p --agent <atual> --agents <json> --output-format stream-json --verbose
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
| `tokens` | `agente`, `entrada`, `saida`, `cache` | Tokens gastos desde o último aviso (ao vivo). |
| `fipa_cobrar` | `agente`, `tentativa` | O agente respondeu sem FIPA-ACL e foi cobrado. |
| `agente_fim` | `agente`, `ok`, `custo`, `duracao`, `tokens` | O processo dele terminou. |
| `tarefa_fim` | `ok`, `resposta`, `custo`, `duracao`, `tokens` | A cadeia acabou. |

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
├── relatorio.py         # relatório Word (.docx) ou texto (.txt) de uma tarefa, só com a biblioteca padrão
├── front/
│   ├── index.html       # layout (tela inicial, palco, painel e gerenciador de agentes)
│   ├── style.css        # tema escuro
│   ├── game.js          # mundo pixel art: 3 mapas (THEMES), móveis, personagens, IA, câmera, minimapa
│   └── app.js           # tela inicial, painel, gerenciador de agentes, linha do tempo, ponte com o Python e Demo
├── .claude/agents/      # definição dos agentes (padrão; troque com path_agent)
├── testes-agents/       # arquivos criados pelos agentes em testes (não são o núcleo)
├── tests/test_pasta.py  # testes da pasta de trabalho
├── tests/test_novos.py  # testes de path_agent, FIPA, relatórios, agentes (criar/editar/excluir), modelo e skin
├── .agentbranch.json    # pasta de trabalho, mapa (tema) e skins (ignorado pelo git)
├── .lixeira-agentes/    # agentes excluídos pelo app (ignorado pelo git)
├── .env                 # opcional: path_agent (ignorado pelo git)
└── README.md
```

**`game.js`**, por dentro:
- **Render:** o piso é gerado pixel a pixel uma única vez (`ImageData`), junto com paredes e decoração fixa. A cada quadro, desenha num buffer pequeno na resolução lógica e amplia com `imageSmoothingEnabled = false`.
- **Profundidade:** móveis e personagens são ordenados pela linha do pé (`base`), então dá para passar atrás de mesas e árvores. Quem senta de costas é desenhado antes do encosto da cadeira.
- **Personagens:** desenhados por código, em 4 direções, com ciclo de caminhada, piscada e poses (`type`, `sit`, `drink`, `read`, `play`, `pingpong`, `water`, `draw`, `jump`, `facepalm`...). Cada agente tem cabelo, roupa e acessórios próprios: terno e óculos escuros, capacete de obra, jaleco, moletom com fone...
- **Mapas:** `THEMES` define, para cada mapa, os pisos, as cores das paredes, o padrão da parede (listras, painéis ou tijolo), o estilo das mesas (`wood`, `console`, `noir`), os bichos, a noite e a chuva. `buildEscritorio` / `buildEspiao` / `buildGotica` colocam os móveis e os pontos de interesse. `applyTheme(id)` refaz o mundo e leva os agentes para as mesas novas. `Game.validate()` confere se todo ponto de interesse e toda mesa é alcançável.
- **IA:** um pathfinding A* nos tiles e pontos de interesse com reserva, para dois agentes não ocuparem o mesmo lugar.
- **Simulação:** usa sub-passos de 50 ms. Se a janela ficar minimizada, tudo se atualiza quando ela voltar.

**`terminalContact.py`**:
- `ler_agentes(pasta)`: lê nome, descrição e ferramentas do frontmatter, e o corpo do `.md` (`prompt`).
- `_definicao_json(agente)`: JSON do agente atual para o `--agents`.
- `parse_fipa(texto)`: parser tolerante de FIPA-ACL (aspas, blocos de código, `usuário/user`).
- `executar_agente(...)`: um processo `claude -p` com stream ao vivo; soma os tokens e emite `tokens`.
- `executar_tarefa(...)`: o roteador. Cobra a mensagem FIPA até 2 vezes antes de mandar `failure`.
- `TerminalContact.copia_job(id)`: cópia da tarefa com o log, usada pelo relatório.

**`home.py`** (classe `Api`): `config`, `send`, `cancel`, `poll`, `history`, `escolher_pasta`, `set_pasta`, `set_tema`, `criar_agente`, `ler_agente`, `salvar_agente` (editar e renomear), `salvar_arquivo_agente` (`.md` cru), `excluir_agente`, `salvar_skin` e `relatorio(id, 'docx'|'txt')`. `_pasta_agentes()` lê o `path_agent`. O `montar_html()` marca a página com `__AGENTS_DESKTOP__`, e por isso o front espera a ponte do pywebview em vez de cair no modo demonstração.

**`relatorio.py`**: `resumir(job)` agrupa o log; `gerar_docx(job)` devolve os bytes do `.docx`; `gerar_txt(job)` devolve o texto.

**`terminalContact.py`** (continuação):
- `modelo_do_agente(agente, padrao)`: o `model:` do agente (apelido ou id completo) ou o modelo da tela.
- `ler_memoria` / `gravar_memoria` / `mapa_projeto`: memória entre tarefas e mapa da pasta.
- `TerminalContact`: fila de tarefas com eventos numerados (`poll`), `cancelar` e `historico`.

## Criar um agente novo

O jeito mais fácil é o botão **Agentes** (veja [Gerenciar agentes](#gerenciar-agentes-criar-editar-excluir)). Ele tem modelos prontos, cria o arquivo e salva a aparência.

Para criar à mão, grave `agent-<nome>.md` na pasta dos agentes (`path_agent`, padrão `.claude/agents`):

```markdown
---
name: agent-<nome>
description: Uma frase dizendo quando este agente deve ser chamado (os outros leem isso).
tools: Read, Grep, Glob   # opcional; sem esta linha o agente pode usar todas
model: haiku              # opcional; opus, sonnet, haiku, fable ou um id completo
---

Você é o **agent-<nome>**. Regras...
```

O roteador já explica o protocolo FIPA para cada agente e lista a equipe com as descrições. Criado à mão, o agente aparece na próxima vez que o app abrir. Criado pelo gerenciador, aparece na hora. Para o `agent-007` saber quando usá-lo, cite-o no `agent-007.md`.

## Contexto entre execuções

Os agentes não precisam reler o projeto inteiro a cada tarefa. O roteador cuida disso de três formas, e nenhuma delas gasta tokens para ser mantida:

| Recurso | O que é | Onde fica |
|---|---|---|
| **Memória** | Depois de cada tarefa, o Python anota a data, o pedido, a cadeia de agentes, os arquivos alterados e o resultado. As anotações mais recentes (até 2.500 caracteres) entram no prompt da próxima tarefa. | `<pasta de trabalho>/.agentbranch/memoria.md` |
| **Mapa da pasta** | Lista dos arquivos da pasta de trabalho com o tamanho (até 80 arquivos), montada pelo Python e enviada no prompt. Os agentes não precisam usar `Glob`/`ls` para se localizar. | gerado a cada tarefa |
| **`CLAUDE.md`** | Resumo fixo do projeto e das regras. O Claude Code carrega esse arquivo sozinho em toda sessão. | raiz da pasta de trabalho |

A memória guarda as últimas 30 tarefas e vale por pasta de trabalho. Ela continua lá depois de fechar o app. Para "esquecer" tudo, apague a pasta `.agentbranch/`. Você também pode editar o `memoria.md` à mão para registrar decisões.

**Economia de tokens:**
- Todo agente recebe regras de economia: começar pela memória e pelo mapa, usar `Grep` e leitura parcial em vez de ler arquivos inteiros, não reler o que já leu e responder curto.
- **Dentro de uma tarefa**, quando um agente é acionado de novo (por exemplo, o `agent-007` recebendo o resultado), a sessão dele é retomada com `--resume` e ele recebe só a mensagem nova, de uns 300 caracteres, em vez do prompt completo.
- **Entre tarefas**, as sessões não são retomadas de propósito: o histórico inteiro seria reenviado a cada chamada e ficaria cada vez mais caro. A memória resumida cumpre esse papel por uma fração do custo.

Para aproveitar melhor: crie um `CLAUDE.md` curto na sua pasta de trabalho com o resumo do projeto. O deste repositório serve de exemplo.

## Gerar o executável

```bash
pip install pyinstaller pywebview python-dotenv
pyinstaller --noconfirm --onefile --windowed --name agents0.7 --add-data "front;front" home.py
```

O resultado é `dist/agents0.7.exe` (cerca de 13 MB). O exe procura a pasta base (a que tem `.env` **ou** `.claude/agents`) em quatro lugares: na pasta dele, no diretório atual, na pasta acima (o que permite rodar direto de `dist/`) e duas pastas acima. Um `path_agent` relativo conta a partir dessa pasta base. O `relatorio.py` entra no exe sozinho, porque é importado pelo `home.py`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| A janela abre, mas "Modo navegador" aparece | O `pywebview` não carregou a ponte em 15 segundos. Rode `python home.py --debug` e veja o console. |
| O gerenciador não salva o `.md` cru | O cabeçalho precisa começar com `---`, ter `name:` igual ao nome do arquivo e `description:`. Para renomear, use a aba Perfil. |
| `[ERRO] comando 'claude' nao encontrado` | O Claude Code não está no PATH. |
| Nenhum agente aparece | O app não achou a pasta dos agentes. Confira o `path_agent` do `.env` (relativo conta da pasta base) ou rode o app na pasta do projeto. |
| A linha do tempo mostra `fipa_cobrar` e depois `failure` | O agente não terminou com uma mensagem FIPA-ACL, mesmo depois de ser cobrado 2 vezes. Reforce o formato no `.md` dele. |
| "ja existe um agente chamado ..." | O gerenciador não sobrescreve arquivos. Escolha outro nome ou exclua o agente antigo. |
| O agente quer rodar um comando e não consegue | No modo `editar arquivos (padrao)`, comandos de terminal que pedem aprovação são negados. Use **tudo liberado** (cuidado) ou faça a parte do terminal você mesmo. |
| A cadeia para com "limite de 14 trocas" | Os agentes entraram em ciclo. Deixe o pedido mais específico. |
| `pip install json/threading/argparse` falha | Esses módulos já vêm com o Python. |

## Pontos de atenção

- **Pasta de trabalho:** confira a pasta mostrada no card NOVA TAREFA antes de enviar. Os agentes editam arquivos **nela**, não no projeto agents0.7.
- **Permissões:** `acceptEdits` deixa os agentes **editarem arquivos sem pedir confirmação**. `bypassPermissions` libera **tudo**, inclusive comandos no terminal. Use as duas só em pastas versionadas pelo git.
- Cada salto da cadeia é um processo `claude -p` novo, que leva alguns segundos para iniciar e custa tokens. O custo de cada agente aparece na linha do tempo.
- O formato FIPA-ACL é obrigatório, mas continua sendo texto. Se o modelo errar, o roteador tenta entender. Se não achar a mensagem, cobra o agente 2 vezes (cada cobrança custa tokens) e depois manda `failure` para quem pediu.
- **`path_agent`:** o `.env` é lido uma vez, quando o app abre. Mudou a variável? Reabra o app. O agente criado pelo gerenciador vai para essa pasta.
- O `_achar_projeto` aceita como pasta base **qualquer** pasta com `.env`, mesmo que não seja deste projeto. Rode o exe de dentro da pasta certa.
- As instruções podem ter até 200 KB. Um texto grande vai inteiro no `.md` e no `--agents` de cada chamada, e gasta tokens.
- Excluir um agente o tira da equipe na hora. Se ele estava no meio de uma tarefa, a tarefa continua com o processo que já estava rodando.
- Fechar a janela cancela as tarefas em andamento.

## Próximos passos

1. **Continuar a mesma conversa:** uma opção para retomar as sessões da tarefa anterior com `--resume` (mais caro, mas útil para tarefas longas).
2. **Log persistente:** salvar os eventos em `logs/AAAA-MM-DD.jsonl` e criar um modo "replay" no escritório.
3. **Painel de custo:** um total por dia e por agente (os eventos já trazem `custo`).
4. **Agentes em paralelo:** permitir `request` para dois agentes ao mesmo tempo. O escritório já suporta vários agentes ao vivo; falta o roteador.
5. **Reuniões:** quando três ou mais agentes estiverem na mesma tarefa, juntá-los na sala de reunião.
