// v3.146.0 — Mapas técnicos do PA: memorial da vila e perímetro geral.
import { PaErro } from './erros';
import { pool, rows, one, exec, hojeBrasil, registrarEvento } from './paDb';
import { buscarProjeto, type Projeto } from './paRepo';
import { desenhoDoProjeto } from './layoutDesenho';
import { marcaArquivos } from './marcaProjeto';
import { memorialVila, type MemorialLote } from './memorialVila';
import { perimetroDeArquivo, utmParaLonLat, type Perimetro } from './perimetro';
import { htmlMapaVila, htmlMapaGeral, htmlSubdivisao, svgSubdivisao, pdfDeHtml, type DadosMapaPA, type BeneficiarioParcela } from './mapasPdf';
import { subdivisaoDeDxf, vilaDeDxf, textoMemorialParcela, limparSubdivisao, dxfSubdivisao, VERSAO_LIMPEZA, type Subdivisao, type VilaPerimetro } from './parcelas';
import { plantaSigef, memorialSigef, documentoSigef, pdfSigef } from './sigefPdf';
import { svgPerimetro } from './mapasPdf';
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
      // v3.154.0: CFT e código de credenciado separados (modelo SIGEF); cai no texto de rt_registro ("CFT 012… · INCRA FQNS").
      cft: rt.cft || (p.rt_registro ?? '').match(/CFT\s*([\w.-]+)/i)?.[1] || null,
      incra: rt.incra || (p.rt_registro ?? '').match(/INCRA\s*([A-Z0-9]+)/i)?.[1] || null,
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

export async function pdfMapaGeral(projetoId: number, modelo: 'tradicional' | 'sigef' = 'tradicional'): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const per = await buscarPerimetro(projetoId);
  if (!per) throw new PaErro('SEM_PERIMETRO', 'Envie o arquivo do perímetro (TXT/CSV/DXF) antes de gerar o mapa geral', 409);
  if (modelo === 'sigef') {
    const d = dadosCabecalho(p);
    const peca = { denominacao: p.nome, titular: null, natureza: 'Projeto de Assentamento', perimetro: per, confrontantes: null, mapaSvg: svgPerimetro(per, 'width:100%;height:150mm;display:block') };
    return { pdf: await pdfSigef(documentoSigef(p.nome, [plantaSigef(d, peca), memorialSigef(d, peca)])), nome: `PERIMETRO-PLANTA-MEMORIAL-SIGEF-${p.codigo}.pdf` };
  }
  return { pdf: await pdfDeHtml(htmlMapaGeral(dadosCabecalho(p), per)), nome: `MAPA-GERAL-MEMORIAL-${p.codigo}.pdf` };
}

// ─── v3.151.0: subdivisão em lotes (DXF da divisão/marcos) ─────────────────
export async function buscarSubdivisao(projetoId: number): Promise<Subdivisao | null> {
  const r = await one(pool, 'SELECT subdivisao_json FROM pa_projetos WHERE id = ?', [projetoId]);
  if (!r) throw new PaErro('PROJETO_NAO_ENCONTRADO', 'Projeto não encontrado', 404);
  return (r.subdivisao_json as Subdivisao | null) ?? null;
}

export async function salvarSubdivisao(
  projetoId: number, arquivo: { nome: string; conteudo: string }, opts: { fuso?: number | null; hemisferio?: 'S' | 'N' }, usuario: string | null,
): Promise<Subdivisao> {
  await buscarProjeto(projetoId);
  if (!/\.dxf$/i.test(arquivo.nome) && !/^\s*0\s*\r?\n\s*SECTION/i.test(arquivo.conteudo)) throw new PaErro('SUBDIVISAO_DXF', 'Envie o DXF da divisão dos lotes', 400);
  const per = await buscarPerimetro(projetoId);
  const sub = subdivisaoDeDxf(arquivo.conteudo, { ...opts, arquivo: arquivo.nome, perimetro: perimetroUtm(per, opts.fuso ?? 23) });
  sub.atualizado_em = new Date().toISOString();
  await exec(pool, 'UPDATE pa_projetos SET subdivisao_json = ? WHERE id = ?', [JSON.stringify(sub), projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'SUBDIVISAO_ATUALIZADA', dados: { arquivo: arquivo.nome, lotes: sub.parcelas.length, marcos: sub.marcos, corrigidos: sub.limpeza?.lotes_corrigidos ?? 0 } });
  return sub;
}

