// OCR de documentos brasileiros (v1.44.0 - Frente I)
//
// Recebe imagem em base64 e usa Claude Vision pra extrair dados ESTRUTURADOS
// (não texto livre) prontos pra preencher cadastro de cliente, contrato,
// avaliação imobiliária, etc.
//
// Suporta: RG, CNH, comprovante de endereço, documento de imóvel,
// e modo genérico que aceita qualquer doc.

import Anthropic from '@anthropic-ai/sdk';

const CLAUDE_MODEL = process.env.CLAUDE_FALLBACK_MODEL || 'claude-sonnet-4-5';
const _claude = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

type ImageBase64 = { base64: string; mime?: string };

function detectarMime(b64: string, mimeOpcional?: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  if (mimeOpcional) {
    const m = mimeOpcional.toLowerCase();
    if (m.includes('png'))  return 'image/png';
    if (m.includes('webp')) return 'image/webp';
    if (m.includes('gif'))  return 'image/gif';
    return 'image/jpeg';
  }
  // Detecta pelo cabeçalho base64 (magic bytes)
  if (b64.startsWith('iVBOR'))   return 'image/png';
  if (b64.startsWith('R0lGOD'))  return 'image/gif';
  if (b64.startsWith('UklGR'))   return 'image/webp';
  return 'image/jpeg';
}

async function extrairComClaudeVision(prompt: string, image: ImageBase64): Promise<string> {
  if (!_claude) throw new Error('ANTHROPIC_API_KEY não configurada — vision não disponível');
  // Sanitiza base64 (remove "data:image/...,base64," se vier)
  const cleanB64 = image.base64.includes(',') ? image.base64.split(',', 2)[1] : image.base64;
  if (cleanB64.length < 100) throw new Error('Imagem muito pequena (<100 chars base64). Verifica se está enviando o conteúdo completo.');

  const r = await _claude.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: detectarMime(cleanB64, image.mime), data: cleanB64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const textBlock = r.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined;
  let raw = (textBlock?.text || '').trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  return raw;
}

