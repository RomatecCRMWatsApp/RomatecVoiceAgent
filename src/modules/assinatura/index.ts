export { criarRotasAssinatura } from './rotas.js';
export { enfileirarDocumento, aprovarEAssinar, statusCertificado } from './servico.js';
export { assinarPdf } from './assinador.js';
export type { PosicaoCarimbo } from './carimbo.js';
// v3.152.0 — assinatura iniciada pelo chat (lotes + aprovação por link)
export { criarRotasAssinaturaChat } from './rotasChat.js';
export { criarRotasAprovacao } from './paginaAprovacao.js';
export { expirarLotesVencidos } from './chatLotes.js';
