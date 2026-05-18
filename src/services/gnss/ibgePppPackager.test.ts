import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { empacotarParaIbge } from './ibgePppPackager';

describe('empacotarParaIbge', () => {
  it('zip contem todos os arquivos com nome preservado', () => {
    const buf = empacotarParaIbge([
      { nome: 'M0010001.26o', conteudo: Buffer.from('OBS_HEADER\n') },
      { nome: 'M0010001.26n', conteudo: Buffer.from('NAV_GPS\n') },
      { nome: 'M0010001.26g', conteudo: Buffer.from('NAV_GLO\n') },
    ]);
    const z = new AdmZip(buf);
    const nomes = z.getEntries().map(e => e.entryName).sort();
    expect(nomes).toEqual(['M0010001.26g', 'M0010001.26n', 'M0010001.26o']);
  });

  it('lanca erro se faltar o arquivo de observacao', () => {
    expect(() => empacotarParaIbge([{ nome: 'M0010001.26n', conteudo: Buffer.from('') }]))
      .toThrow(/observacao/i);
  });

  it('lanca erro se 2 arquivos tem o mesmo nome', () => {
    expect(() => empacotarParaIbge([
      { nome: 'a.26o', conteudo: Buffer.from('x') },
      { nome: 'a.26o', conteudo: Buffer.from('y') },
    ])).toThrow(/duplicado/i);
  });
});
