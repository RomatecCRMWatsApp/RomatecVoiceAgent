// v3.143.0 — WhatsApp do módulo PA: verificação dos números dos associados
// (Z-API phone-exists em lote) e envio da cobrança pelo WhatsApp do sistema.
//
// Regras:
//   - número sem 9º dígito no WhatsApp (contas antigas) é tentado como
//     alternativa automaticamente — o resultado guarda o número que EXISTE;
//   - falha da instância (vencida/desconectada) NÃO marca ninguém como
//     inexistente: aborta e devolve ZAPI_INDISPONIVEL;
//   - envio só para whatsapp_status = VALIDO, com evento auditado.
import { PaErro } from './erros';
import { pool, rows, one, exec, num, registrarEvento } from './paDb';
// integrations/whatsapp puxa a cadeia do agente — import sob demanda.
const zapi = () => import('../../integrations/whatsapp');

/** +5599991546099 → ['5599991546099', '559991546099'] (com e sem o 9 após o DDD). */
export function variantesNumero(e164: string): string[] {
  const d = e164.replace(/\D/g, '');
  const out = [d];
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') out.push(d.slice(0, 4) + d.slice(5));
  return out;
}

export interface ResultadoVerificacao {
  verificados: number; validos: number; inexistentes: number; sem_telefone: number;
  detalhes: Array<{ associado_id: number; numero: string; lote: string; nome: string; status: string; whatsapp: string | null }>;
}

export async function verificarWhatsAppsProjeto(projetoId: number, usuario: string | null, somenteNaoVerificados = false): Promise<ResultadoVerificacao> {
  const as = await rows(pool, `
    SELECT a.id, a.numero, a.nome, a.telefone_e164, l.numero AS lote FROM pa_associados a JOIN pa_lotes l ON l.id = a.lote_id
    WHERE a.projeto_id = ? AND a.ativo = 1 ${somenteNaoVerificados ? "AND a.whatsapp_status = 'NAO_VERIFICADO'" : ''}
    ORDER BY CAST(l.numero AS UNSIGNED)`, [projetoId]);
  const comTel = as.filter((a) => a.telefone_e164);
  const todos = comTel.flatMap((a) => variantesNumero(String(a.telefone_e164)));
  let resultados;
  try {
    resultados = await (await zapi()).verificarNumerosWhatsApp(todos);
  } catch (err) {
    throw new PaErro('ZAPI_INDISPONIVEL', `Não consegui consultar a Z-API (instância vencida ou desconectada?): ${(err as Error).message.slice(0, 200)}`, 502);
  }
  const porEntrada = new Map(resultados.map((r) => [r.entrada.replace(/\D/g, ''), r]));
  const out: ResultadoVerificacao = { verificados: 0, validos: 0, inexistentes: 0, sem_telefone: 0, detalhes: [] };
  for (const a of as) {
    let status: 'VALIDO' | 'INEXISTENTE' | 'SEM_TELEFONE' = 'SEM_TELEFONE';
    let numero: string | null = null;
    if (a.telefone_e164) {
      status = 'INEXISTENTE';
      for (const v of variantesNumero(String(a.telefone_e164))) {
        const r = porEntrada.get(v);
        if (r?.existe) { status = 'VALIDO'; numero = (r.numero || v).replace(/\D/g, ''); break; }
      }
    }
    await exec(pool, 'UPDATE pa_associados SET whatsapp_status = ?, whatsapp_numero = ?, whatsapp_verificado_em = NOW() WHERE id = ?', [status, numero, a.id]);
    out.verificados++;
    if (status === 'VALIDO') out.validos++; else if (status === 'INEXISTENTE') out.inexistentes++; else out.sem_telefone++;
    out.detalhes.push({ associado_id: num(a.id), numero: String(a.numero), lote: String(a.lote), nome: String(a.nome), status, whatsapp: numero });
  }
  await registrarEvento(pool, {
    projeto_id: projetoId, usuario, tipo: 'WHATSAPP_VERIFICADO',
    dados: { verificados: out.verificados, validos: out.validos, inexistentes: out.inexistentes, sem_telefone: out.sem_telefone },
  });
  return out;
}

