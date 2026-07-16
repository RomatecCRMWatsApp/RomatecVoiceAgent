// src/routes/inventarioPublico.ts
// v3.101.1 — Link PÚBLICO do Inventário de Obra (padrão /v/entrega, fora da auth).
// GET /v/inventario/:hash → relatório PDF gerado NA HORA do acesso (estado real:
// cada material que entrou/foi utilizado aparece na próxima abertura do link).
// Hash de 64 hex (impossível de adivinhar); inválido => 404 seco, sem vazar nada.
import { Router, type Request, type Response } from 'express';

export const inventarioPublicoRouter = Router();

inventarioPublicoRouter.get('/:hash', async (req: Request, res: Response) => {
  try {
    const repo = await import('../services/inventario/inventarioObraRepo');
    const cab = await repo.buscarCabecalhoPorHash(String(req.params.hash ?? ''));
    if (!cab) return res.status(404).send('Link de inventário inválido ou expirado.');
    const etapaId = req.query.etapa_id != null && String(req.query.etapa_id) !== ''
      ? parseInt(String(req.query.etapa_id), 10) : undefined;
    const dados = await repo.dadosRelatorio(cab.obra_id, Number.isFinite(etapaId as number) ? etapaId : undefined);
    const { gerarInventarioPdfComAnexos } = await import('../services/inventario/inventarioObraPdf');
    const pdf = await gerarInventarioPdfComAnexos(dados);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Inventario_${cab.numero || cab.obra_id}.pdf"`);
    res.setHeader('Cache-Control', 'no-store'); // sempre o estado ATUAL
    res.send(pdf);
  } catch (err) {
    console.error('[inventario-publico] erro:', (err as Error).message);
    res.status(500).send('Falha ao gerar o inventário. Tente novamente em instantes.');
  }
});

export default inventarioPublicoRouter;
