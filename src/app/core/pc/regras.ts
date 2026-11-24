// ============================================================
// Regras das inovações do "Monte seu PC" (docs/regras-inovacoes.md).
// Funções puras, sem Angular: a tela usa para recalcular na hora a cada escolha,
// e o back-end falso (mock) usa para responder às rotas.
// A mesma lógica existe em Java (com.vantix.api.pc.RegrasPc), que é a fonte da API;
// os testes dos dois lados (regras.spec.ts e RegrasPcTest) conferem os mesmos números.
// Teste: npm run test:regras
// ============================================================

export type TipoPeca = 'cpu' | 'gpu' | 'placa_mae' | 'ram' | 'ssd' | 'hdd' | 'fonte' | 'cooler' | 'gabinete';
export type Nivel = 'minimo' | 'recomendado' | 'ultra';
export type NivelResultado = 'nao_roda' | Nivel;
export type SeloFonte = 'verde' | 'amarelo' | 'vermelho' | 'sem_fonte';

/** Peça de hardware: produto + especificacao_tecnica + quantidade na montagem. */
export interface Peca {
  idProduto: number;
  nome: string;
  preco: number;
  quantidade: number;
  tipoPeca: TipoPeca;
  consumoWatts: number;
  scoreDesempenho: number;
  soquete?: string | null;
  tipoMemoria?: 'DDR4' | 'DDR5' | null;
  formato?: 'ATX' | 'mATX' | 'ITX' | null;
  vramGb?: number | null;
  capacidadeGb?: number | null;
  potenciaFonteW?: number | null;
  eficienciaFonte?: number | null;
}

export interface Requisito {
  nivel: Nivel;
  scoreCpuMin: number;
  scoreGpuMin: number;
  ramMinGb: number;
  vramMinGb: number;
  armazenamentoGb: number;
  fpsEstimado?: number | null;
}

export interface Consumo {
  somaWatts: number;
  consumoUsoW: number;
  consumoCargaW: number;
  potenciaFonteW: number | null;
  eficienciaFonte: number;
  tomadaUsoW: number;
  tomadaCargaW: number;
  custoMensal: number;
  custoAnual: number;
  seloFonte: SeloFonte;
  folgaPercentual: number | null;
  mensagemFonte: string;
}

export interface Aviso {
  codigo: string;
  nivel: 'erro' | 'alerta';
  categoria: 'incompatibilidade' | 'faltando' | 'fonte' | 'aviso';
  mensagem: string;
}

export interface Desempenho {
  scoreCpu: number; scoreGpu: number; scoreTotal: number;
  ramGb: number; vramGb: number; armazenamentoGb: number;
  gpuIntegrada: boolean; preco: number;
}

export interface Avaliacao {
  consumo: Consumo;
  desempenho: Desempenho;
  avisos: Aviso[];
  faltando: string[];
  temIncompatibilidade: boolean;
}

export interface Criterio { criterio: string; rotulo: string; exigido: number; montagem: number; ok: boolean; }
export interface NivelAvaliado { nivel: Nivel; atendido: boolean; fpsEstimado: number | null; criterios: Criterio[]; }
export interface Limitante {
  criterio: string; tipoPeca: TipoPeca; proximoNivel: Nivel; exigido: number; atual: number; deficit: number;
}
export interface ResultadoRoda {
  nivel: NivelResultado; fpsEstimado: number | null; niveis: NivelAvaliado[]; limitante: Limitante | null;
}
export interface Metrica {
  metrica: string; rotulo: string; a: number; b: number; diferencaPercentual: number | null; melhor: 'a' | 'b' | 'empate';
}
export interface Comparacao { metricas: Metrica[]; resumo: string; }

export const FATOR_USO = 0.7;
export const FATOR_CARGA = 1.0;
export const EFICIENCIA_SEM_FONTE = 0.80;
export const FOLGA_MINIMA = 0.20;
export const SCORE_GPU_INTEGRADA = 8;
export const DIAS_POR_MES = 30;
export const NIVEIS: Nivel[] = ['minimo', 'recomendado', 'ultra'];