/**
 * v3.145.3: separa os códigos Pix copia-e-cola do texto. No WhatsApp o código no
 * meio da mensagem quebra em várias linhas e só dá pra copiar a mensagem inteira —
 * o código vai sozinho na mensagem seguinte (um toque pra copiar).
 */
export function separarCodigosPix(texto: string): { principal: string; codigos: string[] } {
  const codigos: string[] = [];
  const linhas = texto.split('\n').filter((l) => {
    const t = l.trim();
    if (/^000201[0-9A-Za-z.@\-_*/ ]{30,}$/.test(t)) { codigos.push(t); return false; }
    return true;
  }).map((l) => l.replace(/Pix copia e cola:\s*$/i, codigos.length ? 'Pix copia e cola: (na próxima mensagem — toque e segure para copiar)' : 'Pix copia e cola:'));
  return { principal: linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim(), codigos };
}

// ─── v3.146.1: ritmo humano (anti-bloqueio do WhatsApp) ───────────────────
// Em 13/10 o número foi bloqueado: o lote mandava 1 associado a cada ~4 s e as
// 2–3 mensagens de cada um saíam coladas. Agora TODO envio passa por aqui:
//   • envios serializados (um de cada vez, mesmo com várias abas/requests);
//   • intervalo mínimo entre envios de associados diferentes (20 s + sorteio);
//   • pausa sorteada entre as mensagens do mesmo associado (texto → Pix).
export const RITMO = {
  gapMinMs: Number(process.env.PA_WA_GAP_MIN_MS) || 20_000,
  entreMensagensMs: [4_000, 8_000] as [number, number],
  entreAssociadosMs: [Number(process.env.PA_WA_LOTE_MIN_MS) || 30_000, Number(process.env.PA_WA_LOTE_MAX_MS) || 60_000] as [number, number],
};
export const sorteio = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let ultimoEnvio = 0;
let corrente: Promise<unknown> = Promise.resolve();

/** Executa `fn` na vez dele: um envio por vez e respeitando o intervalo mínimo. */
function naVez<T>(fn: () => Promise<T>): Promise<T> {
  const exec = corrente.then(async () => {
    const espera = ultimoEnvio + RITMO.gapMinMs + sorteio(0, 8_000) - Date.now();
    if (ultimoEnvio && espera > 0) await dormir(espera);
    try { return await fn(); } finally { ultimoEnvio = Date.now(); }
  });
  corrente = exec.catch(() => undefined);
  return exec;
}

/** Saudação variada pelo horário de Brasília — mensagens não ficam idênticas. */
export function variarSaudacao(texto: string, agora = new Date()): string {
  const h = (agora.getUTCHours() + 21) % 24; // UTC-3
  const periodo = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const opcoes = ['Olá', 'Oi', periodo, `${periodo}`];
  return texto.replace(/^Olá,/, `${opcoes[sorteio(0, opcoes.length - 1)]},`);
}

/** Envia um texto ao associado pelo WhatsApp do sistema (só número VALIDO). */
export async function enviarWhatsAppAssociado(aid: number, mensagem: string, tipo: string, usuario: string | null) {
  const a = await one(pool, 'SELECT id, projeto_id, nome, whatsapp_status, whatsapp_numero FROM pa_associados WHERE id = ?', [aid]);
  if (!a) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado', 404);
  if (a.whatsapp_status !== 'VALIDO' || !a.whatsapp_numero) {
    throw new PaErro('WHATSAPP_NAO_VALIDADO', `WhatsApp de ${a.nome} não está validado — rode "Verificar WhatsApps" antes`, 409);
  }
  const texto = String(mensagem || '').trim();
  if (!texto) throw new PaErro('CAMPO_INVALIDO', 'Mensagem vazia', 400);
  const { principal, codigos } = separarCodigosPix(variarSaudacao(texto));
  let r: { messageId?: string };
  try {
    r = await naVez(async () => {
      const z = await zapi();
      const primeiro = await z.sendReply(String(a.whatsapp_numero), principal.slice(0, 4000));
      for (const c of codigos) {
        await dormir(sorteio(...RITMO.entreMensagensMs));
        await z.sendReply(String(a.whatsapp_numero), c);
      }
      return primeiro;
    });
  } catch (err) {
    throw new PaErro('ZAPI_INDISPONIVEL', `Falha ao enviar pelo WhatsApp do sistema: ${(err as Error).message.slice(0, 200)}`, 502);
  }
  await registrarEvento(pool, { projeto_id: num(a.projeto_id), associado_id: aid, usuario, tipo: `WHATSAPP_${tipo}`.slice(0, 40), dados: { message_id: r.messageId ?? null, chars: texto.length } });
  return { enviado: true, message_id: r.messageId ?? null };
}

