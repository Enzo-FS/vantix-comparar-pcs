import { Component, HostListener, computed, inject } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PcService, SLOTS, Slot, Montagem } from '../../services/pc.service';
import { CartService } from '../../services/cart.service';
import { ToastService } from '../../services/toast.service';
import { motivoIncompativel, Peca } from '../../core/pc/regras';
import { EspecificacaoApi } from '../../core/api/api.types';
import { PcEnergiaComponent } from '../../components/pc/pc-energia.component';
import { ClienteLoginComponent } from '../../components/pc/cliente-login.component';
import { ImgFallbackDirective } from '../../components/ui/img-fallback.directive';
import { apiErrorMessage } from '../../core/api/auth.interceptor';

/** Tela 1: Monte seu PC (slots + modal de peças + resumo em tempo real). */
@Component({
  selector: 'app-pc-montar',
  standalone: true,
  imports: [NgFor, NgIf, FormsModule, PcEnergiaComponent, ClienteLoginComponent, ImgFallbackDirective],
  template: `
    <div class="mt-grid">
      <!-- ── Coluna esquerda: slots ───────────────────────── -->
      <section aria-labelledby="mt-slots-titulo">
        <div class="mt-barra">
          <h2 id="mt-slots-titulo" class="mt-h2">Peças</h2>
          <div class="mt-barra-acoes">
            <label class="sr-only" for="mt-carregar">Carregar montagem</label>
            <select id="mt-carregar" class="pc-select" (change)="carregar($any($event.target).value); $any($event.target).value = ''">
              <option value="">Carregar montagem…</option>
              <option *ngFor="let m of pc.montagens()" [value]="m.chave">{{ m.nome }} · {{ origem(m) }}</option>
            </select>
            <button type="button" class="btn btn-outline btn-sm" (click)="pc.limparRascunho()" [disabled]="!itens().length">Limpar</button>
          </div>
        </div>

        <div class="mt-slots">
          <div *ngFor="let s of slots" class="pc-card mt-slot" [class.mt-slot-vazio]="!pecasDoSlot(s).length">
            <div class="mt-slot-topo">
              <span class="mt-slot-icone" aria-hidden="true">{{ s.icone }}</span>
              <span class="mt-slot-nome">{{ s.rotulo }}</span>
              <button *ngIf="!pecasDoSlot(s).length" type="button" class="btn btn-primary btn-sm mt-slot-btn"
                      (click)="abrir(s)" [attr.data-teste]="'escolher-' + s.id">Escolher</button>
              <button *ngIf="s.multiplo && pecasDoSlot(s).length" type="button" class="btn btn-outline btn-sm mt-slot-btn"
                      (click)="abrir(s)">+ Adicionar</button>
            </div>
            <div *ngFor="let p of pecasDoSlot(s)" class="mt-escolhida">
              <img [src]="espec(p.idProduto)?.imagemUrl" [alt]="p.nome" appImgFallback>
              <div class="mt-escolhida-info">
                <p class="mt-escolhida-nome">{{ p.quantidade > 1 ? p.quantidade + '× ' : '' }}{{ p.nome }}</p>
                <p class="mt-meta">{{ brl(p.preco) }} · {{ p.consumoWatts }} W · score {{ p.scoreDesempenho }}<span *ngIf="detalhe(p)"> · {{ detalhe(p) }}</span></p>
              </div>
              <div class="mt-escolhida-acoes">
                <button type="button" class="btn btn-ghost btn-sm" (click)="abrir(s, p.idProduto)">Trocar</button>
                <button type="button" class="btn btn-ghost btn-sm mt-remover" (click)="pc.remover(p.idProduto)"
                        [attr.aria-label]="'Remover ' + p.nome">✕</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Coluna direita: resumo (no celular vira barra no rodapé) ── -->
      <aside class="mt-resumo" [class.mt-resumo-aberto]="resumoAberto" aria-label="Resumo da montagem">
        <button type="button" class="mt-resumo-barra" (click)="resumoAberto = !resumoAberto" [attr.aria-expanded]="resumoAberto">
          <span><strong>{{ brl(av().desempenho.preco) }}</strong> · {{ brl(av().consumo.custoMensal) }}/mês</span>
          <span class="pc-selo" [class]="'pc-selo pc-selo-' + av().consumo.seloFonte">{{ seloCurto() }}</span>
          <span class="mt-seta" aria-hidden="true">{{ resumoAberto ? '▾' : '▴' }}</span>
        </button>

        <div class="pc-card mt-resumo-card">
          <div class="pc-card-body">
            <p class="pc-rotulo">Preço total</p>
            <p class="pc-numero mt-total" data-teste="preco-total">{{ brl(av().desempenho.preco) }}</p>
            <p class="mt-meta">{{ itens().length }} peça(s) · score total {{ av().desempenho.scoreTotal }}
              (CPU {{ av().desempenho.scoreCpu }} · GPU {{ av().desempenho.scoreGpu }}{{ av().desempenho.gpuIntegrada ? ' integrada' : '' }})</p>

            <hr class="mt-hr">
            <app-pc-energia [consumo]="av().consumo" [uf]="r().uf" [horas]="r().horasUsoDia"
                            (ufChange)="pc.atualizarRascunho({ uf: $event })"
                            (horasChange)="pc.atualizarRascunho({ horasUsoDia: $event })"></app-pc-energia>

            <hr class="mt-hr">
            <p class="pc-rotulo">Avisos de compatibilidade</p>
            <ul class="mt-avisos" data-teste="avisos">
              <li *ngIf="!itens().length" class="mt-aviso-vazio">Escolha as peças para ver os avisos.</li>
              <li *ngIf="itens().length && !avisos().length" class="pc-ok-box">✔ Tudo compatível.</li>
              <li *ngFor="let a of avisos()" [class]="a.nivel === 'erro' ? 'pc-erro-box' : 'pc-alerta-box'">
                {{ a.nivel === 'erro' ? '✖' : '!' }} {{ a.mensagem }}
              </li>
            </ul>

            <div class="mt-botoes">
              <button type="button" class="btn btn-primary" (click)="adicionarAoCarrinho()"
                      [disabled]="!itens().length || av().temIncompatibilidade"
                      [title]="av().temIncompatibilidade ? 'Resolva as incompatibilidades em vermelho' : ''">
                🛒 Adicionar tudo ao carrinho
              </button>
              <p *ngIf="av().temIncompatibilidade" class="mt-bloqueio">Resolva os itens em vermelho para comprar.</p>
              <div class="mt-botoes-2">
                <button type="button" class="btn btn-outline btn-sm" (click)="abrirSalvar()" [disabled]="!itens().length">💾 Salvar montagem</button>
                <button type="button" class="btn btn-outline btn-sm" (click)="ir('comparar')" [disabled]="!itens().length">⚖️ Comparar</button>
                <button type="button" class="btn btn-outline btn-sm" (click)="ir('roda')" [disabled]="!itens().length">🎮 Ver o que roda</button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- ── Modal: escolher peça ───────────────────────────── -->
    <div *ngIf="slotAberto as s" class="modal-overlay" (click)="fechar()">
      <div class="modal pc-claro mt-modal" role="dialog" aria-modal="true" aria-labelledby="mt-modal-titulo" (click)="$event.stopPropagation()">
        <div class="mt-modal-topo">
          <h2 id="mt-modal-titulo">{{ substituindo ? 'Trocar' : 'Escolher' }}: {{ s.rotulo }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" (click)="fechar()" aria-label="Fechar">✕</button>
        </div>
        <div class="mt-modal-busca">
          <input class="form-input mt-busca" type="search" placeholder="Buscar por nome ou marca" [(ngModel)]="busca"
                 aria-label="Buscar peça">
        </div>
        <div class="mt-modal-lista">
          <p *ngIf="!opcoes().length" class="mt-aviso-vazio">Nenhuma peça encontrada.</p>
          <button *ngFor="let o of opcoes(); trackBy: porId" type="button" class="mt-opcao" [class.mt-opcao-incompativel]="o.motivo"
                  [disabled]="o.e.estoque <= 0 || !o.e.disponivel" (click)="escolher(o.e.idProduto)"
                  [attr.aria-label]="o.e.nome + (o.motivo ? ' (incompatível: ' + o.motivo + ')' : '')">
            <img [src]="o.e.imagemUrl" [alt]="" appImgFallback>
            <span class="mt-opcao-info">
              <span class="mt-opcao-nome">{{ o.e.nome }}</span>
              <span class="mt-meta">{{ o.e.marca }} · {{ o.e.consumoWatts }} W · score {{ o.e.scoreDesempenho }}<span *ngIf="detalhe(o.p)"> · {{ detalhe(o.p) }}</span></span>
              <span *ngIf="o.motivo" class="mt-motivo">⚠ {{ o.motivo }}</span>
              <span *ngIf="o.e.estoque <= 0 || !o.e.disponivel" class="mt-motivo">Sem estoque</span>
            </span>
            <span class="mt-opcao-preco">{{ brl(o.e.preco) }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Modal: salvar ──────────────────────────────────── -->
    <div *ngIf="salvando" class="modal-overlay" (click)="salvando = false">
      <div class="modal pc-claro mt-modal mt-modal-pequeno" role="dialog" aria-modal="true" aria-labelledby="mt-salvar-titulo" (click)="$event.stopPropagation()">
        <form class="mt-salvar" (ngSubmit)="salvar()">
          <h2 id="mt-salvar-titulo">Salvar montagem</h2>
          <div class="pc-campo">
            <label for="mt-nome">Nome da montagem</label>
            <input id="mt-nome" name="nome" class="form-input mt-busca" maxlength="100" [(ngModel)]="nomeSalvar" required
                   placeholder="Ex.: PC para jogar e estudar">
          </div>
          <p *ngIf="!pc.clienteLogado()" class="mt-meta">Você não está logado: a montagem fica salva só neste navegador.
            <button type="button" class="mt-link" (click)="salvando = false; login = true">Entrar para salvar na conta</button></p>
          <div class="mt-salvar-acoes">
            <button type="button" class="btn btn-ghost" (click)="salvando = false">Cancelar</button>
            <button type="submit" class="btn btn-primary" [disabled]="!nomeSalvar.trim() || enviando">{{ enviando ? 'Salvando…' : 'Salvar' }}</button>
          </div>
        </form>
      </div>
    </div>
    <app-cliente-login *ngIf="login" (fechar)="login = false" (entrou)="login = false; abrirSalvar()"></app-cliente-login>
  `,
  styles: [`
    .mt-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 1.5rem; align-items: start; }
    .mt-barra { display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap; margin-bottom: .9rem; }
    .mt-barra-acoes { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
    .mt-barra-acoes .btn-outline, .mt-botoes .btn-outline { color: var(--stone-700); border-color: var(--stone-300); }
    .mt-h2 { font-size: 1.15rem; color: var(--stone-900); }
    .mt-slots { display: flex; flex-direction: column; gap: .65rem; }
    .mt-slot { padding: .85rem 1rem; }
    .mt-slot-vazio { border-style: dashed; }
    .mt-slot-topo { display: flex; align-items: center; gap: .6rem; }
    .mt-slot-icone { font-size: 1.2rem; }
    .mt-slot-nome { font-weight: 700; color: var(--stone-900); font-size: .92rem; }
    .mt-slot-btn { margin-left: auto; }
    .mt-escolhida { display: flex; gap: .75rem; align-items: center; margin-top: .6rem; }
    .mt-escolhida img { width: 3.25rem; height: 3.25rem; border-radius: var(--r-md); object-fit: cover; flex-shrink: 0; background: var(--stone-100); }
    .mt-escolhida-info { flex: 1; min-width: 0; }
    .mt-escolhida-nome { font-size: .88rem; font-weight: 600; color: var(--stone-900); }
    .mt-escolhida-acoes { display: flex; gap: .25rem; }
    .mt-escolhida-acoes .btn-ghost { color: var(--brand-700); }
    .mt-remover { color: var(--stone-500) !important; }
    .mt-meta { font-size: .76rem; color: var(--stone-500); }
    .mt-resumo { position: sticky; top: 5.5rem; }
    .mt-resumo-barra { display: none; }
    .mt-total { font-size: 1.9rem; color: var(--brand-700); }
    .mt-hr { border: none; border-top: 1px solid var(--stone-200); margin: 1rem 0; }
    .mt-avisos { list-style: none; display: flex; flex-direction: column; gap: .4rem; margin-top: .5rem; }
    .mt-avisos li { font-size: .8rem; padding: .5rem .65rem; }
    .mt-aviso-vazio { color: var(--stone-500); font-size: .82rem; }
    .mt-botoes { display: flex; flex-direction: column; gap: .5rem; margin-top: 1.1rem; }
    .mt-botoes > .btn-primary { justify-content: center; height: 2.9rem; }
    .mt-botoes-2 { display: flex; flex-wrap: wrap; gap: .4rem; }
    .mt-botoes-2 .btn { flex: 1 1 auto; justify-content: center; }
    .mt-bloqueio { font-size: .76rem; color: var(--pc-erro); }
    .mt-modal { max-width: 680px; background: #fff; color: var(--stone-900); border-color: var(--stone-200); display: flex; flex-direction: column; }
    .mt-modal-pequeno { max-width: 440px; }
    .mt-modal-topo { display: flex; justify-content: space-between; align-items: center; padding: 1.1rem 1.25rem .5rem; }
    .mt-modal-topo h2 { font-size: 1.15rem; }
    .mt-modal-busca { padding: 0 1.25rem .75rem; }
    .mt-busca { background: #fff; color: var(--stone-900); border-color: var(--stone-300); width: 100%; }
    .mt-modal-lista { padding: 0 1.25rem 1.25rem; display: flex; flex-direction: column; gap: .5rem; overflow-y: auto; }
    .mt-opcao { display: flex; gap: .75rem; align-items: center; text-align: left; padding: .65rem; border: 1px solid var(--stone-200);
      border-radius: var(--r-lg); background: #fff; color: inherit; transition: border-color var(--transition-fast), box-shadow var(--transition-fast); }
    .mt-opcao:hover:not(:disabled) { border-color: var(--brand-400); box-shadow: var(--shadow-sm); }
    .mt-opcao:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
    .mt-opcao:disabled { cursor: not-allowed; opacity: .45; }
    .mt-opcao img { width: 3.5rem; height: 3.5rem; border-radius: var(--r-md); object-fit: cover; flex-shrink: 0; background: var(--stone-100); }
    .mt-opcao-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .15rem; }
    .mt-opcao-nome { font-weight: 600; font-size: .88rem; }
    .mt-opcao-preco { font-weight: 700; color: var(--brand-700); white-space: nowrap; font-size: .9rem; }
    .mt-opcao-incompativel { opacity: .55; background: var(--stone-50); }
    .mt-opcao-incompativel:hover { opacity: .85; }
    .mt-motivo { font-size: .74rem; color: var(--pc-erro); font-weight: 600; }
    .mt-salvar { padding: 1.4rem; display: flex; flex-direction: column; gap: 1rem; }
    .mt-salvar h2 { font-size: 1.2rem; }
    .mt-salvar-acoes { display: flex; justify-content: flex-end; gap: .5rem; }
    .mt-salvar-acoes .btn-ghost { color: var(--stone-600); }
    .mt-link { color: var(--brand-700); font-weight: 600; text-decoration: underline; padding: 0; }

    @media (max-width: 900px) {
      .mt-grid { grid-template-columns: minmax(0, 1fr); padding-bottom: 4.5rem; }
      .mt-resumo { position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 200; max-height: 4rem;
        transition: max-height .3s ease; background: #fff; box-shadow: 0 -6px 20px rgba(0,0,0,.12); }
      .mt-resumo-aberto { max-height: 85vh; overflow-y: auto; }
      .mt-resumo-barra { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .5rem;
        height: 4rem; padding: 0 1rem; background: var(--navy); color: #fff; font-size: .88rem; position: sticky; top: 0; z-index: 1; }
      .mt-resumo-barra .pc-selo { font-size: .7rem; padding: .15rem .5rem; }
      .mt-resumo-card { border-radius: 0; border: none; }
      .mt-modal { max-height: 92vh; }
    }
  `],
})
export class MontarComponent {
  pc = inject(PcService);
  private cart = inject(CartService);
  private toast = inject(ToastService);
  private router = inject(Router);

