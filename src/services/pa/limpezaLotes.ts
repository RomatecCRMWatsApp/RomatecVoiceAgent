// v3.158.0 — Limpeza das poligonais dos lotes (DXF da subdivisão).
//
// Problemas comuns no DXF vindo do CAD: polilinha que fecha no canto errado
// (invade o lote vizinho), ponto repetido, "ida e volta" (espinho), vértice do
// vizinho quase coincidente (fresta/sobreposição de centímetros), polilinha
// aberta e traços soltos. Em vez de confiar em cada polilinha isolada, a região
// correta de cada lote é reconstruída a partir do traçado de TODOS os lotes:
//
//   1. limpa cada anel (pontos repetidos, espinhos);
//   2. junta vértices a menos de `tol` metros (snap);
//   3. quebra as linhas nos cruzamentos e nos vértices encostados (T);
//   4. remove os traços soltos (pontas sem continuidade);
//   5. monta as faces fechadas do traçado (poligonização);
//   6. dá cada face ao lote dono: rótulo LT-NN dentro da face → aquele lote;
//      face só dentro de um lote → aquele lote; face reivindicada por 2+ lotes
//      (sobreposição por fechamento errado) → o lote que fica com o formato
//      mais regular (compacidade 4πA/P²); fresta fina sem dono → vizinho com
//      maior divisa; parte fora do perímetro do PA → descartada;
//   7. refaz o contorno de cada lote a partir das suas faces.
// Funções puras, sem banco.

export interface Pt { x: number; y: number }
export interface LoteEntrada { lote: string; anel: Pt[] | null; rotulo?: Pt | null }
export interface RelatorioLote {
  lote: string; area_antes_m2: number | null; area_depois_m2: number; vertices_antes: number; vertices_depois: number; alterado: boolean; acoes: string[];
}
export interface ResultadoLimpeza { lotes: Array<{ lote: string; anel: Pt[] }>; relatorio: RelatorioLote[]; avisos: string[] }

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export function areaAssinada(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}
function dentro(p: Pt, poly: Pt[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}
const m2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Limpeza local de um anel: fecha, tira ponto repetido e espinho (ida e volta). */
export function limparAnel(pts: Pt[], tol: number): { anel: Pt[]; repetidos: number; espinhos: number } {
  let a = pts.slice();
  let repetidos = 0, espinhos = 0;
  while (a.length > 1 && dist(a[0], a[a.length - 1]) < tol) { a.pop(); }
  const semRep: Pt[] = [];
  for (const p of a) { if (semRep.length && dist(semRep[semRep.length - 1], p) < tol) { repetidos++; continue; } semRep.push(p); }
  while (semRep.length > 1 && dist(semRep[0], semRep[semRep.length - 1]) < tol) { semRep.pop(); repetidos++; }
  a = semRep;
  let mudou = true;
  while (mudou && a.length >= 3) {
    mudou = false;
    for (let i = 0; i < a.length && a.length >= 3; i++) {
      const p = a[(i - 1 + a.length) % a.length], c = a[i], n = a[(i + 1) % a.length];
      const ux = p.x - c.x, uy = p.y - c.y, vx = n.x - c.x, vy = n.y - c.y;
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-9 || lv < 1e-9) { a.splice(i, 1); repetidos++; mudou = true; break; }
      // espinho: a linha vai e volta pelo mesmo caminho (ângulo interno ~0°)
      if (Math.abs(ux * vy - uy * vx) / (lu * lv) < 0.0087 && ux * vx + uy * vy > 0) { a.splice(i, 1); espinhos++; mudou = true; break; }
    }
  }
  return { anel: a, repetidos, espinhos };
}

class Nos {
  pts: Pt[] = [];
  private grade = new Map<string, number[]>();
  constructor(private tol: number) {}
  private chave(x: number, y: number) { return `${Math.floor(x / this.tol)},${Math.floor(y / this.tol)}`; }
  achar(p: Pt): number | null {
    const cx = Math.floor(p.x / this.tol), cy = Math.floor(p.y / this.tol);
    let melhor: number | null = null, md = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of this.grade.get(`${cx + dx},${cy + dy}`) ?? []) { const d = dist(this.pts[id], p); if (d < this.tol && d < md) { md = d; melhor = id; } }
    }
    return melhor;
  }
  add(p: Pt): number {
    const ja = this.achar(p);
    if (ja != null) return ja;
    const id = this.pts.length;
    this.pts.push({ x: p.x, y: p.y });
    const k = this.chave(p.x, p.y);
    const l = this.grade.get(k); if (l) l.push(id); else this.grade.set(k, [id]);
    return id;
  }
}

