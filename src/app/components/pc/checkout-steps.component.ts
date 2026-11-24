import { Component, Input } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

export type EtapaCompra = 'carrinho' | 'verificacao' | 'checkout' | 'pagamento';

/** Barra de progresso da compra: Carrinho → Verificação → Checkout → Pagamento. */
@Component({
  selector: 'app-checkout-steps',
  standalone: true,
  imports: [NgFor, NgIf],
  template: `
    <nav class="pc-steps" aria-label="Etapas da compra">
      <ng-container *ngFor="let e of etapas; let i = index; let ultimo = last">
        <div class="pc-step" [class.feito]="i < indiceAtual" [class.atual]="i === indiceAtual"
             [attr.aria-current]="i === indiceAtual ? 'step' : null">
          <span class="pc-step-n">{{ i < indiceAtual ? '✓' : i + 1 }}</span>
          <span>{{ e.rotulo }}<span *ngIf="e.id === 'verificacao' && !comVerificacao" class="pc-opcional"> (só com hardware)</span></span>
        </div>
        <span *ngIf="!ultimo" class="pc-step-linha" [class.feito]="i < indiceAtual"></span>
      </ng-container>
    </nav>
  `,
  styles: [`.pc-opcional { font-weight: 400; color: var(--stone-400); }
            @media (max-width: 600px) { .pc-step-linha { width: .75rem; } .pc-opcional { display: none; } }`],
})
export class CheckoutStepsComponent {
  @Input() atual: EtapaCompra = 'carrinho';
  /** false quando o carrinho não tem hardware (a etapa aparece, mas é pulada). */
  @Input() comVerificacao = true;

  etapas = [
    { id: 'carrinho', rotulo: 'Carrinho' },
    { id: 'verificacao', rotulo: 'Verificação do PC' },
    { id: 'checkout', rotulo: 'Checkout' },
    { id: 'pagamento', rotulo: 'Pagamento' },
  ];
  get indiceAtual() { return this.etapas.findIndex(e => e.id === this.atual); }
}
