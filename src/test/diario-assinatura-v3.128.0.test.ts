// v3.128.0 — Assinatura formal do proprietário/responsável no Diário de Obra.
//
// Cobre o contrato do módulo sem depender de MySQL:
//   1. geração do hash SHA-256 (determinístico, sela conteúdo + signatário + rubrica);
//   2. integridade da persistência (o snapshot congelado reconfere o hash; adulterar quebra);
//   3. canonicalização do carimbo temporal (o que impede o hash de "desconferir" fora do UTC);
//   4. wire-up: rotas autenticadas, página pública /v/diario, migration, PDF, envio.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import {
  gerarHashAssinatura,
  conferirIntegridade,
  canonicalizarInstante,
  apenasBase64,
  formatarDocumento,
  type PayloadHash,
  type Assinatura,
  type SnapshotDiario,
} from '../services/diario/diarioAssinaturaRepo';

const read = (...p: string[]) => readFileSync(join(process.cwd(), 'src', ...p), 'utf8');

const RUBRICA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function payloadBase(): PayloadHash {
  return {
    diario_id: 42,
    obra_id: 7,
    data_visita: '2026-07-24',
    hora_visita: '10:00:00',
    observacoes: 'Fundação concluída conforme projeto.',
    pendencias: 'Falta impermeabilizar a viga baldrame.',
    solicitacoes_proprietario: 'Antecipar a laje para a próxima semana.',
    signatario_nome: 'Carlos Mello',
    signatario_cpf: '123.456.789-09',
    signatario_papel: 'proprietario',
    assinado_em: '2026-07-24T13:05:00Z',
    assinatura_b64: RUBRICA,
  };
}

describe('Geração do hash SHA-256 (v3.128.0)', () => {
  it('é um SHA-256 hex (64 chars) e determinístico', () => {
    const h1 = gerarHashAssinatura(payloadBase());
    const h2 = gerarHashAssinatura(payloadBase());
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).toBe(h2);
  });

  it('a rubrica entra pela impressão SHA-256, não crua (mesma base = mesmo hash)', () => {
    // Provamos a fórmula: o hash é SHA-256 da string canônica onde a rubrica
    // aparece já "hasheada". Reconstruímos a base e conferimos.
    const p = payloadBase();
    const rubricaHash = createHash('sha256').update(apenasBase64(p.assinatura_b64)).digest('hex');
    const base = [
      'DIARIO-OBRA-ASSINATURA-V1', p.diario_id, p.obra_id, p.data_visita, p.hora_visita,
      p.observacoes, p.pendencias, p.solicitacoes_proprietario, p.signatario_nome.trim(),
      p.signatario_cpf!.replace(/\D/g, ''), p.signatario_papel, p.assinado_em, rubricaHash,
    ].join('|');
    expect(gerarHashAssinatura(p)).toBe(createHash('sha256').update(base).digest('hex'));
  });

  it('o prefixo data:...;base64, não muda o hash (rubrica normalizada)', () => {
    const semPrefixo = payloadBase();
    const comPrefixo = { ...payloadBase(), assinatura_b64: `data:image/png;base64,${RUBRICA}` };
    expect(gerarHashAssinatura(comPrefixo)).toBe(gerarHashAssinatura(semPrefixo));
  });

  it('CPF muda de máscara mas não de hash (compara só os dígitos)', () => {
    const mascarado = payloadBase();
    const cru = { ...payloadBase(), signatario_cpf: '12345678909' };
    expect(gerarHashAssinatura(cru)).toBe(gerarHashAssinatura(mascarado));
  });

  it('qualquer alteração de conteúdo, signatário, papel, rubrica ou instante muda o hash', () => {
    const base = gerarHashAssinatura(payloadBase());
    const variacoes: Array<Partial<PayloadHash>> = [
      { observacoes: 'Outro texto' },
      { pendencias: null },
      { solicitacoes_proprietario: 'Pedido diferente' },
      { signatario_nome: 'Carlos Mello Filho' },
      { signatario_cpf: '111.444.777-35' },
      { signatario_papel: 'responsavel' },
      { data_visita: '2026-07-25' },
      { hora_visita: '10:30:00' },
      { assinado_em: '2026-07-24T13:06:00Z' },
      { diario_id: 43 },
      { obra_id: 8 },
      { assinatura_b64: RUBRICA.replace('A', 'B') },
    ];
    for (const v of variacoes) {
      expect(gerarHashAssinatura({ ...payloadBase(), ...v }), JSON.stringify(v)).not.toBe(base);
    }
  });
});

