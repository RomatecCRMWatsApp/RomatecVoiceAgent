// v1.69.0 — Geracao do PDF de recibo universal
//
// QR Code apontando pra URL publica /v/:hash (validacao permanente, sem auth).
// Selo "✓ CONFIRMADO" diagonal quando recibo foi confirmado.
// Layout adaptativo por tipo (titulo, corpo, valor opcional).

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { getTenantSettings } from './tenantSettings';
import type { Recibo } from '../integrations/recibos';
import { META } from '../integrations/recibos';
// v1.99.16: helpers compartilhados (QR, hash, selo CONFIRMADO)
import {
  renderQRValidacao,
  renderHashFooter,
  renderSeloConfirmado,
} from './reciboPdfShared';

const fmtBRL = (n: number) =>
  'R$ ' + Number(n || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const fmtData = (d: Date | string | null): string => {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
};

const fmtDataHora = (d: Date | string | null): string => {
  if (!d) return '-';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${fmtData(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
};

/** Base URL pra QR code. Usa env PUBLIC_BASE_URL (preferido) ou BASE_URL (legado),
 * senao Railway URL. Pra apontar dominio proprio, basta trocar PUBLIC_BASE_URL. */
export function getBaseUrl(): string {
  const url = process.env.PUBLIC_BASE_URL
    || process.env.BASE_URL
    || 'https://romatecvoiceagent-production.up.railway.app';
  return url.replace(/\/$/, '');
}

const FORMA_LABEL: Record<string, string> = {
  pix: 'PIX',
  dinheiro: 'Dinheiro',
  transferencia: 'Transferência bancária',
  cartao: 'Cartão',
  boleto: 'Boleto',
  cheque: 'Cheque',
};

// v1.95.0: Valor por extenso em pt-BR (até R$ 999.999.999,99).
function numeroExtenso(n: number): string {
  if (n === 0) return 'zero';
  if (n < 0) return 'menos ' + numeroExtenso(-n);
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const d10 = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function ate999(x: number): string {
    if (x === 100) return 'cem';
    const partes: string[] = [];
    const cc = Math.floor(x / 100);
    if (cc > 0) partes.push(c[cc]);
    const r = x % 100;
    if (r > 0) {
      if (r < 10) partes.push(u[r]);
      else if (r < 20) partes.push(d10[r - 10]);
      else {
        const dd = Math.floor(r / 10);
        const uu = r % 10;
        if (uu > 0) partes.push(d[dd] + ' e ' + u[uu]);
        else partes.push(d[dd]);
      }
    }
    return partes.join(' e ');
  }

  const partes: string[] = [];
  const bilhoes = Math.floor(n / 1_000_000_000);
  if (bilhoes > 0) {
    partes.push(ate999(bilhoes) + (bilhoes === 1 ? ' bilhão' : ' bilhões'));
    n = n % 1_000_000_000;
  }
  const milhoes = Math.floor(n / 1_000_000);
  if (milhoes > 0) {
    partes.push(ate999(milhoes) + (milhoes === 1 ? ' milhão' : ' milhões'));
    n = n % 1_000_000;
  }
  const milhares = Math.floor(n / 1000);
  if (milhares > 0) {
    if (milhares === 1) partes.push('mil');
    else partes.push(ate999(milhares) + ' mil');
    n = n % 1000;
  }
  if (n > 0) partes.push(ate999(n));
  return partes.join(' e ');
}

export function valorPorExtenso(valor: number): string {
  const v = Math.max(0, Math.round(Number(valor) * 100) / 100);
  const reais = Math.floor(v);
  const centavos = Math.round((v - reais) * 100);
  const partes: string[] = [];
  if (reais > 0) partes.push(numeroExtenso(reais) + (reais === 1 ? ' real' : ' reais'));
  if (centavos > 0) partes.push(numeroExtenso(centavos) + (centavos === 1 ? ' centavo' : ' centavos'));
  if (partes.length === 0) return 'zero reais';
  return partes.join(' e ');
}

// v1.99.9: metadados da assinatura digital pra renderizar bloco visual no PDF
export interface SignatureVisualMeta {
  signer_cn: string;          // CN do certificado (titular)
  signer_doc?: string | null; // CPF/CNPJ extraido do CN
  issuer_cn?: string | null;  // AC emitente
  validade_ate?: string | null; // ISO date
  data_assinatura: Date;      // momento da assinatura
  thumbprint?: string | null; // hash do cert
}

export async function gerarPdfRecibo(
  recibo: Recibo,
  signatureMeta?: SignatureVisualMeta,
): Promise<Buffer> {
  const t = await getTenantSettings(recibo.tenant_id).catch(() => null);
  // v1.95.0: tenta tambem o tenant_fiscal_config (CNPJ, IE)
  let fiscal: { cnpj?: string; inscricao_estadual?: string | null; inscricao_municipal?: string | null } | null = null;
  try {
    const m = await import('./tenantFiscalConfig');
    fiscal = await m.getFiscalConfig(recibo.tenant_id);
  } catch { /* ignora */ }

  // v1.96.0: perfil emitente — PJ Romatec (default) ou PF José Romário
  const ehPF = recibo.emitente_perfil === 'jose_romario_pf';
  const corHex = t?.primary_color || '#1F5C3A';
  const corDourada = '#B8893A';

  const emitente = ehPF
    ? {
        nome: 'JOSÉ ROMÁRIO PINTO BEZERRA',
        identificadorLabel: 'CPF',
        identificador: '012.091.853-69',
        complemento: 'Brasileiro · Avaliador Imobiliário CNAI 031.161 · CRECI 4.705 · CFT-BR 0120918536-9 · INCRA-FQNS',
        endereco: 'Rua São Raimundo, 10 — Centro — Açailândia/MA — CEP 65930-000',
        contato: '(99) 99181-1246 · contato@consultoriaromatec.com.br',
        exibirBancarios: false, // PF não exibe dados bancários (PIX a combinar)
        observacaoBancaria: 'Pagamento via PIX a combinar com o profissional.',
      }
    : {
        nome: t?.brand_name || 'ROMATEC CONSULTORIA TOTAL',
        identificadorLabel: 'CNPJ',
        identificador: fiscal?.cnpj || t?.cnpj || '17.261.987/0001-09',
        // v1.98.1: IE restaurada com valor real (127450840 — SINTEGRA/MA)
        complemento: `IE: ${fiscal?.inscricao_estadual || '127.450.840'} · J R P BEZERRA LTDA`,
        endereco: t?.endereco || 'Rua São Raimundo, 10 — Centro — Açailândia/MA — CEP 65930-000',
        contato: `${t?.telefone || '(99) 99181-1246'} · ${t?.email || 'contato@consultoriaromatec.com.br'}`,
        exibirBancarios: true,
        observacaoBancaria: '',
      };

  const dadosBancarios = {
    banco: 'Santander (033)',
    agencia: '1225',
    conta: '13000714-4',
    titular: 'J R P BEZERRA LTDA',
    pix: 'romatec.cad@hotmail.com',
  };
  const logoFile = path.join(__dirname, '..', 'public', 'romatec-logo-removebg-preview.png');

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    info: {
      Title: `${META.TITULO_PDF[recibo.tipo]} ${recibo.numero}`,
      Author: emitente.nome,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  // ── Cabecalho ────────────────────────────────────────────────────────
  if (fs.existsSync(logoFile)) {
    try { doc.image(logoFile, 40, 30, { fit: [90, 50] }); } catch { /* opcional */ }
  }
  doc.fontSize(15).fillColor(corHex).font('Helvetica-Bold').text(emitente.nome, 145, 38);
  doc.fontSize(8).fillColor('#444').font('Helvetica')
     .text(`${emitente.identificadorLabel} ${emitente.identificador} · ${emitente.complemento}`, 145, 56, { width: 410 })
     .text(emitente.endereco, 145, 70, { width: 410 })
     .text(emitente.contato, 145, 82, { width: 410 });

  // Faixa dourada
  doc.rect(40, 95, 515, 3).fill(corDourada);
  doc.moveTo(40, 99).lineTo(555, 99).strokeColor(corHex).lineWidth(1.5).stroke();

  // Titulo + numero + valor destacado em row
  doc.fontSize(16).fillColor('#111').font('Helvetica-Bold')
     .text(META.TITULO_PDF[recibo.tipo], 40, 110, { width: 280 });
  doc.fontSize(9).fillColor('#666').font('Helvetica')
     .text(`Nº ${recibo.numero}`, 40, 132);
  if (recibo.valor != null) {
    doc.fontSize(20).fillColor(corHex).font('Helvetica-Bold')
       .text(fmtBRL(recibo.valor), 320, 113, { width: 235, align: 'right' });
  }

  // ── Bloco EMITENTE ──────────────────────────────────────────────────
  let cy = 165;
  doc.fontSize(9).fillColor(corDourada).font('Helvetica-Bold')
     .text('EMITENTE — RECEBI(EMOS) DE', 40, cy);
  cy += 11;
  doc.fontSize(10).fillColor('#111').font('Helvetica-Bold').text(emitente.nome, 40, cy);
  cy += 12;
  doc.fontSize(9).fillColor('#444').font('Helvetica')
     .text(`${emitente.identificadorLabel}: ${emitente.identificador} · ${emitente.complemento}`, 40, cy, { width: 515 });
  cy = doc.y + 4;
  doc.text(emitente.endereco, 40, cy, { width: 515 });
  cy = doc.y + 8;

  // ── Bloco PAGADOR ───────────────────────────────────────────────────
  doc.fontSize(9).fillColor(corDourada).font('Helvetica-Bold')
     .text('PAGADOR — A IMPORTÂNCIA DE', 40, cy);
  cy += 11;
  doc.fontSize(11).fillColor('#111').font('Helvetica-Bold')
     .text(recibo.destinatario_nome || '— preencher —', 40, cy);
  cy += 13;
  doc.fontSize(9).fillColor('#444').font('Helvetica');
  if (recibo.destinatario_doc) {
    doc.text(`CPF/CNPJ: ${recibo.destinatario_doc}`, 40, cy);
    cy += 11;
  }
  if (recibo.destinatario_phone) {
    doc.text(`WhatsApp: ${recibo.destinatario_phone}`, 40, cy);
    cy += 11;
  }
  if (recibo.destinatario_email) {
    doc.text(`Email: ${recibo.destinatario_email}`, 40, cy);
    cy += 11;
  }
  cy += 6;

  // ── Frase de quitação com valor por extenso ─────────────────────────
  if (recibo.valor != null && recibo.valor > 0) {
    const extenso = valorPorExtenso(Number(recibo.valor));
    const frase = `A importância de ${fmtBRL(recibo.valor)} (${extenso}), referente ao serviço abaixo descrito, dando plena, geral e irrevogável quitação.`;
    doc.fontSize(9.5).fillColor('#111').font('Helvetica-Oblique')
       .text(frase, 40, cy, { width: 515, align: 'justify' });
    cy = doc.y + 10;
  }

  // ── Bloco REFERENTE A ───────────────────────────────────────────────
  if (recibo.descricao_servico) {
    doc.fontSize(9).fillColor(corDourada).font('Helvetica-Bold')
       .text('REFERENTE A', 40, cy);
    cy += 11;
    doc.fontSize(9.5).fillColor('#111').font('Helvetica')
       .text(recibo.descricao_servico, 40, cy, { width: 515 });
    cy = doc.y + 8;
  }

  // ── Forma de pagamento + DADOS BANCÁRIOS ────────────────────────────
  doc.fontSize(9).fillColor(corDourada).font('Helvetica-Bold')
     .text('PAGAMENTO', 40, cy);
  cy += 11;
  doc.fontSize(9).fillColor('#444').font('Helvetica');
  if (recibo.forma_pagamento) {
    doc.text(`Forma: ${FORMA_LABEL[recibo.forma_pagamento] || recibo.forma_pagamento}`, 40, cy);
    cy += 11;
  }
  doc.text(`Data de emissão: ${fmtData(recibo.created_at)}`, 40, cy);
  cy += 11;
  if (recibo.expires_at) {
    doc.text(`Válido até: ${fmtData(recibo.expires_at)}`, 40, cy);
    cy += 11;
  }
  // Dados bancários (so pra PJ — Romatec)
  if (recibo.tenant_id === 1) {
    cy += 4;
    doc.fontSize(8.5).fillColor('#666').font('Helvetica-Bold')
       .text('Dados bancários para depósito/PIX:', 40, cy);
    cy += 10;
    doc.fontSize(8.5).fillColor('#444').font('Helvetica')
       .text(`Banco ${dadosBancarios.banco} · Ag. ${dadosBancarios.agencia} · CC ${dadosBancarios.conta}`, 40, cy);
    cy += 10;
    doc.text(`Titular: ${dadosBancarios.titular}`, 40, cy);
    cy += 10;
    doc.font('Helvetica-Bold').fillColor(corHex)
       .text(`PIX (e-mail): ${dadosBancarios.pix}`, 40, cy);
    cy += 12;
  }

  // ── Local + Data + Linha de assinatura ──────────────────────────────
  cy += 14;
  const cidade = 'Açailândia/MA';
  const dataExtenso = (() => {
    const d = recibo.created_at instanceof Date ? recibo.created_at : new Date(recibo.created_at);
    const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    return `${cidade}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}.`;
  })();
  doc.fontSize(10).fillColor('#111').font('Helvetica')
     .text(dataExtenso, 40, cy, { width: 515, align: 'center' });
  cy += 18;

  // v1.99.10: BLOCO VISUAL DE ASSINATURA DIGITAL ENTRE DATA E LINHA DE ASSINATURA
  // Quando o PDF e gerado dentro do fluxo assinarRecibo, o signatureMeta tem
  // dados do certificado e o bloco e renderizado AQUI (no miolo, nao no rodape).
  if (signatureMeta) {
    const fmtDataAssin = (d: Date) => {
      return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const validadeFmt = signatureMeta.validade_ate
      ? fmtData(signatureMeta.validade_ate)
      : '—';
    const docFmt = (() => {
      const d = signatureMeta.signer_doc || '';
      if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
      if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      return d || '—';
    })();
    const dataAssinFmt = fmtDataAssin(signatureMeta.data_assinatura);
    const cnLimpo = signatureMeta.signer_cn.replace(/:\d+$/, '');

    // Caixa verde no miolo, x=130-485 (centrada, 355px de largura)
    const boxX = 130;
    const boxW = 355;
    doc.save()
       .lineWidth(0.8)
       .strokeColor('#10b981')
       .roundedRect(boxX, cy, boxW, 56, 4)
       .stroke()
       .restore();

    // Cabecalho
    doc.fontSize(8).fillColor('#10b981').font('Helvetica-Bold')
       .text('ASSINADO DIGITALMENTE — ICP-Brasil (PAdES)', boxX, cy + 5, {
         width: boxW, align: 'center', lineBreak: false,
       });

    // Linha 1: signatario
    doc.fontSize(8).fillColor('#222').font('Helvetica-Bold')
       .text(cnLimpo, boxX + 6, cy + 19, { width: boxW - 12, align: 'center', lineBreak: false });

    // Linha 2: doc + data
    doc.fontSize(7).fillColor('#444').font('Helvetica')
       .text(`${docFmt} · Assinado em ${dataAssinFmt}`, boxX + 6, cy + 31, {
         width: boxW - 12, align: 'center', lineBreak: false,
       });

    // Linha 3: cert + validade
    doc.fontSize(6.5).fillColor('#666').font('Helvetica')
       .text(`Cert: ${signatureMeta.issuer_cn || '—'} · Válido até ${validadeFmt} · Validar em validar.iti.gov.br`,
             boxX + 6, cy + 42, { width: boxW - 12, align: 'center', lineBreak: false });

    cy += 65; // altura do bloco + margem
  } else {
    cy += 14; // espaço normal se nao tem assinatura digital
  }

  // Linha de assinatura (manuscrita)
  doc.moveTo(180, cy).lineTo(415, cy).strokeColor('#444').lineWidth(0.5).stroke();
  cy += 6;
  doc.fontSize(9).fillColor('#222').font('Helvetica-Bold')
     .text(emitente.nome, 40, cy, { width: 515, align: 'center' });
  cy += 11;
  doc.fontSize(8).fillColor('#666').font('Helvetica')
     .text(`${emitente.identificadorLabel} ${emitente.identificador}`, 40, cy, { width: 515, align: 'center' });

  // Bloco confirmacao (se ja respondido)
  if (recibo.respondido_em) {
    cy += 18;
    const corStatus =
      recibo.status === 'confirmado' ? '#10b981' :
      recibo.status === 'contestado' ? '#dc2626' :
      '#3b82f6';
    doc.fontSize(8).fillColor(corStatus).font('Helvetica-Bold')
       .text('STATUS', 40, cy);
    cy += 10;
    const labelStatus =
      recibo.status === 'confirmado' ? '✓ CONFIRMADO PELO DESTINATÁRIO' :
      recibo.status === 'contestado' ? '✗ CONTESTADO PELO DESTINATÁRIO' :
      `Respondido (${recibo.resposta_acao})`;
    doc.fontSize(9).fillColor(corStatus).text(labelStatus, 40, cy);
    cy += 10;
    doc.fontSize(8).fillColor('#444').font('Helvetica')
       .text(`Em ${fmtDataHora(recibo.respondido_em)} via WhatsApp${recibo.ip_resposta ? ' · IP ' + recibo.ip_resposta : ''}`, 40, cy);
    cy += 10;
    if (recibo.resposta_obs) {
      doc.text(`Obs: ${recibo.resposta_obs}`, 40, cy, { width: 515 });
    }
  }

  // ── Selo diagonal "CONFIRMADO" (so se confirmado) ───────────────────
  // v1.99.16: refatorado pra renderSeloConfirmado (mesmo selo usado em valePdf)
  if (recibo.status === 'confirmado') {
    renderSeloConfirmado(doc);
  }

  // ── Rodape: QR code + hash + assinatura ──────────────────────────────
  // v1.99.16: refatorado pra renderQRValidacao + renderHashFooter
  const qrUrl = await renderQRValidacao(
    doc, recibo.hash_validacao, getBaseUrl(),
    460, 680,
    { size: 95, corHex, comLabel: true }
  );
  renderHashFooter(doc, recibo.hash_validacao, qrUrl, 40, 680, 410);

  // v1.99.10: bloco visual de assinatura digital foi MOVIDO pro miolo do
  // documento (entre data e linha de assinatura manuscrita). Aqui no rodape
  // sobra apenas hash + QR code.

  // v1.96.0: footer mais compacto pra evitar pagina em branco extra.
  // Texto da assinatura foi REMOVIDO daqui (estava em y=800 absoluto e
  // criava pagina nova quando cy ja passou). Hash + URL em y=700-730
  // ja servem pra rastreabilidade.

  doc.end();
  await new Promise<void>(resolve => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

// v1.89.0: PDF de PREVIEW (modal de confirmação). NAO persiste — recebe
// dados crus do form, faz placeholder pro hash/numero/QR e gera PDF.
// Usa o mesmo gerarPdfRecibo internamente pra garantir 100% de consistencia
// visual entre o que o user ve no modal e o que vai pro cliente.
export interface ReciboPreviewInput {
  tipo: string;
  numero?: string;
  emitente_perfil?: string;  // v1.96.0: 'romatec_pj' (default) | 'jose_romario_pf'
  destinatario_nome: string;
  destinatario_doc?: string | null;
  destinatario_phone: string;
  destinatario_email?: string | null;
  valor?: number | null;
  forma_pagamento?: string | null;
  descricao_servico?: string | null;
  expira_em_dias?: number;
  tenant_id?: number;
}

const PREVIEW_PREFIXOS: Record<string, string> = {
  funcionario: 'REC-FUN', parcela: 'REC-PAR', despesa: 'REC-DSP',
  proposta: 'REC-PRO', vistoria: 'REC-VTO', etapa: 'REC-ETP',
  chaves: 'REC-CHV', custom: 'REC-CUS',
};

export async function gerarPdfReciboPreview(input: ReciboPreviewInput): Promise<Buffer> {
  // Constroi um Recibo "fake" com placeholders. NAO insere no banco.
  const ano = new Date().getFullYear();
  const numero = input.numero || `${PREVIEW_PREFIXOS[input.tipo] || 'REC-CUS'}-${ano}-PREVIEW`;
  const expiresAt = input.expira_em_dias
    ? new Date(Date.now() + Math.max(1, Math.min(365, input.expira_em_dias)) * 86400_000)
    : null;

  const fakeRecibo = {
    id: 0,
    tenant_id: input.tenant_id ?? 1,
    numero,
    tipo: input.tipo,
    emitente_perfil: input.emitente_perfil || 'romatec_pj',
    resource_type: 'preview',
    resource_id: 'preview',
    destinatario_nome: input.destinatario_nome || '— preencher —',
    destinatario_doc: input.destinatario_doc?.replace(/\D/g, '') || null,
    destinatario_phone: input.destinatario_phone || '',
    destinatario_email: input.destinatario_email || null,
    destinatario_endereco: null,
    valor: input.valor != null ? Number(input.valor) : null,
    forma_pagamento: input.forma_pagamento || null,
    descricao_servico: input.descricao_servico || null,
    codigo_servico_key: null,
    categoria_servico: null,
    categoria_grupo: null,
    token: 'preview',
    hash_validacao: 'preview-'.padEnd(64, '0'),
    status: 'rascunho',
    resposta_acao: null,
    resposta_obs: null,
    resposta_foto_url: null,
    resposta_lat: null,
    resposta_lng: null,
    pdf_url: null,
    zapi_message_id: null,
    expires_at: expiresAt,
    enviado_em: null,
    entregue_em: null,
    lido_em: null,
    respondido_em: null,
    ip_resposta: null,
    user_agent_resposta: null,
    last_reminder_at: null,
    nota_fiscal_id: null,
    created_by: null,
    created_at: new Date(),
    updated_at: new Date(),
  } as unknown as import('../integrations/recibos').Recibo;

  return await gerarPdfRecibo(fakeRecibo);
}
