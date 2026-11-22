import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { MenuItem } from '../models';
import { CategoriaApi, ProdutoApi } from '../core/api/api.types';
import { productFromApi, productToApi } from '../core/api/mappers';

// Lista usada enquanto GET /api/categorias não responde (mesma ordem do 02_dados.sql).
export const CATEGORIES = ['Hardware', 'Periféricos', 'Monitores', 'Notebooks', 'Smartphones', 'Games', 'Áudio'];

/** Catálogo da loja. O nome "Menu" ficou da versão antiga; aqui são produtos. */
@Injectable({ providedIn: 'root' })
export class MenuService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/produtos`;

  private _items      = signal<MenuItem[]>([]);
  private _loaded     = signal(false);
  private _categories = signal<CategoriaApi[]>(CATEGORIES.map((nome, i) => ({ id: i + 1, nome })));
  private includeInactive = false;
  /** Número da consulta mais recente do catálogo (descarta respostas fora de ordem). */
  private reloadSeq = 0;

  private _error      = signal('');

  readonly items$      = this._items.asReadonly();
  readonly loaded$     = this._loaded.asReadonly();
  readonly categories$ = this._categories.asReadonly();
  /** Mensagem quando o catálogo não carregou (RNF10); '' quando deu certo. */
  readonly error$      = this._error.asReadonly();

  constructor() {
    this.loadCategories();
    this.reload();
  }

  /**
   * Recarrega o catálogo. O painel do gerente pede também os produtos desativados.
   * Só a resposta da consulta mais recente vale: ao abrir /gerente/produtos, a busca inicial
   * (só ativos) e a do gerente (com inativos) correm juntas, e a mais lenta não pode
   * sobrescrever a mais nova — senão os produtos pausados somem da tela do gerente.
   */
  async reload(includeInactive = this.includeInactive): Promise<void> {
    this.includeInactive = includeInactive;
    const seq = ++this.reloadSeq;
    const params = includeInactive ? new HttpParams().set('incluirInativos', 'true') : undefined;
    try {
      const list = await firstValueFrom(this.http.get<ProdutoApi[]>(this.base, { params }));
      if (seq !== this.reloadSeq) return; // resposta antiga: já existe uma consulta mais nova
      this._items.set(list.map(productFromApi));
      this._error.set('');
    } catch (e) {
      if (seq !== this.reloadSeq) return;
      // Mantém a lista anterior (se houver) e avisa a tela.
      this._error.set(e instanceof HttpErrorResponse && e.status === 0
        ? 'Sem conexão com o servidor.'
        : 'O servidor não respondeu como esperado.');
    } finally {
      if (seq === this.reloadSeq) this._loaded.set(true);
    }
  }

  /** "Tentar de novo" das telas: mostra o carregamento outra vez e consulta a API. */
  async retry(): Promise<void> {
    this._loaded.set(false);
    await Promise.all([this.reload(), this.loadCategories()]);
  }

  private async loadCategories(): Promise<void> {
    try {
      const cats = await firstValueFrom(this.http.get<CategoriaApi[]>(`${environment.apiUrl}/categorias`));
      if (cats.length) this._categories.set(cats);
    } catch (e) {
      console.error('[MenuService] erro ao carregar categorias:', e);
    }
  }

  /** Um produto pelo id (página de detalhes). Devolve null se não existir. */
  async getById(id: string): Promise<MenuItem | null> {
    try {
      return productFromApi(await firstValueFrom(this.http.get<ProdutoApi>(`${this.base}/${id}`)));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status === 404) return null;
      throw e;
    }
  }

  getAll(): MenuItem[]                 { return this._items(); }
  getCategories(): string[]            { return this._categories().map(c => c.nome); }
  getByCategory(cat: string): MenuItem[] { return this._items().filter(i => i.category === cat); }
  getSpecials(): MenuItem[]            { return this._items().filter(i => i.isSpecial && i.active !== false).slice(0, 3); }

  private categoryId(name: string): number {
    return this._categories().find(c => c.nome === name)?.id ?? 1;
  }

  async addItem(item: Omit<MenuItem, 'id'>): Promise<void> {
    await firstValueFrom(this.http.post(this.base, productToApi(item, this.categoryId(item.category))));
    await this.reload();
  }

  async updateItem(id: string, data: Partial<MenuItem>): Promise<void> {
    const current = this._items().find(i => i.id === id);
    const merged = { ...current, ...data };
    await firstValueFrom(this.http.put(`${this.base}/${id}`, productToApi(merged, this.categoryId(merged.category ?? ''))));
    await this.reload();
  }

  async deleteItem(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.base}/${id}`));
    await this.reload();
  }

  async toggleItem(id: string, active: boolean): Promise<void> {
    await firstValueFrom(this.http.patch(`${this.base}/${id}/disponivel`, { disponivel: active }));
    await this.reload();
  }
}