  slots = SLOTS;
  r = this.pc.rascunho;
  itens = computed(() => this.r().itens);
  pecas = computed(() => this.pc.pecas(this.itens()));
  av = computed(() => this.pc.avaliar(this.itens(), this.r().uf, this.r().horasUsoDia));
  /** Avisos que não são "falta peça" ficam no topo; os de peça faltando vêm depois. */
  avisos = computed(() => !this.itens().length ? [] :
    [...this.av().avisos].sort((a, b) => Number(a.categoria === 'faltando') - Number(b.categoria === 'faltando')));
  seloCurto = computed(() => ({ verde: 'Fonte OK', amarelo: 'No limite', vermelho: 'Fonte fraca', sem_fonte: 'Sem fonte' })[this.av().consumo.seloFonte]);

  slotAberto: Slot | null = null;
  substituindo: number | null = null;
  busca = '';
  resumoAberto = false;
  salvando = false;
  login = false;
  nomeSalvar = '';
  enviando = false;

  pecasDoSlot(s: Slot): Peca[] { return this.pecas().filter(p => s.tipos.includes(p.tipoPeca)); }
  espec(id: number): EspecificacaoApi | undefined { return this.pc.pecasPorId().get(id); }

  detalhe(p: Peca): string {
    switch (p.tipoPeca) {
      case 'cpu': return `${p.soquete}${p.tipoMemoria ? ' · ' + p.tipoMemoria : ''}`;
      case 'placa_mae': return `${p.soquete} · ${p.tipoMemoria} · ${p.formato}`;
      case 'ram': return `${p.tipoMemoria} · ${p.capacidadeGb} GB`;
      case 'gpu': return `${p.vramGb} GB VRAM`;
      case 'ssd': case 'hdd': return `${(p.capacidadeGb ?? 0) >= 1000 ? (p.capacidadeGb! / 1000) + ' TB' : p.capacidadeGb + ' GB'}`;
      case 'fonte': return `${p.potenciaFonteW} W · ${Math.round((p.eficienciaFonte ?? 0) * 100)}%`;
      case 'gabinete': return `${p.formato}`;
      case 'cooler': return `${p.soquete}`;
      default: return '';
    }
  }

