import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { EstoqueService } from '../../../services/estoque.service';
import { ToastService } from '../../../services/toast.service';
import { apiErrorMessage } from '../../../core/api/auth.interceptor';
import { parseApiDate } from '../../../core/api/mappers';
import { MovimentacaoApi, SaldoEstoqueApi, TipoMovimentacaoApi } from '../../../core/api/api.types';
import { ImgFallbackDirective } from '../../../components/ui/img-fallback.directive';

type Aba = 'saldo' | 'movimentacoes';
type Filtro = 'todos' | 'baixo' | 'zerado';

const TIPO_ROTULO: Record<TipoMovimentacaoApi, string> = {
  entrada: 'Entrada', saida: 'Saída (venda)', ajuste: 'Ajuste', devolucao: 'Devolução',
};
const MOTIVOS_AJUSTE = ['Inventário (contagem física)', 'Avaria', 'Extravio', 'Correção de lançamento'];

/** Portal do Estoque: saldo de cada produto, entradas de mercadoria, ajustes e histórico de movimentações. */
@Component({
  selector: 'app-controle-estoque',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, DatePipe, ImgFallbackDirective],
  template: `
    <div class="ce-pagina">
      <header class="ce-topo">
        <div>
          <h1 class="ce-titulo">Controle de Estoque</h1>
          <p class="ce-sub">Saldo de cada produto, entradas de mercadoria, ajustes de inventário e histórico de movimentações.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" (click)="carregar()" [disabled]="carregando()">↻ Atualizar</button>
      </header>

      <div class="ce-kpis">
        <div class="ce-kpi"><span class="ce-kpi-num">{{ saldo().length }}</span><span class="ce-kpi-rot">PRODUTOS</span></div>
        <div class="ce-kpi"><span class="ce-kpi-num">{{ totalUnidades() }}</span><span class="ce-kpi-rot">UNIDADES EM ESTOQUE</span></div>
        <button type="button" class="ce-kpi ce-kpi-alerta" (click)="aba.set('saldo'); filtro.set('baixo')">
          <span class="ce-kpi-num">{{ abaixoMinimo() }}</span><span class="ce-kpi-rot">ABAIXO DO MÍNIMO</span></button>
        <button type="button" class="ce-kpi ce-kpi-perigo" (click)="aba.set('saldo'); filtro.set('zerado')">
          <span class="ce-kpi-num">{{ zerados() }}</span><span class="ce-kpi-rot">SEM ESTOQUE</span></button>
      </div>

      <div class="ce-abas" role="tablist">
        <button type="button" role="tab" class="ce-aba" [class.ce-aba-ativa]="aba() === 'saldo'" [attr.aria-selected]="aba() === 'saldo'"
                (click)="aba.set('saldo')">📦 Saldo</button>
        <button type="button" role="tab" class="ce-aba" [class.ce-aba-ativa]="aba() === 'movimentacoes'" [attr.aria-selected]="aba() === 'movimentacoes'"
                (click)="abrirMovimentacoes()">🔁 Movimentações</button>
      </div>

      <p *ngIf="erro()" class="ce-erro" role="alert">{{ erro() }}</p>
      <p *ngIf="carregando() && !saldo().length" class="ce-sub">Carregando…</p>

      <!-- ── Saldo ─────────────────────────────────────── -->
      <section *ngIf="aba() === 'saldo'">
        <div class="ce-filtros">
          <input class="form-input ce-busca" placeholder="Buscar produto ou marca…" [value]="busca()" (input)="busca.set($any($event.target).value)"
                 aria-label="Buscar produto">
          <select class="form-input ce-cat" [value]="categoria()" (change)="categoria.set($any($event.target).value)" aria-label="Categoria">
            <option value="">Todas as categorias</option>
            <option *ngFor="let c of categorias()" [value]="c">{{ c }}</option>
          </select>
          <div class="ce-chips" role="group" aria-label="Filtrar">
            <button *ngFor="let f of filtros" type="button" class="ce-chip" [class.ce-chip-ativo]="filtro() === f.id"
                    [attr.aria-pressed]="filtro() === f.id" (click)="filtro.set(f.id)">{{ f.rotulo }}</button>
          </div>
        </div>

        <div class="ce-tabela-wrap">
          <table class="data-table ce-tabela">
            <thead><tr><th>Produto</th><th>Categoria</th><th class="ce-num">Saldo</th><th class="ce-num">Mínimo</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let s of saldoFiltrado(); trackBy: porProduto">
                <td>
                  <div class="ce-produto">
                    <img [src]="s.imagemUrl" alt="" appImgFallback>
                    <div><p class="ce-nome">{{ s.nome }}</p><p class="ce-marca">{{ s.marca }}<span *ngIf="!s.disponivel"> · fora de venda</span></p></div>
                  </div>
                </td>
                <td>{{ s.categoria }}</td>
                <td class="ce-num"><strong>{{ s.quantidade }}</strong></td>
                <td class="ce-num">{{ s.estoqueMinimo }}</td>
                <td>
                  <span class="ce-situacao" [class.ce-sit-ok]="situacao(s) === 'ok'" [class.ce-sit-baixo]="situacao(s) === 'baixo'"
                        [class.ce-sit-zerado]="situacao(s) === 'zerado'">{{ rotuloSituacao[situacao(s)] }}</span>
                </td>
                <td class="ce-acoes">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="abrirEntrada(s)">+ Entrada</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="abrirAjuste(s)">Ajustar</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="abrirMinimo(s)">Mínimo</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="historico(s)">Histórico</button>
                </td>
              </tr>
              <tr *ngIf="!saldoFiltrado().length && !carregando()"><td colspan="6" class="ce-vazio">Nenhum produto neste filtro.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ── Movimentações ─────────────────────────────── -->
      <section *ngIf="aba() === 'movimentacoes'">
        <div class="ce-filtros">
          <select class="form-input ce-prod" [ngModel]="movProduto()" (ngModelChange)="movProduto.set($event); carregarMovimentacoes()" aria-label="Produto">
            <option [ngValue]="null">Todos os produtos</option>
            <option *ngFor="let s of saldoPorNome()" [ngValue]="s.idProduto">{{ s.nome }}</option>
          </select>
          <div class="ce-chips" role="group" aria-label="Tipo de movimentação">
            <button *ngFor="let t of tipos" type="button" class="ce-chip" [class.ce-chip-ativo]="movTipo() === t.id"
                    [attr.aria-pressed]="movTipo() === t.id" (click)="movTipo.set(t.id); carregarMovimentacoes()">{{ t.rotulo }}</button>
          </div>
        </div>
        <div class="ce-tabela-wrap">
          <table class="data-table ce-tabela">
            <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th class="ce-num">Qtd.</th><th class="ce-num">Saldo após</th><th>Motivo</th><th>Por</th></tr></thead>
            <tbody>
              <tr *ngFor="let m of movs()">
                <td class="ce-data">{{ data(m.criadoEm) | date:'dd/MM/yy HH:mm' }}</td>
                <td>{{ m.produto }}</td>
                <td><span class="ce-tipo" [class]="'ce-tipo ce-tipo-' + m.tipo">{{ rotuloTipo[m.tipo] }}</span></td>
                <td class="ce-num" [class.ce-pos]="m.quantidade > 0" [class.ce-neg]="m.quantidade < 0">{{ m.quantidade > 0 ? '+' : '' }}{{ m.quantidade }}</td>
                <td class="ce-num">{{ m.saldoApos }}</td>
                <td>{{ m.motivo || '—' }}<span *ngIf="m.pedido" class="ce-marca"> · {{ m.pedido }}</span></td>
                <td>{{ m.usuario || 'Sistema' }}</td>
              </tr>
              <tr *ngIf="!movs().length"><td colspan="7" class="ce-vazio">{{ carregandoMovs() ? 'Carregando…' : 'Nenhuma movimentação neste filtro.' }}</td></tr>
            </tbody>
          </table>
        </div>
        <p class="ce-nota">Saídas e devoluções de vendas são registradas automaticamente quando o pagamento é aprovado ou o pedido é cancelado.</p>
      </section>
    </div>

    <!-- ── Modal: entrada / ajuste / mínimo ─────────────── -->
    <div *ngIf="modal() as md" class="modal-overlay" (click)="modal.set(null)">
      <form class="modal ce-modal" role="dialog" aria-modal="true" [attr.aria-label]="tituloModal()" (click)="$event.stopPropagation()" (ngSubmit)="confirmar()">
        <div class="modal-header"><h2>{{ tituloModal() }}</h2></div>
        <div class="modal-body ce-form">
          <p class="ce-modal-produto"><strong>{{ md.produto.nome }}</strong><br>Saldo atual: <strong>{{ md.produto.quantidade }}</strong> · mínimo {{ md.produto.estoqueMinimo }}</p>

          <ng-container *ngIf="md.tipo === 'entrada'">
            <div class="form-group"><label class="form-label" for="ce-qtd">Quantidade recebida</label>
              <input id="ce-qtd" class="form-input" type="number" min="1" name="qtd" [(ngModel)]="md.valor" required></div>
            <div class="form-group"><label class="form-label" for="ce-motivo">Origem (opcional)</label>
              <input id="ce-motivo" class="form-input" name="motivo" [(ngModel)]="md.motivo" placeholder="Ex.: NF 1234 — fornecedor"></div>
            <p class="ce-previa">Novo saldo: <strong>{{ md.produto.quantidade + (md.valor ? +md.valor : 0) }}</strong></p>
          </ng-container>

          <ng-container *ngIf="md.tipo === 'ajuste'">
            <div class="form-group"><label class="form-label" for="ce-contado">Quantidade contada</label>
              <input id="ce-contado" class="form-input" type="number" min="0" name="contado" [(ngModel)]="md.valor" required></div>
            <div class="form-group"><label class="form-label" for="ce-mot">Motivo</label>
              <select id="ce-mot" class="form-input" name="mot" [(ngModel)]="md.motivo">
                <option *ngFor="let m of motivosAjuste" [value]="m">{{ m }}</option>
              </select></div>
            <p class="ce-previa">Diferença: <strong [class.ce-pos]="dif(md) > 0" [class.ce-neg]="dif(md) < 0">{{ dif(md) > 0 ? '+' : '' }}{{ dif(md) }}</strong></p>
          </ng-container>

          <ng-container *ngIf="md.tipo === 'minimo'">
            <div class="form-group"><label class="form-label" for="ce-min">Estoque mínimo</label>
              <input id="ce-min" class="form-input" type="number" min="0" name="min" [(ngModel)]="md.valor" required></div>
            <p class="ce-nota">Abaixo desse número o produto aparece em "Abaixo do mínimo" e no relatório de estoque baixo do gerente.</p>
          </ng-container>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="modal.set(null)">Cancelar</button>
          <button type="submit" class="btn btn-primary" [disabled]="salvando()">{{ salvando() ? 'Salvando…' : 'Confirmar' }}</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .ce-pagina { max-width: 1280px; margin: 0 auto; padding: 0 1.5rem 4rem; }
    .ce-topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .ce-titulo { font-family: var(--font-display); font-size: 1.875rem; color: var(--text-primary); }
    .ce-sub { color: var(--text-tertiary); font-size: var(--text-base); margin-top: .25rem; }
    .ce-erro { color: var(--danger-text); margin-bottom: 1rem; }
    .ce-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: .875rem; margin-bottom: 1.5rem; }
    .ce-kpi { display: flex; flex-direction: column; gap: .15rem; text-align: left; background: var(--bg-card); border: 1px solid var(--border);
      border-radius: var(--r-xl); padding: .9rem 1rem; color: inherit; }
    .ce-kpi-num { font-size: 1.75rem; font-weight: 700; color: var(--text-primary); }
    .ce-kpi-rot { font-size: .68rem; font-weight: 600; letter-spacing: .08em; color: var(--text-tertiary); }
    .ce-kpi-alerta .ce-kpi-num { color: var(--warning-text); }
    .ce-kpi-perigo .ce-kpi-num { color: var(--danger-text); }
    button.ce-kpi:hover { border-color: var(--border-strong); }
    .ce-abas { display: flex; gap: .375rem; margin-bottom: 1.1rem; }
    .ce-aba { padding: .5rem 1rem; border-radius: var(--r-full); font-size: .82rem; font-weight: 600; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-secondary); }
    .ce-aba-ativa { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
    .ce-filtros { display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; margin-bottom: 1rem; }
    .ce-busca { max-width: 300px; }
    .ce-cat, .ce-prod { max-width: 260px; }
    .ce-chips { display: flex; gap: .35rem; flex-wrap: wrap; }
    .ce-chip { padding: .4rem .85rem; border-radius: var(--r-full); font-size: .75rem; font-weight: 500; border: 1px solid var(--border);
      background: var(--bg-card); color: var(--text-tertiary); }
    .ce-chip-ativo { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
    .ce-tabela-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--r-xl); background: var(--bg-card); }
    .ce-tabela { width: 100%; min-width: 860px; }
    .ce-tabela td, .ce-tabela th { padding-left: .75rem; padding-right: .75rem; }
    .ce-num { text-align: right; font-variant-numeric: tabular-nums; }
    .ce-produto { display: flex; gap: .65rem; align-items: center; }
    .ce-produto img { width: 2.4rem; height: 2.4rem; border-radius: var(--r-md); object-fit: cover; flex-shrink: 0; }
    .ce-nome { color: var(--text-primary); font-weight: 600; font-size: .85rem; }
    .ce-marca { color: var(--text-tertiary); font-size: .75rem; }
    .ce-situacao { display: inline-block; padding: .2rem .6rem; border-radius: var(--r-full); font-size: .72rem; font-weight: 600; border: 1px solid; }
    .ce-sit-ok { color: var(--success-text); background: var(--success-bg); border-color: var(--success-border); }
    .ce-sit-baixo { color: var(--warning-text); background: var(--warning-bg); border-color: var(--warning-border); }
    .ce-sit-zerado { color: var(--danger-text); background: var(--danger-bg); border-color: var(--danger-border); }
    .ce-acoes { white-space: nowrap; text-align: right; width: 1%; }
    .ce-acoes .btn { padding: .3rem .5rem; }
    .ce-vazio { text-align: center; color: var(--text-tertiary); padding: 2rem !important; }
    .ce-data { white-space: nowrap; color: var(--text-secondary); }
    .ce-tipo { display: inline-block; padding: .15rem .55rem; border-radius: var(--r-full); font-size: .72rem; font-weight: 600; }
    .ce-tipo-entrada { color: var(--success-text); background: var(--success-bg); }
    .ce-tipo-saida { color: var(--info-text); background: var(--info-bg); }
    .ce-tipo-devolucao { color: var(--brand-400); background: var(--bg-selected); }
    .ce-tipo-ajuste { color: var(--warning-text); background: var(--warning-bg); }
    .ce-pos { color: var(--success-text); }
    .ce-neg { color: var(--danger-text); }
    .ce-nota { color: var(--text-tertiary); font-size: .78rem; margin-top: .75rem; }
    .ce-modal { max-width: 460px; }
    .ce-form { display: flex; flex-direction: column; gap: .85rem; }
    .ce-modal-produto { color: var(--text-secondary); font-size: .88rem; }
    .ce-modal-produto strong { color: var(--text-primary); }
    .ce-previa { color: var(--text-secondary); font-size: .9rem; }
  `],
})
export class ControleEstoqueComponent implements OnInit {
  private estoque = inject(EstoqueService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);

