import { Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PcService } from '../../../services/pc.service';
import { MenuService } from '../../../services/menu.service';
import { ToastService } from '../../../services/toast.service';
import { apiErrorMessage } from '../../../core/api/auth.interceptor';
import { EspecificacaoApi, EspecificacaoRequest, RequisitoApi, SoftwareApi, SoftwareRequest, TarifaApi } from '../../../core/api/api.types';
import { NOME_PECA } from '../../../core/pc/regras';

type Aba = 'especificacoes' | 'tarifas' | 'softwares';
const TIPOS = ['cpu', 'gpu', 'placa_mae', 'ram', 'ssd', 'hdd', 'fonte', 'cooler', 'gabinete'] as const;
const NIVEIS: RequisitoApi['nivel'][] = ['minimo', 'recomendado', 'ultra'];
/** Campos técnicos que cada tipo de peça usa (os outros são gravados como null). */
const CAMPOS_POR_TIPO: Record<string, string[]> = {
  soquete: ['cpu', 'placa_mae', 'cooler'], tipoMemoria: ['cpu', 'placa_mae', 'ram'], formato: ['placa_mae', 'gabinete'],
  vramGb: ['gpu'], capacidadeGb: ['ram', 'ssd', 'hdd'], potenciaFonteW: ['fonte'], eficienciaFonte: ['fonte'],
};
const usaCampo = (tipo: string | undefined, campo: string) => !!tipo && (CAMPOS_POR_TIPO[campo] ?? []).includes(tipo);

