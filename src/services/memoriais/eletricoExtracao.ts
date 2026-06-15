// v3.66.0: orquestra a extração elétrica — IA-documento + parser de texto.
import { extrairEletricaDeDocumento, validarExtracao, aplicarLanceDefault } from './aiDocExtractor';
import { parsePlantaPdf } from './memorialPdfParser';
import type { ExtracaoEletrica } from './eletricoExtracaoTypes';

export async function extrairEletricaCompleta(pdf: Buffer): Promise<ExtracaoEletrica> {
  const [ia, texto] = await Promise.all([
    extrairEletricaDeDocumento(pdf),
    parsePlantaPdf(pdf).catch(() => null),
  ]);

  // Metadados do texto têm prioridade (regex determinística > IA) quando existirem.
  if (texto?.metadados) {
    const m = texto.metadados;
    ia.obra = {
      ...ia.obra,
      proprietario: m.proprietario ?? ia.obra.proprietario,
      cpfCnpj: m.cpf_cnpj ?? ia.obra.cpfCnpj,
      municipio: m.municipio ?? ia.obra.municipio,
      uf: m.uf ?? ia.obra.uf,
      areaConstruidaM2: m.area_construida_m2 ?? ia.obra.areaConstruidaM2,
      areaLoteM2: m.area_lote_m2 ?? ia.obra.areaLoteM2,
      taxaOcupacaoPct: m.taxa_ocupacao_pct ?? ia.obra.taxaOcupacaoPct,
      nPavimentos: m.num_pavimentos ?? ia.obra.nPavimentos,
      prancha: m.prancha_codigo ?? ia.obra.prancha,
    };
    if (m.area_construida_m2 && ia.obra.areaConstruidaM2) {
      const dif = Math.abs(m.area_construida_m2 - ia.obra.areaConstruidaM2) / m.area_construida_m2;
      if (dif > 0.05) ia.divergencias.push(`Área diverge: texto ${m.area_construida_m2} m² × IA ${ia.obra.areaConstruidaM2} m².`);
    }
  } else {
    ia.observacoes.push('Parser de texto não retornou metadados — confira a obra manualmente.');
  }

  ia.circuitos = aplicarLanceDefault(ia.circuitos);
  ia.observacoes.push(...validarExtracao(ia));
  return ia;
}
