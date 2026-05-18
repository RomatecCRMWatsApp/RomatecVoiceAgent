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
import { latLonToUtm, isWithinBrazil } from '../services/gnss/coordTransform';

const gnssRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

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
    const p = await obterProcessamento(id);
    if (!p) return res.status(404).json({ error: 'nao encontrado' });
    const validacao = validarRinexParaSubmissao({
      durationSeconds: p.duracao_segundos,
      systems: (p.sistemas_gnss || '').split(',').filter(Boolean),
      antennaHeightM: p.antena_altura_m,
    });
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

    res.json({ processamento: await obterProcessamento(id) });
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

    let pontoId = ponto_id != null ? Number(ponto_id) : null;
    if (criar_novo || pontoId == null) {
      const [r] = await pool.execute<import('mysql2').ResultSetHeader>(
        `INSERT INTO laudos_demarcacao_pontos
           (laudo_id, ordem, rotulo, utm_zona, utm_hemisferio, utm_e, utm_n,
            lat_decimal, long_decimal, altitude, tempo_rastreio_seg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.laudo_id, Number(ordem ?? 1), (rotulo ?? p.rotulo).toString().slice(0, 50),
         utmZ, utmH, utmE, utmN, lat, lon, alt, p.duracao_segundos]
      );
      pontoId = r.insertId;
    } else {
      await pool.execute(
        `UPDATE laudos_demarcacao_pontos SET
            utm_zona = ?, utm_hemisferio = ?, utm_e = ?, utm_n = ?,
            lat_decimal = ?, long_decimal = ?, altitude = ?, tempo_rastreio_seg = ?
          WHERE id = ? AND laudo_id = ?`,
        [utmZ, utmH, utmE, utmN, lat, lon, alt, p.duracao_segundos, pontoId, p.laudo_id]
      );
    }
    await atualizarProcessamento(id, { ponto_id: pontoId });
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
    res.json({ processamento: await obterProcessamento(id) });
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
    res.json({ processamento: await obterProcessamento(id) });
  } catch (err) { res.status(500).json({ error: (err as Error).message }); }
});

export default gnssRouter;
