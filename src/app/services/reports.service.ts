import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  EstoqueBaixoApi, FaturamentoDiaApi, FormaPagamentoRelApi, MaisVendidoApi,
  PedidosHoraApi, PedidosStatusApi, ResumoApi,
} from '../core/api/api.types';

export type ReportPeriod = '7d' | '30d' | 'all';

export interface ReportData {
  resumo: ResumoApi;
  faturamentoDiario: FaturamentoDiaApi[];
  pedidosPorStatus: PedidosStatusApi[];
  maisVendidos: MaisVendidoApi[];
  formasPagamento: FormaPagamentoRelApi[];
  pedidosPorHora: PedidosHoraApi[];
  estoqueBaixo: EstoqueBaixoApi[];
  /** Nomes dos relatórios que falharam nesta consulta (os outros aparecem normalmente). */
  failed: string[];
}

const EMPTY_RESUMO: ResumoApi = { faturamento: 0, totalPedidos: 0, pedidosEntregues: 0, pedidosCancelados: 0, ticketMedio: 0 };

/** Relatórios do painel do gerente — cada endpoint chama uma consulta/view do MySQL. */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/relatorios`;

  /**
   * Carrega os 7 relatórios de forma independente: se um falhar, os outros aparecem
   * e o nome do que falhou vai em `failed`. Só dá erro geral quando todos falham.
   */
  load(period: ReportPeriod): Observable<ReportData> {
    const params = periodParams(period);
    const failed: string[] = [];
    let firstError: unknown = null;
    const get = <T>(label: string, path: string, fallback: T, opts: { extra?: Record<string, string>; noPeriod?: boolean } = {}) => {
      const p = opts.noPeriod ? undefined : opts.extra ? params.appendAll(opts.extra) : params;
      return this.http.get<T>(`${this.base}/${path}`, { params: p }).pipe(
        catchError(err => { failed.push(label); firstError ??= err; return of(fallback); }),
      );
    };

    return forkJoin({
      resumo:            get<ResumoApi>('Indicadores', 'resumo', EMPTY_RESUMO),
      faturamentoDiario: get<FaturamentoDiaApi[]>('Faturamento por dia', 'faturamento-diario', []),
      pedidosPorStatus:  get<PedidosStatusApi[]>('Pedidos por status', 'pedidos-por-status', []),
      maisVendidos:      get<MaisVendidoApi[]>('Mais vendidos', 'mais-vendidos', [], { extra: { limite: '5' } }),
      formasPagamento:   get<FormaPagamentoRelApi[]>('Formas de pagamento', 'formas-pagamento', []),
      pedidosPorHora:    get<PedidosHoraApi[]>('Pedidos por hora', 'pedidos-por-hora', []),
      estoqueBaixo:      get<EstoqueBaixoApi[]>('Estoque baixo', 'estoque-baixo', [], { noPeriod: true }),
    }).pipe(
      map(data => ({ ...data, failed: [...failed] })),
      // Todos falharam: provavelmente a API está fora; a tela mostra o erro geral.
      map(data => { if (data.failed.length === 7) throw firstError; return data; }),
    );
  }
}

/** inicio/fim no formato YYYY-MM-DD. "Tudo" não manda filtro. */
function periodParams(period: ReportPeriod): HttpParams {
  if (period === 'all') return new HttpParams();
  const days = period === '7d' ? 7 : 30;
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return new HttpParams().set('inicio', ymd(start)).set('fim', ymd(end));
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