// ─── v3.158.0: limpeza das poligonais (fecha no canto certo, sem traço solto) ─
function perimetroUtm(per: Perimetro | null, fuso: number) {
  return per && per.fuso === fuso ? per.vertices.map((v) => ({ x: v.E, y: v.N })) : null;
}

/** Limpa as poligonais da subdivisão já salva e grava o resultado (backup da geometria original fica no JSON). */
export async function limparSubdivisaoSalva(projetoId: number, usuario: string | null): Promise<Subdivisao> {
  const sub = await buscarSubdivisao(projetoId);
  if (!sub) throw new PaErro('SEM_SUBDIVISAO', 'Envie o DXF da divisão dos lotes primeiro', 409);
  const per = await buscarPerimetro(projetoId);
  const limpa = limparSubdivisao(sub, perimetroUtm(per, sub.fuso));
  limpa.atualizado_em = new Date().toISOString();
  await exec(pool, 'UPDATE pa_projetos SET subdivisao_json = ? WHERE id = ?', [JSON.stringify(limpa), projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'SUBDIVISAO_LIMPA', dados: { lotes: limpa.parcelas.length, corrigidos: limpa.limpeza?.lotes_corrigidos ?? 0, avisos: limpa.limpeza?.avisos ?? [] } });
  return limpa;
}

/** DXF limpo da subdivisão (R12), com o perímetro do PA se estiver no mesmo fuso. */
export async function dxfSubdivisaoProjeto(projetoId: number): Promise<{ dxf: string; nome: string }> {
  const sub = await buscarSubdivisao(projetoId);
  if (!sub) throw new PaErro('SEM_SUBDIVISAO', 'Nenhuma subdivisão enviada', 404);
  const [p, per] = await Promise.all([buscarProjeto(projetoId), buscarPerimetro(projetoId)]);
  const base = (sub.arquivo || `SUBDIVISAO-${p.codigo}`).replace(/\.dxf$/i, '').replace(/-LIMPO$/i, '');
  return { dxf: dxfSubdivisao(sub, perimetroUtm(per, sub.fuso)), nome: `${base}-LIMPO.dxf` };
}

/** Boot: limpa as subdivisões salvas que ainda não passaram pela limpeza desta versão. */
export async function limparSubdivisoesPendentes(): Promise<void> {
  const ids = await rows(pool, 'SELECT id FROM pa_projetos WHERE subdivisao_json IS NOT NULL');
  for (const r of ids) {
    const id = Number(r.id);
    try {
      const sub = await buscarSubdivisao(id);
      if (!sub || (sub.limpeza && sub.limpeza.versao >= VERSAO_LIMPEZA)) continue;
      const l = await limparSubdivisaoSalva(id, 'sistema');
      console.log(`[pa-limpeza] projeto ${id}: ${l.limpeza?.lotes_corrigidos ?? 0} lote(s) corrigido(s)${l.limpeza?.avisos.length ? ' · ' + l.limpeza.avisos.join(' | ') : ''}`);
    } catch (e) { console.error(`[pa-limpeza] projeto ${id}: falhou`, e); }
  }
}

export async function removerSubdivisao(projetoId: number, usuario: string | null): Promise<void> {
  await exec(pool, 'UPDATE pa_projetos SET subdivisao_json = NULL WHERE id = ?', [projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'SUBDIVISAO_REMOVIDA' });
}

async function exigirSubdivisao(projetoId: number): Promise<Subdivisao> {
  const sub = await buscarSubdivisao(projetoId);
  if (!sub) throw new PaErro('SEM_SUBDIVISAO', 'Envie o DXF da divisão dos lotes primeiro', 409);
  return sub;
}