export const NIVEL_ROTULO: Record<NivelResultado, string> = {
  nao_roda: 'Não roda', minimo: 'Mínimo', recomendado: 'Recomendado', ultra: 'Ultra',
};
export const NOME_PECA: Record<string, string> = {
  cpu: 'processador', placa_mae: 'placa-mãe', ram: 'memória RAM', armazenamento: 'armazenamento (SSD ou HD)',
  fonte: 'fonte', gabinete: 'gabinete', cooler: 'cooler', gpu: 'placa de vídeo', ssd: 'SSD', hdd: 'HD',
};

// ── Inovação 1: consumo e custo de energia ───────────────────
export function consumo(pecas: Peca[], valorKwh: number, horasDia: number): Consumo {
  let soma = 0;
  let fonte: Peca | undefined;
  for (const p of pecas) {
    if (p.tipoPeca === 'fonte') fonte ??= p;
    else soma += p.consumoWatts * p.quantidade;
  }
  const uso = soma * FATOR_USO;
  const carga = soma * FATOR_CARGA;
  const ef = fonte?.eficienciaFonte ?? EFICIENCIA_SEM_FONTE;
  const tomadaUso = uso / ef;
  const tomadaCarga = carga / ef;
  const mensal = tomadaUso / 1000 * horasDia * DIAS_POR_MES * valorKwh;
  const anual = mensal * 12;

  const potencia = fonte?.potenciaFonteW ?? null;
  let selo: SeloFonte;
  let folga: number | null = null;
  let msg: string;
  if (potencia == null) {
    selo = 'sem_fonte';
    msg = 'Sua montagem não tem fonte.';
  } else {
    folga = carga > 0 ? round1((potencia - carga) / carga * 100) : null;
    if (potencia < carga) {
      selo = 'vermelho';
      msg = `A fonte de ${potencia} W não aguenta a carga máxima de ${fmt0(carga)} W.`;
    } else if (potencia < carga * (1 + FOLGA_MINIMA)) {
      selo = 'amarelo';
      msg = `Fonte no limite: folga de ${fmt1(folga!)}%. Recomendado: pelo menos ${Math.ceil(carga * (1 + FOLGA_MINIMA))} W.`;
    } else {
      selo = 'verde';
      msg = folga == null ? 'Fonte adequada.' : `Fonte com folga de ${fmt1(folga)}%.`;
    }
  }
  return {
    somaWatts: soma, consumoUsoW: round1(uso), consumoCargaW: round1(carga), potenciaFonteW: potencia,
    eficienciaFonte: ef, tomadaUsoW: round1(tomadaUso), tomadaCargaW: round1(tomadaCarga),
    custoMensal: round2(mensal), custoAnual: round2(anual), seloFonte: selo, folgaPercentual: folga, mensagemFonte: msg,
  };
}

// ── Desempenho ───────────────────────────────────────────────
export function desempenho(pecas: Peca[]): Desempenho {
  const cpu = primeira(pecas, 'cpu');
  const gpu = todas(pecas, 'gpu').sort((a, b) => b.scoreDesempenho - a.scoreDesempenho)[0];
  const scoreCpu = cpu?.scoreDesempenho ?? 0;
  const scoreGpu = gpu ? gpu.scoreDesempenho : SCORE_GPU_INTEGRADA;
  return {
    scoreCpu, scoreGpu, scoreTotal: scoreTotal(scoreCpu, scoreGpu),
    ramGb: somaCapacidade(pecas, 'ram'),
    vramGb: gpu?.vramGb ?? 0,
    armazenamentoGb: somaCapacidade(pecas, 'ssd') + somaCapacidade(pecas, 'hdd'),
    gpuIntegrada: !gpu,
    preco: round2(pecas.reduce((s, p) => s + p.preco * p.quantidade, 0)),
  };
}

