// src/routes/gnss.ts
// v3.18.0: Rotas REST para processamento GNSS. Padrao identico ao
// arquivosVetoriaisService — multer memoryStorage, sha256 por arquivo,
// soft delete via coluna `ativo`.

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import pool from '../database/connection';
import {
  criarProcessamento, obterProcessamento, listarProcessamentos,
  atualizarProcessamento, inserirArquivo, listarArquivos,
  obterConteudoArquivo, inativarArquivo, calcularSha256, sanitizarNome,
  type GnssFonte, type GnssArquivoPapel,
} from '../integrations/gnss';
import {
  parseRinexHeader, parseIbgeResultTxt, parseKmlPoint, parseIbgePos,
  classificarPapelRinex, classificarPapelRetornoIbge,
  validarRinexParaSubmissao,
} from '../services/gnss/processamentoService';
import { empacotarParaIbge, desempacotarRetornoIbge } from '../services/gnss/ibgePppPackager';
import { latLonToUtm, isWithinBrazil, decimalToDms } from '../services/gnss/coordTransform';
import type { ProcessamentoGnss } from '../integrations/gnss';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

const gnssRouter = Router();

// v3.18.1: limite por arquivo 100 MB — RINEX obs de sessoes longas (>2h) com
// alta taxa de amostragem (1 Hz) e multiplos sistemas (GPS+GLO+GAL) facilmente
// passa de 25 MB. ZIP de retorno do IBGE-PPP tambem pode crescer com PDF gerado.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 10 },
});

// v3.18.1: handler de erro do multer pra devolver mensagem util (em vez de 500
// generico do Express default error handler). Aplicado a TODAS as rotas que
// usam `upload.array(...)` mais abaixo.
import type { NextFunction } from 'express';
function multerErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction) {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'arquivo muito grande (limite 100 MB por arquivo). Para RINEX maiores, comprima em .zip antes de enviar.',
      });
    }
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `multer: ${code}` });
    }
  }
  return next(err);
}

// v3.19.0: Auto-aplica os dados de uma sessao GNSS processada em um vertice
// do laudo. Se a sessao ainda nao tem ponto_id vinculado, cria um NOVO vertice
// com a proxima ordem disponivel (MAX(ordem)+1). Se ja tem, ATUALIZA o
// existente — idempotente, re-importacao do retorno IBGE nao duplica vertices.
async function autoAplicarEmVertice(p: ProcessamentoGnss): Promise<number | null> {
  if (!p.laudo_id || p.latitude_graus == null || p.longitude_graus == null) return null;
  const lat = Number(p.latitude_graus);
  const lon = Number(p.longitude_graus);
  const latGms = decimalToDms(lat, 'N', 'S');
  const lonGms = decimalToDms(lon, 'E', 'W');

  if (p.ponto_id) {
    // UPDATE — sessao ja vinculada a um vertice (re-importacao)
    await pool.execute(
      `UPDATE laudos_demarcacao_pontos SET
         utm_zona = ?, utm_hemisferio = ?, utm_e = ?, utm_n = ?,
         lat_decimal = ?, long_decimal = ?, lat_gms = ?, long_gms = ?,
         altitude = ?, tempo_rastreio_seg = ?
       WHERE id = ? AND laudo_id = ?`,
      [p.utm_zona, p.utm_hemisferio, p.utm_leste_m, p.utm_norte_m,
       lat, lon, latGms, lonGms,
       p.altitude_ortometrica_m, p.duracao_segundos,
       p.ponto_id, p.laudo_id]
    );
    return p.ponto_id;
  }

  // INSERT — calcula proxima ordem
  const [maxRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(ordem), 0) + 1 AS prox FROM laudos_demarcacao_pontos WHERE laudo_id = ?`,
    [p.laudo_id]
  );
  const proximaOrdem = Number(maxRows[0]?.prox ?? 1);
  const descricao = p.fonte === 'rinex_ibge'
    ? `GNSS PPP IBGE — ${p.rotulo}`
    : (p.fonte === 'ppp_manual' ? `PPP externo — ${p.rotulo}` : p.rotulo);

  const [ins] = await pool.execute<ResultSetHeader>(
    `INSERT INTO laudos_demarcacao_pontos
       (laudo_id, ordem, rotulo, utm_zona, utm_hemisferio, utm_e, utm_n,
        lat_decimal, long_decimal, lat_gms, long_gms, altitude,
        descricao_marco, tempo_rastreio_seg)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.laudo_id, proximaOrdem, p.rotulo,
     p.utm_zona, p.utm_hemisferio, p.utm_leste_m, p.utm_norte_m,
     lat, lon, latGms, lonGms,
     p.altitude_ortometrica_m,
     descricao,
     p.duracao_segundos]
  );
  await atualizarProcessamento(p.id!, { ponto_id: ins.insertId });
  return ins.insertId;
}

