// v3.25.0: tests do catalogo de permissoes + resolverPermissoesEfetivas.

import { describe, it, expect } from 'vitest';
import {
  CATEGORIAS_PERMISSOES,
  PERMISSIONS_VALIDAS,
  DEFAULT_PERMISSIONS_BY_ROLE,
  resolverPermissoesEfetivas,
  temPermissao,
} from '../constants/permissoesSistema';

describe('Catalogo de Permissoes', () => {
  it('tem 14 categorias com pelo menos 50 keys totais', () => {
    expect(CATEGORIAS_PERMISSOES.length).toBeGreaterThanOrEqual(14);
    expect(PERMISSIONS_VALIDAS.size).toBeGreaterThanOrEqual(50);
  });

  it('todas as keys seguem padrao modulo:acao', () => {
    for (const k of PERMISSIONS_VALIDAS) {
      expect(k).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });

  it('todas as keys do catalogo sao unicas', () => {
    const todas = CATEGORIAS_PERMISSOES.flatMap(c => c.itens.map(i => i.key));
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('cada categoria tem icone + label nao vazio', () => {
    for (const c of CATEGORIAS_PERMISSOES) {
      expect(c.icone.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.itens.length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_PERMISSIONS_BY_ROLE', () => {
  it('admin tem TODAS as permissoes', () => {
    expect(DEFAULT_PERMISSIONS_BY_ROLE.admin.length).toBe(PERMISSIONS_VALIDAS.size);
  });

  it('owner = admin (mesmo conjunto)', () => {
    expect(DEFAULT_PERMISSIONS_BY_ROLE.owner).toEqual(DEFAULT_PERMISSIONS_BY_ROLE.admin);
  });

  it('gestor NAO tem config:* nem :excluir nem reverter folha', () => {
    const g = DEFAULT_PERMISSIONS_BY_ROLE.gestor;
    expect(g.some(p => p.startsWith('config:'))).toBe(false);
    expect(g.some(p => p.endsWith(':excluir'))).toBe(false);
    expect(g).not.toContain('folha:reverter');
    expect(g).not.toContain('financeiro:excluir');
    // Mas tem operacoes basicas
    expect(g).toContain('proposta:criar');
    expect(g).toContain('equipe:editar');
  });

  it('colaborador NAO tem nada por default (so /minha-quinzena fora desse sistema)', () => {
    expect(DEFAULT_PERMISSIONS_BY_ROLE.colaborador).toEqual([]);
  });
});

describe('resolverPermissoesEfetivas', () => {
  it('null custom -> usa defaults do role', () => {
    expect(resolverPermissoesEfetivas('admin', null)).toEqual(DEFAULT_PERMISSIONS_BY_ROLE.admin);
    expect(resolverPermissoesEfetivas('gestor', undefined)).toEqual(DEFAULT_PERMISSIONS_BY_ROLE.gestor);
  });

  it('array vazio explicito -> usuario sem permissoes', () => {
    expect(resolverPermissoesEfetivas('admin', [])).toEqual([]);
  });

  it('array com keys validas -> retorna so as validas', () => {
    expect(resolverPermissoesEfetivas('colaborador', ['proposta:ver','equipe:ver']))
      .toEqual(['proposta:ver','equipe:ver']);
  });

  it('filtra keys invalidas silenciosamente', () => {
    expect(resolverPermissoesEfetivas('admin', ['proposta:ver','xxx:invalido','equipe:ver']))
      .toEqual(['proposta:ver','equipe:ver']);
  });
});

describe('temPermissao helper', () => {
  it('admin sem custom -> tem qualquer key valida', () => {
    expect(temPermissao('admin', null, 'proposta:assinar')).toBe(true);
    expect(temPermissao('admin', null, 'config:usuarios')).toBe(true);
    expect(temPermissao('admin', null, 'financeiro:excluir')).toBe(true);
  });

  it('gestor sem custom -> NAO tem :excluir nem config:*', () => {
    expect(temPermissao('gestor', null, 'proposta:criar')).toBe(true);
    expect(temPermissao('gestor', null, 'proposta:excluir')).toBe(false);
    expect(temPermissao('gestor', null, 'config:usuarios')).toBe(false);
  });

  it('colaborador sem custom -> nenhuma', () => {
    expect(temPermissao('colaborador', null, 'proposta:ver')).toBe(false);
  });

  it('user com custom = [] -> nada', () => {
    expect(temPermissao('admin', [], 'proposta:ver')).toBe(false);
  });

  it('user com custom = [...] -> exatamente isso', () => {
    expect(temPermissao('colaborador', ['proposta:ver'], 'proposta:ver')).toBe(true);
    expect(temPermissao('colaborador', ['proposta:ver'], 'proposta:criar')).toBe(false);
  });
});

describe('Smoke — endpoints adminUsers', () => {
  it('routes/adminUsers.ts registra 7 endpoints', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'adminUsers.ts'), 'utf8');
    expect(src).toContain("'/permissions-catalog'");
    expect(src).toContain("'/users-config'");
    expect(src).toContain("/reset-senha");
    expect(src).toContain("'/auditoria'");
    expect(src).toMatch(/router\.use\(requireAuth, requireRole/);
  });

  it('server.ts monta adminUsersRoutes em /api/admin', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8');
    expect(src).toContain('adminUsersRoutes');
    expect(src).toContain("app.use('/api/admin', adminUsersRoutes)");
  });

  it('obras.html renderiza aba Configuracoes', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'obras.html'), 'utf8');
    expect(src).toMatch(/data-tab="config"/);
    expect(src).toMatch(/renderConfiguracoes/);
    expect(src).toMatch(/renderCfgUsuarios/);
    expect(src).toMatch(/abrirModalCfgUser/);
    expect(src).toMatch(/renderCfgAuditoria/);
  });
});
