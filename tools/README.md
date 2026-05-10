# Tools — Ferramentas auxiliares Romatec

Scripts standalone que **não** rodam dentro do servidor Express. São utilitários
locais pra rodar manualmente em cenários específicos (análise de DXF, debug,
calibração).

## inspecionar_dxf.py

Analisa um arquivo DXF de loteamento e gera relatório de viabilidade pra extração
automática (Caminho B do módulo Loteamentos).

### Por que existe

A extração automática de dados de DXF (lotes/quadras/medidas/confrontantes) só
funciona bem se o arquivo seguir certas convenções (layers organizadas, textos
posicionados dentro dos polígonos). Antes de investir tempo no parser do servidor,
roda esse inspetor pra saber se vale o esforço.

### Instalação (1 vez só)

```bash
pip install ezdxf shapely
```

### Uso

```bash
# Padrão (com cores ANSI e emojis)
python tools/inspecionar_dxf.py CAMINHO_DO_ARQUIVO.dxf

# Sem emojis (terminais antigos)
python tools/inspecionar_dxf.py arquivo.dxf --no-emoji

# Texto puro (ideal para redirecionar pra log)
python tools/inspecionar_dxf.py arquivo.dxf --plain > relatorio.txt
```

### Saída

Pontuação 0-100 + recomendação:

| Faixa | Recomendação |
|---|---|
| 80-100 | 🏆 Caminho B (DXF nativo) — extração automática direta |
| 60-79  | ⚠️ Caminho B com revisão — alguns casos manuais |
| 40-59  | ⚠️ Híbrido — bastante revisão manual |
| 0-39   | ❌ Caminho A (planilha manual) |

### Notas técnicas

- Suporta DXF R12 a R2018 ASCII (não suporta DWG nem DXF binário)
- Para DWG: converter primeiro com ODA File Converter, QGIS ou AutoCAD
- O script reconhece layers por palavras-chave portuguesas/espanholas
  (lote, quadra, rua, area, etc) — se seu CAD usa nomes em outro idioma,
  ajuste `LAYER_KEYWORDS` no topo do script
