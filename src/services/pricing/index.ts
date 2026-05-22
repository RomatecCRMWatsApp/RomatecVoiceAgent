// v1.66.0: orquestrador do motor de calculo.
// v1.99.4: Geo Rural implementado (Fase 2 iniciada).
// Pendentes: desmembramento, remembramento, retificacao, ptam.

import type {
  SubtipoConsultoria,
  ResultadoCalculo,
  InputAverbacao,
  InputGeorreferenciamento,
  InputDesmembramento,
  InputRetificacao,
  InputAvaliacaoPTAM,
  InputProjetoExecutivo,
} from './types';
import { calcularAverbacao } from './averbacao';
import { calcularGeorreferenciamento } from './georreferenciamento';
import { calcularDesmembramento } from './desmembramento';
import { calcularRetificacao } from './retificacao';
import { calcularAvaliacaoPTAM } from './ptam';
import { calcularProjetoExecutivo } from './projetoExecutivo';

export type InputConsultoria =
  | { subtipo: 'averbacao_residencial' | 'averbacao_comercial'; dados: InputAverbacao }
  | { subtipo: 'georreferenciamento_rural';   dados: InputGeorreferenciamento }
  | { subtipo: 'desmembramento';              dados: InputDesmembramento }
  | { subtipo: 'remembramento';               dados: InputDesmembramento }
  | { subtipo: 'retificacao_area';            dados: InputRetificacao }
  | { subtipo: 'avaliacao_ptam';              dados: InputAvaliacaoPTAM }
  | { subtipo: 'projeto_executivo';           dados: InputProjetoExecutivo };

export async function calcularConsultoria(input: InputConsultoria): Promise<ResultadoCalculo> {
  switch (input.subtipo) {
    case 'averbacao_residencial':
      return calcularAverbacao({ ...input.dados, modalidade: 'residencial' });
    case 'averbacao_comercial':
      return calcularAverbacao({ ...input.dados, modalidade: 'comercial', apresentar_projetos_complementares: true });
    case 'georreferenciamento_rural':
      return calcularGeorreferenciamento(input.dados);
    case 'desmembramento':
      return calcularDesmembramento({ ...input.dados, tipo: 'desmembramento' });
    case 'remembramento':
      return calcularDesmembramento({ ...input.dados, tipo: 'remembramento' });
    case 'retificacao_area':
      return calcularRetificacao(input.dados);
    case 'avaliacao_ptam':
      return calcularAvaliacaoPTAM(input.dados);
    case 'projeto_executivo':
      return calcularProjetoExecutivo(input.dados);
  }
}

export type SubtipoFase1 = SubtipoConsultoria;

export const SUBTIPOS_DISPONIVEIS_FASE1: SubtipoConsultoria[] = [
  'averbacao_residencial',
  'averbacao_comercial',
  'georreferenciamento_rural',
  'desmembramento',
  'remembramento',
  'retificacao_area',
  'avaliacao_ptam',
  'projeto_executivo',
];

export const TODOS_SUBTIPOS: SubtipoConsultoria[] = [
  'averbacao_residencial',
  'averbacao_comercial',
  'georreferenciamento_rural',
  'desmembramento',
  'remembramento',
  'retificacao_area',
  'avaliacao_ptam',
  'projeto_executivo',
];
