import { Component, Input } from '@angular/core';
import { NgFor } from '@angular/common';
import { Avaliacao, NOME_PECA, Peca } from '../../core/pc/regras';

interface Item { estado: 'ok' | 'erro' | 'alerta' | 'na'; titulo: string; detalhe: string; }

/** Lista de compatibilidade (✔ / ✖ / ! por regra), a partir do resultado de regras.avaliar(). */
@Component({
  selector: 'app-pc-checklist',
  standalone: true,
  imports: [NgFor],
  template: `
    <ul class="ck-lista" aria-label="Compatibilidade da montagem">
      <li *ngFor="let i of itens" class="pc-check" [class]="'pc-check pc-check-' + i.estado">
        <span class="pc-check-icone" [attr.aria-label]="rotuloEstado[i.estado]">{{ icone[i.estado] }}</span>
        <span><strong>{{ i.titulo }}</strong><br><span class="ck-detalhe">{{ i.detalhe }}</span></span>
      </li>
    </ul>
  `,
  styles: [`.ck-lista { list-style: none; } .ck-detalhe { color: var(--stone-500); font-size: .8rem; }
            .pc-check-erro .ck-detalhe { color: var(--pc-erro); } .pc-check-alerta .ck-detalhe { color: var(--pc-alerta); }`],
})
export class PcChecklistComponent {
  @Input({ required: true }) avaliacao!: Avaliacao;
  @Input() pecas: Peca[] = [];

  icone = { ok: '✔', erro: '✖', alerta: '!', na: '–' };
  rotuloEstado = { ok: 'Compatível', erro: 'Incompatível', alerta: 'Atenção', na: 'Não se aplica' };

  get itens(): Item[] {
    const a = this.avaliacao;
    const tem = (t: string) => this.pecas.some(p => p.tipoPeca === t);
    const aviso = (...codigos: string[]) => a.avisos.find(x => codigos.includes(x.codigo));
    const regra = (titulo: string, aplica: boolean, codigos: string[], okMsg: string, naMsg: string): Item => {
      if (!aplica) return { estado: 'na', titulo, detalhe: naMsg };
      const x = aviso(...codigos);
      return x ? { estado: x.nivel, titulo, detalhe: x.mensagem } : { estado: 'ok', titulo, detalhe: okMsg };
    };
    const faltam = a.faltando.map(f => NOME_PECA[f]);
    const fonteAviso = a.avisos.find(x => x.codigo === 'C8');
    return [
      regra('Soquete: processador × placa-mãe', tem('cpu') && tem('placa_mae'), ['C1'],
        'Mesmo soquete.', 'Escolha processador e placa-mãe.'),
      regra('Memória: RAM × placa-mãe × processador', tem('placa_mae') && (tem('ram') || tem('cpu')), ['C2', 'C3'],
        'Mesmo tipo de memória.', 'Escolha placa-mãe e memória.'),
      regra('Placa-mãe cabe no gabinete', tem('placa_mae') && tem('gabinete'), ['C4'],
        'O formato da placa cabe no gabinete.', 'Escolha placa-mãe e gabinete.'),
      regra('Uma unidade de cada peça única', this.pecas.length > 0, ['C5'],
        'Um processador, uma placa, uma fonte e um gabinete.', 'Nenhuma peça escolhida.'),
      regra('Cooler compatível', tem('cooler') && tem('cpu'), ['C6'],
        'O cooler suporta o soquete do processador.', 'Escolha processador e cooler.'),
      a.consumo.seloFonte === 'sem_fonte'
        ? { estado: 'erro', titulo: 'Fonte suficiente', detalhe: 'Sua montagem não tem fonte.' }
        : fonteAviso
          ? { estado: fonteAviso.nivel, titulo: 'Fonte suficiente', detalhe: fonteAviso.mensagem }
          : { estado: 'ok', titulo: 'Fonte suficiente', detalhe: a.consumo.mensagemFonte },
      regra('Placa de vídeo', this.pecas.length > 0, ['C7'], 'Placa de vídeo dedicada.', 'Nenhuma peça escolhida.'),
      faltam.length
        ? { estado: 'erro', titulo: 'Peças essenciais', detalhe: `Falta: ${faltam.join(', ')}.` }
        : { estado: 'ok', titulo: 'Peças essenciais', detalhe: 'Todas as peças essenciais estão na montagem.' },
    ];
  }
}
