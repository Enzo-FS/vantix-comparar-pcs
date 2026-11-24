import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PcService, Montagem } from '../../services/pc.service';
import { ToastService } from '../../services/toast.service';
import { NIVEIS, NIVEL_ROTULO, NOME_PECA, Nivel, Peca, Requisito, roda, sugerir } from '../../core/pc/regras';
import { SoftwareApi } from '../../core/api/api.types';
import { ImgFallbackDirective } from '../../components/ui/img-fallback.directive';

const ATUAL = 'atual';

/** Tela 3: "Roda ou não?" — o jogo/programa roda na montagem? Em qual nível? Qual peça limita? */
@Component({
  selector: 'app-pc-roda',
  standalone: true,
  imports: [NgFor, NgIf, ImgFallbackDirective],
  template: `
    <div class="rd-topo">
      <div class="pc-campo rd-busca">
        <label for="rd-busca">Jogo ou programa</label>
        <input id="rd-busca" class="form-input rd-input" type="search" list="rd-sugestoes" autocomplete="off"
               placeholder="Ex.: Cyberpunk, Valorant, Premiere…" [value]="busca()" (input)="digitar($any($event.target).value)">
        <datalist id="rd-sugestoes">
          <option *ngFor="let s of pc.softwares()" [value]="s.nome"></option>
        </datalist>
      </div>
      <div class="pc-campo">
        <label for="rd-montagem">Montagem</label>
        <select id="rd-montagem" class="pc-select" [value]="montagem()" (change)="montagem.set($any($event.target).value)">
          <option *ngFor="let o of opcoes()" [value]="o.chave" [selected]="o.chave === montagem()">{{ o.nome }}</option>
        </select>
      </div>
    </div>

    <div class="rd-filtros" role="group" aria-label="Filtrar por tipo">
      <button *ngFor="let f of filtros" type="button" class="rd-chip" [class.rd-chip-ativo]="tipo() === f.id"
              [attr.aria-pressed]="tipo() === f.id" (click)="tipo.set(f.id)">{{ f.rotulo }}</button>
    </div>

    <div class="rd-grade">
      <button *ngFor="let s of lista(); trackBy: porId" type="button" class="rd-card" [class.rd-card-ativo]="s.id === software()?.id"
              (click)="escolher(s)" [attr.aria-pressed]="s.id === software()?.id">
        <img [src]="s.imagemUrl" [alt]="" appImgFallback>
        <span class="rd-card-info">
          <span class="rd-card-nome">{{ s.nome }}</span>
          <span class="rd-card-cat">{{ s.tipo === 'jogo' ? '🎮' : '💻' }} {{ s.categoria }}</span>
          <span *ngIf="nivelRapido(s) as n" class="pc-nivel pc-nivel-mini" [class]="'pc-nivel pc-nivel-mini pc-nivel-' + n"><strong>{{ rotulo[n] }}</strong></span>
        </span>
      </button>
      <p *ngIf="!lista().length" class="rd-vazio">Nada encontrado para "{{ busca() }}".</p>
    </div>

    <section *ngIf="software() as s" class="pc-card rd-resultado" aria-live="polite">
      <div class="pc-card-body" *ngIf="resultado() as r">
        <div class="rd-cabecalho">
          <div>
            <p class="pc-rotulo">{{ s.tipo === 'jogo' ? 'Jogo' : 'Programa' }} · {{ s.categoria }}</p>
            <h2 class="rd-nome">{{ s.nome }}</h2>
            <p class="rd-sub">na montagem <strong>{{ nomeMontagem() }}</strong></p>
          </div>
          <div class="pc-nivel" [class]="'pc-nivel pc-nivel-' + r.nivel" data-teste="nivel-roda">
            <small>Resultado</small>
            <strong>{{ rotulo[r.nivel] }}</strong>
            <small *ngIf="r.fpsEstimado">~{{ r.fpsEstimado }} FPS</small>
          </div>
        </div>

        <div class="rd-tabela-wrap">
          <table class="rd-tabela">
            <caption class="sr-only">Requisitos de {{ s.nome }} comparados com a montagem</caption>
            <thead>
              <tr>
                <th scope="col">Requisito</th>
                <th scope="col">Sua montagem</th>
                <th *ngFor="let n of r.niveis" scope="col" [class.rd-col-atingida]="n.atendido">
                  {{ rotulo[n.nivel] }}<span *ngIf="n.fpsEstimado"> · {{ n.fpsEstimado }} FPS</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of r.niveis[0]?.criterios; let i = index">
                <th scope="row">{{ c.rotulo }}</th>
                <td class="rd-montagem">{{ c.montagem }}</td>
                <td *ngFor="let n of r.niveis" [class.rd-ok]="n.criterios[i].ok" [class.rd-nok]="!n.criterios[i].ok">
                  <span aria-hidden="true">{{ n.criterios[i].ok ? '✔' : '✖' }}</span> {{ n.criterios[i].exigido }}
                  <span class="sr-only">{{ n.criterios[i].ok ? 'atende' : 'não atende' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div *ngIf="r.limitante as l" class="rd-limitante">
          <p class="pc-alerta-box">
            <strong>Peça que limita: {{ nomePeca(l.tipoPeca, l.criterio) }}.</strong>
            Para chegar ao nível <strong>{{ rotulo[l.proximoNivel] }}</strong>, {{ textoCriterio(l.criterio) }} precisa de
            <strong>{{ l.exigido }}</strong> (a montagem tem {{ l.atual }}).
          </p>
          <p class="pc-rotulo rd-sug-titulo" *ngIf="sugestoes().length">Produtos que resolvem</p>
          <div class="rd-sugestoes">
            <div *ngFor="let p of sugestoes()" class="pc-mini-produto">
              <img [src]="pc.pecasPorId().get(p.idProduto)?.imagemUrl" [alt]="" appImgFallback>
              <div class="rd-sug-info">
                <p class="rd-sug-nome">{{ p.nome }}</p>
                <p class="rd-sug-meta">{{ brl(p.preco) }} · score {{ p.scoreDesempenho }}<span *ngIf="p.vramGb"> · {{ p.vramGb }} GB</span><span *ngIf="p.capacidadeGb"> · {{ p.capacidadeGb }} GB</span></p>
              </div>
              <button type="button" class="btn btn-primary btn-sm" (click)="trocar(p)">Trocar peça</button>
            </div>
            <p *ngIf="!sugestoes().length" class="rd-vazio">Nenhum produto do catálogo resolve sozinho este requisito.</p>
          </div>
        </div>
        <p *ngIf="!r.limitante && r.nivel === 'ultra'" class="pc-ok-box rd-ultra">🏆 Roda no máximo! Nenhuma peça limita este {{ s.tipo }}.</p>
      </div>
    </section>
  `,
  styles: [`
    .rd-topo { display: grid; grid-template-columns: 1fr 280px; gap: 1rem; }
    .rd-input { background: #fff; color: var(--stone-900); border-color: var(--stone-300); }
    .rd-filtros { display: flex; gap: .4rem; margin: 1rem 0 .75rem; }
    .rd-chip { padding: .35rem .85rem; border-radius: var(--r-full); border: 1px solid var(--stone-300); background: #fff;
      font-size: .8rem; font-weight: 600; color: var(--stone-600); }
    .rd-chip-ativo { background: var(--navy); color: #fff; border-color: var(--navy); }
    .rd-chip:focus-visible, .rd-card:focus-visible { outline: 2px solid var(--brand-500); outline-offset: 2px; }
    .rd-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: .65rem; }
    .rd-card { display: flex; flex-direction: column; text-align: left; background: #fff; border: 1.5px solid var(--stone-200);
      border-radius: var(--r-lg); overflow: hidden; color: inherit; transition: border-color var(--transition-fast), transform var(--transition-fast); }
    .rd-card:hover { border-color: var(--brand-300); transform: translateY(-2px); }
    .rd-card-ativo { border-color: var(--brand-600); box-shadow: 0 0 0 3px var(--brand-100); }
    .rd-card img { width: 100%; height: 88px; object-fit: cover; background: var(--stone-100); }
    .rd-card-info { padding: .55rem .65rem .7rem; display: flex; flex-direction: column; gap: .2rem; align-items: flex-start; }
    .rd-card-nome { font-weight: 700; font-size: .85rem; color: var(--stone-900); }
    .rd-card-cat { font-size: .72rem; color: var(--stone-500); }
    .rd-vazio { color: var(--stone-500); font-size: .85rem; }
    .rd-resultado { margin-top: 1.25rem; }
    .rd-cabecalho { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .rd-nome { font-size: 1.5rem; color: var(--stone-900); }
    .rd-sub { font-size: .85rem; color: var(--stone-500); }
    .rd-tabela-wrap { overflow-x: auto; }
    .rd-tabela { width: 100%; border-collapse: collapse; font-size: .84rem; min-width: 520px; }
    .rd-tabela th, .rd-tabela td { padding: .55rem .6rem; border-bottom: 1px solid var(--stone-100); text-align: left; }
    .rd-tabela thead th { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--stone-500); }
    .rd-tabela tbody th { font-weight: 600; color: var(--stone-800); }
    .rd-montagem { font-weight: 700; color: var(--brand-700); }
    .rd-ok { color: var(--pc-ok); }
    .rd-nok { color: var(--pc-erro); }
    .rd-col-atingida { color: var(--pc-ok) !important; }
    .rd-limitante { margin-top: 1rem; }
    .rd-sug-titulo { margin: .9rem 0 .5rem; }
    .rd-sugestoes { display: flex; flex-direction: column; gap: .5rem; }
    .rd-sug-info { flex: 1; min-width: 0; }
    .rd-sug-nome { font-weight: 600; font-size: .85rem; color: var(--stone-900); }
    .rd-sug-meta { font-size: .75rem; color: var(--stone-500); }
    .rd-ultra { margin-top: 1rem; }
    @media (max-width: 700px) { .rd-topo { grid-template-columns: 1fr; } }
  `],
})
export class RodaComponent implements OnInit {
  pc = inject(PcService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(ToastService);

  rotulo = NIVEL_ROTULO;
  filtros = [{ id: 'todos', rotulo: 'Todos' }, { id: 'jogo', rotulo: 'Jogos' }, { id: 'programa', rotulo: 'Programas' }];
  busca = signal('');
  tipo = signal('todos');
  montagem = signal('');
  software = signal<SoftwareApi | null>(null);

  opcoes = computed(() => {
    const r = this.pc.rascunho();
    const atual: Montagem[] = r.itens.length ? [{ chave: ATUAL, idServidor: null, nome: `Montagem atual${r.nome ? ' (' + r.nome + ')' : ''}`,
      uf: r.uf, horasUsoDia: r.horasUsoDia, origem: 'navegador', itens: r.itens }] : [];
    return [...atual, ...this.pc.montagens()];
  });
  private itensMontagem = computed(() => this.opcoes().find(o => o.chave === this.montagem())?.itens ?? []);
  private pecas = computed(() => this.pc.pecas(this.itensMontagem()));

  lista = computed(() => {
    const termo = this.busca().trim().toLowerCase();
    return this.pc.softwares()
      .filter(s => this.tipo() === 'todos' || s.tipo === this.tipo())
      .filter(s => !termo || `${s.nome} ${s.categoria}`.toLowerCase().includes(termo));
  });

  resultado = computed(() => {
    const s = this.software();
    return s ? roda(this.pecas(), s.requisitos as Requisito[], s.tipo === 'jogo') : null;
  });

  sugestoes = computed(() => {
    const s = this.software(), r = this.resultado();
    return s && r ? sugerir(r.limitante, s.requisitos as Requisito[], this.pecas(), this.pc.catalogo()) : [];
  });

  ngOnInit() {
    const q = this.route.snapshot.queryParamMap;
    const ops = this.opcoes();
    this.montagem.set(q.get('montagem') === ATUAL && ops.some(o => o.chave === ATUAL) ? ATUAL
      : ops.find(o => o.origem === 'exemplo')?.chave ?? ops[0]?.chave ?? '');
    const sw = this.pc.softwares().find(s => s.id === Number(q.get('software'))) ?? this.pc.softwares()[0] ?? null;
    this.software.set(sw);
  }

  porId = (_: number, s: SoftwareApi) => s.id;

  digitar(v: string) {
    this.busca.set(v);
    const exato = this.pc.softwares().find(s => s.nome.toLowerCase() === v.trim().toLowerCase());
    if (exato) this.escolher(exato);
  }

  escolher(s: SoftwareApi) { this.software.set(s); }

  /** Nível que a montagem selecionada alcança neste software (selo pequeno nos cards). */
  nivelRapido(s: SoftwareApi) {
    return this.itensMontagem().length ? roda(this.pecas(), s.requisitos as Requisito[], s.tipo === 'jogo').nivel : null;
  }

  nomeMontagem() { return this.opcoes().find(o => o.chave === this.montagem())?.nome ?? ''; }
  nomePeca(tipo: string, criterio: string) { return criterio === 'armazenamento' ? 'armazenamento' : NOME_PECA[tipo]; }
  textoCriterio(c: string) {
    return ({ cpu: 'o score do processador', gpu: 'o score da placa de vídeo', vram: 'a memória de vídeo (GB)',
      ram: 'a memória RAM (GB)', armazenamento: 'o armazenamento (GB)' } as Record<string, string>)[c] ?? c;
  }

  /** Troca a peça que limita (na montagem atual; se era outra montagem, ela vira a montagem atual). */
  trocar(p: Peca) {
    const m = this.opcoes().find(o => o.chave === this.montagem());
    if (m && m.chave !== ATUAL) this.pc.carregarNoRascunho(m);
    const atual = this.pc.pecas(this.pc.rascunho().itens);
    const antiga = p.tipoPeca === 'ssd' || p.tipoPeca === 'hdd' ? undefined : atual.find(x => x.tipoPeca === p.tipoPeca);
    this.pc.escolher(p.idProduto, antiga?.idProduto);
    this.montagem.set(ATUAL);
    this.toast.show(`${p.nome} entrou na montagem atual.`);
  }

  irMontar() { this.router.navigate(['/monte-seu-pc/montar']); }
  brl(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  protected readonly niveis: Nivel[] = NIVEIS;
}
