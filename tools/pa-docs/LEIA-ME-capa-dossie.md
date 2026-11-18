# Capa do Dossiê do Lote de Produção (Incremento v1.1)

- `capa_dossie_lote.py` — gerador de **referência** (ReportLab) do modelo aprovado em 18/11/2026
  (`Capa_Dossie_LT-05_Salete_Moreno_Romatec.pdf`). Espera as artes em `tools/pa-docs/assets/capa-dossie/`
  (`logo_romatec_branco.png`, `brasao_pa_salete_moreno.png`, `vista_aerea_pa_salete_moreno.jpg`) — não versionadas aqui.
- **Produção (ZAYRA):** `src/services/pa/paCapaDossie.ts` reproduz as mesmas posições/cores/textos em HTML → PDF,
  com Liberation Sans embutida (`src/public/fonts`) e artes em `src/public/brand/pa/capa_*` e `logo_romatec_branco.png`.
- Rotas: `GET/POST/PATCH /api/pa/projetos/:id/lotes-producao[/:codigo]`, `GET …/lotes-producao/:codigo/capa.pdf`,
  `POST /api/pa/lotes-producao/:lid/gerar/capa` (arquiva em `pa_documentos`, tipo `CAPA_DOSSIE_LOTE`, versão +1),
  `POST /api/pa/projetos/:id/gerar/capas-dossie` (ZIP).
- Área: ha · alqueires (1 alqueire = 48.400 m²); sem área → "a definir após o georreferenciamento".
