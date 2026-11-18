import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { OrdersService } from '../../services/orders.service';
import { environment } from '../../../environments/environment';

/**
 * Estado da atualização automática dos painéis (RNF10).
 * - Primeira consulta em andamento: "Carregando pedidos..."
 * - API falhou: faixa de aviso; os pedidos da última atualização continuam na tela
 *   e o polling tenta de novo sozinho.
 * Uso: <app-orders-sync-status></app-orders-sync-status> no topo do painel.
 */
@Component({
  selector: 'app-orders-sync-status',
  standalone: true,
  imports: [NgIf],
  template: `
    <div *ngIf="orders.loading()" class="oss-loading" role="status" aria-live="polite">
      <span class="oss-spinner" aria-hidden="true"></span>
      Carregando pedidos...
    </div>

    <div *ngIf="!orders.loading() && orders.error()" class="oss-error" role="alert">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true" style="flex-shrink:0">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <div class="oss-text">
        <strong>{{ orders.error() }}</strong>
        Tentando de novo a cada {{ seconds }} segundos.
        <span *ngIf="orders.orders$().length">Os pedidos abaixo são da última atualização.</span>
      </div>
      <button type="button" class="btn btn-sm oss-btn" (click)="orders.refresh()">Tentar agora</button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .oss-loading { display:flex; align-items:center; justify-content:center; gap:.625rem; padding:3rem 1rem;
      color:var(--text-tertiary); font-size:var(--text-sm); }
    .oss-spinner { width:16px; height:16px; border-radius:50%; border:2px solid var(--border);
      border-top-color:var(--brand-400); animation:oss-spin .8s linear infinite; }
    @keyframes oss-spin { to { transform:rotate(360deg); } }
    .oss-error { display:flex; align-items:center; gap:.75rem; flex-wrap:wrap; padding:.875rem 1.125rem; margin-bottom:1.25rem;
      border-radius:var(--r-lg); background:var(--danger-bg); border:1px solid var(--danger-border); color:var(--danger-text); }
    .oss-text { flex:1; min-width:200px; font-size:var(--text-sm); line-height:1.5; }
    .oss-text strong { margin-right:.25rem; }
    .oss-btn { background:transparent; color:var(--danger-text); border:1px solid var(--danger-border); }
    .oss-btn:hover { background:var(--danger-bg); }
    @media (prefers-reduced-motion: reduce) { .oss-spinner { animation:none; } }
  `],
})
export class OrdersSyncStatusComponent {
  orders = inject(OrdersService);
  seconds = Math.round(environment.pollingMs / 1000);
}
