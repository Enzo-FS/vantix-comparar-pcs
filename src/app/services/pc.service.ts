import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { CartItem } from '../models';
import {
  EspecificacaoApi, EspecificacaoRequest, ItemMontagemApi, MontagemApi, SoftwareApi, SoftwareRequest, TarifaApi,
} from '../core/api/api.types';
import * as regras from '../core/pc/regras';
import { Peca, TipoPeca } from '../core/pc/regras';
import { AuthService } from './auth.service';

/** Montagem como a tela usa: do servidor (exemplo ou da conta) ou só do navegador (visitante). */
export interface Montagem {
  /** "S12" = salva no servidor (id 12); "L1732..." = salva só neste navegador. */
  chave: string;
  idServidor: number | null;
  nome: string;
  uf: string;
  horasUsoDia: number;
  origem: 'exemplo' | 'conta' | 'navegador';
  itens: ItemMontagemApi[];
}

/** Os 8 "slots" da tela Monte seu PC. Armazenamento aceita SSD e HD (até 4 unidades). */
export interface Slot { id: string; rotulo: string; tipos: TipoPeca[]; multiplo: boolean; icone: string; }
export const SLOTS: Slot[] = [
  { id: 'cpu',           rotulo: 'Processador (CPU)',  tipos: ['cpu'],          multiplo: false, icone: '🧠' },
  { id: 'placa_mae',     rotulo: 'Placa-mãe',          tipos: ['placa_mae'],    multiplo: false, icone: '🧩' },
  { id: 'ram',           rotulo: 'Memória RAM',        tipos: ['ram'],          multiplo: false, icone: '💾' },
  { id: 'gpu',           rotulo: 'Placa de vídeo (GPU)', tipos: ['gpu'],        multiplo: false, icone: '🎮' },
  { id: 'armazenamento', rotulo: 'Armazenamento',      tipos: ['ssd', 'hdd'],   multiplo: true,  icone: '🗄️' },
  { id: 'fonte',         rotulo: 'Fonte',              tipos: ['fonte'],        multiplo: false, icone: '🔌' },
  { id: 'cooler',        rotulo: 'Cooler',             tipos: ['cooler'],       multiplo: false, icone: '❄️' },
  { id: 'gabinete',      rotulo: 'Gabinete',           tipos: ['gabinete'],     multiplo: false, icone: '🖥️' },
];
export const slotDoTipo = (t: TipoPeca) => SLOTS.find(s => s.tipos.includes(t))!;

export interface Rascunho { nome: string; uf: string; horasUsoDia: number; itens: ItemMontagemApi[]; }

const KEY_LOCAIS = 'vantix_montagens_locais';
const KEY_RASCUNHO = 'vantix_pc_rascunho';
const KEY_VERIFICACAO = 'vantix_pc_verificacao';
export const UF_PADRAO = 'SP';
export const HORAS_PADRAO = 4;

/**
 * Dados e estado do "Monte seu PC". Os cálculos ficam em core/pc/regras.ts e rodam no navegador
 * (o painel de resumo atualiza a cada escolha, sem esperar a rede). A API Java tem as mesmas regras.
 */