describe('Integridade da persistência (v3.128.0)', () => {
  // Monta uma Assinatura como se tivesse voltado do banco, com o hash gerado
  // sobre o snapshot congelado — é o que a página pública reconfere.
  function assinaturaGravada(over: Partial<SnapshotDiario> = {}): Assinatura {
    const snap: SnapshotDiario = {
      diario_id: 42, obra_id: 7, obra_nome: 'Residência Alphaville',
      data_visita: '2026-07-24', hora_visita: '10:00:00',
      observacoes: 'Fundação concluída conforme projeto.',
      pendencias: 'Falta impermeabilizar a viga baldrame.',
      solicitacoes_proprietario: 'Antecipar a laje.',
      ...over,
    };
    const assinado_em = '2026-07-24T13:05:00Z';
    const hash = gerarHashAssinatura({
      diario_id: snap.diario_id, obra_id: snap.obra_id,
      data_visita: snap.data_visita, hora_visita: snap.hora_visita,
      observacoes: snap.observacoes, pendencias: snap.pendencias,
      solicitacoes_proprietario: snap.solicitacoes_proprietario,
      signatario_nome: 'Carlos Mello', signatario_cpf: '12345678909',
      signatario_papel: 'proprietario', assinado_em, assinatura_b64: RUBRICA,
    });
    return {
      id: 1, diario_id: 42, obra_id: 7,
      signatario_nome: 'Carlos Mello', signatario_cpf: '12345678909',
      signatario_papel: 'proprietario', assinatura_b64: RUBRICA,
      hash_validacao: hash, snapshot: snap, assinado_em,
      latitude: null, longitude: null, local_texto: null,
      status: 'assinado', criado_por: 'sub-1', criado_em: assinado_em,
    };
  }

  it('assinatura íntegra reconfere (hash == recomputado do snapshot)', () => {
    expect(conferirIntegridade(assinaturaGravada())).toBe(true);
  });

  it('adulterar o texto congelado quebra a integridade', () => {
    const a = assinaturaGravada();
    a.snapshot!.observacoes = 'TEXTO ADULTERADO DEPOIS DA ASSINATURA';
    expect(conferirIntegridade(a)).toBe(false);
  });

  it('trocar o signatário ou a rubrica quebra a integridade', () => {
    const a1 = assinaturaGravada(); a1.signatario_nome = 'Outro Nome';
    expect(conferirIntegridade(a1)).toBe(false);
    const a2 = assinaturaGravada(); a2.assinatura_b64 = RUBRICA.replace('g', 'h');
    expect(conferirIntegridade(a2)).toBe(false);
  });

  it('sem snapshot não há como conferir → falso (nunca "verde por omissão")', () => {
    const a = assinaturaGravada(); a.snapshot = null;
    expect(conferirIntegridade(a)).toBe(false);
  });
});

