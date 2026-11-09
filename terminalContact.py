import os

import subprocess
import dotenv

dotenv.load_dotenv()


def actionClaude(prompt):
    try:
        resultado = subprocess.run(
        [ "claude", prompt, "--permission-mode", "acceptEdits"],
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

    def enviar(self, prompt):
        resposta = actionClaude(prompt)
        self.historico.append({"prompt": prompt, "resposta": resposta})
        return resposta

    def ultima_resposta(self):
        if not self.historico:
            return None
        return self.historico[-1]["resposta"]

    def limpar_historico(self):
        self.historico.clear()


print(actionClaude("voce consegue criar um repositorio no github e fazer um commit e push desta pasta agora? se sim faça agora pfv!"))