export const scoreTotal = (cpu: number, gpu: number) => Math.round(0.4 * cpu + 0.6 * gpu);

// ── Compatibilidade ──────────────────────────────────────────
const TAMANHO_FORMATO: Record<string, number> = { ITX: 1, mATX: 2, ATX: 3 };

export function avaliar(pecas: Peca[], valorKwh: number, horasDia: number): Avaliacao {
  const c = consumo(pecas, valorKwh, horasDia);
  const avisos: Aviso[] = [];
  const cpu = primeira(pecas, 'cpu');
  const placa = primeira(pecas, 'placa_mae');
  const gabinete = primeira(pecas, 'gabinete');
  const cooler = primeira(pecas, 'cooler');

  if (cpu && placa && !igual(cpu.soquete, placa.soquete)) {
    avisos.push({ codigo: 'C1', nivel: 'erro', categoria: 'incompatibilidade',
      mensagem: `Soquete ${cpu.soquete} não é compatível com a placa ${placa.soquete}.` });
  }
  if (placa) {
    const ram = todas(pecas, 'ram').find(r => !igual(r.tipoMemoria, placa.tipoMemoria));
    if (ram) avisos.push({ codigo: 'C2', nivel: 'erro', categoria: 'incompatibilidade',
      mensagem: `Memória ${ram.tipoMemoria} não é compatível com a placa ${placa.tipoMemoria}.` });
  }
  if (cpu && placa && cpu.tipoMemoria && placa.tipoMemoria && cpu.tipoMemoria !== placa.tipoMemoria) {
    avisos.push({ codigo: 'C3', nivel: 'erro', categoria: 'incompatibilidade',
      mensagem: `O processador usa ${cpu.tipoMemoria}, mas a placa-mãe é ${placa.tipoMemoria}.` });
  }
  if (placa?.formato && gabinete?.formato
      && (TAMANHO_FORMATO[placa.formato] ?? 3) > (TAMANHO_FORMATO[gabinete.formato] ?? 3)) {
    avisos.push({ codigo: 'C4', nivel: 'erro', categoria: 'incompatibilidade',
      mensagem: `Placa ${placa.formato} não cabe no gabinete ${gabinete.formato}.` });
  }
  for (const tipo of ['cpu', 'placa_mae', 'fonte', 'gabinete'] as TipoPeca[]) {
    const n = todas(pecas, tipo).reduce((s, p) => s + p.quantidade, 0);
    if (n > 1) avisos.push({ codigo: 'C5', nivel: 'erro', categoria: 'incompatibilidade',
      mensagem: `A montagem tem ${n} unidades de ${NOME_PECA[tipo]}; use apenas 1.` });
  }
  if (cooler?.soquete && cpu?.soquete && !cooler.soquete.split('/').includes(cpu.soquete)) {
    avisos.push({ codigo: 'C6', nivel: 'alerta', categoria: 'aviso',
      mensagem: `O cooler não lista suporte ao soquete ${cpu.soquete}.` });
  }
  if (!primeira(pecas, 'gpu') && pecas.length) {
    avisos.push({ codigo: 'C7', nivel: 'alerta', categoria: 'aviso',
      mensagem: 'Sem placa de vídeo: usando o vídeo integrado do processador.' });
  }
  if (c.seloFonte === 'vermelho') avisos.push({ codigo: 'C8', nivel: 'erro', categoria: 'fonte', mensagem: c.mensagemFonte });
  else if (c.seloFonte === 'amarelo') avisos.push({ codigo: 'C8', nivel: 'alerta', categoria: 'fonte', mensagem: c.mensagemFonte });

  const faltando: string[] = [];
  for (const tipo of ['cpu', 'placa_mae', 'ram', 'armazenamento', 'fonte', 'gabinete']) {
    const tem = tipo === 'armazenamento'
      ? !!(primeira(pecas, 'ssd') || primeira(pecas, 'hdd'))
      : !!primeira(pecas, tipo as TipoPeca);
    if (!tem) {
      faltando.push(tipo);
      avisos.push({ codigo: 'F', nivel: 'erro', categoria: 'faltando', mensagem: `Sua montagem não tem ${NOME_PECA[tipo]}.` });
    }
  }
  if (!cooler && pecas.length) {
    avisos.push({ codigo: 'F', nivel: 'alerta', categoria: 'faltando',
      mensagem: 'Sem cooler: confira se o processador acompanha cooler box.' });
  }
  const temIncompatibilidade = avisos.some(a => a.nivel === 'erro'
    && (a.categoria === 'incompatibilidade' || a.categoria === 'fonte'));
  return { consumo: c, desempenho: desempenho(pecas), avisos, faltando, temIncompatibilidade };
}

