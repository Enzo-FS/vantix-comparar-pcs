import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { Consumo } from '../../core/pc/regras';
import { PcService } from '../../services/pc.service';

const SELO_ROTULO: Record<string, string> = {
  verde: 'Fonte OK', amarelo: 'Fonte no limite', vermelho: 'Fonte insuficiente', sem_fonte: 'Sem fonte',
};

/** Consumo (W), custo mensal/anual e selo da fonte, com a UF (tarifa) e as horas de uso editáveis. */
@Component({
  selector: 'app-pc-energia',
  standalone: true,
  imports: [NgFor, NgIf, DecimalPipe],
  template: `
    <div class="en-grid">
      <div>
        <p class="pc-rotulo">Em uso</p>
        <p class="pc-numero en-num">{{ consumo.consumoUsoW | number:'1.0-1':'pt-BR' }} <small>W</small></p>
      </div>
      <div>
        <p class="pc-rotulo">Carga máxima</p>
        <p class="pc-numero en-num">{{ consumo.consumoCargaW | number:'1.0-1':'pt-BR' }} <small>W</small></p>
      </div>
      <div>
        <p class="pc-rotulo">Custo por mês</p>
        <p class="pc-numero en-num en-custo">{{ brl(consumo.custoMensal) }}</p>
      </div>
      <div>
        <p class="pc-rotulo">Custo por ano</p>
        <p class="pc-numero en-num">{{ brl(consumo.custoAnual) }}</p>
      </div>
    </div>
    <p class="en-tomada">Na tomada: {{ consumo.tomadaUsoW | number:'1.0-1':'pt-BR' }} W em uso
      (eficiência da fonte {{ consumo.eficienciaFonte * 100 | number:'1.0-0' }}%)</p>

    <div class="en-selo">
      <span class="pc-selo" [class]="'pc-selo pc-selo-' + consumo.seloFonte" data-teste="selo-fonte">
        <span aria-hidden="true">{{ consumo.seloFonte === 'verde' ? '●' : consumo.seloFonte === 'amarelo' ? '▲' : '■' }}</span>
        {{ rotuloSelo }}
      </span>
      <span class="en-selo-msg">{{ consumo.mensagemFonte }}</span>
    </div>

    <div class="en-campos">
      <div class="pc-campo">
        <label [for]="id + '-uf'">Estado (tarifa)</label>
        <select class="pc-select" [id]="id + '-uf'" [value]="uf" (change)="ufChange.emit($any($event.target).value)">
          <option *ngFor="let t of pc.tarifas()" [value]="t.uf" [selected]="t.uf === uf">{{ t.uf }} · R$ {{ t.valorKwh | number:'1.2-2':'pt-BR' }}/kWh</option>
        </select>
      </div>
      <div class="pc-campo">
        <label [for]="id + '-horas'">Uso por dia: <strong>{{ horas }} h</strong></label>
        <input type="range" class="pc-range" [id]="id + '-horas'" min="1" max="24" step="1" [value]="horas"
               (input)="horasChange.emit(+$any($event.target).value)">
      </div>
    </div>
  `,
  styles: [`
    .en-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem 1rem; }
    .en-num { font-size: 1.25rem; }
    .en-num small { font-size: .75rem; color: var(--stone-500); font-weight: 600; }
    .en-custo { color: var(--brand-700); }
    .en-tomada { font-size: .72rem; color: var(--stone-500); margin-top: .5rem; }
    .en-selo { display: flex; flex-direction: column; gap: .35rem; margin: .9rem 0; }
    .en-selo .pc-selo { align-self: flex-start; }
    .en-selo-msg { font-size: .8rem; color: var(--stone-600); }
    .en-campos { display: grid; grid-template-columns: 1fr; gap: .75rem; }
  `],
})
export class PcEnergiaComponent {
  pc = inject(PcService);
  private static n = 0;
  readonly id = `pc-energia-${++PcEnergiaComponent.n}`;

  @Input({ required: true }) consumo!: Consumo;
  @Input() uf = 'SP';
  @Input() horas = 4;
  @Output() ufChange = new EventEmitter<string>();
  @Output() horasChange = new EventEmitter<number>();

  get rotuloSelo() { return SELO_ROTULO[this.consumo.seloFonte]; }
  brl(v: number) { return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
}