// ─── v3.146.1: fila de envio em lote (roda no servidor, devagar) ──────────
export interface ItemFila { associado_id: number; nome: string; lancamento_ids: number[] }
export interface EstadoFila {
  id: number; projeto_id: number; status: 'RODANDO' | 'CONCLUIDA' | 'PARADA' | 'ERRO';
  total: number; enviados: number; falhas: number; atual: string | null; proximo_em: string | null;
  iniciado_em: string; terminado_em: string | null; erro: string | null;
  log: Array<{ nome: string; ok: boolean; erro?: string; em: string }>;
}
let fila: (EstadoFila & { itens: ItemFila[]; parar: boolean; usuario: string | null }) | null = null;
let seqFila = 0;

export function estadoFila(): EstadoFila | null {
  if (!fila) return null;
  const { itens: _i, parar: _p, usuario: _u, ...pub } = fila;
  return { ...pub, log: pub.log.slice(-30) };
}

export function pararFila(): EstadoFila | null {
  if (fila && fila.status === 'RODANDO') fila.parar = true;
  return estadoFila();
}

/** Enfileira e dispara o envio em lote (um por vez, 30–60 s sorteados entre associados). */
export function iniciarFila(projetoId: number, itens: ItemFila[], usuario: string | null, enviarItem: (it: ItemFila) => Promise<void>): EstadoFila {
  if (fila && fila.status === 'RODANDO') throw new PaErro('FILA_EM_ANDAMENTO', 'Já existe um envio em lote em andamento — aguarde terminar ou pare a fila', 409);
  const lista = itens.filter((i) => i.lancamento_ids.length);
  if (!lista.length) throw new PaErro('NADA_SELECIONADO', 'Nenhum associado/parcela para enviar', 400);
  fila = {
    id: ++seqFila, projeto_id: projetoId, status: 'RODANDO', total: lista.length, enviados: 0, falhas: 0,
    atual: null, proximo_em: null, iniciado_em: new Date().toISOString(), terminado_em: null, erro: null, log: [],
    itens: lista, parar: false, usuario,
  };
  const f = fila;
  void (async () => {
    for (let i = 0; i < f.itens.length; i++) {
      if (f.parar) { f.status = 'PARADA'; break; }
      const it = f.itens[i];
      f.atual = it.nome; f.proximo_em = null;
      try {
        await enviarItem(it);
        f.enviados++;
        f.log.push({ nome: it.nome, ok: true, em: new Date().toISOString() });
      } catch (err) {
        f.falhas++;
        const msg = (err as Error).message.slice(0, 200);
        f.log.push({ nome: it.nome, ok: false, erro: msg, em: new Date().toISOString() });
        // Falha da Z-API (desconectada/bloqueada): para tudo na hora, não insiste.
        if (err instanceof PaErro && err.codigo === 'ZAPI_INDISPONIVEL') { f.status = 'ERRO'; f.erro = msg; break; }
      }
      if (i < f.itens.length - 1) {
        const espera = sorteio(...RITMO.entreAssociadosMs);
        f.proximo_em = new Date(Date.now() + espera).toISOString(); f.atual = null;
        for (let t = 0; t < espera && !f.parar; t += 1000) await dormir(Math.min(1000, espera - t));
      }
    }
    if (f.status === 'RODANDO') f.status = f.parar ? 'PARADA' : 'CONCLUIDA';
    f.atual = null; f.proximo_em = null; f.terminado_em = new Date().toISOString();
    await registrarEvento(pool, { projeto_id: f.projeto_id, usuario: f.usuario, tipo: 'WHATSAPP_LOTE', dados: { fila: f.id, status: f.status, total: f.total, enviados: f.enviados, falhas: f.falhas } });
  })();
  return estadoFila()!;
}