export function limparPoligonais(entrada: LoteEntrada[], extras: Pt[][] = [], opts: { tol?: number; perimetro?: Pt[] | null } = {}): ResultadoLimpeza {
  const tol = opts.tol ?? 0.3;
  const avisos: string[] = [];
  const acoes = new Map<string, string[]>(entrada.map((l) => [l.lote, []]));
  const ac = (lote: string, t: string) => { const l = acoes.get(lote); if (l && !l.includes(t)) l.push(t); };

  // 1. anéis limpos
  const aneis = new Map<string, Pt[]>();
  for (const l of entrada) {
    if (!l.anel || l.anel.length < 3) { if (!l.rotulo) avisos.push(`LT-${l.lote}: sem polilinha fechada e sem rótulo — ignorado`); continue; }
    const r = limparAnel(l.anel, tol);
    if (r.repetidos) ac(l.lote, `${r.repetidos} ponto(s) repetido(s) removido(s)`);
    if (r.espinhos) ac(l.lote, `${r.espinhos} traço(s) de ida e volta removido(s)`);
    if (r.anel.length >= 3 && Math.abs(areaAssinada(r.anel)) > 1) aneis.set(l.lote, r.anel);
    else avisos.push(`LT-${l.lote}: polilinha degenerada (sem área) — ignorada`);
  }

  // 2. nós com snap e segmentos (guardando a origem de cada segmento de anel)
  const nos = new Nos(tol);
  type Seg = { a: number; b: number; lote: string | null; ordem: number };
  const segs: Seg[] = [];
  for (const [lote, anel] of aneis) {
    const ids = anel.map((p) => nos.add(p));
    ids.forEach((id, i) => segs.push({ a: id, b: ids[(i + 1) % ids.length], lote, ordem: i }));
  }
  const linhasExtras = [...extras, ...(opts.perimetro && opts.perimetro.length >= 3 ? [[...opts.perimetro, opts.perimetro[0]]] : [])];
  for (const ln of linhasExtras) {
    const ids = ln.map((p) => nos.add(p));
    for (let i = 1; i < ids.length; i++) segs.push({ a: ids[i - 1], b: ids[i], lote: null, ordem: i });
  }

  // 3. cruzamentos e T: pontos de quebra (parâmetro t ao longo do segmento)
  const quebras: Array<Array<{ t: number; id: number }>> = segs.map(() => []);
  const bb = segs.map((s) => { const p = nos.pts[s.a], q = nos.pts[s.b]; return [Math.min(p.x, q.x) - tol, Math.min(p.y, q.y) - tol, Math.max(p.x, q.x) + tol, Math.max(p.y, q.y) + tol]; });
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (bb[i][0] > bb[j][2] || bb[j][0] > bb[i][2] || bb[i][1] > bb[j][3] || bb[j][1] > bb[i][3]) continue;
      const s1 = segs[i], s2 = segs[j];
      if (s1.a === s2.a || s1.a === s2.b || s1.b === s2.a || s1.b === s2.b) continue;
      const p = nos.pts[s1.a], r = { x: nos.pts[s1.b].x - p.x, y: nos.pts[s1.b].y - p.y };
      const q = nos.pts[s2.a], s = { x: nos.pts[s2.b].x - q.x, y: nos.pts[s2.b].y - q.y };
      const den = r.x * s.y - r.y * s.x;
      if (Math.abs(den) < 1e-9) continue; // paralelos: tratados no passo do T
      const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den, u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) {
        const id = nos.add({ x: p.x + t * r.x, y: p.y + t * r.y });
        quebras[i].push({ t, id }); quebras[j].push({ t: u, id });
      }
    }
  }
  segs.forEach((s, i) => {
    const p = nos.pts[s.a], q = nos.pts[s.b];
    const dx = q.x - p.x, dy = q.y - p.y, L2 = dx * dx + dy * dy;
    if (L2 < 1e-12) return;
    nos.pts.forEach((n, id) => {
      if (id === s.a || id === s.b || n.x < bb[i][0] || n.x > bb[i][2] || n.y < bb[i][1] || n.y > bb[i][3]) return;
      const t = ((n.x - p.x) * dx + (n.y - p.y) * dy) / L2;
      if (t <= 1e-9 || t >= 1 - 1e-9) return;
      if (Math.hypot(n.x - (p.x + t * dx), n.y - (p.y + t * dy)) < tol) quebras[i].push({ t, id });
    });
  });
  // cadeia de nós de cada segmento (já quebrado)
  const cadeia = segs.map((s, i) => {
    const c = [s.a, ...quebras[i].sort((x, y) => x.t - y.t).map((x) => x.id), s.b];
    return c.filter((id, k) => k === 0 || id !== c[k - 1]);
  });

  // arestas únicas
  const ek = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const arestas = new Map<string, [number, number]>();
  for (const c of cadeia) for (let k = 1; k < c.length; k++) if (c[k] !== c[k - 1]) arestas.set(ek(c[k - 1], c[k]), [c[k - 1], c[k]]);

  // 4. traços soltos
  const viz = new Map<number, Set<number>>();
  const liga = (a: number, b: number) => { (viz.get(a) ?? viz.set(a, new Set()).get(a)!).add(b); (viz.get(b) ?? viz.set(b, new Set()).get(b)!).add(a); };
  for (const [a, b] of arestas.values()) liga(a, b);
  let soltos = 0;
  const fila = [...viz.keys()].filter((n) => viz.get(n)!.size === 1);
  while (fila.length) {
    const n = fila.pop()!; const vs = viz.get(n); if (!vs || vs.size !== 1) continue;
    const m = [...vs][0]; vs.delete(m); viz.get(m)!.delete(n); arestas.delete(ek(n, m)); soltos++;
    if (viz.get(m)!.size === 1) fila.push(m);
  }
  if (soltos) avisos.push(`${soltos} traço(s) solto(s) removido(s) do desenho`);

  // 5. faces (meia-aresta: próxima = vizinho anterior no sentido anti-horário)
  const ordenados = new Map<number, number[]>();
  for (const [n, vs] of viz) {
    const p = nos.pts[n];
    ordenados.set(n, [...vs].sort((a, b) => Math.atan2(nos.pts[a].y - p.y, nos.pts[a].x - p.x) - Math.atan2(nos.pts[b].y - p.y, nos.pts[b].x - p.x)));
  }
  const visit = new Set<string>();
  type Face = { nos: number[]; area: number; per: number; pto: Pt; cobre: string[]; dono: string | null; arestas: Map<string, number> };
  const faces: Face[] = [];
  for (const [u0, vs] of ordenados) for (const v0 of vs) {
    if (visit.has(`${u0}>${v0}`)) continue;
    const seq: number[] = [];
    let u = u0, v = v0, guarda = 0;
    while (!visit.has(`${u}>${v}`) && guarda++ < 100000) {
      visit.add(`${u}>${v}`); seq.push(u);
      const l = ordenados.get(v)!; const i = l.indexOf(u);
      const w = l[(i - 1 + l.length) % l.length];
      u = v; v = w;
    }
    const pts = seq.map((id) => nos.pts[id]);
    const area = areaAssinada(pts);
    if (area <= 1e-6) continue;
    let per = 0, maior = 0, pto: Pt = pts[0];
    const ars = new Map<string, number>();
    seq.forEach((id, k) => {
      const a = nos.pts[id], b = nos.pts[seq[(k + 1) % seq.length]], L = dist(a, b);
      per += L; ars.set(ek(id, seq[(k + 1) % seq.length]), L);
      if (L > maior) { maior = L; const e = Math.min(0.01, L / 100); pto = { x: (a.x + b.x) / 2 - ((b.y - a.y) / L) * e, y: (a.y + b.y) / 2 + ((b.x - a.x) / L) * e }; }
    });
    faces.push({ nos: seq, area, per, pto, cobre: [], dono: null, arestas: ars });
  }

  // anéis "quebrados" (com os nós intermediários) para o teste de cobertura exato
  const aneisNos = new Map<string, Pt[]>();
  for (const lote of aneis.keys()) {
    const ids: number[] = [];
    segs.forEach((s, i) => { if (s.lote === lote) ids.push(...cadeia[i].slice(0, -1)); });
    aneisNos.set(lote, ids.map((id) => nos.pts[id]));
  }
  const perim = opts.perimetro && opts.perimetro.length >= 3 ? opts.perimetro.map((p) => { const id = nos.achar(p); return id != null ? nos.pts[id] : p; }) : null;
  for (const f of faces) for (const [lote, anel] of aneisNos) if (dentro(f.pto, anel)) f.cobre.push(lote);

  // perímetro do PA: só recorta se os lotes estão de fato dentro dele (evita perímetro em outro sistema)
  let usarPerim = false;
  if (perim) {
    const cob = faces.filter((f) => f.cobre.length), dentroA = cob.filter((f) => dentro(f.pto, perim)).reduce((s, f) => s + f.area, 0);
    const tot = cob.reduce((s, f) => s + f.area, 0);
    usarPerim = tot > 0 && dentroA / tot > 0.9;
  }

  // 6. donos
  const rotulos = entrada.filter((l) => l.rotulo);
  for (const f of faces) {
    if (usarPerim && perim && !dentro(f.pto, perim)) { for (const l of f.cobre) ac(l, `parte fora do perímetro do PA removida (${fmt(f.area)} m²)`); continue; }
    const rs = rotulos.filter((l) => dentro(l.rotulo!, f.nos.map((id) => nos.pts[id])));
    if (rs.length === 1) f.dono = rs[0].lote;
    else if (rs.length > 1) { avisos.push(`Rótulos ${rs.map((r) => 'LT-' + r.lote).join(', ')} caem na mesma região — confira no CAD`); f.dono = f.cobre.find((c) => rs.some((r) => r.lote === c)) ?? rs[0].lote; }
    else if (f.cobre.length === 1) f.dono = f.cobre[0];
  }
  const doLote = new Map<string, { area: number; per: number; arestas: Map<string, number> }>();
  const somar = (lote: string, f: Face) => {
    const d = doLote.get(lote) ?? { area: 0, per: 0, arestas: new Map<string, number>() };
    let comum = 0;
    for (const [k, L] of f.arestas) { if (d.arestas.has(k)) { comum += L; d.arestas.delete(k); } else d.arestas.set(k, L); }
    d.area += f.area; d.per += f.per - 2 * comum; doLote.set(lote, d);
  };
  for (const f of faces) if (f.dono) somar(f.dono, f);
  const compac = (lote: string, f: Face) => {
    const d = doLote.get(lote); let comum = 0;
    if (d) for (const [k, L] of f.arestas) if (d.arestas.has(k)) comum += L;
    const A = (d?.area ?? 0) + f.area, P = (d?.per ?? 0) + f.per - 2 * comum;
    return (4 * Math.PI * A) / (P * P);
  };
  const disputadas = faces.filter((f) => !f.dono && f.cobre.length > 1 && !(usarPerim && perim && !dentro(f.pto, perim))).sort((a, b) => b.area - a.area);
  for (const f of disputadas) {
    const ganha = f.cobre.reduce((b, l) => (compac(l, f) > compac(b, f) ? l : b));
    f.dono = ganha; somar(ganha, f);
    for (const l of f.cobre) if (l !== ganha) {
      ac(l, `sobreposição com LT-${ganha} corrigida: ${fmt(f.area)} m² devolvidos ao vizinho`);
      ac(ganha, `área de ${fmt(f.area)} m² que LT-${l} invadia foi devolvida a este lote`);
    }
  }
  // frestas: face fina sem dono encostada em lote
  for (const f of faces) {
    if (f.dono || f.cobre.length || (usarPerim && perim && !dentro(f.pto, perim))) continue;
    const fina = f.area < 200 || (f.area < 5000 && f.area / f.per < 1);
    if (!fina) continue;
    let melhor: string | null = null, ml = 0;
    for (const [lote, d] of doLote) { let c = 0; for (const [k, L] of f.arestas) if (d.arestas.has(k)) c += L; if (c > ml) { ml = c; melhor = lote; } }
    if (melhor) { f.dono = melhor; somar(melhor, f); ac(melhor, `fresta de ${fmt(f.area)} m² entre lotes incorporada`); }
  }

  // 7. contorno de cada lote
  const originais = new Map<string, Set<number>>();
  for (const [lote, anel] of aneis) originais.set(lote, new Set(anel.map((p) => nos.achar(p)!).filter((x) => x != null)));
  const todosOriginais = new Set<number>(); for (const s of originais.values()) for (const x of s) todosOriginais.add(x);
  const lotes: Array<{ lote: string; anel: Pt[] }> = [];
  const relatorio: RelatorioLote[] = [];
  for (const l of entrada) {
    const fs = faces.filter((f) => f.dono === l.lote);
    const antes = aneis.get(l.lote) ?? null;
    if (!fs.length) { if (antes || l.rotulo) avisos.push(`LT-${l.lote}: nenhuma região fechada encontrada — confira no CAD`); continue; }
    const cont = new Map<string, number>();
    for (const f of fs) f.nos.forEach((id, k) => { const nx = f.nos[(k + 1) % f.nos.length]; const r = `${nx}>${id}`; if (cont.has(r)) cont.delete(r); else cont.set(`${id}>${nx}`, 1); });
    const saida = new Map<number, number[]>();
    for (const k of cont.keys()) { const [a, b] = k.split('>').map(Number); (saida.get(a) ?? saida.set(a, []).get(a)!).push(b); }
    const aneisL: number[][] = [];
    while (saida.size) {
      const ini = saida.keys().next().value as number;
      const r: number[] = []; let u = ini, g = 0;
      while (g++ < 100000) {
        r.push(u); const os = saida.get(u); if (!os || !os.length) break;
        const v = os.shift()!; if (!os.length) saida.delete(u);
        u = v; if (u === ini) break;
      }
      if (r.length >= 3) aneisL.push(r);
    }
    aneisL.sort((a, b) => areaAssinada(b.map((i) => nos.pts[i])) - areaAssinada(a.map((i) => nos.pts[i])));
    const ext = aneisL[0];
    if (aneisL.filter((r) => areaAssinada(r.map((i) => nos.pts[i])) > 1).length > 1) avisos.push(`LT-${l.lote}: ficou em mais de um pedaço — mantido o maior; confira no CAD`);
    if (aneisL.some((r) => areaAssinada(r.map((i) => nos.pts[i])) < -1)) avisos.push(`LT-${l.lote}: tem área interna de outro lote (furo) — confira no CAD`);
    // tira nó colinear que não é vértice original (cruzamento/encosto de vizinho)
    const minhas = originais.get(l.lote) ?? new Set<number>();
    let r = ext.slice(), mud = true;
    while (mud && r.length > 3) {
      mud = false;
      for (let i = 0; i < r.length; i++) {
        if (minhas.has(r[i]) || (!antes && todosOriginais.has(r[i]))) continue;
        const a = nos.pts[r[(i - 1 + r.length) % r.length]], c = nos.pts[r[i]], b = nos.pts[r[(i + 1) % r.length]];
        const L = dist(a, b); if (L < 1e-9) continue;
        if (Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / L < 0.02) { r.splice(i, 1); mud = true; break; }
      }
    }
    // mesmo sentido e mesmo vértice inicial do original
    let pts = r.map((i) => nos.pts[i]);
    if (antes) {
      if (Math.sign(areaAssinada(antes)) !== Math.sign(areaAssinada(pts))) pts = pts.reverse();
      const k = pts.reduce((b, p, i) => (dist(p, antes[0]) < dist(pts[b], antes[0]) ? i : b), 0);
      pts = [...pts.slice(k), ...pts.slice(0, k)];
    } else ac(l.lote, 'polilinha aberta/ausente: região fechada pelas linhas vizinhas');
    const aAntes = antes ? Math.abs(areaAssinada(antes)) : null, aDep = Math.abs(areaAssinada(pts));
    const orig = l.anel ?? [];
    const alterado = !antes || Math.abs((aAntes ?? 0) - aDep) > 0.5 || orig.length !== pts.length || pts.some((p, i) => !orig[i] || dist(p, orig[i]) > 1e-6);
    if (alterado && antes && Math.abs(aAntes! - aDep) > Math.max(50, aAntes! * 0.001) && !(acoes.get(l.lote) ?? []).length) ac(l.lote, `contorno refeito pelas divisas (área ${fmt(aAntes!)} → ${fmt(aDep)} m²)`);
    else if (alterado && !(acoes.get(l.lote) ?? []).length) ac(l.lote, 'vértices ajustados às divisas dos vizinhos');
    lotes.push({ lote: l.lote, anel: pts });
    relatorio.push({ lote: l.lote, area_antes_m2: aAntes == null ? null : m2(aAntes), area_depois_m2: m2(aDep), vertices_antes: orig.length, vertices_depois: pts.length, alterado, acoes: alterado ? acoes.get(l.lote) ?? [] : [] });
  }
  return { lotes, relatorio, avisos };
}