/** Painel do gerente: cadastros do "Monte seu PC" (especificações, tarifas, jogos/programas e requisitos). */
@Component({
  selector: 'app-pc-admin',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, DecimalPipe],
  template: `
    <div class="ad-pagina">
      <header class="ad-topo">
        <div>
          <h1 class="ad-titulo">Monte seu PC</h1>
          <p class="ad-sub">Dados técnicos das peças, tarifas de energia por UF e requisitos dos jogos e programas.</p>
        </div>
      </header>

      <div class="ad-abas" role="tablist">
        <button *ngFor="let a of abas" type="button" role="tab" [attr.aria-selected]="aba() === a.id"
                class="ad-aba" [class.ad-aba-ativa]="aba() === a.id" (click)="aba.set(a.id)">{{ a.rotulo }} <span>{{ a.qtd() }}</span></button>
      </div>

      <p *ngIf="pc.erro()" class="ad-erro">{{ pc.erro() }}</p>

      <!-- ── Especificações ─────────────────────────────── -->
      <section *ngIf="aba() === 'especificacoes'">
        <div class="ad-acoes">
          <input class="form-input ad-busca" placeholder="Buscar peça..." [value]="busca()" (input)="busca.set($any($event.target).value)" aria-label="Buscar peça">
          <button type="button" class="btn btn-primary" (click)="novaEspec()">+ Nova especificação</button>
        </div>
        <div class="ad-tabela-wrap">
          <table class="data-table ad-tabela">
            <thead><tr><th>Produto</th><th>Tipo</th><th>Consumo</th><th>Score</th><th>Detalhes</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let e of especFiltradas()">
                <td>{{ e.nome }}</td>
                <td>{{ nome(e.tipoPeca) }}</td>
                <td>{{ e.consumoWatts }} W</td>
                <td>{{ e.scoreDesempenho }}</td>
                <td class="ad-det">{{ detalhe(e) }}</td>
                <td class="ad-botoes">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="editarEspec(e)">Editar</button>
                  <button type="button" class="btn btn-ghost btn-sm ad-apagar" (click)="apagarEspec(e)">Remover</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ── Tarifas ────────────────────────────────────── -->
      <section *ngIf="aba() === 'tarifas'">
        <p class="ad-sub ad-nota">Valores fictícios usados no cálculo do custo de energia (R$ por kWh).</p>
        <div class="ad-tabela-wrap">
          <table class="data-table ad-tabela">
            <thead><tr><th>UF</th><th>Distribuidora</th><th>R$/kWh</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let t of tarifasEdit">
                <td><strong>{{ t.uf }}</strong></td>
                <td><input class="form-input ad-input" [(ngModel)]="t.distribuidora" [attr.aria-label]="'Distribuidora ' + t.uf"></td>
                <td><input class="form-input ad-input ad-num" type="number" step="0.01" min="0.01" [(ngModel)]="t.valorKwh" [attr.aria-label]="'Valor do kWh ' + t.uf"></td>
                <td><button type="button" class="btn btn-ghost btn-sm" [disabled]="!mudou(t)" (click)="salvarTarifa(t)">Salvar</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ── Softwares ──────────────────────────────────── -->
      <section *ngIf="aba() === 'softwares'">
        <div class="ad-acoes"><span></span><button type="button" class="btn btn-primary" (click)="novoSoftware()">+ Novo jogo ou programa</button></div>
        <div class="ad-tabela-wrap">
          <table class="data-table ad-tabela">
            <thead><tr><th>Nome</th><th>Tipo</th><th>Categoria</th><th>Popularidade</th><th>Mínimo (CPU/GPU/RAM)</th><th>Ultra (CPU/GPU/RAM)</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let s of pc.softwares()">
                <td>{{ s.nome }}</td>
                <td>{{ s.tipo }}</td>
                <td>{{ s.categoria }}</td>
                <td>{{ s.popularidade }}</td>
                <td>{{ req(s, 'minimo') }}</td>
                <td>{{ req(s, 'ultra') }}</td>
                <td class="ad-botoes">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="editarSoftware(s)">Editar</button>
                  <button type="button" class="btn btn-ghost btn-sm ad-apagar" (click)="apagarSoftware(s)">Remover</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- Modal especificação -->
    <div *ngIf="espec" class="modal-overlay" (click)="espec = null">
      <form class="modal ad-modal" role="dialog" aria-modal="true" aria-label="Especificação técnica" (click)="$event.stopPropagation()" (ngSubmit)="salvarEspec()">
        <div class="modal-header"><h2>{{ espec.idProduto ? 'Editar' : 'Nova' }} especificação</h2></div>
        <div class="modal-body ad-form">
          <div class="form-group ad-largo">
            <label class="form-label">Produto</label>
            <select class="form-input" name="produto" [(ngModel)]="espec.idProduto" [disabled]="espec.editando" required>
              <option [ngValue]="0" disabled>Escolha um produto…</option>
              <option *ngFor="let p of produtosSemEspec()" [ngValue]="+p.id">{{ p.name }}</option>
              <option *ngIf="espec.editando" [ngValue]="espec.idProduto">{{ espec.nome }}</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo de peça</label>
            <select class="form-input" name="tipo" [(ngModel)]="espec.dados.tipoPeca">
              <option *ngFor="let t of tipos" [value]="t">{{ nome(t) }}</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Consumo (W)</label>
            <input class="form-input" type="number" name="w" min="0" max="600" [(ngModel)]="espec.dados.consumoWatts"></div>
          <div class="form-group"><label class="form-label">Score (0 a 100)</label>
            <input class="form-input" type="number" name="score" min="0" max="100" [(ngModel)]="espec.dados.scoreDesempenho"></div>
          <div class="form-group" *ngIf="usa('soquete')"><label class="form-label">Soquete{{ espec.dados.tipoPeca === 'cooler' ? 's (separe com /)' : '' }}</label>
            <input class="form-input" name="soquete" [(ngModel)]="espec.dados.soquete" placeholder="AM5, LGA1700…"></div>
          <div class="form-group" *ngIf="usa('tipoMemoria')"><label class="form-label">Memória</label>
            <select class="form-input" name="mem" [(ngModel)]="espec.dados.tipoMemoria">
              <option [ngValue]="null">—</option><option value="DDR4">DDR4</option><option value="DDR5">DDR5</option></select></div>
          <div class="form-group" *ngIf="usa('formato')"><label class="form-label">Formato</label>
            <select class="form-input" name="formato" [(ngModel)]="espec.dados.formato">
              <option [ngValue]="null">—</option><option value="ATX">ATX</option><option value="mATX">mATX</option><option value="ITX">ITX</option></select></div>
          <div class="form-group" *ngIf="usa('vramGb')"><label class="form-label">VRAM (GB)</label>
            <input class="form-input" type="number" name="vram" min="1" [(ngModel)]="espec.dados.vramGb"></div>
          <div class="form-group" *ngIf="usa('capacidadeGb')"><label class="form-label">Capacidade (GB)</label>
            <input class="form-input" type="number" name="cap" min="1" [(ngModel)]="espec.dados.capacidadeGb"></div>
          <div class="form-group" *ngIf="usa('potenciaFonteW')"><label class="form-label">Potência (W)</label>
            <input class="form-input" type="number" name="pot" min="1" [(ngModel)]="espec.dados.potenciaFonteW"></div>
          <div class="form-group" *ngIf="usa('eficienciaFonte')"><label class="form-label">Eficiência</label>
            <select class="form-input" name="ef" [(ngModel)]="espec.dados.eficienciaFonte">
              <option [ngValue]="0.8">0,80 (White)</option><option [ngValue]="0.85">0,85 (Bronze)</option><option [ngValue]="0.9">0,90 (Gold)</option></select></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="espec = null">Cancelar</button>
          <button type="submit" class="btn btn-primary" [disabled]="!espec.idProduto || salvando">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
        </div>
      </form>
    </div>

    <!-- Modal software -->
    <div *ngIf="sw" class="modal-overlay" (click)="sw = null">
      <form class="modal ad-modal ad-modal-largo" role="dialog" aria-modal="true" aria-label="Jogo ou programa" (click)="$event.stopPropagation()" (ngSubmit)="salvarSoftware()">
        <div class="modal-header"><h2>{{ sw.id ? 'Editar' : 'Novo' }} jogo ou programa</h2></div>
        <div class="modal-body ad-form">
          <div class="form-group ad-largo"><label class="form-label">Nome</label><input class="form-input" name="nome" [(ngModel)]="sw.dados.nome" required></div>
          <div class="form-group"><label class="form-label">Tipo</label>
            <select class="form-input" name="tipo" [(ngModel)]="sw.dados.tipo"><option value="jogo">Jogo</option><option value="programa">Programa</option></select></div>
          <div class="form-group"><label class="form-label">Categoria</label><input class="form-input" name="cat" [(ngModel)]="sw.dados.categoria" placeholder="FPS, Edição de vídeo…"></div>
          <div class="form-group"><label class="form-label">Popularidade</label><input class="form-input" type="number" name="pop" [(ngModel)]="sw.dados.popularidade"></div>
          <div class="form-group ad-largo"><label class="form-label">URL da imagem</label><input class="form-input" name="img" [(ngModel)]="sw.dados.imagemUrl"></div>
          <div class="ad-largo ad-tabela-wrap">
            <table class="data-table ad-req">
              <thead><tr><th>Nível</th><th>Score CPU</th><th>Score GPU</th><th>RAM GB</th><th>VRAM GB</th><th>Disco GB</th><th *ngIf="sw.dados.tipo === 'jogo'">FPS</th></tr></thead>
              <tbody>
                <tr *ngFor="let r of sw.dados.requisitos; let i = index">
                  <td>{{ rotuloNivel[r.nivel] }}</td>
                  <td><input class="form-input ad-num" type="number" min="0" max="100" [name]="'cpu' + i" [(ngModel)]="r.scoreCpuMin"></td>
                  <td><input class="form-input ad-num" type="number" min="0" max="100" [name]="'gpu' + i" [(ngModel)]="r.scoreGpuMin"></td>
                  <td><input class="form-input ad-num" type="number" min="1" [name]="'ram' + i" [(ngModel)]="r.ramMinGb"></td>
                  <td><input class="form-input ad-num" type="number" min="0" [name]="'vram' + i" [(ngModel)]="r.vramMinGb"></td>
                  <td><input class="form-input ad-num" type="number" min="1" [name]="'disco' + i" [(ngModel)]="r.armazenamentoGb"></td>
                  <td *ngIf="sw.dados.tipo === 'jogo'"><input class="form-input ad-num" type="number" min="1" [name]="'fps' + i" [(ngModel)]="r.fpsEstimado"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="sw = null">Cancelar</button>
          <button type="submit" class="btn btn-primary" [disabled]="salvando">{{ salvando ? 'Salvando…' : 'Salvar' }}</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .ad-pagina { max-width: 1280px; margin: 0 auto; padding: 0 1.5rem 4rem; }
    .ad-topo { margin-bottom: 1.5rem; }
    .ad-titulo { font-family: var(--font-display); font-size: 1.875rem; color: var(--text-primary); }
    .ad-sub { color: var(--text-tertiary); font-size: var(--text-base); margin-top: .25rem; }
    .ad-nota { margin-bottom: 1rem; }
    .ad-erro { color: var(--danger-text); margin-bottom: 1rem; }
    .ad-abas { display: flex; gap: .375rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
    .ad-aba { padding: .5rem 1rem; border-radius: var(--r-full); font-size: .8rem; font-weight: 600; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-secondary); }
    .ad-aba span { opacity: .6; margin-left: .25rem; }
    .ad-aba-ativa { background: var(--brand-600); color: #fff; border-color: var(--brand-600); }
    .ad-acoes { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; }
    .ad-busca { max-width: 320px; }
    .ad-tabela-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-xl); background: var(--bg-card); }
    .ad-tabela { width: 100%; min-width: 760px; }
    .ad-tabela td, .ad-tabela th { padding-left: .75rem; padding-right: .75rem; }
    .ad-det { color: var(--text-tertiary); font-size: .8rem; }
    .ad-botoes { white-space: nowrap; text-align: right; width: 1%; }
    .ad-botoes .btn { padding: .3rem .55rem; }
    .ad-apagar { color: var(--danger-text) !important; }
    .ad-input { padding: .4rem .6rem; font-size: .82rem; }
    .ad-num { width: 6rem; padding: .4rem .5rem; font-size: .82rem; }
    .ad-modal { max-width: 640px; }
    .ad-modal-largo { max-width: 860px; }
    .ad-form { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem 1rem; }
    .ad-largo { grid-column: 1 / -1; }
    .ad-req { width: 100%; min-width: 640px; }
    @media (max-width: 640px) { .ad-form { grid-template-columns: 1fr; } }
  `],
})
export class PcAdminComponent implements OnInit {
  pc = inject(PcService);
  private menu = inject(MenuService);
  private toast = inject(ToastService);

