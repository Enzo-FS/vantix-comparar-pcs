import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe, NgFor, NgIf } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { PcService, Montagem, UF_PADRAO, HORAS_PADRAO } from '../../services/pc.service';
import { comparar, Metrica } from '../../core/pc/regras';

const ATUAL = 'atual';

/** Tela 2: Comparar PCs (A × B), com barras por métrica e resumo automático. */
@Component({
  selector: 'app-pc-comparar',
  standalone: true,
  imports: [NgFor, NgIf, DecimalPipe],
  template: `
    <div class="pc-card cp-seletores">
      <div class="pc-card-body cp-grid">
        <div class="pc-campo">
          <label for="cp-a">PC A</label>
          <select id="cp-a" class="pc-select" [value]="a()" (change)="a.set($any($event.target).value)">
            <option *ngFor="let o of opcoes()" [value]="o.chave" [selected]="o.chave === a()">{{ o.nome }}</option>
          </select>
          <button type="button" class="btn btn-outline btn-sm cp-usar" (click)="usar(a())">Usar esta montagem</button>
        </div>
        <div class="cp-vs" aria-hidden="true">×</div>
        <div class="pc-campo">
          <label for="cp-b">PC B</label>
          <select id="cp-b" class="pc-select" [value]="b()" (change)="b.set($any($event.target).value)">
            <option *ngFor="let o of opcoes()" [value]="o.chave" [selected]="o.chave === b()">{{ o.nome }}</option>
          </select>
          <button type="button" class="btn btn-outline btn-sm cp-usar" (click)="usar(b())">Usar esta montagem</button>
        </div>
      </div>
      <div class="cp-config">
        <div class="pc-campo">
          <label for="cp-uf">Estado (tarifa)</label>
          <select id="cp-uf" class="pc-select" [value]="uf()" (change)="uf.set($any($event.target).value)">
            <option *ngFor="let t of pc.tarifas()" [value]="t.uf" [selected]="t.uf === uf()">{{ t.uf }} · R$ {{ t.valorKwh | number:'1.2-2':'pt-BR' }}/kWh</option>
          </select>
        </div>
        <div class="pc-campo cp-horas">
          <label for="cp-h">Uso por dia: <strong>{{ horas() }} h</strong> (o mesmo para os dois)</label>
          <input id="cp-h" type="range" class="pc-range" min="1" max="24" [value]="horas()" (input)="horas.set(+$any($event.target).value)">
        </div>
      </div>
    </div>

    <div *ngIf="resultado() as r" class="pc-card cp-resultado">
      <div class="pc-card-body">
        <div class="cp-cabecalho">
          <span class="cp-legenda cp-legenda-a">A · {{ nome(a()) }}</span>
          <span class="cp-legenda cp-legenda-b">B · {{ nome(b()) }}</span>
        </div>

        <div *ngFor="let m of r.metricas" class="cp-linha">
          <div class="cp-linha-topo">
            <span class="cp-metrica">{{ m.rotulo }}</span>
            <span class="cp-dif" [class.cp-dif-melhor]="m.melhor === 'b'" [class.cp-dif-pior]="m.melhor === 'a'">
              B {{ m.diferencaPercentual == null ? '—' : (m.diferencaPercentual > 0 ? '+' : '') + (m.diferencaPercentual | number:'1.0-1':'pt-BR') + '%' }}
            </span>
          </div>
          <div class="cp-barras">
            <div class="cp-barra-linha" [class.cp-melhor]="m.melhor === 'a'">
              <span class="cp-letra">A</span>
              <div class="cp-trilho"><div class="cp-barra cp-barra-a" [style.width.%]="largura(m, m.a)"></div></div>
              <span class="cp-valor">{{ formatar(m, m.a) }}<span *ngIf="m.melhor === 'a'" class="cp-check" aria-label="melhor"> ✔</span></span>
            </div>
            <div class="cp-barra-linha" [class.cp-melhor]="m.melhor === 'b'">
              <span class="cp-letra">B</span>
              <div class="cp-trilho"><div class="cp-barra cp-barra-b" [style.width.%]="largura(m, m.b)"></div></div>
              <span class="cp-valor">{{ formatar(m, m.b) }}<span *ngIf="m.melhor === 'b'" class="cp-check" aria-label="melhor"> ✔</span></span>
            </div>
          </div>
        </div>

        <p class="cp-resumo" data-teste="resumo-comparacao">💡 {{ r.resumo }}</p>
        <p class="cp-nota">Verde = melhor valor em cada linha (mais score; menos consumo, custo e preço).
          A diferença percentual compara B com A.</p>
      </div>
    </div>
    <p *ngIf="!resultado()" class="cp-nota">Escolha duas montagens com peças para comparar.</p>
  `,
  styles: [`
    .cp-grid { display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: start; }
    .cp-vs { align-self: center; font-family: var(--font-display); font-size: 1.6rem; color: var(--stone-400); padding-top: 1rem; }
    .cp-usar { align-self: flex-start; margin-top: .35rem; color: var(--brand-700); border-color: var(--brand-200); }
    .cp-config { display: grid; grid-template-columns: 220px 1fr; gap: 1rem; padding: 0 1.25rem 1.25rem; }
    .cp-resultado { margin-top: 1rem; }
    .cp-cabecalho { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
    .cp-legenda { font-size: .8rem; font-weight: 700; padding: .25rem .65rem; border-radius: var(--r-full); }
    .cp-legenda-a { background: var(--stone-100); color: var(--stone-700); }
    .cp-legenda-b { background: var(--brand-50); color: var(--brand-700); }
    .cp-linha { padding: .8rem 0; border-top: 1px solid var(--stone-100); }
    .cp-linha-topo { display: flex; justify-content: space-between; margin-bottom: .45rem; }
    .cp-metrica { font-weight: 700; font-size: .88rem; color: var(--stone-900); }
    .cp-dif { font-size: .78rem; font-weight: 700; color: var(--stone-500); }
    .cp-dif-melhor { color: var(--pc-ok); }
    .cp-dif-pior { color: var(--pc-erro); }
    .cp-barras { display: flex; flex-direction: column; gap: .3rem; }
    .cp-barra-linha { display: grid; grid-template-columns: 1.2rem 1fr 8.5rem; align-items: center; gap: .5rem; font-size: .82rem; }
    .cp-letra { font-weight: 700; color: var(--stone-500); }
    .cp-trilho { height: .7rem; background: var(--stone-100); border-radius: var(--r-full); overflow: hidden; }
    .cp-barra { height: 100%; border-radius: var(--r-full); transition: width .4s ease; }
    .cp-barra-a { background: var(--stone-400); }
    .cp-barra-b { background: var(--brand-500); }
    .cp-melhor .cp-barra { background: var(--pc-ok); }
    .cp-valor { text-align: right; font-variant-numeric: tabular-nums; color: var(--stone-700); }
    .cp-melhor .cp-valor { color: var(--pc-ok); font-weight: 700; }
    .cp-resumo { margin-top: 1rem; padding: .9rem 1rem; background: var(--brand-50); border: 1px solid var(--brand-200);
      border-radius: var(--r-lg); color: var(--brand-800); font-weight: 600; }
    .cp-nota { margin-top: .6rem; font-size: .75rem; color: var(--stone-500); }
    @media (max-width: 700px) {
      .cp-grid { grid-template-columns: 1fr; }
      .cp-vs { display: none; }
      .cp-config { grid-template-columns: 1fr; }
      .cp-barra-linha { grid-template-columns: 1.2rem 1fr 6.5rem; }
    }
  `],
})
export class CompararComponent implements OnInit {
  pc = inject(PcService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  a = signal('');
  b = signal('');
  uf = signal(this.pc.rascunho().uf || UF_PADRAO);
  horas = signal(HORAS_PADRAO);

  /** Montagem em edição + exemplos + salvas. */
  opcoes = computed(() => {
    const lista: Montagem[] = [];
    const r = this.pc.rascunho();
    if (r.itens.length) lista.push({ chave: ATUAL, idServidor: null, nome: `Montagem atual${r.nome ? ' (' + r.nome + ')' : ''}`,
      uf: r.uf, horasUsoDia: r.horasUsoDia, origem: 'navegador', itens: r.itens });
    return [...lista, ...this.pc.montagens()];
  });

  resultado = computed(() => {
    const ma = this.opcoes().find(o => o.chave === this.a()), mb = this.opcoes().find(o => o.chave === this.b());
    if (!ma || !mb || !ma.itens.length || !mb.itens.length) return null;
    return comparar(this.rotulo(ma), this.pc.pecas(ma.itens), this.rotulo(mb), this.pc.pecas(mb.itens),
      this.pc.valorKwh(this.uf()), this.horas());
  });

  ngOnInit() {
    const ops = this.opcoes();
    const pedida = this.route.snapshot.queryParamMap.get('montagem');
    const exemplos = ops.filter(o => o.origem === 'exemplo');
    if (pedida === ATUAL && ops.some(o => o.chave === ATUAL)) {
      this.a.set(ATUAL);
      this.b.set(exemplos[1]?.chave ?? exemplos[0]?.chave ?? '');
    } else {
      this.a.set(exemplos[0]?.chave ?? ops[0]?.chave ?? '');
      this.b.set(exemplos[1]?.chave ?? ops[1]?.chave ?? '');
    }
  }

  nome(chave: string) { return this.opcoes().find(o => o.chave === chave)?.nome ?? '—'; }
  /** Nome usado no texto do resumo ("O PC B é..."). */
  private rotulo(m: Montagem) { return m.chave === ATUAL ? 'PC atual' : m.nome; }

  largura(m: Metrica, v: number) {
    const max = Math.max(m.a, m.b);
    return max > 0 ? Math.max(3, (v / max) * 100) : 0;
  }

  formatar(m: Metrica, v: number) {
    if (m.metrica === 'custoMensal' || m.metrica === 'preco') return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (m.metrica === 'consumo') return `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} W`;
    return String(v);
  }

  usar(chave: string) {
    const m = this.opcoes().find(o => o.chave === chave);
    if (!m) return;
    if (m.chave !== ATUAL) this.pc.carregarNoRascunho(m);
    this.router.navigate(['/monte-seu-pc/montar']);
  }
}
