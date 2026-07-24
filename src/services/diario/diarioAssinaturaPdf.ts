// src/services/diario/diarioAssinaturaPdf.ts
// v3.128.0 — PDF do relatório de visita técnica ASSINADO. Tema dark green/gold
// Romatec, renderizado como HTML e convertido pelo motor htmlToPdf (puppeteer)
// — mesmo pipeline do Relatório de Entrega e do VTO Checklist.
//
// Afixa a rubrica desenhada, a qualificação do signatário, o carimbo de data/
// hora + GPS, e um selo de integridade com o SHA-256 e o QR que aponta para a
// página pública de verificação (/v/diario/:hash).
import QRCode from 'qrcode';
import { htmlToPdf } from '../../pdf/htmlToPdf';
import { formatarDocumento, type Assinatura, type SnapshotDiario } from './diarioAssinaturaRepo';

const GREEN = '#0C3320';
const GREEN2 = '#14472B';
const GOLD = '#C9A84C';
const GOLD_SOFT = '#E3D19A';
const PAPER = '#FBFAF6';
const INK = '#1C1C18';
const MUTED = '#6A6656';
const LINE = '#D8D3C4';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string
  ));
}
function fmtData(d?: string | null): string {
  if (!d) return '—';
  const p = String(d).slice(0, 10).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : esc(d);
}
function fmtDataHora(iso?: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return esc(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  // O carimbo é UTC (canonicalizarInstante grava wall-clock UTC).
  return `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()} ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())} (UTC)`;
}
function papelLabel(p: string): string {
  return p === 'responsavel' ? 'Responsável pela obra' : 'Proprietário';
}

function blocoCampo(titulo: string, valor?: string | null): string {
  if (!valor || !valor.trim()) return '';
  return `<div class="campo"><div class="ct">${esc(titulo)}</div><div class="cv">${esc(valor).replace(/\n/g, '<br>')}</div></div>`;
}

export interface DadosPdfAssinatura {
  assinatura: Assinatura;
  snapshot: SnapshotDiario;
  linkPublico: string;
  integro: boolean;
}

export async function gerarAssinaturaPdf(dados: DadosPdfAssinatura): Promise<Buffer> {
  const { assinatura: a, snapshot: s, linkPublico, integro } = dados;

  // QR aponta pra página pública de verificação. margin 1 pra não colar na borda.
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(linkPublico, { margin: 1, width: 130 });
  } catch { qrDataUrl = ''; }

  const rubricaSrc = a.assinatura_b64
    ? (a.assinatura_b64.startsWith('data:') ? a.assinatura_b64 : `data:image/png;base64,${a.assinatura_b64}`)
    : '';

  const gps = (a.latitude != null && a.longitude != null)
    ? `${a.latitude.toFixed(6)}, ${a.longitude.toFixed(6)}`
    : null;

  const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', Helvetica, Arial, sans-serif; margin: 0; color: ${INK}; background: ${PAPER}; }
  .hero { background: linear-gradient(135deg, ${GREEN}, ${GREEN2}); color: #fff; padding: 28px 40px; }
  .kick { color: ${GOLD_SOFT}; letter-spacing: 2px; text-transform: uppercase; font-size: 10px; margin: 0 0 6px; }
  .hero h1 { margin: 0; font-size: 22px; }
  .hero .num { color: ${GOLD}; font-weight: 700; font-size: 13px; margin-top: 4px; }
  .wrap { padding: 24px 40px 40px; }
  .card { background: #fff; border: 1px solid ${LINE}; border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
  h2 { color: ${GREEN}; font-size: 14px; margin: 0 0 12px; border-bottom: 2px solid ${GOLD}; padding-bottom: 6px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; }
  .meta-grid .k { color: ${MUTED}; }
  .meta-grid .v { font-weight: 600; color: ${GREEN}; }
  .campo { margin-bottom: 10px; }
  .campo .ct { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: ${MUTED}; font-weight: 700; }
  .campo .cv { font-size: 13px; line-height: 1.4; margin-top: 2px; white-space: pre-wrap; }
  .assino { display: flex; gap: 20px; align-items: flex-end; }
  .assino .rub { flex: 0 0 300px; text-align: center; }
  .assino .rub img { max-width: 300px; max-height: 130px; border-bottom: 2px solid ${INK}; }
  .assino .rub .l { font-size: 11px; color: ${MUTED}; margin-top: 4px; }
  .assino .qual { flex: 1; font-size: 12px; }
  .assino .qual b { color: ${GREEN}; }
  .selo { display: flex; gap: 16px; align-items: center; background: ${GREEN}; color: #fff; border-radius: 10px; padding: 14px 18px; }
  .selo img { width: 96px; height: 96px; background: #fff; border-radius: 6px; padding: 4px; }
  .selo .st { flex: 1; }
  .selo .st .t { color: ${GOLD_SOFT}; text-transform: uppercase; letter-spacing: 1px; font-size: 9px; }
  .selo .st .hash { font-family: 'Courier New', monospace; font-size: 10px; word-break: break-all; color: #fff; margin-top: 4px; }
  .selo .st .lk { color: ${GOLD}; font-size: 10px; margin-top: 6px; word-break: break-all; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 20px; }
  .badge.ok { background: rgba(16,185,129,.18); color: #7ff0c0; border: 1px solid #10b981; }
  .badge.no { background: rgba(239,68,68,.18); color: #ffb4b4; border: 1px solid #ef4444; }
  .foot { color: ${MUTED}; font-size: 10px; text-align: center; padding: 8px 40px 24px; }
</style></head>
<body>
  <div class="hero">
    <p class="kick">Romatec Consultoria Total — Açailândia/MA</p>
    <h1>📔 Relatório de Visita Técnica — Assinado</h1>
    <div class="num">${esc(s.obra_nome || (s.obra_id ? 'Obra #' + s.obra_id : 'Diário de Obra'))} · ${fmtData(s.data_visita)} ${esc((s.hora_visita || '').slice(0, 5))}</div>
  </div>
  <div class="wrap">
    <div class="card">
      <h2>Visita técnica</h2>
      <div class="meta-grid">
        <div class="k">Obra</div><div class="v">${esc(s.obra_nome || (s.obra_id ? '#' + s.obra_id : '—'))}</div>
        <div class="k">Data / Hora</div><div class="v">${fmtData(s.data_visita)} ${esc((s.hora_visita || '').slice(0, 5))}</div>
      </div>
      <div style="margin-top:14px">
        ${blocoCampo('Observações', s.observacoes)}
        ${blocoCampo('Pendências', s.pendencias)}
        ${blocoCampo('Solicitações do Proprietário', s.solicitacoes_proprietario)}
      </div>
    </div>

    <div class="card">
      <h2>Assinatura ${integro ? '<span class="badge ok">✓ Íntegra</span>' : '<span class="badge no">⚠ Divergente</span>'}</h2>
      <div class="assino">
        <div class="rub">
          ${rubricaSrc ? `<img src="${rubricaSrc}" alt="assinatura">` : '<div style="border-bottom:2px solid ' + INK + ';height:110px"></div>'}
          <div class="l">${esc(a.signatario_nome)}</div>
        </div>
        <div class="qual">
          <div><b>${esc(a.signatario_nome)}</b></div>
          <div>${esc(papelLabel(a.signatario_papel))}</div>
          ${a.signatario_cpf ? `<div>CPF/CNPJ: ${esc(formatarDocumento(a.signatario_cpf))}</div>` : ''}
          <div style="margin-top:8px;color:${MUTED}">Assinado em ${fmtDataHora(a.assinado_em)}</div>
          ${gps ? `<div style="color:${MUTED}">GPS: ${esc(gps)}</div>` : ''}
          ${a.local_texto ? `<div style="color:${MUTED}">Local: ${esc(a.local_texto)}</div>` : ''}
        </div>
      </div>
    </div>

    <div class="card" style="padding:0;border:0">
      <div class="selo">
        ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR de verificação">` : ''}
        <div class="st">
          <div class="t">Selo de autenticidade · SHA-256</div>
          <div class="hash">${esc(a.hash_validacao)}</div>
          <div class="lk">Verifique em: ${esc(linkPublico)}</div>
        </div>
      </div>
    </div>
  </div>
  <div class="foot">Documento gerado eletronicamente pela Romatec Consultoria Total. A autenticidade pode ser conferida pelo QR Code ou pelo link acima, comparando o código SHA-256.</div>
</body></html>`;

  return htmlToPdf(html);
}
