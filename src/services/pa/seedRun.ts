// v3.142.0 — Persistência idempotente do plano de seed (ver seedPlan.ts).
//
// Idempotência (spec §4): projeto por código, lote por (projeto, número),
// associado por (projeto, número PASM) com trava de CPF, lançamento por
// (associado, tipo, parcela), pagamento por id de transação/seed_chave e
// documento por (projeto, caminho) + sha256. Rodar de novo NÃO desfaz o que o
// app mudou depois: dados de campo (medição) e cadastro editado são mantidos —
// o seed só preenche o que está vazio.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { pool, rows, one, exec, transacao, num } from './paDb';
import { centavos, statusAposRecebimento, type StatusLancamento } from './regrasFinanceiras';
import type { PlanoSeed } from './seedPlan';
import { sha256 } from './paDocumentos';

export type LerArquivo = (relativo: string) => Promise<Buffer | null>;

export interface RelatorioSeed {
  projeto_id: number;
  inseridos: Record<string, number>;
  atualizados: Record<string, number>;
  ignorados: Record<string, number>;
  arquivos: { carregados: number; ja_presentes: number; ausentes: number };
  avisos: string[];
  erros: string[];
}

function cont(): Record<string, number> {
  return { projeto: 0, lotes: 0, associados: 0, lancamentos: 0, pagamentos: 0, documentos: 0 };
}

