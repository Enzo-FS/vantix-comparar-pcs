import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { CartService } from '../../services/cart.service';
import { PcService, UF_PADRAO, HORAS_PADRAO } from '../../services/pc.service';
import { ToastService } from '../../services/toast.service';
import { NIVEL_ROTULO, NOME_PECA, Peca, Requisito, roda } from '../../core/pc/regras';
import { CheckoutStepsComponent } from '../../components/pc/checkout-steps.component';
import { PcEnergiaComponent } from '../../components/pc/pc-energia.component';
import { PcChecklistComponent } from '../../components/pc/pc-checklist.component';
import { ImgFallbackDirective } from '../../components/ui/img-fallback.directive';
import { PcCompararModalComponent } from '../../components/pc/pc-comparar-modal.component';

/**
 * Tela 4: Verificação do PC. Etapa obrigatória entre o carrinho e o checkout quando o carrinho
 * tem peças de hardware: monta um PC temporário com essas peças e mostra compatibilidade,
 * fonte, consumo, custo de energia e o que roda.
 */
@Component({
  selector: 'app-verificacao',
  standalone: true,
  imports: [NgFor, NgIf, RouterLink, CheckoutStepsComponent, PcEnergiaComponent, PcChecklistComponent, ImgFallbackDirective, PcCompararModalComponent],
  template: `
    <div class="pc-page">
      <div class="container">
        <app-checkout-steps atual="verificacao"></app-checkout-steps>
        <h1 class="pc-titulo">Verificação do PC</h1>
        <p class="pc-sub vf-sub">Conferimos as peças de hardware do seu carrinho antes do pagamento.</p>

        <p *ngIf="!pc.carregado()" class="pc-sub">Carregando dados técnicos…</p>

        <div *ngIf="pc.carregado()" class="vf-grid">
          <div class="vf-col">
            <section class="pc-card">
              <div class="pc-card-body">
                <h2 class="vf-h2">Peças verificadas ({{ pecas().length }})</h2>
                <ul class="vf-pecas">
                  <li *ngFor="let p of pecas()">
                    <span class="vf-tipo">{{ nome(p.tipoPeca) }}</span>
                    <span class="vf-peca">{{ p.quantidade > 1 ? p.quantidade + '× ' : '' }}{{ p.nome }}</span>
                    <span class="vf-w">{{ p.consumoWatts * p.quantidade }} W</span>
                  </li>
                </ul>
              </div>
            </section>

            <section class="pc-card">
              <div class="pc-card-body">
                <h2 class="vf-h2">Compatibilidade</h2>
                <app-pc-checklist [avaliacao]="av()" [pecas]="pecas()"></app-pc-checklist>
              </div>
            </section>

            <section *ngIf="av().faltando.length" class="pc-card">
              <div class="pc-card-body">
                <h2 class="vf-h2">Falta alguma peça?</h2>
                <div *ngFor="let f of av().faltando" class="vf-falta">
                  <p class="pc-erro-box">Sua montagem não tem {{ nome(f) }}.</p>
                  <div class="vf-sugestoes">
                    <div *ngFor="let s of sugestoes(f)" class="pc-mini-produto">
                      <img [src]="pc.pecasPorId().get(s.idProduto)?.imagemUrl" [alt]="" appImgFallback>
                      <div class="vf-sug-info">
                        <p class="vf-sug-nome">{{ s.nome }}</p>
                        <p class="vf-sug-meta">{{ brl(s.preco) }} · {{ s.consumoWatts }} W</p>
                      </div>
                      <button type="button" class="btn btn-primary btn-sm" (click)="adicionar(s)">Adicionar ao carrinho</button>
                    </div>
                  </div>
                </div>
                <p class="vf-nota">Você também pode continuar sem essas peças (por exemplo, se já tiver em casa).</p>
              </div>
            </section>

            <section class="pc-card">
              <div class="pc-card-body">
                <h2 class="vf-h2">Roda ou não?</h2>
                <p class="vf-nota">Os 3 jogos mais populares da loja com estas peças:</p>
                <ul class="vf-jogos">
                  <li *ngFor="let j of jogos()">
                    <span class="vf-jogo-nome">{{ j.nome }}</span>
                    <span class="pc-nivel pc-nivel-mini" [class]="'pc-nivel pc-nivel-mini pc-nivel-' + j.nivel"><strong>{{ rotulo[j.nivel] }}</strong></span>
                    <span class="vf-fps">{{ j.fps ? '~' + j.fps + ' FPS' : '' }}</span>
                  </li>
                </ul>
                <a routerLink="/monte-seu-pc/roda" class="vf-link">Ver outros jogos e programas →</a>
              </div>
            </section>
          </div>

          <aside class="vf-lateral">
            <section class="pc-card">
              <div class="pc-card-body">
                <h2 class="vf-h2">Energia</h2>
                <app-pc-energia [consumo]="av().consumo" [uf]="uf()" [horas]="horas()"
                                (ufChange)="uf.set($event)" (horasChange)="horas.set($event)"></app-pc-energia>
              </div>
            </section>

            <section class="pc-card vf-acoes">
              <div class="pc-card-body">
                <div *ngIf="av().temIncompatibilidade" class="pc-erro-box vf-alerta" role="alert">
                  <strong>Atenção: há incompatibilidade.</strong> As peças em vermelho podem não funcionar juntas.
                  Volte ao carrinho para trocar ou continue por sua conta.
                </div>
                <button *ngIf="!av().temIncompatibilidade" type="button" class="btn btn-primary vf-btn" (click)="continuar()" data-teste="ir-checkout">
                  Ir para o checkout →
                </button>
                <button *ngIf="av().temIncompatibilidade" type="button" class="btn btn-danger vf-btn" (click)="continuar()" data-teste="continuar-mesmo-assim">
                  Continuar mesmo assim
                </button>
                <button type="button" class="btn btn-outline vf-comparar" (click)="comparando.set(true)" data-teste="comparar-pcs">
                  ⚖️ Comparar com outro PC
                </button>
                <a routerLink="/carrinho" class="btn btn-ghost vf-voltar">← Voltar ao carrinho</a>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>

    <app-pc-comparar-modal *ngIf="comparando()" [itensCarrinho]="itens()" [uf]="uf()" [horas]="horas()"
                           (fechar)="comparando.set(false)"></app-pc-comparar-modal>
  `,
  styles: [`
    .vf-sub { margin-bottom: 1.5rem; }
    .vf-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 1.25rem; align-items: start; }
    .vf-col { display: flex; flex-direction: column; gap: 1rem; }
    .vf-lateral { position: sticky; top: 5.5rem; display: flex; flex-direction: column; gap: 1rem; }
    .vf-h2 { font-size: 1.05rem; color: var(--stone-900); margin-bottom: .75rem; }
    .vf-pecas { list-style: none; display: flex; flex-direction: column; }
    .vf-pecas li { display: grid; grid-template-columns: 8.5rem 1fr auto; gap: .5rem; padding: .45rem 0; font-size: .85rem;
      border-top: 1px solid var(--stone-100); }
    .vf-pecas li:first-child { border-top: none; }
    .vf-tipo { color: var(--stone-500); }
    .vf-tipo::first-letter { text-transform: uppercase; }
    .vf-peca { color: var(--stone-900); font-weight: 600; }
    .vf-w { color: var(--stone-500); font-variant-numeric: tabular-nums; }
    .vf-falta + .vf-falta { margin-top: 1rem; }
    .vf-sugestoes { display: flex; flex-direction: column; gap: .4rem; margin-top: .5rem; }
    .vf-sug-info { flex: 1; min-width: 0; }
    .vf-sug-nome { font-weight: 600; font-size: .84rem; color: var(--stone-900); }
    .vf-sug-meta { font-size: .74rem; color: var(--stone-500); }
    .vf-nota { font-size: .78rem; color: var(--stone-500); margin-top: .6rem; }
    .vf-jogos { list-style: none; margin: .5rem 0 .75rem; }
    .vf-jogos li { display: grid; grid-template-columns: 1fr auto 5rem; gap: .6rem; align-items: center; padding: .45rem 0;
      border-top: 1px solid var(--stone-100); font-size: .88rem; }
    .vf-jogo-nome { font-weight: 600; color: var(--stone-900); }
    .vf-fps { font-size: .78rem; color: var(--stone-500); text-align: right; }
    .vf-link { font-size: .82rem; color: var(--brand-700); font-weight: 600; }
    .vf-alerta { margin-bottom: .75rem; font-size: .82rem; }
    .vf-btn { width: 100%; justify-content: center; height: 3rem; }
    .vf-comparar { width: 100%; justify-content: center; margin-top: .5rem; color: var(--brand-700); border-color: var(--brand-200); }
    .vf-voltar { width: 100%; justify-content: center; margin-top: .4rem; color: var(--stone-600); }
    @media (max-width: 900px) { .vf-grid { grid-template-columns: minmax(0, 1fr); } .vf-lateral { position: static; } }
    @media (max-width: 520px) { .vf-pecas li { grid-template-columns: 1fr auto; } .vf-tipo { grid-column: 1 / -1; font-size: .72rem; } }
  `],
})
export class VerificacaoComponent implements OnInit {
  pc = inject(PcService);
  private cart = inject(CartService);
  private router = inject(Router);
  private toast = inject(ToastService);