  tipos = TIPOS;
  rotuloNivel: Record<string, string> = { minimo: 'Mínimo', recomendado: 'Recomendado', ultra: 'Ultra' };
  aba = signal<Aba>('especificacoes');
  busca = signal('');
  abas = [
    { id: 'especificacoes' as Aba, rotulo: 'Especificações', qtd: () => this.pc.especificacoes().length },
    { id: 'tarifas' as Aba, rotulo: 'Tarifas', qtd: () => this.pc.tarifas().length },
    { id: 'softwares' as Aba, rotulo: 'Jogos e programas', qtd: () => this.pc.softwares().length },
  ];
  salvando = false;
  espec: { idProduto: number; nome: string; editando: boolean; dados: EspecificacaoRequest } | null = null;
  sw: { id: number | null; dados: SoftwareRequest } | null = null;
  tarifasEdit: TarifaApi[] = [];

  especFiltradas = computed(() => {
    const t = this.busca().trim().toLowerCase();
    return this.pc.especificacoes().filter(e => !t || e.nome.toLowerCase().includes(t) || e.tipoPeca.includes(t));
  });
  produtosSemEspec = computed(() => this.menu.items$().filter(p => !this.pc.pecasPorId().has(Number(p.id))));

  constructor() {
    // A tabela editável de tarifas acompanha os dados carregados (e é refeita depois de cada "Salvar").
    effect(() => { this.pc.tarifas(); untracked(() => this.copiarTarifas()); });
  }

