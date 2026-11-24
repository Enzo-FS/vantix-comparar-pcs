import { Component, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PcService } from '../../services/pc.service';
import { AuthService } from '../../services/auth.service';
import { ClienteLoginComponent } from '../../components/pc/cliente-login.component';

/** "Monte seu PC": abas Montar, Comparar e Roda ou não? */
@Component({
  selector: 'app-pc-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgIf, ClienteLoginComponent],
  template: `
    <div class="pc-page">
      <div class="container">
        <header class="sh-topo">
          <div>
            <p class="section-tag sh-tag">Novidade</p>
            <h1 class="pc-titulo">Monte seu PC</h1>
            <p class="pc-sub">Escolha as peças, veja o consumo de energia em R$ por mês, compare montagens e descubra o que roda.</p>
          </div>
          <div class="sh-conta">
            <ng-container *ngIf="pc.clienteLogado() as u; else entrar">
              <span>Conta: <strong>{{ u.username }}</strong></span>
              <button type="button" class="btn btn-outline btn-sm" (click)="sair()">Sair</button>
            </ng-container>
            <ng-template #entrar>
              <button type="button" class="btn btn-outline btn-sm" (click)="login = true">Entrar para salvar na conta</button>
            </ng-template>
          </div>
        </header>

        <nav class="pc-tabs" aria-label="Seções do Monte seu PC">
          <a routerLink="montar"  routerLinkActive="ativo">🛠️ Montar</a>
          <a routerLink="comparar" routerLinkActive="ativo">⚖️ Comparar</a>
          <a routerLink="roda"    routerLinkActive="ativo">🎮 Roda ou não?</a>
        </nav>

        <div *ngIf="pc.erro()" class="pc-erro-box sh-erro" role="alert">
          {{ pc.erro() }} <button type="button" class="btn btn-sm btn-outline" (click)="pc.carregar(true)">Tentar de novo</button>
        </div>
        <div *ngIf="!pc.carregado()" class="sh-carregando">Carregando peças, tarifas e jogos…</div>

        <div *ngIf="pc.carregado() && !pc.erro()" class="sh-conteudo">
          <router-outlet></router-outlet>
        </div>
      </div>
    </div>
    <app-cliente-login *ngIf="login" (fechar)="login = false" (entrou)="login = false"></app-cliente-login>
  `,
  styles: [`
    .sh-topo { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
    .sh-tag { margin-bottom: .35rem; }
    .sh-conta { display: flex; align-items: center; gap: .6rem; font-size: .82rem; color: var(--stone-600); }
    .sh-erro { margin-top: 1rem; display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
    .sh-carregando { padding: 3rem 0; color: var(--stone-500); }
    .sh-conteudo { margin-top: 1.5rem; }
  `],
})
export class PcShellComponent {
  pc = inject(PcService);
  private auth = inject(AuthService);
  login = false;

  async sair() {
    await this.auth.logout();
    await this.pc.recarregarMontagens();
  }
}