  origem(m: Montagem) { return m.origem === 'exemplo' ? 'exemplo' : m.origem === 'conta' ? 'sua conta' : 'neste navegador'; }

  abrir(s: Slot, substituir?: number) {
    this.slotAberto = s;
    this.substituindo = substituir ?? null;
    this.busca = '';
  }

  /** Peças do slot aberto: compatíveis primeiro, depois as incompatíveis (esmaecidas), por preço. */
  opcoes() {
    const s = this.slotAberto;
    if (!s) return [];
    const termo = this.busca.trim().toLowerCase();
    const outras = this.pecas().filter(p => p.idProduto !== this.substituindo);
    return this.pc.especificacoes()
      .filter(e => s.tipos.includes(e.tipoPeca))
      .filter(e => !termo || `${e.nome} ${e.marca}`.toLowerCase().includes(termo))
      .map(e => { const p = this.pc.peca(e.idProduto)!; return { e, p, motivo: motivoIncompativel(p, outras) }; })
      .sort((a, b) => Number(!!a.motivo) - Number(!!b.motivo) || a.e.preco - b.e.preco);
  }

  porId = (_: number, o: { e: EspecificacaoApi }) => o.e.idProduto;

  fechar() { this.slotAberto = null; }

  escolher(idProduto: number) {
    this.pc.escolher(idProduto, this.substituindo ?? undefined);
    this.fechar();
  }