export async function executarSeed(plano: PlanoSeed, lerArquivo: LerArquivo | null, usuario: string | null): Promise<RelatorioSeed> {
  const rel: RelatorioSeed = {
    projeto_id: 0, inseridos: cont(), atualizados: cont(), ignorados: cont(),
    arquivos: { carregados: 0, ja_presentes: 0, ausentes: 0 }, avisos: [...plano.avisos], erros: [...plano.erros],
  };
  const pj = plano.projeto;

  // mysql2 liga CLIENT_FOUND_ROWS: no ON DUPLICATE KEY, "existia e não mudou"
  // também devolve affectedRows=1 — por isso a contagem usa o que já existia.
  const ctx = await transacao(async (c) => {
    // Projeto
    const projetoExistia = !!(await one(c, 'SELECT id FROM pa_projetos WHERE codigo = ?', [pj.codigo]));
    const r = await exec(c, `
      INSERT INTO pa_projetos (codigo, nome, municipio, uf, associacao_nome, associacao_cnpj, associacao_cnpj_status, presidente_nome,
        valor_lote, sinal_padrao, boleto_padrao, prazo_sinal, pix_chave, pix_favorecido, pix_cidade, rt_nome, rt_registro, layout_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), nome = VALUES(nome), municipio = VALUES(municipio), uf = VALUES(uf),
        associacao_nome = COALESCE(associacao_nome, VALUES(associacao_nome)), associacao_cnpj = COALESCE(associacao_cnpj, VALUES(associacao_cnpj)),
        presidente_nome = COALESCE(presidente_nome, VALUES(presidente_nome)), valor_lote = VALUES(valor_lote),
        sinal_padrao = VALUES(sinal_padrao), boleto_padrao = VALUES(boleto_padrao), prazo_sinal = VALUES(prazo_sinal),
        pix_chave = VALUES(pix_chave), pix_favorecido = VALUES(pix_favorecido), pix_cidade = VALUES(pix_cidade),
        rt_nome = VALUES(rt_nome), rt_registro = VALUES(rt_registro), layout_json = VALUES(layout_json)`, [
      pj.codigo, pj.nome, pj.municipio, pj.uf, pj.associacao_nome, pj.associacao_cnpj, pj.associacao_cnpj_status, pj.presidente_nome,
      pj.valor_lote, pj.sinal_padrao, pj.boleto_padrao, pj.prazo_sinal, pj.pix_chave, pj.pix_favorecido, pj.pix_cidade,
      pj.rt_nome, pj.rt_registro, JSON.stringify(pj.layout_json),
    ]);
    const projetoId = r.insertId;
    if (projetoExistia) rel.atualizados.projeto++; else rel.inseridos.projeto++;
    const lotesExistentes = new Set((await rows(c, 'SELECT numero FROM pa_lotes WHERE projeto_id = ?', [projetoId])).map((x) => String(x.numero)));

    // Lotes (status de medição/equipe/área medida nunca são sobrescritos)
    const loteId = new Map<string, number>();
    for (const l of plano.lotes) {
      const x = await exec(c, `
        INSERT INTO pa_lotes (projeto_id, numero, tipo, largura_m, profundidade_m, area_projeto_m2, perimetro_m, croqui_xy, status_medicao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), largura_m = VALUES(largura_m), profundidade_m = VALUES(profundidade_m),
          area_projeto_m2 = VALUES(area_projeto_m2), perimetro_m = COALESCE(perimetro_m, VALUES(perimetro_m)), croqui_xy = VALUES(croqui_xy),
          tipo = IF(tipo = 'VAGO', VALUES(tipo), tipo)`, [
        projetoId, l.numero, l.tipo, l.largura_m, l.profundidade_m, l.area_projeto_m2, l.perimetro_m,
        l.croqui_xy ? JSON.stringify(l.croqui_xy) : null, l.status_medicao,
      ]);
      loteId.set(l.numero, x.insertId);
      if (lotesExistentes.has(l.numero)) rel.atualizados.lotes++; else rel.inseridos.lotes++;
    }

    // Associados
    const assocId = new Map<string, number>(); // lote → id
    for (const a of plano.associados) {
      const lid = loteId.get(a.lote)!;
      const existente = await one(c, 'SELECT id, cpf, lote_id FROM pa_associados WHERE projeto_id = ? AND numero = ?', [projetoId, a.numero]);
      if (existente) {
        if (String(existente.cpf) !== a.cpf) { rel.erros.push(`${a.numero}: já existe com outro CPF — mantido o do banco`); }
        const u = await exec(c, `
          UPDATE pa_associados SET
            rg = COALESCE(rg, ?), nascimento = COALESCE(nascimento, ?), estado_civil = COALESCE(estado_civil, ?),
            conjuge_nome = COALESCE(conjuge_nome, ?), conjuge_cpf = COALESCE(conjuge_cpf, ?), telefone = COALESCE(telefone, ?),
            telefone_e164 = COALESCE(telefone_e164, ?), email = COALESCE(email, ?), denominacao_terra = COALESCE(denominacao_terra, ?),
            endereco = COALESCE(endereco, ?), dia_vencimento = COALESCE(dia_vencimento, ?), pendencias = COALESCE(pendencias, ?),
            acervo_pasta = COALESCE(acervo_pasta, ?),
            contrato_status = IF(? = 'ASSINADO', 'ASSINADO', contrato_status),
            contrato_assinado_em = IF(? = 'ASSINADO' AND contrato_assinado_em IS NULL, NOW(), contrato_assinado_em)
          WHERE id = ?`, [
          a.rg, a.nascimento, a.estado_civil, a.conjuge_nome, a.conjuge_cpf, a.telefone, a.telefone_e164, a.email,
          a.denominacao_terra, a.endereco, a.dia_vencimento, a.pendencias, a.acervo_pasta, a.contrato_status, a.contrato_status, existente.id,
        ]);
        assocId.set(a.lote, num(existente.id));
        if (u.changedRows > 0) rel.atualizados.associados++; else rel.ignorados.associados++;
        continue;
      }
      const cpfDono = await one(c, 'SELECT numero FROM pa_associados WHERE projeto_id = ? AND cpf = ?', [projetoId, a.cpf]);
      if (cpfDono) { rel.erros.push(`${a.numero}: CPF ${a.cpf} já pertence a ${cpfDono.numero} — não importado`); continue; }
      const loteDono = await one(c, 'SELECT numero FROM pa_associados WHERE lote_id = ?', [lid]);
      if (loteDono) { rel.erros.push(`${a.numero}: lote ${a.lote} já pertence a ${loteDono.numero} — não importado`); continue; }
      const ins = await exec(c, `
        INSERT INTO pa_associados (projeto_id, lote_id, numero, nome, cpf, rg, nascimento, estado_civil, conjuge_nome, conjuge_cpf,
          telefone, telefone_e164, email, denominacao_terra, endereco, dia_vencimento, contrato_status, contrato_assinado_em, pendencias, acervo_pasta)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        projetoId, lid, a.numero, a.nome, a.cpf, a.rg, a.nascimento, a.estado_civil, a.conjuge_nome, a.conjuge_cpf,
        a.telefone, a.telefone_e164, a.email, a.denominacao_terra, a.endereco, a.dia_vencimento, a.contrato_status,
        a.contrato_status === 'ASSINADO' ? new Date() : null, a.pendencias, a.acervo_pasta,
      ]);
      assocId.set(a.lote, ins.insertId);
      rel.inseridos.associados++;
    }

    // Lançamentos (só cria os que faltam; valor_recebido nasce 0 e vem do rateio)
    const lancId = new Map<string, number>(); // lote|tipo|parcela → id
    for (const l of plano.lancamentos) {
      const aid = assocId.get(l.lote);
      if (!aid) { rel.ignorados.lancamentos++; continue; }
      const statusInicial: StatusLancamento = l.status === 'PAGO' || l.status === 'PARCIAL' ? (l.tipo === 'BOLETO' ? 'A_VENCER' : 'A_PAGAR') : l.status;
      const x = await exec(c, `
        INSERT IGNORE INTO pa_lancamentos (associado_id, tipo, parcela, valor, vencimento, status, valor_recebido, descricao)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)`, [aid, l.tipo, l.parcela, l.valor, l.vencimento, statusInicial, l.descricao]);
      if (x.affectedRows === 1) rel.inseridos.lancamentos++; else rel.ignorados.lancamentos++;
      const id = x.insertId || num((await one(c, 'SELECT id FROM pa_lancamentos WHERE associado_id = ? AND tipo = ? AND parcela = ?', [aid, l.tipo, l.parcela]))?.id);
      lancId.set(`${l.lote}|${l.tipo}|${l.parcela}`, id);
    }

    // Pagamentos + rateio
    const tocados = new Set<number>();
    for (const p of plano.pagamentos) {
      const ja = await one(c, 'SELECT id FROM pa_pagamentos WHERE seed_chave = ? OR (id_transacao IS NOT NULL AND id_transacao = ?)', [p.seed_chave, p.id_transacao]);
      if (ja) { rel.ignorados.pagamentos++; continue; }
      const rateio = p.rateio
        .map((r) => ({ ...r, id: lancId.get(`${r.lote}|${r.tipo}|${r.parcela}`) }))
        .filter((r): r is typeof r & { id: number } => !!r.id);
      if (!rateio.length) { rel.erros.push(`pagamento ${p.seed_chave}: lançamentos não encontrados`); continue; }
      const ins = await exec(c, `
        INSERT INTO pa_pagamentos (projeto_id, forma, valor, pago_em, id_transacao, pagador_nome, vinculo_pagador, obs, seed_chave, criado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        projetoId, p.forma, p.valor, p.pago_em, p.id_transacao, p.pagador_nome, p.vinculo_pagador, p.obs, p.seed_chave, usuario ?? 'seed',
      ]);
      for (const r of rateio) {
        await exec(c, 'INSERT INTO pa_pagamento_rateio (pagamento_id, lancamento_id, valor) VALUES (?, ?, ?)', [ins.insertId, r.id, r.valor]);
        tocados.add(r.id);
      }
      rel.inseridos.pagamentos++;
    }
    // Recalcula recebido/status dos lançamentos que ganharam rateio agora.
    for (const id of tocados) {
      const l = await one(c, `
        SELECT l.valor, l.status, COALESCE((SELECT SUM(valor) FROM pa_pagamento_rateio WHERE lancamento_id = l.id), 0) AS recebido
        FROM pa_lancamentos l WHERE l.id = ?`, [id]);
      if (!l) continue;
      const recebido = centavos(num(l.recebido));
      await exec(c, 'UPDATE pa_lancamentos SET valor_recebido = ?, status = ? WHERE id = ?', [
        recebido, statusAposRecebimento(num(l.valor), recebido, l.status as StatusLancamento), id,
      ]);
    }

    await exec(c, 'INSERT INTO pa_eventos (projeto_id, usuario_id, tipo, dados) VALUES (?, ?, ?, ?)', [
      projetoId, usuario, 'SEED_IMPORTADO', JSON.stringify({ inseridos: rel.inseridos, atualizados: rel.atualizados, erros: rel.erros.length }),
    ]);
    return { projetoId, loteId, assocId };
  });
  rel.projeto_id = ctx.projetoId;

  // Documentos — fora da transação (até ~124 MB de blob; um por vez).
  const docsExistentes = new Set((await rows(pool, 'SELECT caminho FROM pa_documentos WHERE projeto_id = ?', [ctx.projetoId])).map((x) => String(x.caminho)));
  for (const d of plano.documentos) {
    const lid = ctx.loteId.get(d.lote) ?? null;
    const aid = ctx.assocId.get(d.lote) ?? null;
    let buf: Buffer | null = null;
    try {
      buf = lerArquivo ? await lerArquivo(d.arquivo_rel) : null;
    } catch (err) {
      rel.avisos.push(`arquivo ${d.arquivo_rel}: ${(err as Error).message}`);
    }
    const hash = buf ? sha256(buf) : null;
    const x = await exec(pool, `
      INSERT INTO pa_documentos (projeto_id, lote_id, associado_id, tipo, versao, caminho, nome_original, mime, sha256, tamanho, arquivo_presente)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), lote_id = VALUES(lote_id), associado_id = COALESCE(associado_id, VALUES(associado_id)),
        sha256 = COALESCE(VALUES(sha256), sha256), tamanho = COALESCE(VALUES(tamanho), tamanho),
        arquivo_presente = GREATEST(arquivo_presente, VALUES(arquivo_presente))`, [
      ctx.projetoId, lid, aid, d.tipo, d.caminho, d.nome_original, d.mime, hash, buf ? buf.length : null, buf ? 1 : 0,
    ]);
    if (docsExistentes.has(d.caminho)) rel.atualizados.documentos++; else rel.inseridos.documentos++;
    if (!buf) { rel.arquivos.ausentes++; continue; }
    const atual = await one(pool, 'SELECT d.sha256, (f.documento_id IS NOT NULL) AS tem FROM pa_documentos d LEFT JOIN pa_documentos_arquivos f ON f.documento_id = d.id WHERE d.id = ?', [x.insertId]);
    if (atual && num(atual.tem) === 1 && atual.sha256 === hash) { rel.arquivos.ja_presentes++; continue; }
    await exec(pool, 'INSERT INTO pa_documentos_arquivos (documento_id, conteudo) VALUES (?, ?) ON DUPLICATE KEY UPDATE conteudo = VALUES(conteudo)', [x.insertId, buf]);
    await exec(pool, 'UPDATE pa_documentos SET sha256 = ?, tamanho = ?, arquivo_presente = 1 WHERE id = ?', [hash, buf.length, x.insertId]);
    rel.arquivos.carregados++;
  }
  if (rel.arquivos.ausentes > 0) {
    rel.avisos.push(`${rel.arquivos.ausentes} documento(s) indexado(s) sem arquivo — importe o ACERVO-DIGITAL para carregá-los`);
  }
  return rel;
}