describe('Carimbo temporal canônico (v3.128.0)', () => {
  it('devolve iso (segundos+Z) e sql (DATETIME) do MESMO wall-clock UTC', () => {
    const r = canonicalizarInstante('2026-07-24T13:05:09.427Z');
    expect(r.iso).toBe('2026-07-24T13:05:09Z');
    expect(r.sql).toBe('2026-07-24 13:05:09');
  });

  it('iso e sql apontam pro mesmo instante (o que faz o hash reconferir após o DATE_FORMAT)', () => {
    const r = canonicalizarInstante('2026-01-02T03:04:05Z');
    expect(r.iso).toBe('2026-01-02T03:04:05Z');
    expect(r.sql).toBe(r.iso.replace('T', ' ').replace('Z', ''));
  });

  it('entrada inválida/ausente não explode (usa agora)', () => {
    expect(canonicalizarInstante('lixo').iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(canonicalizarInstante(null).sql).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('Utilitários de documento (v3.128.0)', () => {
  it('formata CPF (11) e CNPJ (14); não-documento passa intacto', () => {
    expect(formatarDocumento('12345678909')).toBe('123.456.789-09');
    expect(formatarDocumento('12345678000199')).toBe('12.345.678/0001-99');
    expect(formatarDocumento('abc')).toBe('abc');
    expect(formatarDocumento(null)).toBe('');
  });
  it('apenasBase64 remove o prefixo data: quando houver', () => {
    expect(apenasBase64('data:image/png;base64,AAAA')).toBe('AAAA');
    expect(apenasBase64('AAAA')).toBe('AAAA');
    expect(apenasBase64(null)).toBe('');
  });
});

describe('Wire-up: rotas, migration, página pública, PDF, envio (v3.128.0)', () => {
  const MIG = read('database', 'migrations-diario-assinatura.ts');
  const REPO = read('services', 'diario', 'diarioAssinaturaRepo.ts');
  const ROUTER = read('routes', 'diarioObra.ts');
  const PUB = read('routes', 'diarioPublico.ts');
  const PDF = read('services', 'diario', 'diarioAssinaturaPdf.ts');
  const ENVIO = read('services', 'diario', 'diarioAssinaturaEnvio.ts');
  const SERVER = read('server.ts');
  const HTML = read('public', 'diario-obra.html');
  const DIARIO_REPO = read('services', 'diario', 'diarioObraRepo.ts');

  it('migration cria a tabela, é idempotente, hash UNIQUE e SEM FK dura', () => {
    expect(MIG).toContain('CREATE TABLE IF NOT EXISTS diario_obra_assinaturas');
    expect(MIG).toMatch(/UNIQUE KEY uq_diario_assinatura_hash/);
    expect(MIG).toMatch(/already exists\|Duplicate/);
    expect(MIG).toMatch(/snapshot_json\s+LONGTEXT/);
    expect(MIG).toMatch(/signatario_papel\s+ENUM\('proprietario','responsavel'\)/);
    // convenção do módulo Diário: sem FK cross-tabela
    expect(MIG).not.toMatch(/REFERENCES/);
  });

  it('reads reconstroem assinado_em via DATE_FORMAT (hash reconfere fora do UTC)', () => {
    expect(REPO).toMatch(/DATE_FORMAT\(assinado_em, '%Y-%m-%dT%H:%i:%sZ'\) AS assinado_em_iso/);
    expect(REPO).toMatch(/assinado_em: r\.assinado_em_iso \? String\(r\.assinado_em_iso\)/);
  });

  it('excluir o diário cascateia as assinaturas (sem FK dura)', () => {
    expect(DIARIO_REPO).toMatch(/DELETE FROM diario_obra_assinaturas WHERE diario_id = \?/);
  });

  it('rotas autenticadas: coletar, listar, anular, PDF e enviar', () => {
    expect(ROUTER).toMatch(/router\.post\('\/:id\/assinaturas'/);
    expect(ROUTER).toMatch(/router\.get\('\/:id\/assinaturas'/);
    expect(ROUTER).toMatch(/router\.post\('\/assinaturas\/:assinaturaId\/anular'/);
    expect(ROUTER).toMatch(/router\.get\('\/assinaturas\/:assinaturaId\/pdf'/);
    expect(ROUTER).toMatch(/router\.post\('\/assinaturas\/:assinaturaId\/enviar'/);
    // congela o snapshot no ato e exige rubrica mínima
    expect(ROUTER).toMatch(/snapshot: assinRepo\.SnapshotDiario/);
    expect(ROUTER).toMatch(/apenasBase64\(rubrica\)\.length < 100/);
    // colisão de hash → 409, não 500
    expect(ROUTER).toMatch(/status\(409\)/);
  });

  it('página pública /v/diario montada FORA do gate /api e namespaced', () => {
    expect(SERVER).toMatch(/import diarioPublicoRouter from '\.\/routes\/diarioPublico'/);
    expect(SERVER).toMatch(/app\.use\('\/v\/diario', diarioPublicoRouter\)/);
    // não pode estar sob /api (senão o apiAuthGate bloquearia o cliente sem login)
    expect(SERVER).not.toMatch(/app\.use\('\/api\/v\/diario'/);
    expect(SERVER).toMatch(/runDiarioAssinaturaMigrations/);
  });

  it('a página pública mostra status assinado + signatário + reconfere integridade', () => {
    expect(PUB).toMatch(/router\.get\('\/:hash'/);
    expect(PUB).toMatch(/router\.get\('\/:hash\/json'/);
    expect(PUB).toMatch(/router\.get\('\/:hash\/pdf'/);
    expect(PUB).toMatch(/conferirIntegridade\(a\)/);
    expect(PUB).toMatch(/Documento assinado e íntegro/);
    expect(PUB).toMatch(/buscarPorHash/);
    expect(PUB).toMatch(/signatario_nome/);
  });

  it('PDF afixa rubrica + selo SHA-256 + QR pra página pública, tema Romatec', () => {
    expect(PDF).toMatch(/htmlToPdf/);
    expect(PDF).toMatch(/QRCode\.toDataURL\(linkPublico/);
    expect(PDF).toMatch(/hash_validacao/);
    expect(PDF).toMatch(/#C9A84C/); // dourado Romatec
    expect(PDF).toMatch(/Selo de autenticidade · SHA-256/);
  });

  it('envio por WhatsApp reaproveita o cliente Z-API do projeto', () => {
    expect(ENVIO).toMatch(/from '\.\.\/\.\.\/integrations\/whatsapp'/);
    expect(ENVIO).toMatch(/sendDocument/);
    expect(ROUTER).toMatch(/enviarAssinaturaWhatsapp/);
  });

  it('a tela do diário colhe rubrica no canvas e lista assinaturas com link/PDF/WhatsApp', () => {
    expect(HTML).toMatch(/function abrirAssinatura\(d\)/);
    expect(HTML).toMatch(/abrirDesenho\('assinatura', store/); // reusa o pad sólido do v3.127
    expect(HTML).toMatch(/'\/'\+d\.id\+'\/assinaturas'/);
    expect(HTML).toMatch(/\/v\/diario\/'\+a\.hash_validacao/);
    expect(HTML).toMatch(/navigator\.geolocation\.getCurrentPosition/); // GPS opcional
    expect(HTML).toMatch(/data-envia=/); // enviar por WhatsApp
  });

  it('o módulo não encosta em tools.ts/think.ts/aiCascade.ts (sem tool nova)', () => {
    for (const src of [REPO, ROUTER, PUB, PDF, ENVIO, MIG]) {
      expect(src).not.toMatch(/agent\/tools|agent\/think|aiCascade/);
    }
  });
});
