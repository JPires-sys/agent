import tkinter as tk


def main():
    root = tk.Tk()
    root.title("Calculadora")
    root.resizable(False, False)

    tela = tk.Entry(root, font=("Arial", 20), justify="right", width=16)
    tela.grid(row=0, column=0, columnspan=4, padx=5, pady=5)

    def inserir(c):
        if tela.get() == "Erro":
            tela.delete(0, tk.END)
        tela.insert(tk.END, c)

    def limpar():
        tela.delete(0, tk.END)

    def calcular():
        try:
            # Entrada vem apenas dos botoes (digitos, ., + - * /)
            r = eval(tela.get())
            tela.delete(0, tk.END)
            tela.insert(0, str(round(r, 10)))
        except Exception:  # ZeroDivisionError, sintaxe invalida
            tela.delete(0, tk.END)
            tela.insert(0, "Erro")

    botoes = ["7", "8", "9", "/", "4", "5", "6", "*",
              "1", "2", "3", "-", "0", ".", "=", "+"]
    for i, b in enumerate(botoes):
        cmd = calcular if b == "=" else (lambda c=b: inserir(c))
        tk.Button(root, text=b, width=5, height=2, font=("Arial", 14),
                  command=cmd).grid(row=1 + i // 4, column=i % 4, padx=2, pady=2)
    tk.Button(root, text="C", font=("Arial", 14), command=limpar).grid(
        row=5, column=0, columnspan=4, sticky="we", padx=2, pady=2)

    root.mainloop()


if __name__ == "__main__":
    main()