  carregar(chave: string) {
    const m = this.pc.montagens().find(x => x.chave === chave);
    if (m) { this.pc.carregarNoRascunho(m); this.toast.show(`"${m.nome}" carregada.`); }
  }

  abrirSalvar() { this.nomeSalvar = this.r().nome || ''; this.salvando = true; }

  async salvar() {
    const nome = this.nomeSalvar.trim();
    if (!nome) return;
    this.enviando = true;
    try {
      const m = await this.pc.salvar(nome);
      this.pc.atualizarRascunho({ nome });
      this.salvando = false;
      this.toast.show(m.origem === 'conta' ? `"${nome}" salva na sua conta.` : `"${nome}" salva neste navegador. Entre na conta para guardá-la online.`);
    } catch (e) {
      this.toast.show(apiErrorMessage(e, 'Não foi possível salvar a montagem.'), 'error');
    } finally {
      this.enviando = false;
    }
  }

  adicionarAoCarrinho() {
    if (this.av().temIncompatibilidade) return;
    for (const p of this.pecas()) {
      const e = this.espec(p.idProduto)!;
      for (let i = 0; i < p.quantidade; i++) {
        this.cart.addItem({ id: String(e.idProduto), name: e.nome, description: '', price: Number(e.preco),
          category: e.categoria, image: e.imagemUrl ?? '', brand: e.marca ?? undefined, stock: e.estoque });
      }
    }
    this.toast.show(`${this.pecas().length} peça(s) adicionadas ao carrinho.`);
    this.router.navigate(['/carrinho']);
  }

  ir(aba: 'comparar' | 'roda') { this.router.navigate(['/monte-seu-pc', aba], { queryParams: { montagem: 'atual' } }); }

  brl(v: number) { return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

  @HostListener('document:keydown.escape') esc() { this.slotAberto = null; this.salvando = false; }
}
