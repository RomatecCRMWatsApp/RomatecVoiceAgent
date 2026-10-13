// v3.145.0 — Identidade visual de cada projeto (arquivos em public/brand/pa).
// Brasão = documentos oficiais (carnê, mapa); emblema circular = telas/cabeçalho
// (manual de identidade visual do PA Salete Moreno, 11/10/2026).
export interface MarcaProjeto { brasao: string | null; emblema: string | null }

const MARCAS: Record<string, MarcaProjeto> = {
  'PA-SALETE-MORENO': { brasao: 'brasao_salete_moreno.png', emblema: 'emblema_salete_moreno.png' },
};

/** Nomes dos arquivos (para o gerador de PDF ler do disco). */
export function marcaArquivos(codigo: string): MarcaProjeto {
  return MARCAS[codigo] ?? { brasao: null, emblema: null };
}

/** URLs públicas (para o front). */
export function marcaUrls(codigo: string): MarcaProjeto {
  const m = marcaArquivos(codigo);
  return { brasao: m.brasao ? `/brand/pa/${m.brasao}` : null, emblema: m.emblema ? `/brand/pa/${m.emblema}` : null };
}
