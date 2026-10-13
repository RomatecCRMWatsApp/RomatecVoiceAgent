// v3.142.0 — Erro de regra de negócio do módulo PA: código estável (o front e a
// Zayra decidem pelo código) + status HTTP sugerido.
export class PaErro extends Error {
  constructor(
    public readonly codigo: string,
    message: string,
    public readonly http: number = 422,
    public readonly detalhe?: unknown,
  ) {
    super(message);
    this.name = 'PaErro';
  }
}
