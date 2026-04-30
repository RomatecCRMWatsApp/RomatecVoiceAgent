// Meeting Note-Taker (v1.42.0 - Frente E)
//
// Recebe transcrição de uma reunião (gravada como áudio do Telegram ou já em
// texto), passa pro Claude com prompt estruturado e extrai:
//   - Resumo executivo
//   - Decisões tomadas
//   - Action items (com responsável quando mencionado)
//   - Datas/prazos mencionados
//   - Pessoas envolvidas
//
// Salva no banco (romatec_atas_reuniao) e retorna ata formatada em Markdown.

import Anthropic from '@anthropic-ai/sdk';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import pool from '../database/connection';
import { transcribeAudio } from '../agent/transcribe';

const CLAUDE_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';
const _claude = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

export interface AtaItem {
  descricao:    string;
  responsavel?: string;
  prazo?:       string;
  contexto?:    string;
}

export interface AtaReuniao {
  id?:                  string;
  titulo:               string;
  data_reuniao:         string;            // ISO YYYY-MM-DD
  resumo_executivo:     string;
  decisoes:             string[];
  action_items:         AtaItem[];
  datas_mencionadas:    Array<{ data: string; descricao: string }>;
  pessoas_mencionadas:  string[];
  topicos_principais:   string[];
  pontos_atencao:       string[];          // riscos, divergências, pendências
  transcricao_completa: string;
  duracao_segundos?:    number;
  criado_em?:           string;
}

interface ClaudeAtaJson {
  titulo:              string;
  resumo_executivo:    string;
  decisoes:            string[];
  action_items:        AtaItem[];
  datas_mencionadas:   Array<{ data: string; descricao: string }>;
  pessoas_mencionadas: string[];
  topicos_principais:  string[];
  pontos_atencao:      string[];
}

const PROMPT_ATA = `Você é uma assistente executiva da Romatec Consultoria que está estruturando uma ata de reunião a partir de uma transcrição.

A transcrição vem de áudio capturado por celular, então pode ter ruído, pausas, repetições e erros menores. Limpe ao estruturar.

Retorne APENAS um objeto JSON válido (sem markdown, sem comentários, sem explicações ao redor) com a seguinte estrutura:

{
  "titulo": "string curto identificando o assunto principal (max 80 chars)",
  "resumo_executivo": "parágrafo de 3-5 linhas sintetizando o que foi discutido e os outcomes principais",
  "decisoes": ["string 1", "string 2", ...],
  "action_items": [
    { "descricao": "o que fazer", "responsavel": "quem (se mencionado)", "prazo": "data ou descrição", "contexto": "opcional" }
  ],
  "datas_mencionadas": [
    { "data": "YYYY-MM-DD ou descrição se incompleta", "descricao": "do que se trata" }
  ],
  "pessoas_mencionadas": ["nome 1", "nome 2"],
  "topicos_principais": ["tópico 1", "tópico 2"],
  "pontos_atencao": ["risco/divergência/pendência identificada"]
}

REGRAS:
- Se algum campo não tem dado, retorne array vazio [] (não null, não omita).
- Nomes de pessoas: capture sobrenome se mencionado.
- Datas: use YYYY-MM-DD quando a transcrição der info clara. Se for relativa ("próxima sexta", "daqui 3 meses"), use a descrição literal.
- Action items: foque em compromissos REAIS (não suposições). Se não houver responsável claro, deixe campo vazio.
- Não invente dados. Se a transcrição é vaga, retorne menos itens em vez de inferir.
- Use português brasileiro formal mas direto.

TRANSCRIÇÃO DA REUNIÃO:
`;

async function extrairEstruturaDaTranscricao(transcricao: string, dataReuniao: string): Promise<ClaudeAtaJson> {
  if (!_claude) throw new Error('ANTHROPIC_API_KEY não configurada — necessário pra estruturar ata');
  if (transcricao.trim().length < 50) throw new Error('Transcrição muito curta pra extrair ata significativa (<50 chars)');

  const prompt = `${PROMPT_ATA}\n[Data da reunião: ${dataReuniao}]\n\n${transcricao}`;
  const r = await _claude.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 4000,
    messages:   [{ role: 'user', content: prompt }],
  });
  const textBlock = r.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  let raw = (textBlock?.text || '').trim();

  // Remove eventuais ```json ... ``` se Claude usou markdown apesar do pedido
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

  let parsed: ClaudeAtaJson;
  try {
    parsed = JSON.parse(raw) as ClaudeAtaJson;
  } catch {
    throw new Error(`Claude retornou JSON inválido. Início: ${raw.slice(0, 200)}…`);
  }
  // Defaults seguros
  parsed.decisoes ||= [];
  parsed.action_items ||= [];
  parsed.datas_mencionadas ||= [];
  parsed.pessoas_mencionadas ||= [];
  parsed.topicos_principais ||= [];
  parsed.pontos_atencao ||= [];
  return parsed;
}

