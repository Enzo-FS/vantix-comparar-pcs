// Testes das regras em TypeScript. Usam o executor nativo do Node (sem dependências).
// Rodar: npm run test:regras
// Os números são os mesmos de docs/regras-inovacoes.md, da view vw_consumo_montagem e do RegrasPcTest (Java).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  avaliar, comparar, consumo, motivoIncompativel, roda, sugerir, diferencaPercentual,
  type Peca, type Requisito,
} from './regras.ts';

// ---- peças do seed (dados fictícios) ----
const p = (x: Partial<Peca> & Pick<Peca, 'idProduto' | 'tipoPeca'>): Peca =>
  ({ nome: `#${x.idProduto}`, preco: 1, quantidade: 1, consumoWatts: 0, scoreDesempenho: 50, ...x });
const cpu = (id: number, preco: number, w: number, score: number, soquete: string, mem: 'DDR4' | 'DDR5' | null = null) =>
  p({ idProduto: id, tipoPeca: 'cpu', preco, consumoWatts: w, scoreDesempenho: score, soquete, tipoMemoria: mem });
const gpu = (id: number, preco: number, w: number, score: number, vram: number) =>
  p({ idProduto: id, tipoPeca: 'gpu', preco, consumoWatts: w, scoreDesempenho: score, vramGb: vram });
const placa = (id: number, preco: number, w: number, soquete: string, mem: 'DDR4' | 'DDR5', formato: 'ATX' | 'mATX' | 'ITX') =>
  p({ idProduto: id, tipoPeca: 'placa_mae', preco, consumoWatts: w, soquete, tipoMemoria: mem, formato });
const ram = (id: number, preco: number, w: number, mem: 'DDR4' | 'DDR5', gb: number) =>
  p({ idProduto: id, tipoPeca: 'ram', preco, consumoWatts: w, tipoMemoria: mem, capacidadeGb: gb });
const disco = (id: number, tipo: 'ssd' | 'hdd', preco: number, w: number, gb: number) =>
  p({ idProduto: id, tipoPeca: tipo, preco, consumoWatts: w, capacidadeGb: gb });
const fonte = (id: number, preco: number, pot: number, ef: number) =>
  p({ idProduto: id, tipoPeca: 'fonte', preco, potenciaFonteW: pot, eficienciaFonte: ef });
const cooler = (id: number, preco: number, w: number, soquetes: string) =>
  p({ idProduto: id, tipoPeca: 'cooler', preco, consumoWatts: w, soquete: soquetes });
const gabinete = (id: number, preco: number, w: number, formato: 'ATX' | 'mATX' | 'ITX') =>
  p({ idProduto: id, tipoPeca: 'gabinete', preco, consumoWatts: w, formato });

const SP = 0.82;
const basico = () => [cpu(54, 649.90, 60, 38, 'LGA1700'), placa(65, 799.90, 35, 'LGA1700', 'DDR4', 'mATX'),
  ram(70, 299.90, 6, 'DDR4', 16), gpu(59, 899.90, 75, 25, 4), disco(74, 'ssd', 219.90, 3, 480),
  fonte(81, 299.90, 500, 0.80), cooler(85, 99.90, 4, 'AM4/AM5/LGA1700'), gabinete(89, 249.90, 6, 'mATX')];
const intermediario = () => [cpu(57, 1199.90, 88, 68, 'AM5', 'DDR5'), placa(42, 999.90, 45, 'AM5', 'DDR5', 'mATX'),
  ram(4, 1099.90, 10, 'DDR5', 32), gpu(61, 1899.90, 115, 55, 8), disco(75, 'ssd', 449.90, 6, 1000),
  fonte(82, 449.90, 650, 0.85), cooler(41, 329.90, 6, 'AM5/LGA1700'), gabinete(43, 399.90, 8, 'ATX')];
const avancado = () => [cpu(2, 1699.90, 120, 92, 'AM5', 'DDR5'), placa(67, 2899.90, 80, 'AM5', 'DDR5', 'ATX'),
  ram(73, 1999.90, 10, 'DDR5', 64), gpu(63, 12999.90, 450, 100, 24), disco(3, 'ssd', 849.90, 7, 2000),
  disco(78, 'hdd', 429.90, 7, 2000), fonte(40, 899.90, 850, 0.90), cooler(87, 899.90, 15, 'AM4/AM5/LGA1700'),
  gabinete(91, 899.90, 12, 'ATX')];
