// Render do texto explicativo (remembramento / desmembramento).
// Busca template ativo na tabela `textos_explicativos` e faz substituição
// {{variavel}} por valor, com fallback se vazio. Sem libs de templating —
// substituição simples por split/join é segura porque os valores são
// dados de cliente (não inserem markup ZAPI sensível) e o destino é
// texto plano do WhatsApp.

import type { RowDataPacket } from 'mysql2';
import pool from '../database/connection';

export type TipoServico = 'remembramento' | 'desmembramento';
export type TipoImovel = 'urbano' | 'rural';
export type UnidadeArea = 'm²' | 'ha';

export interface DadosTexto {
  tipoServico: TipoServico;
  clienteNome: string;
  quantidadeImoveis?: number;
  areaTotal?: number;
  unidadeArea?: UnidadeArea;
  quantidadeFracoes?: number;
  municipio?: string;
  uf?: string;
  tipoImovel?: TipoImovel;
}

export function calcularBaseLegal(tipoImovel?: TipoImovel): string {
  if (tipoImovel === 'urbano') {
    return 'Lei Federal nº 6.766/79 e legislação municipal de parcelamento do solo';
  }
  if (tipoImovel === 'rural') {
    return 'Lei nº 5.868/72 e normas do INCRA aplicáveis ao parcelamento rural';
  }
  return 'legislação aplicável';
}

interface TemplateRow extends RowDataPacket {
  template_texto: string;
}

export async function gerarTextoExplicativo(dados: DadosTexto): Promise<string> {
  const [rows] = await pool.query<TemplateRow[]>(
    'SELECT template_texto FROM textos_explicativos WHERE tipo_servico = ? AND ativo = 1 LIMIT 1',
    [dados.tipoServico],
  );
  if (!rows.length) {
    throw new Error(`Template não encontrado para ${dados.tipoServico}`);
  }
  let texto = rows[0].template_texto;

  const substituicoes: Record<string, string> = {
    '{{cliente_nome}}': (dados.clienteNome || '').trim() || 'Cliente',
    '{{quantidade_imoveis}}':
      dados.quantidadeImoveis != null ? String(dados.quantidadeImoveis) : 'X',
    '{{area_total}}':
      dados.areaTotal != null
        ? dados.areaTotal.toLocaleString('pt-BR')
        : 'X',
    '{{unidade_area}}': dados.unidadeArea || 'm²',
    '{{quantidade_fracoes}}':
      dados.quantidadeFracoes != null ? String(dados.quantidadeFracoes) : 'X',
    '{{municipio}}': (dados.municipio || '').trim() || 'Açailândia',
    '{{uf}}': (dados.uf || '').trim() || 'MA',
    '{{base_legal}}': calcularBaseLegal(dados.tipoImovel),
  };

  for (const [chave, valor] of Object.entries(substituicoes)) {
    texto = texto.split(chave).join(valor);
  }
  return texto;
}
