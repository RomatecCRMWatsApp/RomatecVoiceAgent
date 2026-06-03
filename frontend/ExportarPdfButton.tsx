// v1.99.16 — Componente React do seletor de template PDF (Padrao / Prime I / II).
//
// NOTA: o ZAYRA hoje e' server-rendered + vanilla JS (src/public). Este componente
// fica FORA de src/ (nao entra no `tsc --noEmit` do backend) e e' fornecido para
// uso em qualquer superficie React/Next que voce venha a ter. Para o app atual,
// use o widget vanilla pronto: src/public/js/exportar-pdf-prime.js.
//
// Padrao usa o endpoint pdfkit existente (urlPadrao); Prime usa /api/pdf-prime.
import { useState } from 'react';

export enum TemplateId {
  PADRAO = 'padrao',
  PRIME_I = 'prime1',
  PRIME_II = 'prime2',
}

export const TEMPLATE_OPTIONS = [
  { id: TemplateId.PADRAO, label: 'Padrao', descricao: 'Modelo tradicional Romatec' },
  { id: TemplateId.PRIME_I, label: 'Prime I', descricao: 'Dark Premium — verde e dourado' },
  { id: TemplateId.PRIME_II, label: 'Prime II', descricao: 'Clean Editorial — minimalista' },
];

interface Props {
  documentoId: string;
  tipo: 'proposta' | 'recibo';
  /** Endpoint do template Padrao (pipeline pdfkit existente). */
  urlPadrao: string;
}

function urlDoTemplate(props: Props, templateId: TemplateId): string {
  if (templateId === TemplateId.PADRAO) return props.urlPadrao;
  return `/api/pdf-prime/${props.tipo}/${props.documentoId}?template=${templateId}`;
}

export function ExportarPdfButton(props: Props) {
  const [aberto, setAberto] = useState(false);
  const [gerando, setGerando] = useState(false);

  async function exportar(templateId: TemplateId) {
    setAberto(false);
    setGerando(true);
    try {
      const res = await fetch(urlDoTemplate(props, templateId));
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `Falha ao gerar PDF (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${props.tipo}-${props.documentoId}-${templateId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setAberto((v) => !v)}
        disabled={gerando}
        className="flex items-center gap-2 px-4 py-2 bg-[#0B6E4F] text-white rounded hover:bg-[#074a35] transition disabled:opacity-60"
      >
        <span>📄 {gerando ? 'Gerando...' : 'Exportar PDF'}</span>
        <span className="text-xs opacity-70">▼</span>
      </button>
      {aberto && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 shadow-lg rounded z-50">
          {TEMPLATE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => exportar(opt.id)}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
            >
              <div className="font-medium text-sm text-gray-800">{opt.label}</div>
              <div className="text-xs text-gray-500">{opt.descricao}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ExportarPdfButton;
