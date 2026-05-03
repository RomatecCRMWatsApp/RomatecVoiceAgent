import { describe, it, expect } from 'vitest';
import { AGENT_IDENTITY } from './identity';

describe('AGENT_IDENTITY', () => {
  it('mantem campos basicos coerentes', () => {
    expect(AGENT_IDENTITY.name).toBe('ZAYRA');
    expect(AGENT_IDENTITY.language).toBe('pt-BR');
    expect(AGENT_IDENTITY.company).toContain('Romatec');
    expect(AGENT_IDENTITY.ceo).toContain('Romário');
  });

  it('versao segue semver basico (x.y.z)', () => {
    expect(AGENT_IDENTITY.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
