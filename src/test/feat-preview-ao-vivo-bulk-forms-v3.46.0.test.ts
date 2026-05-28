// v3.46.0: bulk add do live preview aos 6 forms restantes de Proposta de Consultoria.
//
// Backend, helper e endpoint sao do v3.45.0 (universais). Aqui cada form ganha:
//   1. Wrapper #<prefixo>SplitGrid (grid 2-cols)
//   2. Painel preview com #<prefixo>PreviewBox + #<prefixo>RefreshPreview
//   3. Helper __<prefixo>MontarDadosImovel() reusado por preview + calcular
//   4. Setup do __<prefixo>Preview via __criarLivePreviewProposta
//   5. Listeners em todos os inputs/selects/textareas via querySelectorAll
//   6. Media query 1100px que colapsa pra 1 coluna no mobile

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const OBRAS_HTML = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'obras.html'),
  'utf-8',
);

const FORMS = [
  { nome: 'Averbação', prefixo: 'cns', subtipo: '(averbacao_residencial|averbacao_comercial)' },
  { nome: 'Georref Rural', prefixo: 'geo', subtipo: 'georreferenciamento_rural' },
  { nome: 'Desm/Rem', prefixo: 'dx', subtipo: '(desmembramento|remembramento)' },
  { nome: 'Retificação', prefixo: 'rx', subtipo: 'retificacao_area' },
  { nome: 'PTAM', prefixo: 'pt', subtipo: 'avaliacao_ptam' },
  { nome: 'Projeto Executivo', prefixo: 'pe', subtipo: 'projeto_executivo' },
];

describe('v3.46.0 — Bulk add: cada form ganha wrapper grid + painel preview', () => {
  FORMS.forEach(({ nome, prefixo }) => {
    it(`${nome} tem wrapper #${prefixo}SplitGrid 2-cols`, () => {
      const re = new RegExp(`id="${prefixo}SplitGrid" style="display:grid;`);
      expect(OBRAS_HTML).toMatch(re);
    });

    it(`${nome} tem painel preview #${prefixo}PreviewBox + botao refresh`, () => {
      expect(OBRAS_HTML).toMatch(new RegExp(`id="${prefixo}PreviewBox"`));
      expect(OBRAS_HTML).toMatch(new RegExp(`id="${prefixo}RefreshPreview"`));
    });

    it(`${nome} tem media query 1100px que colapsa pra 1 coluna`, () => {
      const re = new RegExp(`@media \\(max-width: 1100px\\)[\\s\\S]{0,200}?#${prefixo}SplitGrid \\{ grid-template-columns: 1fr`);
      expect(OBRAS_HTML).toMatch(re);
    });
  });
});

describe('v3.46.0 — Wire-up: cada form chama __criarLivePreviewProposta', () => {
  FORMS.forEach(({ nome, prefixo }) => {
    it(`${nome} usa __criarLivePreviewProposta com boxId correto`, () => {
      const re = new RegExp(`__${prefixo}Preview = __criarLivePreviewProposta\\(\\{[\\s\\S]{0,300}?boxId: '${prefixo}PreviewBox'`);
      expect(OBRAS_HTML).toMatch(re);
    });

    it(`${nome} faz bind em #${prefixo}SplitGrid input/select/textarea`, () => {
      const re = new RegExp(`#${prefixo}SplitGrid input, #${prefixo}SplitGrid select, #${prefixo}SplitGrid textarea`);
      expect(OBRAS_HTML).toMatch(re);
    });

    it(`${nome} faz setTimeout(100ms) pra primeira renderizacao`, () => {
      const re = new RegExp(`setTimeout\\(\\(\\) => __${prefixo}Preview\\.atualizar\\(\\), 100\\)`);
      expect(OBRAS_HTML).toMatch(re);
    });
  });
});

describe('v3.46.0 — Helpers de dados sao reusados (DRY: preview + calcular)', () => {
  const helpers = [
    { nome: 'Averbação', fn: '__cnsMontarDadosImovel' },
    { nome: 'Georref', fn: '__geoMontarDadosImovel' },
    { nome: 'Desm/Rem', fn: '__dxMontarDadosPreview' },
    { nome: 'Retificação', fn: '__rxMontarDadosImovel' },
    { nome: 'PTAM', fn: '__ptMontarDadosImovel' },
    { nome: 'Projeto Exec', fn: '__peMontarDadosImovel' },
  ];

  helpers.forEach(({ nome, fn }) => {
    it(`${nome}: helper ${fn}() existe`, () => {
      expect(OBRAS_HTML).toMatch(new RegExp(`function ${fn}\\(`));
    });
  });
});

describe('v3.46.0 — Padrao preservado: cliente lookup + endereco_imovel', () => {
  // Cada form deve passar o cliente_id pra encontrar dados do cliente no cache
  // e o endereco_imovel pro PDF mostrar corretamente.
  FORMS.forEach(({ nome, prefixo }) => {
    it(`${nome}: getDados inclui cliente lookup via propostasClientes.find`, () => {
      const re = new RegExp(
        `__${prefixo}Preview[\\s\\S]{0,800}?state\\.propostasClientes\\?\\.find\\(c => String\\(c\\.id\\) === String\\(cliId\\)\\)`
      );
      expect(OBRAS_HTML).toMatch(re);
    });
  });
});
