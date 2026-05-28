// v3.29.0: defaults sugeridos de aditivo de campo por subtipo de proposta.
// O default reflete a exposicao tipica do tecnico em cada cenario:
//   - Mata fechada / cerrado / rural denso  -> insalubridade grau medio
//   - Urbano com vegetacao rasa             -> insalubridade grau minimo
//   - Avaliacao/projeto em escritorio       -> desligado por default

import type { AditivoTipo, AditivoGrau } from './aditivoCampoCalculator';

export interface AditivoDefault {
  habilitado: boolean;
  tipo: AditivoTipo;
  grau: AditivoGrau;
}

export const ADITIVO_DEFAULTS: Record<string, AditivoDefault> = {
  // Mata fechada / cerrado -> grau medio
  demarcacao_rural:          { habilitado: true,  tipo: 'insalubridade', grau: 'medio' },
  georreferenciamento_rural: { habilitado: true,  tipo: 'insalubridade', grau: 'medio' },

  // Urbano / vegetacao rasa -> grau minimo
  demarcacao_urbana:         { habilitado: true,  tipo: 'insalubridade', grau: 'minimo' },
  averbacao_residencial:     { habilitado: true,  tipo: 'insalubridade', grau: 'minimo' },
  averbacao_comercial:       { habilitado: true,  tipo: 'insalubridade', grau: 'minimo' },
  desmembramento:            { habilitado: true,  tipo: 'insalubridade', grau: 'minimo' },
  remembramento:             { habilitado: true,  tipo: 'insalubridade', grau: 'minimo' },
  retificacao_area:          { habilitado: true,  tipo: 'insalubridade', grau: 'minimo' },

  // Escritorio (avaliacao / projeto executivo) -> desligado
  avaliacao_ptam:            { habilitado: false, tipo: 'insalubridade', grau: 'minimo' },
  projeto_executivo:         { habilitado: false, tipo: 'insalubridade', grau: 'minimo' },
};

export function defaultParaSubtipo(subtipo: string | null | undefined): AditivoDefault {
  if (!subtipo) return { habilitado: false, tipo: 'insalubridade', grau: 'minimo' };
  return ADITIVO_DEFAULTS[subtipo] ?? { habilitado: false, tipo: 'insalubridade', grau: 'minimo' };
}
