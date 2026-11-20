// v3.193.0 — KML do lote para o associado navegar no celular, sem internet, com o Organic Maps:
// contorno do lote (linha fechada — o Organic Maps desenha linhas; polígono vai junto para o Google Earth)
// + um ponto em cada vértice com o código do marco. Vai junto com o dossiê no WhatsApp, com o passo a passo.
import { PaErro } from './erros';
import { pool, rows, exec, registrarEvento } from './paDb';
import { buscarProjeto } from './paRepo';
import { buscarSubdivisao, vinculosParcelas } from './paMapas';
import { pontosColetora, TOL_VERTICE_M } from './paColetora';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
const slug = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

export interface VerticeKml { nome: string; lat: number; lon: number }
/** KML do lote (pura — testável). */
export function kmlDoLote(o: { lote: string; titulo: string; descricao: string; vertices: VerticeKml[] }): string {
  const c = (v: VerticeKml) => `${v.lon.toFixed(8)},${v.lat.toFixed(8)},0`;
  const anel = [...o.vertices, o.vertices[0]].map(c).join(' ');
  const pts = o.vertices.map((v, i) => `<Placemark><name>${esc(v.nome)}</name><description>${esc(`Vértice ${i + 1} do LT-${o.lote}`)}</description><styleUrl>#marco</styleUrl><Point><coordinates>${c(v)}</coordinates></Point></Placemark>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(o.titulo)}</name><description>${esc(o.descricao)}</description>
<Style id="limite"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle><PolyStyle><color>3300ff00</color></PolyStyle></Style>
<Style id="marco"><IconStyle><color>ff00d7ff</color><scale>0.9</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>
<Placemark><name>${esc(`Limite do LT-${o.lote}`)}</name><description>${esc(o.descricao)}</description><styleUrl>#limite</styleUrl><LineString><tessellate>1</tessellate><coordinates>${anel}</coordinates></LineString></Placemark>
<Placemark><name>${esc(`Área do LT-${o.lote}`)}</name><styleUrl>#limite</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${anel}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
${pts}
</Document></kml>
`;
}

export async function kmlLote(projetoId: number, lote: string): Promise<{ kml: string; nome: string }> {
  const p = await buscarProjeto(projetoId);
  const sub = await buscarSubdivisao(projetoId);
  const pc = sub?.parcelas.find((x) => x.lote === lote);
  if (!pc) throw new PaErro('LOTE_NAO_ENCONTRADO', `LT-${lote} não está na subdivisão`, 404);
  const ben = (await vinculosParcelas(projetoId).catch(() => ({} as Awaited<ReturnType<typeof vinculosParcelas>>)))[lote] ?? null;
  // nome de cada vértice = código do marco no canto (até 3 m); senão o nome do vértice do desenho
  const d = await pontosColetora(projetoId).catch(() => null);
  const marcos = (d?.pontos ?? []).filter((x) => x.origem === 'LOTE');
  const vertices = pc.perimetro.vertices.map((v) => {
    let melhor: { nome: string; dist: number } | null = null;
    for (const m of marcos) { const dist = Math.hypot(m.E - v.E, m.N - v.N); if (dist <= TOL_VERTICE_M && (!melhor || dist < melhor.dist)) melhor = { nome: m.nome, dist }; }
    return { nome: melhor?.nome ?? v.nome, lat: v.lat, lon: v.lon };
  });
  const area = pc.perimetro.area_ha.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const titulo = `LT-${lote}${ben ? ` — ${ben.nome}` : ''}`;
  const descricao = `${p.nome} · ${p.municipio}/${p.uf} · ${area} ha · ${vertices.length} vértices${ben?.denominacao ? ` · ${ben.denominacao}` : ''} · SIRGAS 2000 · Romatec Consultoria Total`;
  return { kml: kmlDoLote({ lote, titulo, descricao, vertices }), nome: `LT-${lote}${ben ? '_' + slug(ben.nome) : ''}_${slug(p.nome.replace(/Projeto de Assentamento/i, 'PA')).replace(/^Pa_/, 'PA_')}.kml` };
}

export const LINK_ORGANIC_ANDROID = 'https://play.google.com/store/apps/details?id=app.organicmaps';
export const LINK_ORGANIC_IPHONE = 'https://apps.apple.com/app/id1567437057';
export function textoKml(nome: string, lote: string): string {
  const p0 = nome.trim().split(/\s+/)[0] ?? '';
  const primeiro = p0.charAt(0).toUpperCase() + p0.slice(1).toLowerCase();
  return [
    `🗺️ *${primeiro ? primeiro + ', o' : 'O'} mapa do seu lote LT-${lote} no celular — funciona sem internet*`,
    '',
    '1️⃣ Instale o aplicativo gratuito *Organic Maps*:',
    `• Android: ${LINK_ORGANIC_ANDROID}`,
    `• iPhone: ${LINK_ORGANIC_IPHONE}`,
    '2️⃣ Ainda com internet, abra o Organic Maps e baixe o mapa da região (Maranhão).',
    '3️⃣ Toque no arquivo *.kml* que vem a seguir e escolha *abrir com Organic Maps*.',
    '4️⃣ O *contorno do seu lote* e os *marcos* aparecem no mapa. Com o GPS ligado, você caminha pelo perímetro e confere as divisas, mesmo sem sinal.',
    '',
    '_Romatec Consultoria Total_',
  ].join('\n');
}

/** Envia o KML ao associado (texto + arquivo) e marca no dossiê. */
export async function enviarKmlLote(projetoId: number, lote: string, numero: string, nome: string, usuario: string | null) {
  const { kml, nome: arq } = await kmlLote(projetoId, lote);
  const wa = await import('./paWhatsapp');
  await wa.enviarDocumentoNumero(numero, Buffer.from(kml, 'utf8'), arq, textoKml(nome, lote));
  await exec(pool, 'UPDATE pa_dossies SET kml_enviado_em = NOW() WHERE projeto_id = ? AND lote = ?', [projetoId, lote]).catch(() => undefined);
  await registrarEvento(pool, { projeto_id: projetoId, associado_id: null, usuario, tipo: 'DOSSIE_KML_ENVIADO', dados: { lote, arquivo: arq } });
  return { lote, arquivo: arq };
}

/** Reenvio em lote: dossiês já enviados/entregues que ainda não receberam o KML (fila anti-bloqueio, em segundo plano). */
let reenvioRodando = false;
export async function reenviarKmlFinalizados(projetoId: number, usuario: string | null) {
  if (reenvioRodando) throw new PaErro('ENVIO_EM_ANDAMENTO', 'O envio dos KML já está em andamento — aguarde terminar', 409);
  const ds = await rows(pool, `SELECT d.lote, a.nome, a.whatsapp_numero FROM pa_dossies d JOIN pa_associados a ON a.id = d.associado_id
    WHERE d.projeto_id = ? AND d.status IN ('ENVIADO','ENTREGUE') AND d.kml_enviado_em IS NULL AND a.whatsapp_status = 'VALIDO' AND a.whatsapp_numero IS NOT NULL ORDER BY CAST(d.lote AS UNSIGNED)`, [projetoId]);
  if (!ds.length) return { fila: 0, lotes: [] as string[] };
  reenvioRodando = true;
  void (async () => {
    let ok = 0; const falhas: string[] = [];
    try {
      for (const d of ds) {
        try { await enviarKmlLote(projetoId, String(d.lote), String(d.whatsapp_numero), String(d.nome), usuario); ok++; }
        catch (e) { falhas.push(`LT-${d.lote}: ${(e as Error).message.slice(0, 120)}`); console.warn('[pa-kml]', d.lote, (e as Error).message); }
      }
      const { numeroCeo } = await import('./paDossie');
      const wa = await import('./paWhatsapp');
      await wa.enviarWhatsAppNumero(numeroCeo(), `🗺️ KML dos lotes finalizados: *${ok}* de ${ds.length} enviado(s).${falhas.length ? `\n⚠️ ${falhas.join(' | ').slice(0, 900)}` : ''}`).catch(() => undefined);
    } finally { reenvioRodando = false; }
  })();
  return { fila: ds.length, lotes: ds.map((d) => String(d.lote)) };
}
