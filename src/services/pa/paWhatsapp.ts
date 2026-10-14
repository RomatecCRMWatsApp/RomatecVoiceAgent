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

/** Envia um texto ao associado pelo WhatsApp do sistema (só número VALIDO). */
export async function enviarWhatsAppAssociado(aid: number, mensagem: string, tipo: string, usuario: string | null) {
  const a = await one(pool, 'SELECT id, projeto_id, nome, whatsapp_status, whatsapp_numero FROM pa_associados WHERE id = ?', [aid]);
  if (!a) throw new PaErro('ASSOCIADO_NAO_ENCONTRADO', 'Associado não encontrado', 404);
  if (a.whatsapp_status !== 'VALIDO' || !a.whatsapp_numero) {
    throw new PaErro('WHATSAPP_NAO_VALIDADO', `WhatsApp de ${a.nome} não está validado — rode "Verificar WhatsApps" antes`, 409);
  }
  const texto = String(mensagem || '').trim();
  if (!texto) throw new PaErro('CAMPO_INVALIDO', 'Mensagem vazia', 400);
  const { principal, codigos } = separarCodigosPix(texto);
  let r;
  try {
    const z = await zapi();
    r = await z.sendReply(String(a.whatsapp_numero), principal.slice(0, 4000));
    for (const c of codigos) await z.sendReply(String(a.whatsapp_numero), c);
  } catch (err) {
    throw new PaErro('ZAPI_INDISPONIVEL', `Falha ao enviar pelo WhatsApp do sistema: ${(err as Error).message.slice(0, 200)}`, 502);
  }
  await registrarEvento(pool, { projeto_id: num(a.projeto_id), associado_id: aid, usuario, tipo: `WHATSAPP_${tipo}`.slice(0, 40), dados: { message_id: r.messageId ?? null, chars: texto.length } });
  return { enviado: true, message_id: r.messageId ?? null };
}