export async function svgSubdivisaoProjeto(projetoId: number, lote: string | null): Promise<string> {
  const sub = await exigirSubdivisao(projetoId);
  if (lote && !sub.parcelas.some((p) => p.lote === lote)) throw new PaErro('LOTE_NAO_ENCONTRADO', `Lote ${lote} não está na subdivisão`, 404);
  return svgSubdivisao(sub, { destaque: lote, perimetro: lote ? null : await buscarPerimetro(projetoId) });
}

/** Vínculos lote rural (LT-NN) → associado. */
export async function vinculosParcelas(projetoId: number): Promise<Record<string, BeneficiarioParcela & { associado_id: number; lote_vila: string }>> {
  const r = await rows(pool, `SELECT a.id, a.nome, a.cpf, a.parcela, lt.numero AS lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1 AND a.parcela IS NOT NULL`, [projetoId]);
  return Object.fromEntries(r.map((x) => [String(x.parcela), { associado_id: Number(x.id), nome: String(x.nome), cpf: String(x.cpf), lote_vila: String(x.lote_vila) }]));
}

/** Liga (ou desliga, com associadoId null) um lote da subdivisão a um associado. Um associado por lote e um lote por associado. */
export async function vincularParcela(projetoId: number, lote: string, associadoId: number | null, usuario: string | null) {
  const sub = await exigirSubdivisao(projetoId);
  if (!sub.parcelas.some((p) => p.lote === lote)) throw new PaErro('LOTE_NAO_ENCONTRADO', `Lote ${lote} não está na subdivisão`, 404);
  if (associadoId != null) {
    const a = await one(pool, 'SELECT id FROM pa_associados WHERE id = ? AND projeto_id = ? AND ativo = 1', [associadoId, projetoId]);
    if (!a) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado neste projeto', 404);
  }
  await exec(pool, 'UPDATE pa_associados SET parcela = NULL WHERE projeto_id = ? AND parcela = ?', [projetoId, lote]);
  if (associadoId != null) await exec(pool, 'UPDATE pa_associados SET parcela = ? WHERE id = ?', [lote, associadoId]);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: associadoId, usuario, tipo: 'PARCELA_VINCULADA', dados: { lote, associado_id: associadoId } });
  return vinculosParcelas(projetoId);
}

export async function memorialParcela(projetoId: number, lote: string) {
  const p = await buscarProjeto(projetoId);
  const sub = await exigirSubdivisao(projetoId);
  const pc = sub.parcelas.find((x) => x.lote === lote);
  if (!pc) throw new PaErro('LOTE_NAO_ENCONTRADO', `Lote ${lote} não está na subdivisão`, 404);
  const ben = (await vinculosParcelas(projetoId))[lote] ?? null;
  return { parcela: pc, beneficiario: ben, memorial: textoMemorialParcela(pc, p.nome, `${p.municipio}/${p.uf}`, ben ? `${ben.nome}, CPF ${ben.cpf}` : null) };
}