async function salvarAtaNoBanco(ata: AtaReuniao): Promise<string> {
  // Tabela criada lazy se não existir
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS romatec_atas_reuniao (
      id                    INT AUTO_INCREMENT PRIMARY KEY,
      titulo                VARCHAR(200) NOT NULL,
      data_reuniao          DATE NOT NULL,
      resumo_executivo      TEXT,
      decisoes              JSON,
      action_items          JSON,
      datas_mencionadas     JSON,
      pessoas_mencionadas   JSON,
      topicos_principais    JSON,
      pontos_atencao        JSON,
      transcricao_completa  MEDIUMTEXT,
      duracao_segundos      INT,
      created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_data (data_reuniao DESC)
    )
  `);

  const [r] = await pool.execute<ResultSetHeader>(
    `INSERT INTO romatec_atas_reuniao
     (titulo, data_reuniao, resumo_executivo, decisoes, action_items, datas_mencionadas,
      pessoas_mencionadas, topicos_principais, pontos_atencao, transcricao_completa, duracao_segundos)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ata.titulo, ata.data_reuniao, ata.resumo_executivo,
      JSON.stringify(ata.decisoes),
      JSON.stringify(ata.action_items),
      JSON.stringify(ata.datas_mencionadas),
      JSON.stringify(ata.pessoas_mencionadas),
      JSON.stringify(ata.topicos_principais),
      JSON.stringify(ata.pontos_atencao),
      ata.transcricao_completa,
      ata.duracao_segundos ?? null,
    ],
  );
  return String(r.insertId);
}

function formatarAtaMarkdown(ata: AtaReuniao): string {
  const linhas: string[] = [];
  linhas.push(`# 📋 ${ata.titulo}`);
  linhas.push(`**Data:** ${ata.data_reuniao}${ata.duracao_segundos ? ` · **Duração:** ${Math.round(ata.duracao_segundos / 60)} min` : ''}\n`);

  linhas.push(`## 📝 Resumo Executivo`);
  linhas.push(ata.resumo_executivo || '_(sem resumo)_');

  if (ata.topicos_principais.length > 0) {
    linhas.push(`\n## 🎯 Tópicos Principais`);
    ata.topicos_principais.forEach(t => linhas.push(`- ${t}`));
  }

  if (ata.decisoes.length > 0) {
    linhas.push(`\n## ✅ Decisões Tomadas`);
    ata.decisoes.forEach(d => linhas.push(`- ${d}`));
  }

  if (ata.action_items.length > 0) {
    linhas.push(`\n## 🚀 Action Items`);
    ata.action_items.forEach(a => {
      const partes: string[] = [a.descricao];
      if (a.responsavel) partes.push(`**${a.responsavel}**`);
      if (a.prazo) partes.push(`📅 ${a.prazo}`);
      linhas.push(`- ${partes.join(' · ')}`);
      if (a.contexto) linhas.push(`  - _${a.contexto}_`);
    });
  }

  if (ata.datas_mencionadas.length > 0) {
    linhas.push(`\n## 📅 Datas Mencionadas`);
    ata.datas_mencionadas.forEach(d => linhas.push(`- **${d.data}** — ${d.descricao}`));
  }

  if (ata.pessoas_mencionadas.length > 0) {
    linhas.push(`\n## 👥 Pessoas Envolvidas`);
    linhas.push(ata.pessoas_mencionadas.map(p => `\`${p}\``).join(', '));
  }

  if (ata.pontos_atencao.length > 0) {
    linhas.push(`\n## ⚠️ Pontos de Atenção`);
    ata.pontos_atencao.forEach(p => linhas.push(`- ${p}`));
  }

  return linhas.join('\n');
}

// ── PUBLIC API ─────────────────────────────────────────────────────────

export async function gerarAtaDeTranscricao(input: {
  transcricao:  string;
  data_reuniao?: string;       // ISO YYYY-MM-DD, default = hoje
  duracao_segundos?: number;
}): Promise<{ ata: AtaReuniao; markdown: string; ata_id: string }> {
  const dataReuniao = input.data_reuniao || new Date().toISOString().slice(0, 10);
  const estrutura = await extrairEstruturaDaTranscricao(input.transcricao, dataReuniao);

  const ata: AtaReuniao = {
    titulo:               estrutura.titulo || 'Reunião sem título',
    data_reuniao:         dataReuniao,
    resumo_executivo:     estrutura.resumo_executivo,
    decisoes:             estrutura.decisoes,
    action_items:         estrutura.action_items,
    datas_mencionadas:    estrutura.datas_mencionadas,
    pessoas_mencionadas:  estrutura.pessoas_mencionadas,
    topicos_principais:   estrutura.topicos_principais,
    pontos_atencao:       estrutura.pontos_atencao,
    transcricao_completa: input.transcricao,
    duracao_segundos:     input.duracao_segundos,
  };

  const ata_id = await salvarAtaNoBanco(ata);
  ata.id = ata_id;
  const markdown = formatarAtaMarkdown(ata);
  return { ata, markdown, ata_id };
}

