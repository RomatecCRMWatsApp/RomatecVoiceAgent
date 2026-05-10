# Precificação INCRA — Laudo de Demarcação

Cálculo automático do valor do serviço de georreferenciamento conforme **Portaria INCRA nº 12, de 23 de abril de 2025** (3ª Edição da Norma Técnica para Georreferenciamento de Imóveis Rurais).

**Fonte oficial:** https://www.gov.br/incra/pt-br/assuntos/governanca-fundiaria/portaria_12_2025_geo.pdf

## Quando usar cada unidade

| Unidade | Usar quando | Quantidade vem de |
|---|---|---|
| **km linear** | Demarcação de divisas com perímetro extenso e poucos vértices | `Σ(distancia_m) / 1000` (perímetro total) |
| **Hectare** | Mensuração de área para titulação, cadastro CCIR/INCRA, georreferenciamento padrão | `area_total_m2 / 10000` |
| **Lote** | Loteamentos com múltiplos lotes pequenos a demarcar | número de lotes (default 1 para laudo simples) |

## Auto-preenchimento

Ao abrir a aba "ART/TRT + Financeiro" do laudo, o sistema sugere automaticamente:

- **Critérios padrão**: todos = 5 (faixa intermediária)
- **Área média dos lotes**: derivada de `area_total_m2`
  - >35 ha → pontuação 2 (favorável)
  - 15-35 ha → pontuação 5 (mediano)
  - ≤15 ha → pontuação 8 (desfavorável)
- **Insalubridade**: se UF ∈ {MA, PA, AM, AC, RO, RR, AP, TO, MT} (Amazônia Legal) → pontuação 7

Você pode editar livremente cada um dos 6 critérios (1-10).

## Como o desconto é aplicado

- **Percentual**: `desconto = valor_base × (% / 100)`. Range válido: 0-100.
- **Fixo**: valor em R$. Não pode ser maior que o valor base.
- **Nenhum**: valor final = valor base.

⚠️ Se o desconto exceder **10%**, o sistema mostra aviso citando a Portaria 12/2025 (variação admissível ±10%). É apenas aviso — não bloqueia.

## Aviso jurídico

A Portaria INCRA 12/2025 é referencial **obrigatório** para contratações de serviços geodésicos pelo INCRA.

Em **contratos privados** (entre empresas e particulares), a tabela serve como **balizador defensável de mercado**, mas o valor final é livremente acordado entre as partes contratantes.

Esta funcionalidade do sistema:
- Calcula o valor referencial conforme a Portaria
- Permite desconto comercial e o documenta no laudo/recibo
- Imprime no PDF do laudo a tabela completa de critérios + valor base + desconto + valor final, conforme exigência da Portaria

## Estrutura técnica

- Service: `src/services/pricing/incra.ts` (TypeScript, fonte de verdade)
- Espelho front: `src/public/js/incraCalc.js` (vanilla JS, cálculo em tempo real na UI)
- Migration: `src/database/migrations-precificacao-incra.ts` (16 colunas em `laudos_demarcacao`)
- Endpoints: `GET/POST/PATCH /api/laudos-demarcacao/:id/precificacao/...`
- PDF: seção 12 em `src/services/laudoPdf.ts`
- Recibo: 3 linhas em `src/services/reciboPdf.ts`
- Testes: `src/services/pricing/incra.test.ts` (incluindo 54 cenários de paridade back↔front)
