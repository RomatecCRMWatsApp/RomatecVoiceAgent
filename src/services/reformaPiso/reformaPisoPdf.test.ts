// v3.68.0: garante que o PDF gera com relatório fotográfico + plantas (sem crashar).
import { describe, it, expect } from 'vitest';
import { gerarPdf } from './reformaPisoPdf';
import { calcular } from './reformaPisoCalc';

// JPEG 1x1 (sem canal alfa) — PDFKit embute direto (rápido). PNG com alfa cai
// num caminho lento de soft-mask (segundos por imagem); fotos reais são JPEG.
const JPG_1x1 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwA//9k=';

const cab = {
  numero: 'PROP-REF-2026-0001-R1', contratanteNome: 'Ceará Alimentos',
  cidade: 'Açailândia', uf: 'MA', validadeDias: 15, comRemocao: false,
};

describe('gerarPdf (reforma piso)', () => {
  const r = calcular([{ descricao: 'Sala 01', comprimentoM: 4, larguraM: 3 }]);

  it('gera PDF válido sem extras', async () => {
    const buf = await gerarPdf('prime1', cab, r);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('gera PDF com relatório fotográfico + planta-imagem + planta-arquivo', async () => {
    const buf = await gerarPdf('tradicional', cab, r, {
      fotos: [{ mime: 'image/jpeg', dataBase64: JPG_1x1, legenda: 'Antes' }],
      plantasImagens: [{ nome: 'planta-baixa.jpg', buffer: Buffer.from(JPG_1x1, 'base64') }],
      plantasArquivos: [{ nome: 'projeto.dwg' }],
    });
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });
});