// ── Inovação 3: "Roda ou não?" ───────────────────────────────
export function roda(pecas: Peca[], requisitos: Requisito[], jogo: boolean): ResultadoRoda {
  const d = desempenho(pecas);
  const niveis: NivelAvaliado[] = [];
  let melhor: NivelResultado = 'nao_roda';
  let fps: number | null = null;
  for (const nivel of NIVEIS) {
    const r = requisitos.find(x => x.nivel === nivel);
    if (!r) continue;
    const cs = criterios(d, r);
    const ok = cs.every(c => c.ok);
    niveis.push({ nivel, atendido: ok, fpsEstimado: jogo ? r.fpsEstimado ?? null : null, criterios: cs });
    if (ok) { melhor = nivel; fps = jogo ? r.fpsEstimado ?? null : null; }
  }
  let limitante: Limitante | null = null;
  if (melhor !== 'ultra') {
    const proximo = NIVEIS[melhor === 'nao_roda' ? 0 : NIVEIS.indexOf(melhor) + 1];
    const alvo = niveis.find(n => n.nivel === proximo);
    if (alvo) {
      let pior: Criterio | null = null;
      let maior = -1;
      for (const c of alvo.criterios) {
        if (c.ok) continue;
        const deficit = c.exigido > 0 ? (c.exigido - c.montagem) / c.exigido : 1;
        if (deficit > maior) { maior = deficit; pior = c; }
      }
      if (pior) limitante = { criterio: pior.criterio, tipoPeca: pecaDoCriterio(pior.criterio), proximoNivel: proximo,
        exigido: pior.exigido, atual: pior.montagem, deficit: round1(maior * 100) };
    }
  }
  return { nivel: melhor, fpsEstimado: fps, niveis, limitante };
}

function criterios(d: Desempenho, r: Requisito): Criterio[] {
  return [
    { criterio: 'cpu', rotulo: 'Processador (score)', exigido: r.scoreCpuMin, montagem: d.scoreCpu, ok: d.scoreCpu >= r.scoreCpuMin },
    { criterio: 'gpu', rotulo: 'Placa de vídeo (score)', exigido: r.scoreGpuMin, montagem: d.scoreGpu, ok: d.scoreGpu >= r.scoreGpuMin },
    { criterio: 'ram', rotulo: 'Memória RAM (GB)', exigido: r.ramMinGb, montagem: d.ramGb, ok: d.ramGb >= r.ramMinGb },
    { criterio: 'vram', rotulo: 'Memória de vídeo (GB)', exigido: r.vramMinGb, montagem: d.vramGb, ok: d.vramGb >= r.vramMinGb },
    { criterio: 'armazenamento', rotulo: 'Armazenamento (GB)', exigido: r.armazenamentoGb, montagem: d.armazenamentoGb,
      ok: d.armazenamentoGb >= r.armazenamentoGb },
  ];
}

export function pecaDoCriterio(criterio: string): TipoPeca {
  return criterio === 'cpu' ? 'cpu' : criterio === 'gpu' || criterio === 'vram' ? 'gpu' : criterio === 'ram' ? 'ram' : 'ssd';
}

