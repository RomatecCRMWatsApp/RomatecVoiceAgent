// v3.24.2: PR C — Admin de gestao de acessos. Smoke tests dos helpers
// puros (gerador de senha, montador de mensagem WhatsApp).
//
// Endpoints HTTP nao sao testados aqui — precisariam mock pesado de DB e
// requireRole. A logica HTTP e' coberta indiretamente pelos tests da PR A
// (requireAuth, requireRole, JWT).

import { describe, it, expect } from 'vitest';
import { gerarSenhaTemporaria, montarMensagemCredenciais } from '../services/admin-acessos-helpers';

describe('gerarSenhaTemporaria', () => {
  it('gera senha do tamanho pedido (default 8)', () => {
    expect(gerarSenhaTemporaria().length).toBe(8);
    expect(gerarSenhaTemporaria(12).length).toBe(12);
  });

  it('nao contem caracteres ambiguos (0/O/1/l/I)', () => {
    for (let i = 0; i < 50; i++) {
      const s = gerarSenhaTemporaria(8);
      for (const ch of '0O1lI') {
        expect(s, `senha "${s}" tem char ambiguo "${ch}"`).not.toContain(ch);
      }
    }
  });

  it('aleatorio — 20 senhas seguidas sao todas diferentes', () => {
    const set = new Set<string>();
    for (let i = 0; i < 20; i++) set.add(gerarSenhaTemporaria(8));
    expect(set.size).toBe(20);
  });

  it('so usa charset esperado (a-z A-Z 2-9, sem ambiguos)', () => {
    const charset = /^[a-zA-Z2-9]+$/;
    for (let i = 0; i < 30; i++) {
      const s = gerarSenhaTemporaria(8);
      expect(s, `senha "${s}" tem char fora do charset`).toMatch(charset);
    }
  });
});

describe('montarMensagemCredenciais', () => {
  const base = {
    nome: 'Leonardo',
    login: 'leonardo.silva@romatec.local',
    senha: 'k7m4p9qx',
    urlLogin: 'https://romatecvoiceagent-production.up.railway.app/login',
  };

  it('contem header com asteriscos do WhatsApp (negrito)', () => {
    const m = montarMensagemCredenciais(base);
    expect(m).toContain('*Acesso ZAYRA — Romatec*');
  });

  it('inclui nome, login, senha, url em sequencia esperada', () => {
    const m = montarMensagemCredenciais(base);
    expect(m).toContain('Olá, Leonardo!');
    expect(m).toContain('Link: https://romatecvoiceagent-production.up.railway.app/login');
    expect(m).toContain('Login: leonardo.silva@romatec.local');
    expect(m).toContain('Senha temporária: k7m4p9qx');
  });

  it('inclui aviso de troca de senha + contato', () => {
    const m = montarMensagemCredenciais(base);
    expect(m).toMatch(/trocar.*senha/i);
    expect(m).toContain('José Romário');
  });
});

describe('Tela obras.html — UI de acessos integrada', () => {
  it('botao Acessos no header de Colaboradores + handler', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'obras.html'),
      'utf8',
    );
    expect(html).toMatch(/id="btnGerenciarAcessos"/);
    expect(html).toContain('🔐 Acessos');
    expect(html).toContain('abrirModalAcessos');
  });

  it('modal de acessos chama os 4 endpoints', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(
      path.join(__dirname, '..', 'public', 'obras.html'),
      'utf8',
    );
    expect(html).toContain("'/api/admin/colaboradores'");
    expect(html).toMatch(/\/api\/admin\/colaboradores\/' \+ equipeId \+ '\/criar-acesso/);
    expect(html).toMatch(/\/api\/admin\/colaboradores\/' \+ equipeId \+ '\/resetar-senha/);
    expect(html).toMatch(/\/api\/admin\/colaboradores\/' \+ equipeId \+ '\/enviar-credenciais-whatsapp/);
    expect(html).toMatch(/\/api\/admin\/colaboradores\/' \+ equipeId \+ '\/desativar-acesso/);
  });
});