export async function gerarAtaDeAudio(input: {
  audio_base64: string;
  mime_type?:   string;
  data_reuniao?: string;
}): Promise<{ ata: AtaReuniao; markdown: string; ata_id: string; transcricao: string }> {
  if (!input.audio_base64) throw new Error('audio_base64 obrigatório');
  const buf = Buffer.from(input.audio_base64, 'base64');
  if (buf.length < 1000) throw new Error('Áudio muito pequeno (< 1KB)');
  if (buf.length > 25 * 1024 * 1024) throw new Error('Áudio muito grande (>25MB) — divide em partes ou use áudio comprimido');

  const transcricao = await transcribeAudio(buf, input.mime_type || 'audio/webm');
  const r = await gerarAtaDeTranscricao({
    transcricao:      transcricao.text,
    data_reuniao:     input.data_reuniao,
    duracao_segundos: transcricao.duration,
  });
  return { ...r, transcricao: transcricao.text };
}

export async function listarAtas(input: { limite?: number } = {}): Promise<Array<{
  id: string; titulo: string; data_reuniao: string; resumo_executivo: string;
  total_action_items: number; total_decisoes: number; criado_em: string;
}>> {
  const limit = Math.min(Math.max(input.limite || 30, 1), 200);
  type Row = RowDataPacket & {
    id: number; titulo: string; data_reuniao: Date; resumo_executivo: string;
    decisoes: string; action_items: string; created_at: Date;
  };
  try {
    const [rows] = await pool.execute<Row[]>(
      `SELECT id, titulo, data_reuniao, resumo_executivo, decisoes, action_items, created_at
       FROM romatec_atas_reuniao ORDER BY data_reuniao DESC, id DESC LIMIT ${limit}`,
    );
    return rows.map(r => {
      const decisoes = JSON.parse(typeof r.decisoes === 'string' ? r.decisoes : '[]') as unknown[];
      const actions  = JSON.parse(typeof r.action_items === 'string' ? r.action_items : '[]') as unknown[];
      return {
        id:                 String(r.id),
        titulo:             r.titulo,
        data_reuniao:       new Date(r.data_reuniao).toISOString().slice(0, 10),
        resumo_executivo:   r.resumo_executivo,
        total_action_items: actions.length,
        total_decisoes:     decisoes.length,
        criado_em:          r.created_at.toISOString(),
      };
    });
  } catch (err) {
    if (/doesn't exist/i.test((err as Error).message)) return [];
    throw err;
  }
}

export async function consultarAta(input: { id: string }): Promise<{ ata: AtaReuniao; markdown: string } | null> {
  type Row = RowDataPacket & {
    id: number; titulo: string; data_reuniao: Date; resumo_executivo: string;
    decisoes: string; action_items: string; datas_mencionadas: string;
    pessoas_mencionadas: string; topicos_principais: string; pontos_atencao: string;
    transcricao_completa: string; duracao_segundos: number | null; created_at: Date;
  };
  const [rows] = await pool.execute<Row[]>(
    `SELECT * FROM romatec_atas_reuniao WHERE id = ? LIMIT 1`,
    [input.id],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const ata: AtaReuniao = {
    id:                   String(r.id),
    titulo:               r.titulo,
    data_reuniao:         new Date(r.data_reuniao).toISOString().slice(0, 10),
    resumo_executivo:     r.resumo_executivo,
    decisoes:             JSON.parse(typeof r.decisoes === 'string' ? r.decisoes : '[]'),
    action_items:         JSON.parse(typeof r.action_items === 'string' ? r.action_items : '[]'),
    datas_mencionadas:    JSON.parse(typeof r.datas_mencionadas === 'string' ? r.datas_mencionadas : '[]'),
    pessoas_mencionadas:  JSON.parse(typeof r.pessoas_mencionadas === 'string' ? r.pessoas_mencionadas : '[]'),
    topicos_principais:   JSON.parse(typeof r.topicos_principais === 'string' ? r.topicos_principais : '[]'),
    pontos_atencao:       JSON.parse(typeof r.pontos_atencao === 'string' ? r.pontos_atencao : '[]'),
    transcricao_completa: r.transcricao_completa,
    duracao_segundos:     r.duracao_segundos ?? undefined,
    criado_em:            r.created_at.toISOString(),
  };
  return { ata, markdown: formatarAtaMarkdown(ata) };
}