  rotuloTipo = TIPO_ROTULO;
  motivosAjuste = MOTIVOS_AJUSTE;
  rotuloSituacao = { ok: 'Normal', baixo: 'Abaixo do mínimo', zerado: 'Sem estoque' };
  filtros: { id: Filtro; rotulo: string }[] = [
    { id: 'todos', rotulo: 'Todos' }, { id: 'baixo', rotulo: 'Abaixo do mínimo' }, { id: 'zerado', rotulo: 'Sem estoque' },
  ];
  tipos: { id: TipoMovimentacaoApi | ''; rotulo: string }[] = [
    { id: '', rotulo: 'Todas' }, { id: 'entrada', rotulo: 'Entradas' }, { id: 'saida', rotulo: 'Saídas' },
    { id: 'devolucao', rotulo: 'Devoluções' }, { id: 'ajuste', rotulo: 'Ajustes' },
  ];

  aba = signal<Aba>('saldo');
  saldo = signal<SaldoEstoqueApi[]>([]);
  movs = signal<MovimentacaoApi[]>([]);
  carregando = signal(false);
  carregandoMovs = signal(false);
  salvando = signal(false);
  erro = signal('');
  busca = signal('');
  categoria = signal('');
  filtro = signal<Filtro>('todos');
  movProduto = signal<number | null>(null);
  movTipo = signal<TipoMovimentacaoApi | ''>('');
  modal = signal<{ tipo: 'entrada' | 'ajuste' | 'minimo'; produto: SaldoEstoqueApi; valor: number | null; motivo: string } | null>(null);

