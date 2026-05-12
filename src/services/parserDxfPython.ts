// src/services/parserDxfPython.ts
//
// Wrapper Node do parser DXF em Python. Subprocess one-shot.
// Requer python3 + ezdxf + shapely instalados no host.

import { spawn } from 'node:child_process';
import { resolve as pathResolve } from 'node:path';

export interface DxfPoligono {
  dxf_id: string;
  label: string;
  layer: string;
  coords: Array<[number, number]>;
  area_m2: number;
  centroide: { x: number; y: number };
  quadra_label?: string;
}

export interface DxfReport {
  formato: 'DXF';
  unidade: 'metros';
  quadras: DxfPoligono[];
  lotes: DxfPoligono[];
  avisos: string[];
}

export type DxfErroCodigo =
  | 'dependencia_ausente'
  | 'arquivo_nao_existe'
  | 'dxf_invalido'
  | 'stdout_invalido'
  | 'timeout'
  | 'desconhecido';

export class DxfParseError extends Error {
  override name = 'DxfParseError';
  constructor(public codigo: DxfErroCodigo, public detalhe: string) {
    super(`[${codigo}] ${detalhe}`);
  }
}

const SCRIPT = pathResolve(process.cwd(), 'scripts/parse_loteamento_dxf.py');
const PYTHON = process.env.PYTHON_BIN || 'python';
const TIMEOUT_MS = 180_000; // 3min — DXFs reais de loteamento podem ter milhares de entidades

export async function parseLoteamentoDxf(dxfPath: string): Promise<DxfReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT, dxfPath]);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new DxfParseError('timeout', `parser excedeu ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    child.stdout!.on('data', d => (stdout += d.toString()));
    child.stderr!.on('data', d => (stderr += d.toString()));

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as DxfReport);
        } catch {
          reject(new DxfParseError('stdout_invalido', stdout.slice(0, 200)));
        }
        return;
      }
      try {
        const errObj = JSON.parse(stderr.trim().split('\n').pop() || '{}');
        const cod = (errObj.erro || 'desconhecido') as DxfErroCodigo;
        reject(new DxfParseError(cod, errObj.detalhe || stderr.slice(0, 200)));
      } catch {
        reject(new DxfParseError('desconhecido', stderr.slice(0, 200) || `exit ${code}`));
      }
    });
  });
}
