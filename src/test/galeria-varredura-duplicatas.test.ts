// v3.110.0: varredura MANUAL de duplicatas — nucleo geografico.
//
// A varredura tem duas categorias:
//   'identica' — mesmo SHA-256 (certeza, mas raro: o carimbo queimado no JPEG
//                carrega o horario, entao duas capturas nunca batem byte a byte);
//   'provavel' — mesmo lugar + quase o mesmo instante. E o caso REAL do campo:
//                duas fotos da mesma parede com segundos de diferenca.
//
// A categoria 'provavel' depende inteiramente do calculo de distancia. Se a
// haversine estiver errada por um fator de escala, a varredura falha em SILENCIO:
// ou nao agrupa nada (raio efetivo minusculo) ou agrupa a obra inteira (raio
// gigante) — e nos dois casos parece "funcionando". Dai estes testes.
//
// Referencia: em Acailandia/MA (~-4.95, -47.50), 1 grau de latitude ~ 111 km.

import { describe, it, expect } from 'vitest';
import { distanciaMetros } from '../integrations/galeria';

const ACAILANDIA = { lat: -4.9472, lng: -47.5036 };

describe('varredura de duplicatas — distancia geografica', () => {
  it('1. mesmo ponto = 0 metros', () => {
    expect(distanciaMetros(ACAILANDIA.lat, ACAILANDIA.lng, ACAILANDIA.lat, ACAILANDIA.lng)).toBe(0);
  });

  it('2. 1 grau de latitude ~ 111 km (escala correta)', () => {
    const d = distanciaMetros(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('3. duas fotos da mesma parede (~5 m) caem dentro do raio padrao de 25 m', () => {
    // ~0.000045 grau de latitude ~ 5 m
    const d = distanciaMetros(ACAILANDIA.lat, ACAILANDIA.lng, ACAILANDIA.lat + 0.000045, ACAILANDIA.lng);
    expect(d).toBeLessThan(25);
  });

  it('4. lotes vizinhos a ~100 m NAO entram no mesmo grupo', () => {
    // ~0.0009 grau de latitude ~ 100 m
    const d = distanciaMetros(ACAILANDIA.lat, ACAILANDIA.lng, ACAILANDIA.lat + 0.0009, ACAILANDIA.lng);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });

  it('5. e simetrica (A->B == B->A)', () => {
    const a = distanciaMetros(-4.9472, -47.5036, -4.9481, -47.5029);
    const b = distanciaMetros(-4.9481, -47.5029, -4.9472, -47.5036);
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });

  it('6. longitude conta menos que latitude longe do equador (nao confundiu os eixos)', () => {
    const dLat = distanciaMetros(-4.9472, -47.5036, -4.9472 + 0.001, -47.5036);
    const dLng = distanciaMetros(-4.9472, -47.5036, -4.9472, -47.5036 + 0.001);
    expect(dLat).toBeGreaterThan(dLng);
  });

  it('7. obras em cidades diferentes ficam a dezenas de km (nunca agrupadas)', () => {
    // Acailandia -> Imperatriz, ~ 100 km
    const d = distanciaMetros(-4.9472, -47.5036, -5.5264, -47.4919);
    expect(d).toBeGreaterThan(60_000);
  });
});