/** Até 3 peças do catálogo (já filtrado: disponível e com estoque) que resolvem o limitante, da mais barata. */
export function sugerir(lim: Limitante | null, requisitos: Requisito[], montagem: Peca[], catalogo: Peca[]): Peca[] {
  if (!lim) return [];
  const alvo = requisitos.find(r => r.nivel === lim.proximoNivel);
  if (!alvo) return [];
  const placa = primeira(montagem, 'placa_mae');
  const d = desempenho(montagem);
  return catalogo
    .filter(p => {
      switch (lim.criterio) {
        case 'cpu': return p.tipoPeca === 'cpu' && p.scoreDesempenho >= alvo.scoreCpuMin && (!placa || igual(p.soquete, placa.soquete));
        case 'gpu':
        case 'vram': return p.tipoPeca === 'gpu' && p.scoreDesempenho >= alvo.scoreGpuMin && (p.vramGb ?? 0) >= alvo.vramMinGb;
        case 'ram': return p.tipoPeca === 'ram' && (p.capacidadeGb ?? 0) >= alvo.ramMinGb && (!placa || igual(p.tipoMemoria, placa.tipoMemoria));
        default: return (p.tipoPeca === 'ssd' || p.tipoPeca === 'hdd') && (p.capacidadeGb ?? 0) + d.armazenamentoGb >= alvo.armazenamentoGb;
      }
    })
    .filter(p => !montagem.some(m => m.idProduto === p.idProduto))
    .sort((a, b) => a.preco - b.preco)
    .slice(0, 3);
}

// ── Inovação 2: comparação ───────────────────────────────────
export function comparar(nomeA: string, a: Peca[], nomeB: string, b: Peca[], valorKwh: number, horasDia: number): Comparacao {
  const da = desempenho(a), db = desempenho(b);
  const ca = consumo(a, valorKwh, horasDia), cb = consumo(b, valorKwh, horasDia);
  const metricas = [
    metrica('scoreCpu', 'Score de CPU', da.scoreCpu, db.scoreCpu, true),
    metrica('scoreGpu', 'Score de GPU', da.scoreGpu, db.scoreGpu, true),
    metrica('scoreTotal', 'Score total', da.scoreTotal, db.scoreTotal, true),
    metrica('consumo', 'Consumo em carga (W)', ca.consumoCargaW, cb.consumoCargaW, false),
    metrica('custoMensal', 'Custo mensal (R$)', ca.custoMensal, cb.custoMensal, false),
    metrica('preco', 'Preço (R$)', da.preco, db.preco, false),
  ];
  return { metricas, resumo: resumo(nomeA, nomeB, da.scoreTotal, db.scoreTotal, ca.custoMensal, cb.custoMensal) };
}

export const diferencaPercentual = (a: number, b: number): number | null => (a === 0 ? null : round1((b - a) / a * 100));

function metrica(id: string, rotulo: string, a: number, b: number, maiorMelhor: boolean): Metrica {
  const melhor = a === b ? 'empate' : (b > a) === maiorMelhor ? 'b' : 'a';
  return { metrica: id, rotulo, a, b, diferencaPercentual: diferencaPercentual(a, b), melhor };
}

export function resumo(nomeA: string, nomeB: string, scoreA: number, scoreB: number, custoA: number, custoB: number): string {
  const bRapido = scoreB >= scoreA;
  const rapido = bRapido ? nomeB : nomeA;
  const sRapido = Math.max(scoreA, scoreB), sLento = Math.min(scoreA, scoreB);
  const difCusto = round2((bRapido ? custoB : custoA) - (bRapido ? custoA : custoB));
  const custo = moeda(Math.abs(difCusto));
  if (scoreA === scoreB) {
    if (difCusto === 0) return 'Os dois têm o mesmo desempenho e o mesmo custo de energia.';
    return `Os dois têm o mesmo desempenho; o ${nomeB} custa ${moeda(Math.abs(round2(custoB - custoA)))} a ${custoB > custoA ? 'mais' : 'menos'} por mês de energia.`;
  }
  const pct = sLento === 0 ? 'muito' : `${Math.round((sRapido - sLento) / sLento * 100)}%`;
  if (difCusto > 0) return `O ${rapido} é ${pct} mais rápido, mas custa ${custo} a mais por mês de energia.`;
  if (difCusto < 0) return `O ${rapido} é ${pct} mais rápido e ainda economiza ${custo} por mês de energia.`;
  return `O ${rapido} é ${pct} mais rápido, com o mesmo custo de energia.`;
}