/** PDF com o mapa geral da subdivisão (geral) e/ou mapa + memorial de cada lote pedido (null = todos). */
export async function pdfSubdivisao(projetoId: number, lotes: string[] | null, geral: boolean, modelo: 'tradicional' | 'sigef' = 'tradicional'): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const sub = await exigirSubdivisao(projetoId);
  const lista = lotes ?? sub.parcelas.map((x) => x.lote);
  if (modelo === 'sigef') {
    // v3.154.0: planta + memorial no modelo SIGEF para cada lote pedido.
    const d = dadosCabecalho(p);
    const ben = await vinculosParcelas(projetoId);
    const secoes = lista.flatMap((l) => {
      const pc = sub.parcelas.find((x) => x.lote === l);
      if (!pc) return [];
      const peca = { denominacao: `Lote ${pc.lote} — ${p.nome}`, titular: ben[pc.lote] ? { nome: ben[pc.lote].nome, cpf: ben[pc.lote].cpf } : null, natureza: 'Projeto de Assentamento', perimetro: pc.perimetro, confrontantes: pc.lados.map((x) => x.confrontante), mapaSvg: svgSubdivisao(sub, { destaque: pc.lote, css: 'width:100%;height:150mm;display:block' }) };
      return [plantaSigef(d, peca), memorialSigef(d, peca)];
    });
    if (!secoes.length) throw new PaErro('LOTE_NAO_ENCONTRADO', 'Nenhum dos lotes pedidos está na subdivisão', 404);
    const nome = lista.length === 1 ? `LOTE-${lista[0]}-PLANTA-MEMORIAL-SIGEF-${p.codigo}.pdf` : `LOTES-PLANTAS-MEMORIAIS-SIGEF-${p.codigo}.pdf`;
    return { pdf: await pdfSigef(documentoSigef(`Lotes — ${p.nome}`, secoes)), nome };
  }
  const html = htmlSubdivisao(dadosCabecalho(p), sub, { lotes: lista, geral, perimetro: await buscarPerimetro(projetoId), beneficiarios: await vinculosParcelas(projetoId) });
  const nome = !geral && lista.length === 1 ? `LOTE-${lista[0]}-MAPA-MEMORIAL-${p.codigo}.pdf` : geral && !lotes?.length ? `SUBDIVISAO-LOTES-${p.codigo}.pdf` : `LOTES-MAPAS-MEMORIAIS-${p.codigo}.pdf`;
  return { pdf: await pdfDeHtml(html), nome };
}

// ─── v3.154.0: perímetro real da vila (AC-01) ──────────────────────────────
export async function buscarVila(projetoId: number): Promise<VilaPerimetro | null> {
  const r = await one(pool, 'SELECT vila_json FROM pa_projetos WHERE id = ?', [projetoId]);
  if (!r) throw new PaErro('PROJETO_NAO_ENCONTRADO', 'Projeto não encontrado', 404);
  return (r.vila_json as VilaPerimetro | null) ?? null;
}

export async function salvarVila(projetoId: number, arquivo: { nome: string; conteudo: string }, opts: { fuso?: number | null; hemisferio?: 'S' | 'N' }, usuario: string | null): Promise<VilaPerimetro> {
  await buscarProjeto(projetoId);
  const v = vilaDeDxf(arquivo.conteudo, { ...opts, arquivo: arquivo.nome });
  v.atualizado_em = new Date().toISOString();
  await exec(pool, 'UPDATE pa_projetos SET vila_json = ? WHERE id = ?', [JSON.stringify(v), projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'VILA_PERIMETRO_ATUALIZADO', dados: { arquivo: arquivo.nome, area_ha: v.total.area_ha, nucleo_ha: v.nucleo?.area_ha ?? null } });
  return v;
}

export async function removerVila(projetoId: number, usuario: string | null): Promise<void> {
  await exec(pool, 'UPDATE pa_projetos SET vila_json = NULL WHERE id = ?', [projetoId]);
  await registrarEvento(pool, { projeto_id: projetoId, usuario, tipo: 'VILA_PERIMETRO_REMOVIDO' });
}

/** Planta + memorial da vila (área total ou núcleo), modelo tradicional ou SIGEF. */
export async function pdfVila(projetoId: number, parte: 'total' | 'nucleo', modelo: 'tradicional' | 'sigef'): Promise<{ pdf: Buffer; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const v = await buscarVila(projetoId);
  if (!v) throw new PaErro('SEM_VILA', 'Envie o DXF do perímetro da vila primeiro', 409);
  const per = parte === 'nucleo' ? v.nucleo : v.total;
  if (!per) throw new PaErro('SEM_NUCLEO', 'O DXF da vila não tem a poligonal do núcleo', 404);
  const rotulo = parte === 'nucleo' ? 'Núcleo da vila (AC-01)' : 'Área da vila (AC-01)';
  const d = dadosCabecalho(p);
  const imovel = `${rotulo} — ${p.nome}`;
  const nome = `VILA-${parte === 'nucleo' ? 'NUCLEO' : 'AREA-TOTAL'}-${modelo === 'sigef' ? 'PLANTA-MEMORIAL-SIGEF' : 'MAPA-MEMORIAL'}-${p.codigo}.pdf`;
  if (modelo === 'sigef') {
    const peca = { denominacao: imovel, titular: null, natureza: 'Área comunitária — vila do Projeto de Assentamento', perimetro: per, confrontantes: null, mapaSvg: svgPerimetro(per, 'width:100%;height:150mm;display:block') };
    return { pdf: await pdfSigef(documentoSigef(imovel, [plantaSigef(d, peca), memorialSigef(d, peca)])), nome };
  }
  const t = parte === 'nucleo' ? 'NÚCLEO DA VILA' : 'ÁREA DA VILA';
  return { pdf: await pdfDeHtml(htmlMapaGeral(d, per, { imovel, mapa: `MAPA — ${t} (AC-01)`, memorial: `MEMORIAL DESCRITIVO — ${t} (AC-01)` })), nome };
}