const fc26: Requisito[] = [
  { nivel: 'minimo', scoreCpuMin: 35, scoreGpuMin: 30, ramMinGb: 8, vramMinGb: 4, armazenamentoGb: 100, fpsEstimado: 60 },
  { nivel: 'recomendado', scoreCpuMin: 55, scoreGpuMin: 50, ramMinGb: 12, vramMinGb: 6, armazenamentoGb: 100, fpsEstimado: 60 },
  { nivel: 'ultra', scoreCpuMin: 70, scoreGpuMin: 70, ramMinGb: 16, vramMinGb: 8, armazenamentoGb: 100, fpsEstimado: 120 },
];

describe('consumo e custo', () => {
  test('PC Básico bate com a view do banco', () => {
    const c = consumo(basico(), SP, 4);
    assert.equal(c.somaWatts, 189);
    assert.equal(c.consumoUsoW, 132.3);
    assert.equal(c.tomadaUsoW, 165.4);
    assert.equal(c.custoMensal, 16.27);
    assert.equal(c.custoAnual, 195.27);
    assert.equal(c.seloFonte, 'verde');
  });
  test('PC Intermediário e Avançado', () => {
    assert.equal(consumo(intermediario(), SP, 4).custoMensal, 22.53);
    const a = consumo(avancado(), SP, 6);
    assert.equal(a.somaWatts, 701);
    assert.equal(a.custoMensal, 80.47);
    assert.equal(a.custoAnual, 965.70);
    assert.equal(a.folgaPercentual, 21.3);
  });
  test('sem fonte usa 0,80 e selos amarelo/vermelho', () => {
    const s = consumo([gpu(1, 1, 100, 50, 8)], 1, 10);
    assert.equal(s.seloFonte, 'sem_fonte');
    assert.equal(s.tomadaUsoW, 87.5);
    const base = [gpu(1, 1, 450, 100, 24), cpu(2, 1, 170, 90, 'AM5')]; // 620 W
    const amarelo = consumo([...base, fonte(3, 1, 700, 0.9)], 1, 1);
    assert.equal(amarelo.seloFonte, 'amarelo');
    assert.match(amarelo.mensagemFonte, /744 W/);
    assert.equal(consumo([...base, fonte(3, 1, 500, 0.8)], 1, 1).seloFonte, 'vermelho');
    assert.equal(consumo([...base, fonte(3, 1, 744, 0.9)], 1, 1).seloFonte, 'verde');
  });
});