function parseSafe<T>(raw: string, contexto: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Claude retornou JSON inválido em ${contexto}. Início: ${raw.slice(0, 200)}…`);
  }
}

const limparCpf  = (s?: string) => (s || '').replace(/\D/g, '');
const validarCpf = (s?: string) => limparCpf(s).length === 11;

// ── 1. RG ────────────────────────────────────────────────────────────────────
export interface DadosRg {
  nome:                    string;
  rg:                      string;
  orgao_emissor:           string;
  uf_emissor:              string;
  data_emissao:            string;
  cpf:                     string;
  data_nascimento:         string;
  naturalidade:            string;
  filiacao_pai:            string;
  filiacao_mae:            string;
  observacoes:             string;
  qualidade_imagem:        'boa' | 'ruim' | 'ilegivel';
  campos_nao_identificados: string[];
}

export async function extrairDadosRG(input: ImageBase64): Promise<DadosRg> {
  const prompt = `Extraia TODOS os dados visíveis nesta foto de RG (Registro Geral / Carteira de Identidade brasileira).

Retorne APENAS JSON (sem markdown, sem explicação):
{
  "nome": "Nome completo (UPPERCASE como aparece)",
  "rg": "Número RG sem pontos/traços",
  "orgao_emissor": "Ex: SSP, SESP, SEJUSP, SDS",
  "uf_emissor": "UF (2 letras)",
  "data_emissao": "DD/MM/AAAA ou vazio",
  "cpf": "Apenas números (11 dígitos)",
  "data_nascimento": "DD/MM/AAAA",
  "naturalidade": "Cidade/UF de nascimento",
  "filiacao_pai": "Nome completo do pai",
  "filiacao_mae": "Nome completo da mãe",
  "observacoes": "Outros dados visíveis (doador, militar, etc)",
  "qualidade_imagem": "boa | ruim | ilegivel",
  "campos_nao_identificados": ["lista campos que você NÃO conseguiu ler"]
}

REGRAS:
- Use string vazia "" pra campos faltantes (não null)
- CPF SEM pontos/traços (só dígitos)
- Datas SEMPRE no formato DD/MM/AAAA
- Se imagem ilegível, retorne "qualidade_imagem":"ilegivel" e campos_nao_identificados com tudo
- NÃO INVENTE dados. Se não conseguiu ler, deixe vazio.`;

  const raw = await extrairComClaudeVision(prompt, input);
  const dados = parseSafe<DadosRg>(raw, 'extrairDadosRG');
  // Validação leve
  if (dados.cpf && !validarCpf(dados.cpf)) {
    dados.observacoes = (dados.observacoes || '') + ' [⚠️ CPF lido tem formato inválido]';
  }
  dados.cpf = limparCpf(dados.cpf);
  return dados;
}

// ── 2. CNH ───────────────────────────────────────────────────────────────────
export interface DadosCnh {
  nome:                  string;
  rg:                    string;
  cpf:                   string;
  data_nascimento:       string;
  categoria:             string;
  primeira_habilitacao:  string;
  validade:              string;
  num_registro:          string;
  numero_espelho:        string;
  uf_emissor:            string;
  filiacao_pai:          string;
  filiacao_mae:          string;
  permissoes:            string;
  observacoes:           string;
  qualidade_imagem:      'boa' | 'ruim' | 'ilegivel';
  vencida:               boolean;
}

export async function extrairDadosCNH(input: ImageBase64): Promise<DadosCnh> {
  const prompt = `Extraia TODOS os dados visíveis nesta foto de CNH (Carteira Nacional de Habilitação brasileira).

Retorne APENAS JSON:
{
  "nome": "Nome completo",
  "rg": "Apenas números",
  "cpf": "Apenas números",
  "data_nascimento": "DD/MM/AAAA",
  "categoria": "A, B, AB, C, D, E ou combinações",
  "primeira_habilitacao": "DD/MM/AAAA",
  "validade": "DD/MM/AAAA",
  "num_registro": "Número de registro CNH",
  "numero_espelho": "Espelho da CNH",
  "uf_emissor": "UF (2 letras)",
  "filiacao_pai": "Nome do pai",
  "filiacao_mae": "Nome da mãe",
  "permissoes": "EAR, ACC, etc se houver",
  "observacoes": "Restrições médicas, observações especiais",
  "qualidade_imagem": "boa | ruim | ilegivel",
  "vencida": true/false (compare validade com data atual)
}

REGRAS:
- Strings vazias "" pra faltantes
- CPF/RG só dígitos
- Datas DD/MM/AAAA
- vencida = true se validade < data de hoje, false se válida
- NÃO INVENTE dados`;

  const raw = await extrairComClaudeVision(prompt, input);
  const dados = parseSafe<DadosCnh>(raw, 'extrairDadosCNH');
  dados.cpf = limparCpf(dados.cpf);
  dados.rg  = limparCpf(dados.rg);
  return dados;
}

// ── 3. Comprovante de endereço (conta de luz/água/telefone) ──────────────────
export interface DadosComprovanteEndereco {
  titular:              string;
  cpf_cnpj_titular:     string;
  endereco_completo:    string;
  numero:               string;
  complemento:          string;
  bairro:               string;
  cidade:               string;
  uf:                   string;
  cep:                  string;
  fornecedor:           string;
  tipo_conta:           string;     // luz / agua / telefone / internet / IPTU
  numero_unidade:       string;     // medidor, matricula
  data_referencia:      string;
  data_vencimento:      string;
  valor_total:          number;
  qualidade_imagem:     'boa' | 'ruim' | 'ilegivel';
}

export async function extrairComprovanteEndereco(input: ImageBase64): Promise<DadosComprovanteEndereco> {
  const prompt = `Extraia dados desta foto de COMPROVANTE DE ENDEREÇO brasileiro (conta de luz, água, telefone, internet, IPTU).

Retorne APENAS JSON:
{
  "titular": "Nome do titular da conta",
  "cpf_cnpj_titular": "Apenas números",
  "endereco_completo": "Logradouro completo (rua, avenida, etc)",
  "numero": "Nº da casa/apto",
  "complemento": "Bloco, sala, casa X, etc",
  "bairro": "Bairro",
  "cidade": "Cidade",
  "uf": "UF",
  "cep": "Apenas números (8 dígitos)",
  "fornecedor": "CEMAR, Equatorial, CAEMA, Vivo, Claro, Prefeitura X, etc",
  "tipo_conta": "luz | agua | telefone | internet | IPTU | outro",
  "numero_unidade": "Nº do medidor, instalação, matrícula etc",
  "data_referencia": "DD/MM/AAAA (mês de referência da conta)",
  "data_vencimento": "DD/MM/AAAA",
  "valor_total": número (valor sem R$, em reais com decimais),
  "qualidade_imagem": "boa | ruim | ilegivel"
}

REGRAS:
- Strings vazias se faltar
- valor_total como NÚMERO (não string), ex: 245.67
- CEP só dígitos
- NÃO INVENTE dados`;

  const raw = await extrairComClaudeVision(prompt, input);
  const dados = parseSafe<DadosComprovanteEndereco>(raw, 'extrairComprovanteEndereco');
  dados.cep = (dados.cep || '').replace(/\D/g, '');
  dados.cpf_cnpj_titular = (dados.cpf_cnpj_titular || '').replace(/\D/g, '');
  return dados;
}

// ── 4. Documento de imóvel (matrícula, IPTU, escritura, contrato) ────────────
export interface DadosDocumentoImovel {
  tipo_documento:       string;     // matricula | iptu | escritura | contrato | habite_se | alvara
  numero_matricula:     string;
  cartorio:             string;
  cidade_cartorio:      string;
  proprietario:         string;
  cpf_cnpj_proprietario: string;
  endereco_imovel:      string;
  bairro_imovel:        string;
  cidade_imovel:        string;
  uf_imovel:            string;
  cep_imovel:           string;
  area_terreno_m2:      number;
  area_construida_m2:   number;
  valor_venal:          number;
  inscricao_imobiliaria: string;
  ano_construcao:       string;
  observacoes:          string;
  qualidade_imagem:     'boa' | 'ruim' | 'ilegivel';
}

export async function extrairDocumentoImovel(input: ImageBase64): Promise<DadosDocumentoImovel> {
  const prompt = `Extraia dados desta foto de DOCUMENTO IMOBILIÁRIO brasileiro (matrícula, IPTU, escritura pública, contrato de compra e venda, habite-se, alvará).

Retorne APENAS JSON:
{
  "tipo_documento": "matricula | iptu | escritura | contrato | habite_se | alvara | outro",
  "numero_matricula": "Nº da matrícula no cartório",
  "cartorio": "Nome do cartório (ex: 1º Ofício de Registro de Imóveis)",
  "cidade_cartorio": "Cidade do cartório",
  "proprietario": "Nome completo do proprietário/titular",
  "cpf_cnpj_proprietario": "Apenas números",
  "endereco_imovel": "Logradouro + número do imóvel",
  "bairro_imovel": "Bairro do imóvel",
  "cidade_imovel": "Cidade",
  "uf_imovel": "UF",
  "cep_imovel": "Apenas números",
  "area_terreno_m2": número,
  "area_construida_m2": número,
  "valor_venal": número (em reais),
  "inscricao_imobiliaria": "Nº de inscrição municipal",
  "ano_construcao": "AAAA",
  "observacoes": "Confrontações, ônus, hipotecas, gravames, restrições",
  "qualidade_imagem": "boa | ruim | ilegivel"
}

REGRAS:
- Áreas como NÚMERO em m² (ex: 250 ou 250.5, não "250 m²")
- valor_venal em reais sem R$ (ex: 350000 ou 350000.50)
- CPF/CNPJ/CEP só dígitos
- Strings vazias se faltar
- Em "observacoes" SEMPRE inclua ônus/gravames se mencionados (importante pra avaliação)
- NÃO INVENTE dados`;

  const raw = await extrairComClaudeVision(prompt, input);
  const dados = parseSafe<DadosDocumentoImovel>(raw, 'extrairDocumentoImovel');
  dados.cep_imovel = (dados.cep_imovel || '').replace(/\D/g, '');
  dados.cpf_cnpj_proprietario = (dados.cpf_cnpj_proprietario || '').replace(/\D/g, '');
  return dados;
}

// ── 5. Análise visual de imóvel (foto da casa/terreno/apartamento) ───────────
export interface AnaliseVisualImovel {
  tipo_imovel:          string;     // residencial_casa | residencial_apto | comercial | terreno | rural
  estado_conservacao:   string;     // novo | otimo | bom | regular | ruim | deteriorado
  padrao_construtivo:   string;     // baixo | medio_baixo | medio | medio_alto | alto | luxo
  caracteristicas:      string[];   // lista de features visíveis
  area_terreno_aprox:   number;     // m² estimados
  area_construida_aprox: number;
  num_pavimentos:       number;
  acabamentos_visiveis: string[];   // pisos, paredes, telhado
  ambientes_externos:   string[];   // garagem, jardim, piscina, varanda
  pontos_atencao:       string[];   // rachaduras, infiltração, telhado ruim, etc
  estimativa_idade_anos: number;
  qualidade_imagem:     'boa' | 'ruim' | 'ilegivel';
  observacoes_avaliador: string;
}

export async function analisarVisualImovel(input: ImageBase64): Promise<AnaliseVisualImovel> {
  const prompt = `Você é uma engenheira avaliadora da Romatec analisando uma FOTO DE IMÓVEL pra avaliação preliminar.

Retorne APENAS JSON:
{
  "tipo_imovel": "residencial_casa | residencial_apto | comercial | terreno | rural | misto",
  "estado_conservacao": "novo | otimo | bom | regular | ruim | deteriorado",
  "padrao_construtivo": "baixo | medio_baixo | medio | medio_alto | alto | luxo",
  "caracteristicas": ["lista features arquitetônicas visíveis"],
  "area_terreno_aprox": número (m² estimado, 0 se não der pra estimar),
  "area_construida_aprox": número,
  "num_pavimentos": número (1 = térreo, 2 = sobrado, etc),
  "acabamentos_visiveis": ["piso porcelanato", "alvenaria rebocada", "telha cerâmica"],
  "ambientes_externos": ["garagem 2 vagas", "jardim frontal", "piscina"],
  "pontos_atencao": ["rachadura na fachada", "telhado precisa manutenção", "infiltração visível"],
  "estimativa_idade_anos": número (estimativa visual baseada em padrão arquitetônico/conservação),
  "qualidade_imagem": "boa | ruim | ilegivel",
  "observacoes_avaliador": "Parágrafo curto com observações técnicas pra laudo (linguagem perito)"
}

REGRAS:
- Use sua expertise como avaliadora pra estimar áreas (mesmo que aproximado)
- Se for foto interna, foque em acabamentos e tamanho dos cômodos
- Se for fachada, foque em padrão construtivo e estado externo
- pontos_atencao: SEMPRE liste se houver problemas (importante pra laudo)
- NÃO invente o que não vê. Vazio é melhor que inventado.`;

  const raw = await extrairComClaudeVision(prompt, input);
  return parseSafe<AnaliseVisualImovel>(raw, 'analisarVisualImovel');
}