// ─── v3.155.0: dados do mapa interativo dos lotes (GeoJSON em lon/lat) ─────
/** Lotes (com beneficiário vinculado), camadas do desenho, perímetro do PA e da vila, prontos para o Leaflet. */
export async function geojsonSubdivisao(projetoId: number) {
  const sub = await exigirSubdivisao(projetoId);
  const [per, vila, vinc] = await Promise.all([buscarPerimetro(projetoId), buscarVila(projetoId), vinculosParcelas(projetoId)]);
  const conv = utmParaLonLat(sub.fuso, sub.hemisferio);
  const fechar = (c: number[][]) => (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1]) ? [...c, c[0]] : c);
  const aids = Object.values(vinc).map((v) => v.associado_id);
  const extras = aids.length ? await rows(pool, `SELECT a.id, a.numero, a.telefone, a.whatsapp_status, lt.numero AS lote_vila FROM pa_associados a JOIN pa_lotes lt ON lt.id = a.lote_id WHERE a.id IN (${aids.map(() => '?').join(',')})`, aids) : [];
  const extraPor = new Map(extras.map((e) => [Number(e.id), e]));
  const features: Array<Record<string, unknown>> = sub.parcelas.map((pc) => {
    const b = vinc[pc.lote] ?? null;
    const ex = b ? extraPor.get(b.associado_id) : null;
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [fechar(pc.perimetro.vertices.map((v) => [Math.round(v.lon * 1e7) / 1e7, Math.round(v.lat * 1e7) / 1e7]))] },
      properties: {
        tipo: 'LOTE', lote: pc.lote, area_ha: pc.perimetro.area_ha, area_util_ha: pc.area_util_ha, perimetro_m: pc.perimetro.perimetro_m,
        vertices: pc.perimetro.vertices.length, confrontantes: [...new Set(pc.lados.map((l) => l.confrontante))],
        beneficiario: b ? { associado_id: b.associado_id, nome: b.nome, cpf: b.cpf, numero: ex?.numero ?? null, telefone: ex?.telefone ?? null, whatsapp_status: ex?.whatsapp_status ?? null, lote_vila: b.lote_vila } : null,
      },
    };
  });
  for (const c of sub.camadas) {
    const coords = c.pts.map(([e, n]) => conv(e, n));
    features.push({ type: 'Feature', geometry: c.fechada ? { type: 'Polygon', coordinates: [fechar(coords)] } : { type: 'LineString', coordinates: coords }, properties: { tipo: c.tipo, rotulo: c.rotulo, camada: c.camada } });
  }
  const anel = (p: Perimetro, tipo: string, rotulo: string) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [fechar(p.vertices.map((v) => [v.lon, v.lat]))] }, properties: { tipo, rotulo, area_ha: p.area_ha } });
  if (per) features.push(anel(per, 'PERIMETRO', 'Perímetro do PA'));
  if (vila) features.push(anel(vila.total, 'VILA', 'Área da vila (AC-01)'));
  return { type: 'FeatureCollection', features, lotes: sub.parcelas.length, vinculados: Object.keys(vinc).length };
}