/** Leitor de acervo a partir de uma pasta local (CLI). */
export function leitorPasta(raiz: string): LerArquivo {
  const base = path.resolve(raiz);
  return async (rel) => {
    const alvo = path.resolve(base, rel);
    if (!alvo.startsWith(base + path.sep)) return null;
    return existsSync(alvo) && statSync(alvo).isFile() ? readFileSync(alvo) : null;
  };
}

/**
 * Leitor de acervo a partir de um ZIP (upload pela tela). Aceita o ZIP com ou
 * sem pasta-raiz ("ACERVO-DIGITAL-PA-Salete-Moreno/LOTE-01-…/…"): casa pelo sufixo.
 */
export function leitorZip(arquivoZip: string | Buffer): LerArquivo {
  const zip = new AdmZip(arquivoZip);
  const entradas = zip.getEntries().filter((e) => !e.isDirectory);
  const porNome = new Map<string, AdmZip.IZipEntry>();
  for (const e of entradas) {
    const nome = e.entryName.replace(/\\/g, '/');
    const partes = nome.split('/');
    for (let i = 0; i < partes.length; i++) {
      const suf = partes.slice(i).join('/').normalize('NFC');
      if (!porNome.has(suf)) porNome.set(suf, e);
    }
  }
  return async (rel) => {
    const e = porNome.get(rel.replace(/\\/g, '/').normalize('NFC'));
    return e ? e.getData() : null;
  };
}

export async function contagemProjeto(projetoId: number) {
  const [r] = await rows(pool, `
    SELECT
      (SELECT COUNT(*) FROM pa_lotes WHERE projeto_id = ?) AS lotes,
      (SELECT COUNT(*) FROM pa_associados WHERE projeto_id = ?) AS associados,
      (SELECT COUNT(*) FROM pa_documentos WHERE projeto_id = ?) AS documentos,
      (SELECT COUNT(*) FROM pa_documentos WHERE projeto_id = ? AND arquivo_presente = 1) AS documentos_com_arquivo`, [projetoId, projetoId, projetoId, projetoId]);
  return { lotes: num(r.lotes), associados: num(r.associados), documentos: num(r.documentos), documentos_com_arquivo: num(r.documentos_com_arquivo) };
}
