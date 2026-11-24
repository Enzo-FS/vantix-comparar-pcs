import { Component, EventEmitter, Output, inject } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { PcService } from '../../services/pc.service';
import { ToastService } from '../../services/toast.service';

/**
 * Login do cliente com conta (perfil "cliente"), usado para salvar montagens na conta.
 * Depois de entrar, as montagens que estavam só no navegador vão para a conta.
 */
@Component({
  selector: 'app-cliente-login',
  standalone: true,
  imports: [NgIf, FormsModule],
  template: `
    <div class="modal-overlay" (click)="fechar.emit()">
      <div class="modal pc-claro cl-modal" role="dialog" aria-modal="true" aria-labelledby="cl-titulo" (click)="$event.stopPropagation()">
        <div class="cl-corpo">
          <h2 id="cl-titulo" class="cl-titulo">Entrar na sua conta</h2>
          <p class="cl-sub">Com a conta, suas montagens ficam salvas e aparecem em qualquer computador.</p>
          <form (ngSubmit)="entrar()" class="cl-form">
            <div class="pc-campo">
              <label for="cl-email">E-mail</label>
              <input id="cl-email" name="email" type="email" class="form-input cl-input" autocomplete="email"
                     [(ngModel)]="email" required>
            </div>
            <div class="pc-campo">
              <label for="cl-senha">Senha</label>
              <input id="cl-senha" name="senha" type="password" class="form-input cl-input" autocomplete="current-password"
                     [(ngModel)]="senha" required>
            </div>
            <p *ngIf="erro" class="cl-erro" role="alert">{{ erro }}</p>
            <div class="cl-acoes">
              <button type="button" class="btn btn-ghost" (click)="fechar.emit()">Agora não</button>
              <button type="submit" class="btn btn-primary" [disabled]="carregando">{{ carregando ? 'Entrando...' : 'Entrar' }}</button>
            </div>
            <p class="cl-dica">Conta de demonstração: ana.beatriz.souza&#64;email.com · senha vantix2024</p>
          </form>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .cl-modal { max-width: 420px; background: #fff; border-color: var(--stone-200); color: var(--stone-900); }
    .cl-corpo { padding: 1.5rem; }
    .cl-titulo { font-size: 1.35rem; margin-bottom: .35rem; }
    .cl-sub { font-size: .85rem; color: var(--stone-500); margin-bottom: 1.25rem; }
    .cl-form { display: flex; flex-direction: column; gap: .9rem; }
    .cl-input { background: #fff; color: var(--stone-900); border-color: var(--stone-300); }
    .cl-erro { color: var(--pc-erro); font-size: .82rem; }
    .cl-acoes { display: flex; justify-content: flex-end; gap: .5rem; }
    .cl-acoes .btn-ghost { color: var(--stone-600); }
    .cl-dica { font-size: .72rem; color: var(--stone-400); }
  `],
})
export class ClienteLoginComponent {
  private auth = inject(AuthService);
  private pc = inject(PcService);
  private toast = inject(ToastService);
  @Output() fechar = new EventEmitter<void>();
  @Output() entrou = new EventEmitter<void>();

  email = '';
  senha = '';
  erro = '';
  carregando = false;

  async entrar() {
    if (!this.email.trim() || !this.senha) { this.erro = 'Informe e-mail e senha.'; return; }
    this.carregando = true;
    this.erro = '';
    try {
      const u = await this.auth.loginWithEmail(this.email, this.senha);
      if (u.role !== 'customer') {
        await this.auth.logout();
        this.erro = 'Esta é uma conta de funcionário. Use os Portais Internos.';
        return;
      }
      const enviadas = await this.pc.sincronizarLocais();
      this.toast.show(enviadas ? `Olá, ${u.username.split(' ')[0]}! ${enviadas} montagem(ns) foram para a sua conta.`
                               : `Olá, ${u.username.split(' ')[0]}!`);
      this.entrou.emit();
    } catch (e) {
      this.erro = (e as Error).message || 'Não foi possível entrar.';
    } finally {
      this.carregando = false;
    }
  }
}
