import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { MovimentacaoApi, SaldoEstoqueApi, TipoMovimentacaoApi } from '../core/api/api.types';

/** Controle de estoque: saldo, movimentações, entrada de mercadoria, ajuste e estoque mínimo. */
@Injectable({ providedIn: 'root' })
export class EstoqueService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/estoque`;

  saldo(): Promise<SaldoEstoqueApi[]> {
    return firstValueFrom(this.http.get<SaldoEstoqueApi[]>(this.base));
  }

  movimentacoes(filtro: { produto?: number | null; tipo?: TipoMovimentacaoApi | '' } = {}): Promise<MovimentacaoApi[]> {
    let params = new HttpParams().set('limite', 300);
    if (filtro.produto) params = params.set('produto', filtro.produto);
    if (filtro.tipo) params = params.set('tipo', filtro.tipo);
    return firstValueFrom(this.http.get<MovimentacaoApi[]>(`${this.base}/movimentacoes`, { params }));
  }

  entrada(idProduto: number, quantidade: number, motivo: string): Promise<SaldoEstoqueApi> {
    return firstValueFrom(this.http.post<SaldoEstoqueApi>(`${this.base}/${idProduto}/entrada`, { quantidade, motivo }));
  }

  ajuste(idProduto: number, novaQuantidade: number, motivo: string): Promise<SaldoEstoqueApi> {
    return firstValueFrom(this.http.post<SaldoEstoqueApi>(`${this.base}/${idProduto}/ajuste`, { novaQuantidade, motivo }));
  }

  minimo(idProduto: number, estoqueMinimo: number): Promise<SaldoEstoqueApi> {
    return firstValueFrom(this.http.patch<SaldoEstoqueApi>(`${this.base}/${idProduto}/minimo`, { estoqueMinimo }));
  }
}