  async ngOnInit() {
    this.menu.reload(true);
    await this.pc.carregar(true);
  }

  nome(t: string) { return NOME_PECA[t] ?? t; }
  detalhe(e: EspecificacaoApi) {
    return [e.soquete, e.tipoMemoria, e.formato, e.vramGb ? e.vramGb + ' GB VRAM' : null, e.capacidadeGb ? e.capacidadeGb + ' GB' : null,
      e.potenciaFonteW ? `${e.potenciaFonteW} W · ${e.eficienciaFonte}` : null].filter(Boolean).join(' · ');
  }
  req(s: SoftwareApi, n: string) {
    const r = s.requisitos.find(x => x.nivel === n);
    return r ? `${r.scoreCpuMin} / ${r.scoreGpuMin} / ${r.ramMinGb} GB` : '—';
  }

  usa(campo: string): boolean { return usaCampo(this.espec?.dados.tipoPeca, campo); }

  novaEspec() {
    this.espec = { idProduto: 0, nome: '', editando: false, dados: { tipoPeca: 'cpu', consumoWatts: 65, scoreDesempenho: 50, soquete: null,
      tipoMemoria: null, formato: null, vramGb: null, capacidadeGb: null, potenciaFonteW: null, eficienciaFonte: 0.85 } };
  }
  editarEspec(e: EspecificacaoApi) {
    this.espec = { idProduto: e.idProduto, nome: e.nome, editando: true, dados: {
      tipoPeca: e.tipoPeca, consumoWatts: e.consumoWatts, scoreDesempenho: e.scoreDesempenho, soquete: e.soquete, tipoMemoria: e.tipoMemoria,
      formato: e.formato, vramGb: e.vramGb, capacidadeGb: e.capacidadeGb, potenciaFonteW: e.potenciaFonteW,
      eficienciaFonte: e.eficienciaFonte != null ? Number(e.eficienciaFonte) : null } };
  }
  async salvarEspec() {
    if (!this.espec) return;
    const d = { ...this.espec.dados };
    for (const c of ['soquete', 'tipoMemoria', 'formato', 'vramGb', 'capacidadeGb', 'potenciaFonteW', 'eficienciaFonte'] as const) {
      if (!usaCampo(d.tipoPeca, c)) (d as Record<string, unknown>)[c] = null;
    }
    await this.executar(() => this.pc.salvarEspecificacao(this.espec!.idProduto, d), 'Especificação salva.', () => (this.espec = null));
  }
  async apagarEspec(e: EspecificacaoApi) {
    if (!confirm(`Remover os dados técnicos de "${e.nome}"? O produto continua à venda, mas sai do Monte seu PC.`)) return;
    await this.executar(() => this.pc.apagarEspecificacao(e.idProduto), 'Especificação removida.');
  }