@Injectable({ providedIn: 'root' })
export class PcService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private api = environment.apiUrl;

  readonly especificacoes = signal<EspecificacaoApi[]>([]);
  readonly tarifas = signal<TarifaApi[]>([]);
  readonly softwares = signal<SoftwareApi[]>([]);
  private montagensServidor = signal<Montagem[]>([]);
  private montagensLocais = signal<Montagem[]>(ler<Montagem[]>(KEY_LOCAIS) ?? []);
  readonly carregado = signal(false);
  readonly erro = signal('');

  /** Montagem em edição na aba "Montar" (sobrevive à troca de abas e ao recarregar a página). */
  readonly rascunho = signal<Rascunho>(ler<Rascunho>(KEY_RASCUNHO) ?? { nome: '', uf: UF_PADRAO, horasUsoDia: HORAS_PADRAO, itens: [] });

  /** UF e horas escolhidas na Verificação do PC + "assinatura" do carrinho que foi verificado. */
  readonly verificacao = signal<{ uf: string; horasUsoDia: number; assinatura: string } | null>(ler(KEY_VERIFICACAO));

  readonly pecasPorId = computed(() => new Map(this.especificacoes().map(e => [e.idProduto, e])));
  readonly montagens = computed(() => [...this.montagensServidor(), ...this.montagensLocais()]);
  readonly clienteLogado = computed(() => this.auth.user()?.role === 'customer' ? this.auth.user() : null);
  /** Jogos mais populares (Verificação do PC mostra os 3 primeiros). */
  readonly jogosPopulares = computed(() => this.softwares().filter(s => s.tipo === 'jogo').slice(0, 3));

  private carregando: Promise<void> | null = null;

  constructor() {
    this.carregar();
  }

  /** Carrega especificações, tarifas, softwares e montagens (uma vez; "forcar" recarrega). */
  carregar(forcar = false): Promise<void> {
    if (this.carregando && !forcar) return this.carregando;
    this.carregando = (async () => {
      try {
        const [esp, tar, sws] = await Promise.all([
          firstValueFrom(this.http.get<EspecificacaoApi[]>(`${this.api}/especificacoes`)),
          firstValueFrom(this.http.get<TarifaApi[]>(`${this.api}/tarifas`)),
          firstValueFrom(this.http.get<SoftwareApi[]>(`${this.api}/softwares`)),
        ]);
        this.especificacoes.set(esp);
        this.tarifas.set(tar);
        this.softwares.set(sws);
        await this.recarregarMontagens();
        this.erro.set('');
      } catch (e) {
        this.erro.set(e instanceof HttpErrorResponse && e.status === 0
          ? 'Sem conexão com o servidor.' : 'Não foi possível carregar os dados do Monte seu PC.');
        this.carregando = null; // permite tentar de novo
      } finally {
        this.carregado.set(true);
      }
    })();
    return this.carregando;
  }

  async recarregarMontagens(): Promise<void> {
    const lista = await firstValueFrom(this.http.get<MontagemApi[]>(`${this.api}/montagens`));
    this.montagensServidor.set(lista.map(m => ({
      chave: `S${m.id}`, idServidor: m.id, nome: m.nome, uf: m.uf, horasUsoDia: Number(m.horasUsoDia),
      origem: m.exemplo ? 'exemplo' : 'conta', itens: m.itens,
    })));
  }

  // ── Peças e cálculos ─────────────────────────────────────────
  peca(idProduto: number, quantidade = 1): Peca | null {
    const e = this.pecasPorId().get(idProduto);
    return e ? paraPeca(e, quantidade) : null;
  }

  pecas(itens: ItemMontagemApi[]): Peca[] {
    return itens.map(i => this.peca(i.idProduto, i.quantidade)).filter((p): p is Peca => !!p);
  }

  /** Peças disponíveis e com estoque (base das sugestões). */
  catalogo(): Peca[] {
    return this.especificacoes().filter(e => e.disponivel && e.estoque > 0).map(e => paraPeca(e, 1));
  }

  valorKwh(uf: string): number {
    return Number(this.tarifas().find(t => t.uf === uf)?.valorKwh ?? this.tarifas().find(t => t.uf === UF_PADRAO)?.valorKwh ?? 0.82);
  }

  avaliar(itens: ItemMontagemApi[], uf: string, horas: number): regras.Avaliacao {
    return regras.avaliar(this.pecas(itens), this.valorKwh(uf), horas);
  }

  /** Sugestões de produto para uma peça que falta (as 3 mais baratas e compatíveis). */
  sugestoesPara(tipo: string, itens: ItemMontagemApi[]): Peca[] {
    const tipos: TipoPeca[] = tipo === 'armazenamento' ? ['ssd', 'hdd'] : [tipo as TipoPeca];
    const escolhidas = this.pecas(itens);
    const carga = regras.consumo(escolhidas, 1, 1).consumoCargaW;
    return this.catalogo()
      .filter(p => tipos.includes(p.tipoPeca) && !regras.motivoIncompativel(p, escolhidas))
      .filter(p => p.tipoPeca !== 'fonte' || (p.potenciaFonteW ?? 0) >= carga * (1 + regras.FOLGA_MINIMA))
      .sort((a, b) => a.preco - b.preco)
      .slice(0, 3);
  }

  // ── Carrinho e Verificação do PC ─────────────────────────────
  temHardware(itens: CartItem[]): boolean {
    return itens.some(i => this.pecasPorId().has(Number(i.id)));
  }

  itensDoCarrinho(itens: CartItem[]): ItemMontagemApi[] {
    return itens.filter(i => this.pecasPorId().has(Number(i.id))).map(i => ({ idProduto: Number(i.id), quantidade: i.quantity }));
  }

  /** Muda quando o carrinho muda: a verificação feita vale só para aquele carrinho. */
  assinatura(itens: CartItem[]): string {
    return itens.map(i => `${i.id}x${i.quantity}`).sort().join(',');
  }

  marcarVerificado(itens: CartItem[], uf: string, horasUsoDia: number): void {
    const v = { uf, horasUsoDia, assinatura: this.assinatura(itens) };
    this.verificacao.set(v);
    gravar(KEY_VERIFICACAO, v);
  }

  verificado(itens: CartItem[]): boolean {
    return this.verificacao()?.assinatura === this.assinatura(itens);
  }

  // ── Rascunho (aba Montar) ────────────────────────────────────
  atualizarRascunho(m: Partial<Rascunho>): void {
    const r = { ...this.rascunho(), ...m };
    this.rascunho.set(r);
    gravar(KEY_RASCUNHO, r);
  }

  /** Coloca uma peça no slot dela (troca a que estava; no armazenamento, acrescenta). */
  escolher(idProduto: number, substituir?: number): void {
    const p = this.peca(idProduto);
    if (!p) return;
    const slot = slotDoTipo(p.tipoPeca);
    let itens = this.rascunho().itens;
    if (substituir != null) itens = itens.filter(i => i.idProduto !== substituir);
    else if (!slot.multiplo) itens = itens.filter(i => !slot.tipos.includes(this.peca(i.idProduto)?.tipoPeca as TipoPeca));
    const ja = itens.find(i => i.idProduto === idProduto);
    itens = ja ? itens.map(i => (i.idProduto === idProduto ? { ...i, quantidade: Math.min(i.quantidade + 1, 4) } : i))
               : [...itens, { idProduto, quantidade: 1 }];
    this.atualizarRascunho({ itens });
  }

  remover(idProduto: number): void {
    this.atualizarRascunho({ itens: this.rascunho().itens.filter(i => i.idProduto !== idProduto) });
  }

  carregarNoRascunho(m: Montagem): void {
    this.atualizarRascunho({ nome: m.origem === 'exemplo' ? `${m.nome} (cópia)` : m.nome, uf: m.uf,
      horasUsoDia: m.horasUsoDia, itens: m.itens.map(i => ({ ...i })) });
  }

  limparRascunho(): void {
    this.atualizarRascunho({ nome: '', itens: [] });
  }

  // ── Salvar e apagar ──────────────────────────────────────────
  /** Cliente com conta: salva no servidor. Visitante: salva no navegador (e a tela oferece login). */
  async salvar(nome: string, r: Rascunho = this.rascunho()): Promise<Montagem> {
    if (this.clienteLogado()) {
      const m = await firstValueFrom(this.http.post<MontagemApi>(`${this.api}/montagens`,
        { nome, uf: r.uf, horasUsoDia: r.horasUsoDia, itens: r.itens }));
      await this.recarregarMontagens();
      return this.montagens().find(x => x.idServidor === m.id)!;
    }
    const local: Montagem = { chave: `L${Date.now()}`, idServidor: null, nome, uf: r.uf, horasUsoDia: r.horasUsoDia,
      origem: 'navegador', itens: r.itens.map(i => ({ ...i })) };
    this.montagensLocais.update(l => [...l, local]);
    gravar(KEY_LOCAIS, this.montagensLocais());
    return local;
  }

  async apagar(m: Montagem): Promise<void> {
    if (m.origem === 'navegador') {
      this.montagensLocais.update(l => l.filter(x => x.chave !== m.chave));
      gravar(KEY_LOCAIS, this.montagensLocais());
    } else if (m.origem === 'conta' && m.idServidor) {
      await firstValueFrom(this.http.delete(`${this.api}/montagens/${m.idServidor}`));
      await this.recarregarMontagens();
    }
  }

  /** Depois do login do cliente: envia para a conta as montagens que estavam só no navegador. */
  async sincronizarLocais(): Promise<number> {
    if (!this.clienteLogado()) return 0;
    const locais = this.montagensLocais();
    let enviadas = 0;
    for (const m of locais) {
      try {
        await firstValueFrom(this.http.post(`${this.api}/montagens`,
          { nome: m.nome, uf: m.uf, horasUsoDia: m.horasUsoDia, itens: m.itens }));
        this.montagensLocais.update(l => l.filter(x => x.chave !== m.chave));
        enviadas++;
      } catch { /* mantém no navegador */ }
    }
    gravar(KEY_LOCAIS, this.montagensLocais());
    await this.recarregarMontagens();
    return enviadas;
  }

  // ── Cadastros do gerente ─────────────────────────────────────
  async salvarEspecificacao(idProduto: number, e: EspecificacaoRequest): Promise<void> {
    await firstValueFrom(this.http.put(`${this.api}/especificacoes/${idProduto}`, e));
    await this.carregar(true);
  }
  async apagarEspecificacao(idProduto: number): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.api}/especificacoes/${idProduto}`));
    await this.carregar(true);
  }
  async salvarTarifa(uf: string, distribuidora: string, valorKwh: number): Promise<void> {
    await firstValueFrom(this.http.put(`${this.api}/tarifas/${uf}`, { distribuidora, valorKwh }));
    await this.carregar(true);
  }
  async salvarSoftware(id: number | null, s: SoftwareRequest): Promise<void> {
    if (id) await firstValueFrom(this.http.put(`${this.api}/softwares/${id}`, s));
    else await firstValueFrom(this.http.post(`${this.api}/softwares`, s));
    await this.carregar(true);
  }
  async apagarSoftware(id: number): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.api}/softwares/${id}`));
    await this.carregar(true);
  }
}

export function paraPeca(e: EspecificacaoApi, quantidade = 1): Peca {
  return {
    idProduto: e.idProduto, nome: e.nome, preco: Number(e.preco), quantidade, tipoPeca: e.tipoPeca,
    consumoWatts: Number(e.consumoWatts), scoreDesempenho: Number(e.scoreDesempenho), soquete: e.soquete,
    tipoMemoria: e.tipoMemoria, formato: e.formato, vramGb: e.vramGb, capacidadeGb: e.capacidadeGb,
    potenciaFonteW: e.potenciaFonteW, eficienciaFonte: e.eficienciaFonte != null ? Number(e.eficienciaFonte) : null,
  };
}

function ler<T>(chave: string): T | null {
  try { const v = localStorage.getItem(chave); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function gravar(chave: string, valor: unknown): void {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* ignora */ }
}
