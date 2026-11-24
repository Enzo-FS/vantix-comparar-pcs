import { Component, Input, computed, inject, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { Router } from '@angular/router';
import { PcService } from '../../services/pc.service';
import { EspecificacaoApi } from '../../core/api/api.types';
import { NOME_PECA } from '../../core/pc/regras';

/** Bloco técnico na página de produto de hardware: consumo, score e com o que é compatível. */
@Component({
  selector: 'app-spec-produto',
  standalone: true,
  imports: [NgIf, NgFor],
  template: `
    <section *ngIf="espec() as e" class="sp-card" aria-labelledby="sp-titulo">
      <h2 id="sp-titulo" class="sp-titulo">Dados técnicos para montar seu PC</h2>
      <div class="sp-numeros">
        <div><p class="pc-rotulo">Tipo</p><p class="sp-valor">{{ nome(e.tipoPeca) }}</p></div>
        <div><p class="pc-rotulo">Consumo</p><p class="sp-valor">{{ e.tipoPeca === 'fonte' ? '—' : e.consumoWatts + ' W' }}</p></div>
        <div><p class="pc-rotulo">Score</p>
          <p class="sp-valor">{{ e.scoreDesempenho }}<small>/100</small></p>
          <div class="sp-barra" role="img" [attr.aria-label]="'Score ' + e.scoreDesempenho + ' de 100'"><span [style.width.%]="e.scoreDesempenho"></span></div>
        </div>
      </div>
      <ul class="sp-lista">
        <li *ngFor="let c of compat()"><strong>{{ c.rotulo }}:</strong> {{ c.valor }}</li>
      </ul>
      <button type="button" class="btn btn-outline btn-sm sp-btn" (click)="montar(e)">🛠️ Montar um PC com esta peça</button>
    </section>
  `,
  styles: [`
    .sp-card { margin-top: 1.5rem; padding: 1.1rem 1.2rem; border: 1px solid var(--brand-200); background: var(--brand-50);
      border-radius: var(--r-xl); }
    .sp-titulo { font-size: 1rem; color: var(--stone-900); margin-bottom: .8rem; }
    .sp-numeros { display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem; }
    .sp-valor { font-family: var(--font-display); font-weight: 700; font-size: 1.15rem; color: var(--stone-900); }
    .sp-valor::first-letter { text-transform: uppercase; }
    .sp-valor small { font-size: .7rem; color: var(--stone-500); }
    .sp-barra { height: .35rem; background: var(--brand-100); border-radius: var(--r-full); overflow: hidden; margin-top: .25rem; }
    .sp-barra span { display: block; height: 100%; background: var(--brand-600); }
    .sp-lista { list-style: none; margin: .9rem 0; font-size: .84rem; color: var(--stone-700); display: flex; flex-direction: column; gap: .25rem; }
    .sp-btn { color: var(--brand-700); border-color: var(--brand-300); background: #fff; }
  `],
})
export class SpecProdutoComponent {
  private pc = inject(PcService);
  private router = inject(Router);
  private id = signal(0);
  @Input({ required: true }) set produtoId(v: string | number) { this.id.set(Number(v)); }

  espec = computed(() => this.pc.pecasPorId().get(this.id()) ?? null);

  compat = computed(() => {
    const e = this.espec();
    if (!e) return [];
    const l: { rotulo: string; valor: string }[] = [];
    if (e.soquete) l.push({ rotulo: e.tipoPeca === 'cooler' ? 'Soquetes suportados' : 'Soquete',
      valor: e.tipoPeca === 'cpu' ? `${e.soquete} (use placa-mãe ${e.soquete})` : e.soquete.split('/').join(', ') });
    if (e.tipoMemoria) l.push({ rotulo: 'Memória', valor: e.tipoPeca === 'ram' ? `${e.tipoMemoria} (placa-mãe ${e.tipoMemoria})` : e.tipoMemoria });
    if (e.tipoPeca === 'cpu' && !e.tipoMemoria) l.push({ rotulo: 'Memória', valor: 'DDR4 ou DDR5 (depende da placa-mãe)' });
    if (e.formato) l.push({ rotulo: e.tipoPeca === 'gabinete' ? 'Aceita placas' : 'Formato',
      valor: e.tipoPeca === 'gabinete' ? ({ ATX: 'ATX, mATX e ITX', mATX: 'mATX e ITX', ITX: 'ITX' })[e.formato] : `${e.formato} (cabe em gabinete ${e.formato} ou maior)` });
    if (e.vramGb) l.push({ rotulo: 'Memória de vídeo', valor: `${e.vramGb} GB` });
    if (e.capacidadeGb) l.push({ rotulo: 'Capacidade', valor: e.capacidadeGb >= 1000 ? `${e.capacidadeGb / 1000} TB` : `${e.capacidadeGb} GB` });
    if (e.potenciaFonteW) l.push({ rotulo: 'Potência', valor: `${e.potenciaFonteW} W · eficiência ${Math.round(Number(e.eficienciaFonte) * 100)}% · aguenta até ${Math.floor(e.potenciaFonteW / 1.2)} W de carga com folga de 20%` });
    return l;
  });

  nome(t: string) { return NOME_PECA[t] ?? t; }

  montar(e: EspecificacaoApi) {
    this.pc.escolher(e.idProduto);
    this.router.navigate(['/monte-seu-pc/montar']);
  }
}