  private copiarTarifas() { this.tarifasEdit = this.pc.tarifas().map(t => ({ ...t, valorKwh: Number(t.valorKwh) })); }
  mudou(t: TarifaApi) {
    const o = this.pc.tarifas().find(x => x.uf === t.uf);
    return !!o && (o.distribuidora !== t.distribuidora || Number(o.valorKwh) !== Number(t.valorKwh));
  }
  async salvarTarifa(t: TarifaApi) {
    await this.executar(() => this.pc.salvarTarifa(t.uf, t.distribuidora, Number(t.valorKwh)), `Tarifa de ${t.uf} salva.`);
  }

  novoSoftware() {
    this.sw = { id: null, dados: { nome: '', tipo: 'jogo', categoria: '', imagemUrl: null, popularidade: 50,
      requisitos: NIVEIS.map((nivel, i) => ({ nivel, scoreCpuMin: 30 + i * 20, scoreGpuMin: 30 + i * 20, ramMinGb: 8 * (i + 1),
        vramMinGb: 2 * (i + 1), armazenamentoGb: 50, fpsEstimado: [30, 60, 120][i] })) } };
  }
  editarSoftware(s: SoftwareApi) {
    this.sw = { id: s.id, dados: { nome: s.nome, tipo: s.tipo, categoria: s.categoria, imagemUrl: s.imagemUrl, popularidade: s.popularidade,
      requisitos: NIVEIS.map(n => ({ ...(s.requisitos.find(r => r.nivel === n) ?? { nivel: n, scoreCpuMin: 0, scoreGpuMin: 0, ramMinGb: 8,
        vramMinGb: 0, armazenamentoGb: 10, fpsEstimado: null }) })) } };
  }
  async salvarSoftware() {
    if (!this.sw) return;
    await this.executar(() => this.pc.salvarSoftware(this.sw!.id, this.sw!.dados), 'Jogo/programa salvo.', () => (this.sw = null));
  }
  async apagarSoftware(s: SoftwareApi) {
    if (!confirm(`Remover "${s.nome}" e os requisitos dele?`)) return;
    await this.executar(() => this.pc.apagarSoftware(s.id), 'Removido.');
  }

  private async executar(acao: () => Promise<void>, ok: string, depois?: () => void) {
    this.salvando = true;
    try { await acao(); this.toast.show(ok); depois?.(); }
    catch (e) { this.toast.show(apiErrorMessage(e, 'Não foi possível salvar.'), 'error'); }
    finally { this.salvando = false; }
  }
}
