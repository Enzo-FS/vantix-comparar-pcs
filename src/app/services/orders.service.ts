import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  EMPTY, Observable, Subject, catchError, firstValueFrom, map, merge, of, shareReplay, switchMap, tap, timer,
} from 'rxjs';
import { environment } from '../../environments/environment';
import { CartItem, Customer, Order, OrderStatus, PaymentMethod } from '../models';
import { MudarStatusRequest, NovoPedidoRequest, PedidoApi } from '../core/api/api.types';
import { orderFromApi, paymentToApi, statusToApi } from '../core/api/mappers';

/** Resultado de cada consulta de "Meus pedidos": a lista, ou null + mensagem quando a API falha. */
export interface CustomerOrdersResult {
  orders: Order[] | null;
  error: string;
}

/** Mensagem para quando a consulta automática (polling) falha. */
export function pollingErrorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse && err.status === 0) return 'Sem conexão com o servidor.';
  if (err instanceof HttpErrorResponse && err.status >= 500) return 'O servidor está com problemas no momento.';
  return 'Não foi possível atualizar os pedidos.';
}

export interface NewOrderData {
  items: CartItem[];
  customer: Customer & { email: string };
  payment: { method: PaymentMethod; installments: number };
  observations?: string;
}

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/pedidos`;

  private _orders = signal<Order[]>([]);
  readonly orders$ = this._orders.asReadonly();

  // RNF10: os painéis mostram "carregando" na primeira consulta e um aviso quando a API falha.
  private _loading = signal(true);
  private _error = signal('');
  /** true até a primeira resposta (com sucesso ou com erro). */
  readonly loading = this._loading.asReadonly();
  /** Mensagem da última falha; volta a '' quando uma consulta dá certo. */
  readonly error = this._error.asReadonly();

  /** Força uma atualização imediata (após mudar status, por exemplo). */
  private refresh$ = new Subject<void>();

  /**
   * Lista de pedidos para os painéis (exige login).
   * Substitui o onSnapshot do Firebase: consulta a API a cada `pollingMs` e
   * compartilha uma única consulta entre todos os componentes inscritos.
   */
  readonly orders: Observable<Order[]> = merge(timer(0, environment.pollingMs), this.refresh$).pipe(
    switchMap(() => this.http.get<PedidoApi[]>(this.base).pipe(
      catchError(err => {
        // Mantém a última lista na tela e tenta de novo na próxima rodada do polling.
        this._error.set(pollingErrorMessage(err));
        this._loading.set(false);
        return EMPTY;
      }),
    )),
    map(list => list.map(orderFromApi).sort((a, b) => +b.createdAt - +a.createdAt)),
    tap(list => { this._orders.set(list); this._error.set(''); this._loading.set(false); }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  getOrders(): Order[] { return this._orders(); }

  /** "Tentar de novo": consulta agora, sem esperar a próxima rodada do polling. */
  refresh(): void { this.refresh$.next(); }

  /**
   * Pedidos de um cliente (público, sem login) — tela "Meus pedidos".
   * Consulta a cada `pollingMs`; quando a API falha, emite { orders: null, error } e continua tentando.
   */
  customerOrders(phone: string): Observable<CustomerOrdersResult> {
    const params = new HttpParams().set('telefone', phone);
    return timer(0, environment.pollingMs).pipe(
      switchMap(() => this.http.get<PedidoApi[]>(`${this.base}/cliente`, { params }).pipe(
        map(list => ({ orders: list.map(orderFromApi).sort((a, b) => +b.createdAt - +a.createdAt), error: '' })),
        catchError(err => of({ orders: null, error: pollingErrorMessage(err) })),
      )),
    );
  }

  /** Busca os pedidos de um cliente uma única vez (sem polling). Lança erro se a API falhar. */
  async fetchCustomerOrders(phone: string): Promise<Order[]> {
    const params = new HttpParams().set('telefone', phone);
    const list = await firstValueFrom(this.http.get<PedidoApi[]>(`${this.base}/cliente`, { params }));
    return list.map(orderFromApi).sort((a, b) => +b.createdAt - +a.createdAt);
  }

  /**
   * Cria o pedido. Preço, frete, total e número são calculados pela API;
   * se faltar estoque a API responde 409 com { mensagem }.
   */
  async addOrder(data: NewOrderData): Promise<Order> {
    const body: NovoPedidoRequest = {
      cliente: {
        nome:     data.customer.name,
        email:    data.customer.email,
        telefone: data.customer.phone,
        endereco: data.customer.address,
      },
      itens:       data.items.map(i => ({ idProduto: Number(i.id), quantidade: i.quantity })),
      pagamento:   { forma: paymentToApi(data.payment.method), parcelas: data.payment.installments },
      tipoEntrega: 'entrega',
      observacoes: data.observations?.trim() || null,
    };
    const created = await firstValueFrom(this.http.post<PedidoApi>(this.base, body));
    return orderFromApi(created);
  }

  async updateStatus(
    orderId: string,
    status: OrderStatus,
    extra: { cancelReason?: string; deliveryPersonId?: string } = {},
  ): Promise<void> {
    const body: MudarStatusRequest = { status: statusToApi(status) };
    if (extra.cancelReason)     body.motivoCancelamento = extra.cancelReason;
    if (extra.deliveryPersonId) body.idEntregador = Number(extra.deliveryPersonId);
    await firstValueFrom(this.http.patch(`${this.base}/${orderId}/status`, body));
    this.refresh$.next();
  }
}
