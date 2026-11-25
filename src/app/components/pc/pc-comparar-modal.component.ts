import { Component, EventEmitter, HostListener, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { PcService } from '../../services/pc.service';
import { ItemMontagemApi } from '../../core/api/api.types';
import { comparar, Metrica, round1 } from '../../core/pc/regras';

const CARRINHO = 'carrinho';
const ATUAL = 'atual';

interface Opcao { chave: string; nome: string; rotulo: string; itens: ItemMontagemApi[]; }

/**
 * Inovação 3: "Qual PC é melhor?". Modal aberto pela Verificação do PC (antes do pagamento)
 * que compara duas montagens (por padrão, o PC do carrinho × outra montagem) e dá um veredito.
 * Usa a mesma regra de comparação da aba Comparar (core/pc/regras.ts → comparar()).
 */
@Component({
  selector: 'app-pc-comparar-modal',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <div class="modal-overlay" (click)="fechar.emit()">
      <div class="modal pc-claro qm-modal" role="dialog" aria-modal="true" aria-labelledby="qm-titulo" (click)="$event.stopPropagation()">
        <div class="qm-topo">
          <div>
            <h2 id="qm-titulo" class="qm-titulo">Qual PC é melhor?</h2>
            <p class="qm-sub">Compare duas montagens antes de pagar.</p>
          </div>
          <button type="button" class="qm-x" aria-label="Fechar" (click)="fechar.emit()">×</button>
        </div>

        <div class="qm-corpo">
          <div class="qm-seletores">
            <div class="pc-campo">
              <label for="qm-a">PC A</label>
              <select id="qm-a" class="pc-select" (change)="a.set($any($event.target).value)">
                <option *ngFor="let o of opcoes()" [value]="o.chave" [selected]="o.chave === a()">{{ o.nome }}</option>
              </select>
            </div>
            <div class="qm-vs" aria-hidden="true">×</div>
            <div class="pc-campo">
              <label for="qm-b">PC B</label>
              <select id="qm-b" class="pc-select" (change)="b.set($any($event.target).value)">
                <option *ngFor="let o of opcoes()" [value]="o.chave" [selected]="o.chave === b()">{{ o.nome }}</option>
              </select>
            </div>
          </div>

          <p *ngIf="a() === b()" class="qm-nota">Escolha duas montagens diferentes.</p>

          <ng-container *ngIf="a() !== b() && resultado() as r">
            <div class="qm-veredito" [class.qm-empate]="!r.vencedor" data-teste="veredito-comparacao">
              <span class="qm-trofeu" aria-hidden="true">{{ r.vencedor ? '🏆' : '🤝' }}</span>
              <div>
                <p class="qm-veredito-titulo">{{ r.vencedor ? 'Melhor escolha: ' + r.vencedor : 'Empate técnico' }}</p>
                <p class="qm-veredito-texto">{{ r.motivo }}</p>
              </div>
            </div>

            <div *ngIf="r.incompativelA || r.incompativelB" class="pc-erro-box qm-alerta" role="alert">
              <span *ngIf="r.incompativelA">O PC A tem peças incompatíveis. </span>
              <span *ngIf="r.incompativelB">O PC B tem peças incompatíveis.</span>
            </div>

            <div class="qm-placar">
              <span class="qm-legenda qm-legenda-a">A · {{ r.nomeA }} — {{ r.vitoriasA }} {{ r.vitoriasA === 1 ? 'vitória' : 'vitórias' }}</span>
              <span class="qm-legenda qm-legenda-b">B · {{ r.nomeB }} — {{ r.vitoriasB }} {{ r.vitoriasB === 1 ? 'vitória' : 'vitórias' }}</span>
            </div>

            <div class="qm-linha qm-cab" aria-hidden="true">
              <span>Critério</span><span class="qm-valor">PC A</span><span class="qm-valor">PC B</span>
            </div>
            <div *ngFor="let m of r.metricas" class="qm-linha">
              <span class="qm-metrica">{{ m.rotulo }}</span>
              <span class="qm-valor" [class.qm-ganhou]="m.melhor === 'a'">{{ formatar(m, m.a) }}<span *ngIf="m.melhor === 'a'"> ✔</span></span>
              <span class="qm-valor" [class.qm-ganhou]="m.melhor === 'b'">{{ formatar(m, m.b) }}<span *ngIf="m.melhor === 'b'"> ✔</span></span>
            </div>
            <div class="qm-linha">
              <span class="qm-metrica">Custo-benefício (score por R$ 1.000)</span>
              <span class="qm-valor" [class.qm-ganhou]="r.cbA > r.cbB">{{ num(r.cbA) }}<span *ngIf="r.cbA > r.cbB"> ✔</span></span>
              <span class="qm-valor" [class.qm-ganhou]="r.cbB > r.cbA">{{ num(r.cbB) }}<span *ngIf="r.cbB > r.cbA"> ✔</span></span>
            </div>

            <p class="qm-resumo">💡 {{ r.resumo }}</p>
            <p class="qm-nota">Energia calculada com a tarifa de {{ uf }} e {{ horas }} h de uso por dia (as mesmas da verificação).
              Ganha quem vence mais critérios; em caso de empate, o de maior score total.</p>
          </ng-container>

          <p *ngIf="a() !== b() && !resultado()" class="qm-nota">Escolha duas montagens com peças para comparar.</p>
        </div>

        <div class="qm-rodape">
          <button type="button" class="btn btn-primary" (click)="fechar.emit()">Voltar à verificação</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .qm-modal { max-width: 640px; width: 100%; background: #fff; border-color: var(--stone-200); color: var(--stone-900);
      max-height: 90vh; display: flex; flex-direction: column; }
    .qm-topo { display: flex; justify-content: space-between; align-items: flex-start; padding: 1.25rem 1.25rem .5rem; }
    .qm-titulo { font-size: 1.2rem; color: var(--stone-900); }
    .qm-sub { font-size: .82rem; color: var(--stone-500); }
    .qm-x { background: none; border: none; font-size: 1.6rem; line-height: 1; color: var(--stone-500); cursor: pointer; }
    .qm-corpo { padding: .5rem 1.25rem 1rem; overflow-y: auto; }
    .qm-seletores { display: grid; grid-template-columns: 1fr auto 1fr; gap: .75rem; align-items: end; }
    .qm-vs { font-family: var(--font-display); font-size: 1.4rem; color: var(--stone-400); padding-bottom: .4rem; }
    .qm-veredito { display: flex; gap: .75rem; align-items: center; margin-top: 1rem; padding: .9rem 1rem;
      background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: var(--r-lg); }
    .qm-empate { background: var(--stone-50); border-color: var(--stone-200); }
    .qm-trofeu { font-size: 1.8rem; }
    .qm-veredito-titulo { font-weight: 700; color: var(--pc-ok); }
    .qm-empate .qm-veredito-titulo { color: var(--stone-700); }
    .qm-veredito-texto { font-size: .82rem; color: var(--stone-700); }
    .qm-alerta { margin-top: .75rem; font-size: .8rem; }
    .qm-placar { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0 .5rem; }
    .qm-legenda { font-size: .76rem; font-weight: 700; padding: .25rem .65rem; border-radius: var(--r-full); }
    .qm-legenda-a { background: var(--stone-100); color: var(--stone-700); }
    .qm-legenda-b { background: var(--brand-50); color: var(--brand-700); }
    .qm-linha { display: grid; grid-template-columns: 1fr 7.5rem 7.5rem; gap: .5rem; padding: .5rem 0;
      border-top: 1px solid var(--stone-100); font-size: .84rem; align-items: center; }
    .qm-cab { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--stone-500); border-top: none; }
    .qm-metrica { font-weight: 600; color: var(--stone-900); }
    .qm-valor { text-align: right; font-variant-numeric: tabular-nums; color: var(--stone-600); }
    .qm-ganhou { color: var(--pc-ok); font-weight: 700; }
    .qm-resumo { margin-top: .75rem; padding: .8rem 1rem; background: var(--brand-50); border: 1px solid var(--brand-200);
      border-radius: var(--r-lg); color: var(--brand-800); font-weight: 600; font-size: .86rem; }
    .qm-nota { margin-top: .6rem; font-size: .74rem; color: var(--stone-500); }
    .qm-rodape { display: flex; justify-content: flex-end; padding: .75rem 1.25rem 1.25rem; border-top: 1px solid var(--stone-100); }
    @media (max-width: 560px) {
      .qm-seletores { grid-template-columns: 1fr; }
      .qm-vs { display: none; }
      .qm-linha { grid-template-columns: 1fr 5.5rem 5.5rem; font-size: .78rem; }
    }
  `],
})
export class PcCompararModalComponent implements OnInit {
  private pc = inject(PcService);

  /** Peças de hardware do carrinho (o "PC do carrinho"). */
  @Input() itensCarrinho: ItemMontagemApi[] = [];
  @Input() uf = 'SP';
  @Input() horas = 4;
  @Output() fechar = new EventEmitter<void>();

  a = signal(CARRINHO);
  b = signal('');

  /** PC do carrinho + montagem em edição + exemplos e montagens salvas. */
  opcoes = computed<Opcao[]>(() => {
    const lista: Opcao[] = [];
    if (this.itensCarrinho.length) lista.push({ chave: CARRINHO, nome: 'PC do seu carrinho', rotulo: 'PC do carrinho', itens: this.itensCarrinho });
    const r = this.pc.rascunho();
    if (r.itens.length) lista.push({ chave: ATUAL, nome: `Montagem atual${r.nome ? ' (' + r.nome + ')' : ''}`, rotulo: 'PC da montagem atual', itens: r.itens });
    for (const m of this.pc.montagens()) {
      if (m.itens.length) lista.push({ chave: m.chave, nome: m.origem === 'exemplo' ? `${m.nome} (exemplo)` : m.nome, rotulo: m.nome, itens: m.itens });
    }
    return lista;
  });

  resultado = computed(() => {
    const oa = this.opcoes().find(o => o.chave === this.a()), ob = this.opcoes().find(o => o.chave === this.b());
    if (!oa || !ob) return null;
    const pa = this.pc.pecas(oa.itens), pb = this.pc.pecas(ob.itens);
    if (!pa.length || !pb.length) return null;

    const c = comparar(oa.rotulo, pa, ob.rotulo, pb, this.pc.valorKwh(this.uf), this.horas);
    const avA = this.pc.avaliar(oa.itens, this.uf, this.horas), avB = this.pc.avaliar(ob.itens, this.uf, this.horas);
    const cbA = custoBeneficio(avA.desempenho.scoreTotal, avA.desempenho.preco);
    const cbB = custoBeneficio(avB.desempenho.scoreTotal, avB.desempenho.preco);

    // Placar: cada métrica da comparação + custo-benefício vale 1 ponto.
    let vitoriasA = c.metricas.filter(m => m.melhor === 'a').length + (cbA > cbB ? 1 : 0);
    let vitoriasB = c.metricas.filter(m => m.melhor === 'b').length + (cbB > cbA ? 1 : 0);
    const sA = avA.desempenho.scoreTotal, sB = avB.desempenho.scoreTotal;
    const total = c.metricas.length + 1;

    let vencedor: string | null = null;
    let motivo: string;
    if (vitoriasA !== vitoriasB) {
      vencedor = vitoriasA > vitoriasB ? oa.rotulo : ob.rotulo;
      motivo = `Venceu em ${Math.max(vitoriasA, vitoriasB)} de ${total} critérios.`;
    } else if (sA !== sB) {
      vencedor = sA > sB ? oa.rotulo : ob.rotulo;
      motivo = `Placar empatado (${vitoriasA} × ${vitoriasB}); desempata pelo maior score total (${Math.max(sA, sB)} × ${Math.min(sA, sB)}).`;
    } else {
      motivo = `Os dois empataram em ${vitoriasA} critérios e têm o mesmo score total.`;
    }
    // Uma montagem com peças incompatíveis não deve ser indicada sem aviso.
    const vencedorIncompativel = vencedor === oa.rotulo ? avA.temIncompatibilidade : vencedor === ob.rotulo ? avB.temIncompatibilidade : false;
    if (vencedorIncompativel) motivo += ' Atenção: essa montagem tem peças incompatíveis.';

    return {
      ...c, nomeA: oa.nome, nomeB: ob.nome, vitoriasA, vitoriasB, vencedor, motivo, cbA, cbB,
      incompativelA: avA.temIncompatibilidade, incompativelB: avB.temIncompatibilidade,
    };
  });

  ngOnInit() {
    const ops = this.opcoes();
    this.a.set(ops[0]?.chave ?? '');
    const exemplo = ops.find(o => o.chave !== this.a() && this.pc.montagens().some(m => m.chave === o.chave && m.origem === 'exemplo'));
    this.b.set(exemplo?.chave ?? ops.find(o => o.chave !== this.a())?.chave ?? '');
  }

  @HostListener('document:keydown.escape')
  aoEsc() { this.fechar.emit(); }

  num(v: number) { return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }); }

  formatar(m: Metrica, v: number) {
    if (m.metrica === 'custoMensal' || m.metrica === 'preco') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (m.metrica === 'consumo') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} W`;
    return String(v);
  }
}

/** Pontos de score total por R$ 1.000 gastos (0 se a montagem não tem preço). */
function custoBeneficio(score: number, preco: number): number {
  return preco > 0 ? round1(score / preco * 1000) : 0;
}