describe('compatibilidade', () => {
  test('exemplos sem erro', () => {
    for (const pc of [basico(), intermediario(), avancado()]) {
      const a = avaliar(pc, SP, 4);
      assert.equal(a.temIncompatibilidade, false, JSON.stringify(a.avisos));
      assert.deepEqual(a.faltando, []);
    }
  });
  test('soquete, memória, formato, repetidas, cooler e GPU integrada', () => {
    const a = avaliar([cpu(55, 1, 65, 52, 'AM4', 'DDR4'), placa(42, 1, 45, 'AM5', 'DDR5', 'ATX'),
      ram(72, 1, 8, 'DDR4', 16), gabinete(89, 1, 6, 'mATX'), fonte(1, 1, 500, 0.8), fonte(2, 1, 500, 0.8),
      cooler(41, 1, 6, 'AM5/LGA1700')], SP, 4);
    const msgs = a.avisos.map(x => x.mensagem);
    assert.ok(msgs.includes('Soquete AM4 não é compatível com a placa AM5.'));
    assert.ok(msgs.includes('Memória DDR4 não é compatível com a placa DDR5.'));
    assert.ok(msgs.includes('Placa ATX não cabe no gabinete mATX.'));
    assert.ok(a.avisos.some(x => x.codigo === 'C3'));
    assert.ok(msgs.includes('A montagem tem 2 unidades de fonte; use apenas 1.'));
    assert.ok(msgs.includes('O cooler não lista suporte ao soquete AM4.'));
    assert.ok(a.avisos.some(x => x.codigo === 'C7'));
    assert.equal(a.temIncompatibilidade, true);
  });
  test('peça faltando não bloqueia a compra', () => {
    const a = avaliar([gpu(1, 1, 100, 50, 8)], SP, 4);
    assert.deepEqual(a.faltando, ['cpu', 'placa_mae', 'ram', 'armazenamento', 'fonte', 'gabinete']);
    assert.ok(a.avisos.some(x => x.mensagem === 'Sua montagem não tem fonte.'));
    assert.equal(a.temIncompatibilidade, false);
  });
  test('motivo da peça esmaecida no modal', () => {
    assert.equal(motivoIncompativel(cpu(2, 1, 120, 92, 'AM5', 'DDR5'), [placa(65, 1, 35, 'LGA1700', 'DDR4', 'mATX')]),
      'Soquete AM5 não é compatível com a placa LGA1700');
    assert.equal(motivoIncompativel(cpu(56, 1, 65, 56, 'LGA1700'), [placa(65, 1, 35, 'LGA1700', 'DDR4', 'mATX')]), null);
    assert.equal(motivoIncompativel(gabinete(90, 1, 2, 'ITX'), [placa(42, 1, 45, 'AM5', 'DDR5', 'mATX')]),
      'A placa mATX não cabe neste gabinete ITX');
  });
});

describe('roda ou não', () => {
  test('PC Básico não roda FC 26 e a GPU limita', () => {
    const r = roda(basico(), fc26, true);
    assert.equal(r.nivel, 'nao_roda');
    assert.equal(r.fpsEstimado, null);
    assert.equal(r.limitante?.tipoPeca, 'gpu');
    assert.equal(r.limitante?.proximoNivel, 'minimo');
    assert.equal(r.limitante?.deficit, 16.7);
  });
  test('Intermediário recomendado, Avançado ultra', () => {
    const i = roda(intermediario(), fc26, true);
    assert.equal(i.nivel, 'recomendado');
    assert.equal(i.fpsEstimado, 60);
    const a = roda(avancado(), fc26, true);
    assert.equal(a.nivel, 'ultra');
    assert.equal(a.fpsEstimado, 120);
    assert.equal(a.limitante, null);
    assert.equal(roda(avancado(), fc26, false).fpsEstimado, null);
  });
  test('sugere até 3 GPUs mais baratas que resolvem', () => {
    const catalogo = [gpu(60, 1299.90, 132, 45, 8), gpu(61, 1899.90, 115, 55, 8), gpu(62, 3699.90, 263, 80, 16),
      gpu(1, 4699.90, 220, 76, 12), gpu(59, 899.90, 75, 25, 4)];
    const r = roda(basico(), fc26, true);
    assert.deepEqual(sugerir(r.limitante, fc26, basico(), catalogo).map(x => x.idProduto), [60, 61, 62]);
  });
});

describe('comparação', () => {
  test('Básico × Intermediário', () => {
    const c = comparar('PC Básico', basico(), 'PC Intermediário', intermediario(), SP, 4);
    const m = (id: string) => c.metricas.find(x => x.metrica === id)!;
    assert.equal(m('scoreCpu').diferencaPercentual, 78.9);
    assert.equal(m('scoreGpu').diferencaPercentual, 120);
    assert.equal(m('scoreTotal').diferencaPercentual, 100);
    assert.equal(m('consumo').diferencaPercentual, 47.1);
    assert.equal(m('custoMensal').diferencaPercentual, 38.5);
    assert.equal(m('preco').diferencaPercentual, 94.1);
    assert.equal(m('custoMensal').melhor, 'a');
    assert.equal(c.resumo, 'O PC Intermediário é 100% mais rápido, mas custa R$ 6,26 a mais por mês de energia.');
  });
  test('empate e base zero', () => {
    assert.equal(comparar('A', basico(), 'B', basico(), SP, 4).resumo, 'Os dois têm o mesmo desempenho e o mesmo custo de energia.');
    assert.equal(diferencaPercentual(0, 10), null);
  });
});