// ── Auxiliares ───────────────────────────────────────────────
const primeira = (pecas: Peca[], tipo: TipoPeca) => pecas.find(p => p.tipoPeca === tipo);
const todas = (pecas: Peca[], tipo: TipoPeca) => pecas.filter(p => p.tipoPeca === tipo);
const somaCapacidade = (pecas: Peca[], tipo: TipoPeca) => todas(pecas, tipo).reduce((s, p) => s + (p.capacidadeGb ?? 0) * p.quantidade, 0);
const igual = (a?: string | null, b?: string | null) => !!a && a === b;

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt0 = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmt1 = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const moeda = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Motivo para uma peça ficar esmaecida no modal (incompatível com o que já foi escolhido), ou null.
 * Ex.: "Soquete AM5 não é compatível com a placa LGA1700".
 */
export function motivoIncompativel(candidata: Peca, escolhidas: Peca[]): string | null {
  const cpu = primeira(escolhidas, 'cpu'), placa = primeira(escolhidas, 'placa_mae');
  const gabinete = primeira(escolhidas, 'gabinete');
  const ram = primeira(escolhidas, 'ram');
  switch (candidata.tipoPeca) {
    case 'cpu':
      if (placa && !igual(candidata.soquete, placa.soquete)) return `Soquete ${candidata.soquete} não é compatível com a placa ${placa.soquete}`;
      if (placa?.tipoMemoria && candidata.tipoMemoria && candidata.tipoMemoria !== placa.tipoMemoria) return `Usa ${candidata.tipoMemoria}; a placa é ${placa.tipoMemoria}`;
      return null;
    case 'placa_mae':
      if (cpu && !igual(cpu.soquete, candidata.soquete)) return `Soquete ${candidata.soquete} não é compatível com o processador ${cpu.soquete}`;
      if (cpu?.tipoMemoria && candidata.tipoMemoria && cpu.tipoMemoria !== candidata.tipoMemoria) return `O processador usa ${cpu.tipoMemoria}`;
      if (ram && !igual(ram.tipoMemoria, candidata.tipoMemoria)) return `A memória escolhida é ${ram.tipoMemoria}`;
      if (gabinete?.formato && candidata.formato && (TAMANHO_FORMATO[candidata.formato] ?? 3) > (TAMANHO_FORMATO[gabinete.formato] ?? 3)) {
        return `Placa ${candidata.formato} não cabe no gabinete ${gabinete.formato}`;
      }
      return null;
    case 'ram':
      if (placa && !igual(candidata.tipoMemoria, placa.tipoMemoria)) return `Memória ${candidata.tipoMemoria} não é compatível com a placa ${placa.tipoMemoria}`;
      if (!placa && cpu?.tipoMemoria && candidata.tipoMemoria !== cpu.tipoMemoria) return `O processador usa ${cpu.tipoMemoria}`;
      return null;
    case 'gabinete':
      if (placa?.formato && candidata.formato && (TAMANHO_FORMATO[placa.formato] ?? 3) > (TAMANHO_FORMATO[candidata.formato] ?? 3)) {
        return `A placa ${placa.formato} não cabe neste gabinete ${candidata.formato}`;
      }
      return null;
    case 'cooler':
      if (cpu?.soquete && candidata.soquete && !candidata.soquete.split('/').includes(cpu.soquete)) return `Não lista suporte ao soquete ${cpu.soquete}`;
      return null;
    default:
      return null;
  }
}
