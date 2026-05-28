// v3.31.0: middleware multer pra upload de planta de quadra. Aceita ate 3
// arquivos (dxf, dwg, pdf) em um unico request multipart/form-data.
//
// Estrategia: memory storage (buffer em RAM) — limite total controlado pelo
// somatorio dos 3 limites. Validacao de magic bytes acontece no caller
// (rota), nao aqui — multer fica responsavel apenas por tamanho/mime ampla.

import multer from 'multer';
import { LIMITES_BYTES } from '../services/quadraPlantaStorage';

const MIME_DXF = new Set([
  'application/dxf',
  'image/vnd.dxf',
  'text/plain',
  'application/octet-stream', // DXF binario ou clientes desinformados
]);
const MIME_DWG = new Set([
  'application/acad',
  'image/vnd.dwg',
  'application/x-acad',
  'application/octet-stream',
]);
const MIME_PDF = new Set(['application/pdf']);

const maxLimite = Math.max(LIMITES_BYTES.dxf, LIMITES_BYTES.dwg, LIMITES_BYTES.pdf);

export const uploadPlantaMulter = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxLimite, // global — checagem por-formato no caller
    files: 3,
  },
  fileFilter: (_req, file, cb) => {
    // Aceita ampla por field name + mime. Magic bytes validados no caller
    // pra dar erro descritivo (multer rejection vira generic 500).
    const f = file.fieldname.toLowerCase();
    if (f === 'dxf' && (MIME_DXF.has(file.mimetype) || /\.dxf$/i.test(file.originalname))) return cb(null, true);
    if (f === 'dwg' && (MIME_DWG.has(file.mimetype) || /\.dwg$/i.test(file.originalname))) return cb(null, true);
    if (f === 'pdf' && (MIME_PDF.has(file.mimetype) || /\.pdf$/i.test(file.originalname))) return cb(null, true);
    cb(new Error(`Arquivo ${file.fieldname} com mime/extensao invalida: ${file.mimetype} / ${file.originalname}`));
  },
}).fields([
  { name: 'dxf', maxCount: 1 },
  { name: 'dwg', maxCount: 1 },
  { name: 'pdf', maxCount: 1 },
]);
