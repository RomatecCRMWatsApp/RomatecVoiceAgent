// Monta um .zip contendo os arquivos RINEX para submissao manual ao portal
// IBGE-PPP. Validacoes: 1 arquivo de observacao (.YYo ou .rnx) obrigatorio;
// nomes unicos. Tamanho/duracao validados em camada superior (route).

import AdmZip from 'adm-zip';

export interface ArquivoEmpacotar {
  nome: string;
  conteudo: Buffer;
}

const OBS_REGEX = /\.(?:\d{2}o|rnx)$/i;

export function empacotarParaIbge(arquivos: ArquivoEmpacotar[]): Buffer {
  if (!arquivos.length) throw new Error('Nenhum arquivo fornecido');
  const temObs = arquivos.some(a => OBS_REGEX.test(a.nome));
  if (!temObs) throw new Error('Falta arquivo de observacao (.YYo ou .rnx)');
  const nomes = new Set<string>();
  for (const a of arquivos) {
    if (nomes.has(a.nome)) throw new Error(`Nome duplicado no pacote: ${a.nome}`);
    nomes.add(a.nome);
  }
  const zip = new AdmZip();
  for (const a of arquivos) {
    zip.addFile(a.nome, a.conteudo);
  }
  return zip.toBuffer();
}

export function desempacotarRetornoIbge(zipBuffer: Buffer): Array<{ nome: string; conteudo: Buffer }> {
  const zip = new AdmZip(zipBuffer);
  return zip.getEntries()
    .filter(e => !e.isDirectory)
    .map(e => ({ nome: e.entryName, conteudo: e.getData() }));
}
