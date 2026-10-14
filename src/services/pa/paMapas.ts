// v3.146.0 — Mapas técnicos do PA: memorial da vila e perímetro geral.
import { PaErro } from './erros';
import { pool, rows, one, exec, hojeBrasil, registrarEvento } from './paDb';
import { buscarProjeto, type Projeto } from './paRepo';
import { desenhoDoProjeto } from './layoutDesenho';
import { marcaArquivos } from './marcaProjeto';
import { memorialVila, type MemorialLote } from './memorialVila';
import { perimetroDeArquivo, type Perimetro } from './perimetro';
import { htmlMapaVila, htmlMapaGeral, pdfDeHtml, type DadosMapaPA } from './mapasPdf';
import type { LoteDoMapa } from './mapaSvg';

async function lotesDoMapa(projetoId: number): Promise<LoteDoMapa[]> {
  const ls = await rows(pool, 'SELECT numero, tipo, croqui_xy FROM pa_lotes WHERE projeto_id = ?', [projetoId]);
  return ls.filter((l) => Array.isArray(l.croqui_xy)).map((l) => ({ numero: String(l.numero), xy: l.croqui_xy as number[][], institucional: l.tipo === 'INSTITUCIONAL' }));
}

function dadosCabecalho(p: Projeto): DadosMapaPA {
  const lj = (p.layout_json ?? {}) as { responsavel_tecnico?: { nome?: string; cft?: string; incra?: string } };
  const rt = lj.responsavel_tecnico ?? {};
  const h = hojeBrasil();
  return {
    projeto: { nome: p.nome, municipio: p.municipio, uf: p.uf, associacao: p.associacao_nome },
    rt: {
      nome: rt.nome || p.rt_nome || 'Responsável técnico',
      registro: ['Técnico em Agrimensura', rt.cft ? `CFT ${rt.cft}` : '', rt.incra ? `INCRA ${rt.incra}` : ''].filter(Boolean).join(' · ') || (p.rt_registro ?? ''),
    },
    marca: marcaArquivos(p.codigo),
    data: `${h.slice(8, 10)}/${h.slice(5, 7)}/${h.slice(0, 4)}`,
  };
}

export async function memorialDoProjeto(projetoId: number): Promise<MemorialLote[]> {
  const p = await buscarProjeto(projetoId);
  return memorialVila(await lotesDoMapa(projetoId), desenhoDoProjeto(p.codigo, p.layout_json));
}

export async function pdfMapaVila(projetoId: number): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const lotes = await lotesDoMapa(projetoId);
  if (!lotes.length) throw new PaErro('SEM_CROQUI', 'Projeto sem croqui dos lotes', 409);
  const desenho = desenhoDoProjeto(p.codigo, p.layout_json);
  const html = htmlMapaVila(dadosCabecalho(p), lotes, desenho, memorialVila(lotes, desenho));
  return { pdf: await pdfDeHtml(html), nome: `MAPA-VILA-MEMORIAL-${p.codigo}.pdf` };
}

export async function buscarPerimetro(projetoId: number): Promise<Perimetro | null> {
  const r = await one(pool, 'SELECT perimetro_json FROM pa_projetos WHERE id = ?', [projetoId]);
  if (!r) throw new PaErro('PROJETO_NAO_ENCONTRADO', 'Projeto não encontrado', 404);
  return (r.perimetro_json as Perimetro | null) ?? null;
}

export async function salvarPerimetro(
  projetoId: number, arquivo: { nome: string; conteudo: string }, opts: { fuso?: number | null; hemisferio?: 'S' | 'N' }, usuario: string | null,
): Promise<Perimetro> {
  await buscarProjeto(projetoId);
  const p = perimetroDeArquivo(arquivo.nome, arquivo.conteudo, opts);
  p.atualizado_em = new Date().toISOString();
  await exec(pool, 'UPDATE pa_projetos SET perimetro_json = ? WHERE id = ?', [JSON.stringify(p), projetoId]);
  await registrarEvento(pool, {
    projeto_id: projetoId, usuario, tipo: 'PERIMETRO_ATUALIZADO',
    dados: { arquivo: arquivo.nome, vertices: p.vertices.length, area_ha: p.area_ha, perimetro_m: p.perimetro_m, fuso: p.fuso, sistema: p.origem.sistema_entrada },
  });
  return p;
}

export async function removerPerimetro(projetoId: number, usuario: string | null): Promise<void> {
  await exec(pool, 'UPDATE pa_projetos SET perimetro_json = NULL WHERE id = ?', [projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'PERIMETRO_REMOVIDO' });
}

export async function pdfMapaGeral(projetoId: number): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const per = await buscarPerimetro(projetoId);
  if (!per) throw new PaErro('SEM_PERIMETRO', 'Envie o arquivo do perímetro (TXT/CSV/DXF) antes de gerar o mapa geral', 409);
  return { pdf: await pdfDeHtml(htmlMapaGeral(dadosCabecalho(p), per)), nome: `MAPA-GERAL-MEMORIAL-${p.codigo}.pdf` };
}
