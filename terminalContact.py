import os

import subprocess
import dotenv

dotenv.load_dotenv()


def actionClaude(prompt, model, effort, agent):
    try:
        resultado = subprocess.run(
        ["claude", "-p", prompt, "--permission-mode", "acceptEdits",
         "--model", model, "--agent", agent, "--effort", effort],
        capture_output=True,
        text=True,
        cwd=os.getenv("route_terminal"),
        )
        if resultado.returncode != 0:
                print("Erro:", resultado.stderr)
                return
        return resultado.stdout
    except Exception as erro:
        print(f'erro: {erro}')
 

class TerminalContact:
    """Gerencia o envio de prompts ao Claude e mantém um histórico das interações."""

    def __init__(self):
        self.historico = []

    def teste():
        print("teste, funfa")


    def enviar(self, prompt, effort, model, agent):
        resposta = actionClaude(prompt, model, effort, agent)
        self.historico.append({"prompt": prompt, "resposta": resposta})
        return resposta

    def ultima_resposta(self):
        if not self.historico:
            return None
        return self.historico[-1]["resposta"]

    def limpar_historico(self):
        self.historico.clear()


# print(actionClaude("somente mova o codigo escritorio_pixel.py para uma pasta chamada 'testes-agents' e deixe os personagens e ambiente do codigo mais elegante e moderno ", "claude-opus-5-5", "low", "agent-007"))