  rotulo = NIVEL_ROTULO;
  private carrinho = toSignal(this.cart.items, { initialValue: this.cart.getItems() });
  uf = signal(this.pc.verificacao()?.uf ?? this.pc.rascunho().uf ?? UF_PADRAO);
  horas = signal(this.pc.verificacao()?.horasUsoDia ?? this.pc.rascunho().horasUsoDia ?? HORAS_PADRAO);

  /** Modal "Qual PC é melhor?" (inovação 3). */
  comparando = signal(false);

  itens = computed(() => this.pc.itensDoCarrinho(this.carrinho()));
  pecas = computed(() => this.pc.pecas(this.itens()));
  av = computed(() => this.pc.avaliar(this.itens(), this.uf(), this.horas()));
  jogos = computed(() => this.pc.jogosPopulares().map(s => {
    const r = roda(this.pecas(), s.requisitos as Requisito[], true);
    return { nome: s.nome, nivel: r.nivel, fps: r.fpsEstimado };
  }));

  async ngOnInit() {
    await this.pc.carregar();
    const itens = this.cart.getItems();
    if (!itens.length) { this.router.navigate(['/carrinho']); return; }
    // Sem hardware (ou dados técnicos indisponíveis) a etapa não se aplica.
    if (!this.pc.temHardware(itens)) this.router.navigate(['/checkout'], { replaceUrl: true });
  }

  nome(t: string) { return NOME_PECA[t] ?? t; }
  sugestoes(tipo: string) { return this.pc.sugestoesPara(tipo, this.itens()); }
  brl(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  adicionar(p: Peca) {
    const e = this.pc.pecasPorId().get(p.idProduto)!;
    this.cart.addItem({ id: String(e.idProduto), name: e.nome, description: '', price: Number(e.preco),
      category: e.categoria, image: e.imagemUrl ?? '', brand: e.marca ?? undefined, stock: e.estoque });
    this.toast.show(`${e.nome} adicionado ao carrinho.`);
  }

  continuar() {
    this.pc.marcarVerificado(this.cart.getItems(), this.uf(), this.horas());
    this.router.navigate(['/checkout']);
  }
}