  totalUnidades = computed(() => this.saldo().reduce((s, x) => s + x.quantidade, 0));
  abaixoMinimo = computed(() => this.saldo().filter(s => this.situacao(s) === 'baixo').length);
  zerados = computed(() => this.saldo().filter(s => s.quantidade === 0).length);
  categorias = computed(() => [...new Set(this.saldo().map(s => s.categoria))].sort());
  saldoPorNome = computed(() => [...this.saldo()].sort((a, b) => a.nome.localeCompare(b.nome)));
  saldoFiltrado = computed(() => {
    const t = this.busca().trim().toLowerCase();
    return this.saldo()
      .filter(s => !this.categoria() || s.categoria === this.categoria())
      .filter(s => this.filtro() === 'todos' || this.situacao(s) === this.filtro())
      .filter(s => !t || `${s.nome} ${s.marca ?? ''}`.toLowerCase().includes(t));
  });

  ngOnInit() {
    if (this.route.snapshot.queryParamMap.get('aba') === 'movimentacoes') this.abrirMovimentacoes();
    this.carregar();
  }

  async carregar() {
    this.carregando.set(true);
    try {
      this.saldo.set(await this.estoque.saldo());
      this.erro.set('');
      if (this.aba() === 'movimentacoes') await this.carregarMovimentacoes();
    } catch (e) {
      this.erro.set(apiErrorMessage(e, 'Não foi possível carregar o estoque.'));
    } finally {
      this.carregando.set(false);
    }
  }

