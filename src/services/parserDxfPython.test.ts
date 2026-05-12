import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as cp from 'node:child_process';
import { parseLoteamentoDxf } from './parserDxfPython';

vi.mock('node:child_process');

function fakeSpawn(stdoutData: string, stderrData = '', code = 0) {
  const ee = new EventEmitter() as cp.ChildProcess;
  (ee as unknown as { stdout: Readable }).stdout = Readable.from([stdoutData]);
  (ee as unknown as { stderr: Readable }).stderr = Readable.from([stderrData]);
  (ee as unknown as { kill: () => void }).kill = () => undefined;
  setImmediate(() => ee.emit('close', code));
  return ee;
}

describe('parseLoteamentoDxf', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna parsed JSON quando Python sai com 0', async () => {
    const payload = { formato: 'DXF', unidade: 'metros', quadras: [], lotes: [], avisos: [] };
    vi.mocked(cp.spawn).mockReturnValue(fakeSpawn(JSON.stringify(payload)));
    const r = await parseLoteamentoDxf('/tmp/foo.dxf');
    expect(r.formato).toBe('DXF');
    expect(r.quadras).toEqual([]);
  });

  it('lanca DxfParseError com codigo dependencia_ausente quando exit=2', async () => {
    const err = JSON.stringify({ erro: 'dependencia_ausente', detalhe: 'No module named ezdxf' });
    vi.mocked(cp.spawn).mockReturnValue(fakeSpawn('', err, 2));
    await expect(parseLoteamentoDxf('/tmp/foo.dxf')).rejects.toMatchObject({
      name: 'DxfParseError',
      codigo: 'dependencia_ausente',
    });
  });

  it('lanca DxfParseError generico quando stdout nao eh JSON', async () => {
    vi.mocked(cp.spawn).mockReturnValue(fakeSpawn('lixo nao-json'));
    await expect(parseLoteamentoDxf('/tmp/foo.dxf')).rejects.toMatchObject({
      name: 'DxfParseError',
      codigo: 'stdout_invalido',
    });
  });
});