// v3.19.0: Auto-preenche os campos GNSS da base no laudo (base_nome,
// base_inicio_rastreio, base_fim_rastreio, base_observacoes) — SO se ainda
// estiverem vazios. Nao sobrescreve entrada manual do usuario.
async function autoPreencherBaseGnssNoLaudo(p: ProcessamentoGnss): Promise<void> {
  if (!p.laudo_id) return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT base_nome, base_inicio_rastreio, base_fim_rastreio, base_observacoes
       FROM laudos_demarcacao WHERE id = ?`,
    [p.laudo_id]
  );
  if (!rows.length) return;
  const l = rows[0];

  const sets: string[] = [];
  const vals: (string | Date | number | null)[] = [];
  if (!l.base_nome && p.receptor_modelo) {
    sets.push('base_nome = ?');
    vals.push(p.receptor_modelo);
  }
  if (!l.base_inicio_rastreio && p.inicio_rastreio) {
    sets.push('base_inicio_rastreio = ?');
    vals.push(p.inicio_rastreio);
  }
  if (!l.base_fim_rastreio && p.fim_rastreio) {
    sets.push('base_fim_rastreio = ?');
    vals.push(p.fim_rastreio);
  }
  if (!l.base_observacoes) {
    const fonteLabel = p.fonte === 'rinex_ibge' ? 'Pos-processado IBGE-PPP'
      : (p.fonte === 'ppp_manual' ? 'Pos-processado PPP (externo)' : 'GNSS');
    const obs = [
      fonteLabel,
      p.ref_geodesico || 'SIRGAS2000',
      p.modelo_geoidal || null,
      p.sistemas_gnss || null,
    ].filter(Boolean).join(' — ');
    sets.push('base_observacoes = ?');
    vals.push(obs);
  }

  if (sets.length) {
    vals.push(p.laudo_id);
    await pool.execute(
      `UPDATE laudos_demarcacao SET ${sets.join(', ')} WHERE id = ?`,
      vals
    );
  }
}

// POST /api/gnss/processamentos
//   body: { rotulo, fonte, laudo_id? }
gnssRouter.post('/processamentos', async (req: Request, res: Response) => {
  try {
    const { rotulo, fonte, laudo_id } = req.body || {};
    if (!rotulo || typeof rotulo !== 'string') return res.status(400).json({ error: 'rotulo obrigatorio' });
    const fontes: GnssFonte[] = ['rinex_ibge', 'ppp_manual', 'rtk_csv', 'outro'];
    if (!fontes.includes(fonte)) return res.status(400).json({ error: 'fonte invalida' });
    const id = await criarProcessamento({
      rotulo: rotulo.trim().slice(0, 50),
      fonte,
      laudo_id: laudo_id != null ? Number(laudo_id) : null,
    });
    const p = await obterProcessamento(id);
    res.status(201).json(p);
  } catch (err) {
    console.error('[gnss] POST /processamentos:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/gnss/processamentos/:id
gnssRouter.get('/processamentos/:id', async (req: Request, res: Response) => {
  try {
    const p = await obterProcessamento(Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'nao encontrado' });
    const arquivos = await listarArquivos(p.id!, { soAtivos: true });
    res.json({ ...p, arquivos });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.19.1: DELETE /api/gnss/processamentos/:id
// Hard delete da sessao + arquivos (cascata via FK ON DELETE CASCADE).
// Query opcional ?apagar_vertice=1 tambem apaga o vertice vinculado (auto-criado).
gnssRouter.delete('/processamentos/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const apagarVertice = req.query.apagar_vertice === '1';
    const p = await obterProcessamento(id);
    if (!p) return res.status(404).json({ error: 'nao encontrado' });

    let verticeApagado: number | null = null;
    if (apagarVertice && p.ponto_id && p.laudo_id) {
      const [r] = await pool.execute<ResultSetHeader>(
        `DELETE FROM laudos_demarcacao_pontos WHERE id = ? AND laudo_id = ?`,
        [p.ponto_id, p.laudo_id]
      );
      if (r.affectedRows > 0) verticeApagado = p.ponto_id;
    }
    // Arquivos sao apagados em cascata pela FK ON DELETE CASCADE
    await pool.execute(`DELETE FROM processamentos_gnss WHERE id = ?`, [id]);
    res.json({ ok: true, vertice_apagado: verticeApagado });
  } catch (err) {
    console.error('[gnss] DELETE /processamentos/:id:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/gnss/processamentos?laudo_id=...&status=...
gnssRouter.get('/processamentos', async (req: Request, res: Response) => {
  try {
    const laudo_id = req.query.laudo_id ? Number(req.query.laudo_id) : undefined;
    const status = req.query.status as any;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const lista = await listarProcessamentos({ laudo_id, status, limit, offset });
    res.json(lista);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST /api/gnss/processamentos/:id/arquivos
//   multipart: arquivos (1..N)
gnssRouter.post('/processamentos/:id/arquivos', upload.array('arquivos'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const p = await obterProcessamento(id);
    if (!p) return res.status(404).json({ error: 'processamento nao encontrado' });
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: 'nenhum arquivo' });
    const out: number[] = [];
    for (const f of files) {
      const papelRequested = (req.body.papel || '').toString();
      const papel: GnssArquivoPapel = papelRequested
        ? (papelRequested as GnssArquivoPapel)
        : (classificarPapelRinex(f.originalname) ||
           classificarPapelRetornoIbge(f.originalname) ||
           'outro');
      const sha = calcularSha256(f.buffer);
      const armazenado = sha.slice(0, 8) + '_' + sanitizarNome(f.originalname);
      const newId = await inserirArquivo({
        processamento_id: id,
        papel,
        nome_original: f.originalname,
        nome_armazenado: armazenado,
        tamanho_bytes: f.size,
        mime_type: f.mimetype || 'application/octet-stream',
        sha256: sha,
        conteudo: f.buffer,
      });
      out.push(newId);
    }
    res.status(201).json({ ids: out });
  } catch (err) {
    console.error('[gnss] POST /processamentos/:id/arquivos:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/gnss/processamentos/:id/arquivos/:arquivoId
gnssRouter.delete('/processamentos/:id/arquivos/:arquivoId', async (req: Request, res: Response) => {
  try {
    await inativarArquivo(Number(req.params.arquivoId));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST /api/gnss/processamentos/:id/parse-rinex
gnssRouter.post('/processamentos/:id/parse-rinex', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const arquivos = await listarArquivos(id, { papel: 'rinex_obs', soAtivos: true });
    const rnx3 = await listarArquivos(id, { papel: 'rinex_rnx3', soAtivos: true });
    const obs = arquivos[0] ?? rnx3[0];
    if (!obs) return res.status(400).json({ error: 'nenhum arquivo de observacao carregado' });
    const conteudo = await obterConteudoArquivo(obs.id!);
    if (!conteudo) return res.status(500).json({ error: 'conteudo nao encontrado' });
    const header = parseRinexHeader(conteudo.conteudo.toString('utf8'));
    // Preenche metadados no processamento
    await atualizarProcessamento(id, {
      inicio_rastreio: header.timeFirstObs ?? null,
      fim_rastreio: header.timeLastObs ?? null,
      duracao_segundos: header.durationSeconds ?? null,
      intervalo_amostragem_s: header.intervalSeconds ?? null,
      receptor_modelo: header.receiverModel ?? null,
      receptor_serial: header.receiverSerial ?? null,
      antena_modelo: header.antennaModel ?? null,
      antena_altura_m: header.antennaHeightM ?? null,
      sistemas_gnss: header.systems.join(',') || null,
    });
    const todos = await listarArquivos(id, { soAtivos: true });
    const validacao = validarRinexParaSubmissao({
      durationSeconds: header.durationSeconds,
      systems: header.systems,
      antennaHeightM: header.antennaHeightM,
      papeisCarregados: todos.map(a => a.papel),
    });
    res.json({ header, validacao });
  } catch (err) {
    console.error('[gnss] parse-rinex:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/gnss/processamentos/:id/empacotar-ibge
gnssRouter.post('/processamentos/:id/empacotar-ibge', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    let p = await obterProcessamento(id);
    if (!p) return res.status(404).json({ error: 'nao encontrado' });
    let validacao = validarRinexParaSubmissao({
      durationSeconds: p.duracao_segundos,
      systems: (p.sistemas_gnss || '').split(',').filter(Boolean),
      antennaHeightM: p.antena_altura_m,
    });

    // v3.18.2: se duracao_segundos esta nula, refaz o parse — o parser atual
    // tem fallback de body scan que cobre receptores (ComNav/CHC) que nao
    // escrevem TIME OF LAST OBS no header. Auto-cura sessoes criadas com
    // versoes anteriores do parser.
    if (validacao.bloqueia && p.duracao_segundos == null) {
      const obsList = await listarArquivos(id, { papel: 'rinex_obs', soAtivos: true });
      const rnx3List = obsList.length ? [] : await listarArquivos(id, { papel: 'rinex_rnx3', soAtivos: true });
      const obsMeta = obsList[0] ?? rnx3List[0];
      if (obsMeta) {
        const c = await obterConteudoArquivo(obsMeta.id!);
        if (c) {
          const header = parseRinexHeader(c.conteudo.toString('utf8'));
          if (header.timeFirstObs && header.timeLastObs) {
            await atualizarProcessamento(id, {
              inicio_rastreio: header.timeFirstObs,
              fim_rastreio: header.timeLastObs,
              duracao_segundos: header.durationSeconds,
              intervalo_amostragem_s: header.intervalSeconds,
              receptor_modelo: header.receiverModel,
              receptor_serial: header.receiverSerial,
              antena_modelo: header.antennaModel,
              sistemas_gnss: header.systems.join(',') || null,
            });
            p = (await obterProcessamento(id))!;
            validacao = validarRinexParaSubmissao({
              durationSeconds: p.duracao_segundos,
              systems: (p.sistemas_gnss || '').split(',').filter(Boolean),
              antennaHeightM: p.antena_altura_m,
            });
          }
        }
      }
    }

    if (validacao.bloqueia) return res.status(400).json({ error: 'validacao bloqueante', validacao });
    const papeis: GnssArquivoPapel[] = ['rinex_obs','rinex_nav_gps','rinex_nav_glo','rinex_nav_gal','rinex_nav_bds','rinex_rnx3'];
    const arquivos: Array<{ nome: string; conteudo: Buffer }> = [];
    for (const papel of papeis) {
      const lista = await listarArquivos(id, { papel, soAtivos: true });
      for (const meta of lista) {
        const c = await obterConteudoArquivo(meta.id!);
        if (c) arquivos.push({ nome: meta.nome_original, conteudo: c.conteudo });
      }
    }
    if (!arquivos.length) return res.status(400).json({ error: 'nenhum RINEX carregado' });
    const zipBuf = empacotarParaIbge(arquivos);
    const sha = calcularSha256(zipBuf);
    const nomeZip = `IBGE_PPP_${p.rotulo}_${Date.now()}.zip`;
    const arqId = await inserirArquivo({
      processamento_id: id,
      papel: 'ibge_zip_envio',
      nome_original: nomeZip,
      nome_armazenado: sha.slice(0, 8) + '_' + sanitizarNome(nomeZip),
      tamanho_bytes: zipBuf.length,
      mime_type: 'application/zip',
      sha256: sha,
      conteudo: zipBuf,
    });
    await atualizarProcessamento(id, { status: 'aguardando_submissao_ibge' });
    res.json({ arquivo_id: arqId, validacao, download_url: `/api/gnss/arquivos/${arqId}/download` });
  } catch (err) {
    console.error('[gnss] empacotar-ibge:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/gnss/arquivos/:arquivoId/download — interno (auth requerido upstream)
gnssRouter.get('/arquivos/:arquivoId/download', async (req: Request, res: Response) => {
  try {
    const r = await obterConteudoArquivo(Number(req.params.arquivoId));
    if (!r) return res.status(404).end();
    res.setHeader('Content-Type', r.meta.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${r.meta.nome_original}"`);
    res.send(r.conteudo);
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST /api/gnss/processamentos/:id/parse-ibge-retorno
//   multipart: arquivo (.zip) OU arquivos individuais (.txt/.pdf/.kml/.pos)
gnssRouter.post('/processamentos/:id/parse-ibge-retorno', upload.array('arquivos'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const p = await obterProcessamento(id);
    if (!p) return res.status(404).json({ error: 'nao encontrado' });
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: 'envie .zip de retorno ou arquivos avulsos' });

    const arquivosExtraidos: Array<{ nome: string; conteudo: Buffer }> = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.originalname)) {
        const sha = calcularSha256(f.buffer);
        await inserirArquivo({
          processamento_id: id, papel: 'ibge_zip_retorno',
          nome_original: f.originalname,
          nome_armazenado: sha.slice(0, 8) + '_' + sanitizarNome(f.originalname),
          tamanho_bytes: f.size, mime_type: f.mimetype || 'application/zip',
          sha256: sha, conteudo: f.buffer,
        });
        for (const e of desempacotarRetornoIbge(f.buffer)) arquivosExtraidos.push(e);
      } else {
        arquivosExtraidos.push({ nome: f.originalname, conteudo: f.buffer });
      }
    }

    let txtBuf: Buffer | null = null, kmlBuf: Buffer | null = null, posBuf: Buffer | null = null;
    for (const ext of arquivosExtraidos) {
      const papel = classificarPapelRetornoIbge(ext.nome);
      if (!papel) continue;
      const sha = calcularSha256(ext.conteudo);
      await inserirArquivo({
        processamento_id: id, papel,
        nome_original: ext.nome,
        nome_armazenado: sha.slice(0, 8) + '_' + sanitizarNome(ext.nome),
        tamanho_bytes: ext.conteudo.length,
        mime_type: papel === 'ibge_pdf' ? 'application/pdf'
          : papel === 'ibge_kml' ? 'application/vnd.google-earth.kml+xml'
          : 'text/plain',
        sha256: sha, conteudo: ext.conteudo,
      });
      if (papel === 'ibge_txt') txtBuf = ext.conteudo;
      if (papel === 'ibge_kml') kmlBuf = ext.conteudo;
      if (papel === 'ibge_pos') posBuf = ext.conteudo;
    }

    if (!txtBuf) return res.status(400).json({ error: 'relatorio .txt nao encontrado no pacote' });
    const result = parseIbgeResultTxt(txtBuf);
    if (!result.latitudeGraus || !result.longitudeGraus) {
      return res.status(400).json({ error: 'nao foi possivel parsear coordenadas do .txt' });
    }
    if (!isWithinBrazil(result.latitudeGraus, result.longitudeGraus)) {
      return res.status(400).json({ error: 'coordenadas fora do territorio brasileiro — confira o arquivo' });
    }

    // Cross-check com KML (se houver)
    if (kmlBuf) {
      const kml = parseKmlPoint(kmlBuf.toString('utf8'));
      if (kml && (Math.abs(kml.latitude - result.latitudeGraus) > 1e-4 || Math.abs(kml.longitude - result.longitudeGraus) > 1e-4)) {
        console.warn('[gnss] cross-check TXT vs KML divergente em > 11m');
      }
    }

    // POS — atualiza numEpocas
    let numEpocas: number | null = null;
    if (posBuf) numEpocas = parseIbgePos(posBuf.toString('utf8')).numEpocas;

    // Garante UTM por proj4 (caso o TXT esteja incompleto)
    if (result.utmNorteM == null || result.utmLesteM == null) {
      const u = latLonToUtm(result.latitudeGraus, result.longitudeGraus, result.utmZona ?? undefined);
      result.utmLesteM = u.utmLeste;
      result.utmNorteM = u.utmNorte;
      result.utmZona = u.zona;
      result.utmHemisferio = u.hemisferio;
      result.utmMc = u.mc;
    }

    await atualizarProcessamento(id, {
      status: 'processado',
      processado_at: new Date(),
      latitude_graus: result.latitudeGraus,
      longitude_graus: result.longitudeGraus,
      altitude_geometrica_m: result.altitudeGeometricaM,
      altitude_ortometrica_m: result.altitudeOrtometricaM,
      modelo_geoidal: result.modeloGeoidal,
      utm_norte_m: result.utmNorteM,
      utm_leste_m: result.utmLesteM,
      utm_zona: result.utmZona,
      utm_hemisferio: result.utmHemisferio,
      utm_mc: result.utmMc,
      sigma_lat_m: result.sigmaLatM,
      sigma_lon_m: result.sigmaLonM,
      sigma_alt_m: result.sigmaAltM,
      num_epocas: numEpocas,
      ref_geodesico: result.refGeodesico,
    });

    // v3.19.0: auto-aplica em vertice + auto-preenche base GNSS do laudo
    const pAtualizado = await obterProcessamento(id);
    let pontoIdAplicado: number | null = null;
    if (pAtualizado?.laudo_id) {
      try {
        pontoIdAplicado = await autoAplicarEmVertice(pAtualizado);
        await autoPreencherBaseGnssNoLaudo(pAtualizado);
      } catch (autoErr) {
        console.warn('[gnss] auto-aplicar falhou (nao bloqueante):', (autoErr as Error).message);
      }
    }
    res.json({
      processamento: pontoIdAplicado ? await obterProcessamento(id) : pAtualizado,
      ponto_id_aplicado: pontoIdAplicado,
    });
  } catch (err) {
    console.error('[gnss] parse-ibge-retorno:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/gnss/processamentos/:id/vincular-laudo  body: { laudo_id }
gnssRouter.post('/processamentos/:id/vincular-laudo', async (req: Request, res: Response) => {
  try {
    await atualizarProcessamento(Number(req.params.id), { laudo_id: Number(req.body.laudo_id) });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// POST /api/gnss/processamentos/:id/aplicar-em-ponto
//   body: { ponto_id?, criar_novo?, ordem?, rotulo? }
gnssRouter.post('/processamentos/:id/aplicar-em-ponto', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const p = await obterProcessamento(id);
    if (!p) return res.status(404).json({ error: 'nao encontrado' });
    if (p.status !== 'processado') return res.status(400).json({ error: 'processamento nao concluido' });
    if (!p.laudo_id) return res.status(400).json({ error: 'processamento sem laudo vinculado' });
    const { ponto_id, criar_novo, ordem, rotulo } = req.body || {};

    const lat = p.latitude_graus, lon = p.longitude_graus;
    const alt = p.altitude_ortometrica_m;
    const utmZ = p.utm_zona, utmH = p.utm_hemisferio, utmE = p.utm_leste_m, utmN = p.utm_norte_m;
    // v3.19.0: tambem grava lat_gms / long_gms (graus°min'seg") pra tabela
    // de vertices do PDF
    const latGms = lat != null ? decimalToDms(Number(lat), 'N', 'S') : null;
    const lonGms = lon != null ? decimalToDms(Number(lon), 'E', 'W') : null;

    let pontoId = ponto_id != null ? Number(ponto_id) : null;
    if (criar_novo || pontoId == null) {
      const [r] = await pool.execute<ResultSetHeader>(
        `INSERT INTO laudos_demarcacao_pontos
           (laudo_id, ordem, rotulo, utm_zona, utm_hemisferio, utm_e, utm_n,
            lat_decimal, long_decimal, lat_gms, long_gms, altitude, tempo_rastreio_seg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.laudo_id, Number(ordem ?? 1), (rotulo ?? p.rotulo).toString().slice(0, 50),
         utmZ, utmH, utmE, utmN, lat, lon, latGms, lonGms, alt, p.duracao_segundos]
      );
      pontoId = r.insertId;
    } else {
      await pool.execute(
        `UPDATE laudos_demarcacao_pontos SET
            utm_zona = ?, utm_hemisferio = ?, utm_e = ?, utm_n = ?,
            lat_decimal = ?, long_decimal = ?, lat_gms = ?, long_gms = ?,
            altitude = ?, tempo_rastreio_seg = ?
          WHERE id = ? AND laudo_id = ?`,
        [utmZ, utmH, utmE, utmN, lat, lon, latGms, lonGms, alt, p.duracao_segundos, pontoId, p.laudo_id]
      );
    }
    await atualizarProcessamento(id, { ponto_id: pontoId });
    // v3.19.0: tambem preenche metadados GNSS do laudo (base_*) se vazios
    try { await autoPreencherBaseGnssNoLaudo({ ...p, ponto_id: pontoId }); } catch (e) {
      console.warn('[gnss] auto-preencher base falhou (nao bloqueante):', (e as Error).message);
    }
    res.json({ ok: true, ponto_id: pontoId });
  } catch (err) {
    console.error('[gnss] aplicar-em-ponto:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/gnss/processamentos/:id/parse-ppp-externo
//   multipart: arquivos (.txt/.kml/.pos/.pdf de outro software)
gnssRouter.post('/processamentos/:id/parse-ppp-externo', upload.array('arquivos'), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: 'nenhum arquivo' });
    let parsed = false;
    for (const f of files) {
      const sha = calcularSha256(f.buffer);
      let papel: GnssArquivoPapel = 'outro';
      if (/\.txt$/i.test(f.originalname)) papel = 'ibge_txt';     // reusa parser
      else if (/\.kml$/i.test(f.originalname)) papel = 'ppp_externo_kml';
      else if (/\.pos$/i.test(f.originalname)) papel = 'ppp_externo_pos';
      else if (/\.pdf$/i.test(f.originalname)) papel = 'ppp_externo_pdf';
      await inserirArquivo({
        processamento_id: id, papel,
        nome_original: f.originalname,
        nome_armazenado: sha.slice(0, 8) + '_' + sanitizarNome(f.originalname),
        tamanho_bytes: f.size, mime_type: f.mimetype || 'application/octet-stream',
        sha256: sha, conteudo: f.buffer,
      });
      if (papel === 'ibge_txt' && !parsed) {
        const r = parseIbgeResultTxt(f.buffer);
        if (r.latitudeGraus && r.longitudeGraus) {
          const utm = (r.utmLesteM != null && r.utmNorteM != null && r.utmZona)
            ? null : latLonToUtm(r.latitudeGraus, r.longitudeGraus);
          await atualizarProcessamento(id, {
            status: 'processado', processado_at: new Date(),
            fonte: 'ppp_manual',
            latitude_graus: r.latitudeGraus, longitude_graus: r.longitudeGraus,
            altitude_geometrica_m: r.altitudeGeometricaM,
            altitude_ortometrica_m: r.altitudeOrtometricaM,
            modelo_geoidal: r.modeloGeoidal,
            utm_zona: r.utmZona ?? utm?.zona ?? null,
            utm_hemisferio: r.utmHemisferio ?? utm?.hemisferio ?? null,
            utm_leste_m: r.utmLesteM ?? utm?.utmLeste ?? null,
            utm_norte_m: r.utmNorteM ?? utm?.utmNorte ?? null,
            utm_mc: r.utmMc ?? utm?.mc ?? null,
            sigma_lat_m: r.sigmaLatM, sigma_lon_m: r.sigmaLonM, sigma_alt_m: r.sigmaAltM,
            ref_geodesico: r.refGeodesico,
          });
          parsed = true;
        }
      }
    }
    if (!parsed) return res.status(400).json({ error: 'nenhum .txt valido encontrado para preencher coordenadas' });

    // v3.19.0: auto-aplica em vertice + auto-preenche base GNSS do laudo
    const pAtualizado = await obterProcessamento(id);
    let pontoIdAplicado: number | null = null;
    if (pAtualizado?.laudo_id) {
      try {
        pontoIdAplicado = await autoAplicarEmVertice(pAtualizado);
        await autoPreencherBaseGnssNoLaudo(pAtualizado);
      } catch (autoErr) {
        console.warn('[gnss] auto-aplicar falhou (nao bloqueante):', (autoErr as Error).message);
      }
    }
    res.json({
      processamento: pontoIdAplicado ? await obterProcessamento(id) : pAtualizado,
      ponto_id_aplicado: pontoIdAplicado,
    });
  } catch (err) {
    console.error('[gnss] parse-ppp-externo:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/gnss/processamentos/:id/manual  body: { latitude, longitude, altitude, ... }
gnssRouter.post('/processamentos/:id/manual', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { latitude, longitude, altitude_ortometrica_m, altitude_geometrica_m } = req.body || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'latitude e longitude obrigatorias' });
    }
    if (!isWithinBrazil(latitude, longitude)) {
      return res.status(400).json({ error: 'coordenadas fora do Brasil' });
    }
    const u = latLonToUtm(latitude, longitude);
    await atualizarProcessamento(id, {
      status: 'processado', processado_at: new Date(),
      fonte: 'outro',
      latitude_graus: latitude, longitude_graus: longitude,
      altitude_geometrica_m: altitude_geometrica_m ?? null,
      altitude_ortometrica_m: altitude_ortometrica_m ?? null,
      utm_zona: u.zona, utm_hemisferio: u.hemisferio,
      utm_leste_m: u.utmLeste, utm_norte_m: u.utmNorte, utm_mc: u.mc,
      ref_geodesico: 'SIRGAS2000',
    });

    // v3.19.0: auto-aplica em vertice + auto-preenche base GNSS do laudo
    const pAtualizado = await obterProcessamento(id);
    let pontoIdAplicado: number | null = null;
    if (pAtualizado?.laudo_id) {
      try {
        pontoIdAplicado = await autoAplicarEmVertice(pAtualizado);
        await autoPreencherBaseGnssNoLaudo(pAtualizado);
      } catch (autoErr) {
        console.warn('[gnss] auto-aplicar falhou (nao bloqueante):', (autoErr as Error).message);
      }
    }
    res.json({
      processamento: pontoIdAplicado ? await obterProcessamento(id) : pAtualizado,
      ponto_id_aplicado: pontoIdAplicado,
    });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

// v3.18.1: error middleware do router — captura erros do multer (LIMIT_FILE_SIZE
// etc.) e devolve 413/400 com mensagem util. Deve ser o ULTIMO middleware do router.
gnssRouter.use(multerErrorHandler);

export default gnssRouter;