  async carregarMovimentacoes() {
    this.carregandoMovs.set(true);
    try {
      this.movs.set(await this.estoque.movimentacoes({ produto: this.movProduto(), tipo: this.movTipo() }));
    } catch (e) {
      this.toast.show(apiErrorMessage(e, 'Não foi possível carregar as movimentações.'), 'error');
    } finally {
      this.carregandoMovs.set(false);
    }
  }

  abrirMovimentacoes() { this.aba.set('movimentacoes'); this.carregarMovimentacoes(); }
  historico(s: SaldoEstoqueApi) { this.movProduto.set(s.idProduto); this.movTipo.set(''); this.abrirMovimentacoes(); }

  situacao(s: SaldoEstoqueApi): 'ok' | 'baixo' | 'zerado' {
    return s.quantidade === 0 ? 'zerado' : s.quantidade <= s.estoqueMinimo ? 'baixo' : 'ok';
  }
  porProduto = (_: number, s: SaldoEstoqueApi) => s.idProduto;
  data(v: string) { return parseApiDate(v); }
  dif(md: { produto: SaldoEstoqueApi; valor: number | null }) { return (md.valor == null ? md.produto.quantidade : +md.valor) - md.produto.quantidade; }

  abrirEntrada(s: SaldoEstoqueApi) { this.modal.set({ tipo: 'entrada', produto: s, valor: null, motivo: '' }); }
  abrirAjuste(s: SaldoEstoqueApi) { this.modal.set({ tipo: 'ajuste', produto: s, valor: s.quantidade, motivo: MOTIVOS_AJUSTE[0] }); }
  abrirMinimo(s: SaldoEstoqueApi) { this.modal.set({ tipo: 'minimo', produto: s, valor: s.estoqueMinimo, motivo: '' }); }
  tituloModal() {
    const t = this.modal()?.tipo;
    return t === 'entrada' ? 'Registrar entrada de mercadoria' : t === 'ajuste' ? 'Ajustar saldo (inventário)' : 'Estoque mínimo';
  }

  async confirmar() {
    const md = this.modal();
    if (!md || md.valor == null || String(md.valor) === '') { this.toast.show('Informe a quantidade.', 'error'); return; }
    this.salvando.set(true);
    try {
      const id = md.produto.idProduto, v = Number(md.valor);
      const atualizado = md.tipo === 'entrada' ? await this.estoque.entrada(id, v, md.motivo)
        : md.tipo === 'ajuste' ? await this.estoque.ajuste(id, v, md.motivo)
        : await this.estoque.minimo(id, v);
      this.saldo.update(l => l.map(x => (x.idProduto === id ? atualizado : x)));
      this.toast.show(md.tipo === 'entrada' ? `Entrada registrada: ${md.produto.nome} agora tem ${atualizado.quantidade}.`
        : md.tipo === 'ajuste' ? `Saldo ajustado para ${atualizado.quantidade}.` : 'Estoque mínimo atualizado.');
      this.modal.set(null);
      if (this.aba() === 'movimentacoes') this.carregarMovimentacoes();
    } catch (e) {
      this.toast.show(apiErrorMessage(e, 'Não foi possível salvar.'), 'error');
    } finally {
      this.salvando.set(false);
    }
  }
}
