// v3.23.2: versão lida do package.json em runtime — fonte única da verdade.
// Antes precisava bumpar manualmente AGENT_IDENTITY.version + sw.js CACHE +
// package.json a cada release (e errar UM gerava o bug "deploy OK no Railway
// mas a versão não muda no app" — porque o badge mostra esta versão e o SW
// só invalida cache quando a chave dele muda).
//
// __dirname em dev (tsx watch src/server.ts) = .../src/agent
// __dirname em prod (node dist/server.js)    = .../dist/agent
// Em ambos os casos, ../../package.json resolve para a raiz do repo.
import { readFileSync } from 'fs';
import { join } from 'path';

function readPackageVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    if (typeof pkg.version === 'string' && pkg.version.length > 0) {
      return pkg.version;
    }
  } catch (err) {
    console.warn('[identity] falha ao ler package.json:', err);
  }
  return '0.0.0-unknown';
}

export const AGENT_IDENTITY = {
  name: 'ZAYRA',
  fullName: 'Zona de Automação e Yield Romatec Agent',
  version: readPackageVersion(),
  company: 'Romatec Consultoria Total',
  ceo: 'José Romário',
  language: 'pt-BR',
  personality: 'direta, inteligente, executiva',
  origin:
    'Meu nome foi escolhido pelo CEO José Romário e significa Zona de Automação e Yield Romatec Agent. Cada letra representa minha missão: automatizar processos, otimizar resultados e integrar os sistemas da Romatec.',
};
