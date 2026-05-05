// v1.66.0: orquestrador do motor de calculo. Em Fase 1 so Averbacao.
// Demais subtipos (georref, desm, retif, ptam) entram na Fase 3.

import type { SubtipoConsultoria, ResultadoCalculo, InputAverbacao } from './types';
import { calcularAverbacao } from './averbacao';

export type InputConsultoria =
  | { subtipo: 'averbacao_residencial' | 'averbacao_comercial'; dados: InputAverbacao }
  // Stubs Fase 3 — bloqueiam ate implementacao completa:
  | { subtipo: 'georreferenciamento_rural';   dados: unknown }
  | { subtipo: 'desmembramento';              dados: unknown }
  | { subtipo: 'remembramento';               dados: unknown }
  | { subtipo: 'retificacao_area';            dados: unknown }
  | { subtipo: 'avaliacao_ptam';              dados: unknown };

export async function calcularConsultoria(input: InputConsultoria): Promise<ResultadoCalculo> {
  switch (input.subtipo) {
    case 'averbacao_residencial':
      return calcularAverbacao({ ...input.dados, modalidade: 'residencial' });
    case 'averbacao_comercial':
      return calcularAverbacao({ ...input.dados, modalidade: 'comercial', apresentar_projetos_complementares: true });
    case 'georreferenciamento_rural':
    case 'desmembramento':
    case 'remembramento':
    case 'retificacao_area':
    case 'avaliacao_ptam':
      throw new Error(`Subtipo ${input.subtipo} nao implementado nesta fase. Apenas averbacao_residencial e averbacao_comercial estao disponiveis na Fase 1.`);
  }
}

export type SubtipoFase1 = 'averbacao_residencial' | 'averbacao_comercial';

export const SUBTIPOS_DISPONIVEIS_FASE1: SubtipoFase1[] = [
  'averbacao_residencial',
  'averbacao_comercial',
];

export const TODOS_SUBTIPOS: SubtipoConsultoria[] = [
  'averbacao_residencial',
  'averbacao_comercial',
  'georreferenciamento_rural',
  'desmembramento',
  'remembramento',
  'retificacao_area',
  'avaliacao_ptam',
];
