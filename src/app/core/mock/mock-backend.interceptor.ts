// ============================================================
// BACK-END FALSO (só para desenvolvimento do front)
// Liga com environment.useMock = true. Responde às mesmas rotas do
// docs/API_CONTRATO.md, com os dados de database/02_dados.sql
// (gerados em mock-seed.json por scripts/sql-to-mock.mjs) e imita as
// regras do banco: trigger de estoque, FK RESTRICT, UNIQUE de e-mail etc.
// O estado fica no localStorage; para zerar rode vantixMockReset() no console.
// Para simular a API fora do ar (RNF10): vantixMockOffline(true) / vantixMockOffline(false).
// "Monte seu PC": dados em mock-pc-seed.json (gerado por scripts/gerar-seed.mjs) e cálculos
// em core/pc/regras.ts — as mesmas regras da API Java.
// ============================================================
import {
  HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse,
} from '@angular/common/http';
import { mergeMap, of, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { shippingFor } from '../../services/cart.service';
import seed from './mock-seed.json';
import pcSeed from './mock-pc-seed.json';
import * as regras from '../pc/regras';
import type { EspecificacaoApi, MontagemApi, SoftwareApi, TarifaApi } from '../api/api.types';

// ── Tipos das "tabelas" ─────────────────────────────────────
interface Usuario   { id_usuario: number; nome: string; email: string; senha_hash: string; papel: string; ativo?: number; data_criacao?: string; senha_mock?: string; }
interface Categoria { id_categoria: number; nome: string; descricao: string | null; }
interface Produto   { id_produto: number; id_categoria: number; nome: string; descricao: string | null; marca: string | null; preco: number; preco_antigo: number | null; estoque: number; imagem_url: string | null; destaque: number; disponivel?: number; }
interface Relacao   { id_produto: number; id_produto_relacionado: number; }
interface Cliente   { id_cliente: number; nome: string; email: string; telefone: string; endereco: string | null; data_criacao?: string; }
interface Pedido    { id_pedido: number; numero: string; id_cliente: number; id_entregador: number | null; tipo_entrega: string; endereco_entrega: string | null; frete: number; valor_total: number; status: string; motivo_cancelamento: string | null; observacoes?: string | null; id_montagem?: number | null; data_criacao: string; data_atualizacao: string; }
type Especificacao = Omit<EspecificacaoApi, 'nome' | 'marca' | 'preco' | 'precoAntigo' | 'imagemUrl' | 'disponivel' | 'categoria' | 'estoque'>;
interface Item      { id_item: number; id_pedido: number; id_produto: number; quantidade: number; preco_unitario: number; }
interface Pagamento { id_pagamento: number; id_pedido: number; forma: string; parcelas: number; valor: number; }

interface Db {
  usuario_painel: Usuario[]; categoria: Categoria[]; produto: Produto[];
  produto_relacionado: Relacao[]; cliente: Cliente[]; pedido: Pedido[];
  item_pedido: Item[]; pagamento: Pagamento[];
  // Monte seu PC
  especificacao: Especificacao[]; tarifa: TarifaApi[]; software: SoftwareApi[]; montagem: MontagemApi[];
  /** id_usuario (papel cliente) -> id_cliente */
  conta_cliente: { id_usuario: number; id_cliente: number }[];
  // Controle de estoque (criados na primeira consulta; o saldo continua em produto.estoque)
  estoque_minimo?: Record<number, number>;
  movimentacao?: Movimentacao[];
}
interface Movimentacao { id: number; id_produto: number; id_pedido: number | null; id_usuario: number | null; tipo: string;
  quantidade: number; saldo_apos: number; motivo: string | null; data: string; }

// v2: modelo com o "Monte seu PC" (o v1 é descartado e o mock recomeça do seed).
const STORAGE_KEY = 'vantix_mock_db_v2';
const DEMO_PASSWORD = 'vantix2024'; // senha dos usuários do 02_dados.sql

class ApiError { constructor(public status: number, public mensagem: string) {} }

// ── Persistência ────────────────────────────────────────────
function freshDb(): Db {
  const db = JSON.parse(JSON.stringify(seed)) as Db;
  db.usuario_painel.forEach(u => { u.ativo ??= 1; u.data_criacao ??= '2026-09-01 09:00:00'; u.senha_mock = DEMO_PASSWORD; });
  db.produto.forEach(p => { p.disponivel ??= 1; });
  db.pedido.forEach(p => { p.observacoes ??= null; });
  // Monte seu PC
  const pc = JSON.parse(JSON.stringify(pcSeed)) as typeof pcSeed;
  db.produto.push(...(pc.produtosNovos as Produto[]));
  db.especificacao = pc.especificacoes as Especificacao[];
  db.tarifa = pc.tarifas;
  db.software = pc.softwares as SoftwareApi[];
  db.montagem = pc.montagens as MontagemApi[];
  const c = pc.clienteComConta;
  db.usuario_painel.push({ id_usuario: c.idUsuario, nome: c.nome, email: c.email, senha_hash: '(bcrypt)', papel: 'cliente',
    ativo: 1, data_criacao: '2026-09-13 18:44:00', senha_mock: DEMO_PASSWORD });
  db.conta_cliente = [{ id_usuario: c.idUsuario, id_cliente: c.idCliente }];
  return db;
}

let db: Db = load();

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch { /* ignora */ }
  return freshDb();
}
function save(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* ignora */ }
}
(window as unknown as Record<string, unknown>)['vantixMockReset'] = () => {
  db = freshDb(); save(); location.reload();
};

// Simula a API fora do ar: toda chamada falha como erro de rede (status 0), igual ao servidor desligado.
const OFFLINE_KEY = 'vantix_mock_offline';
function isOffline(): boolean {
  try { return localStorage.getItem(OFFLINE_KEY) === '1'; } catch { return false; }
}
(window as unknown as Record<string, unknown>)['vantixMockOffline'] = (on = true) => {
  try { on ? localStorage.setItem(OFFLINE_KEY, '1') : localStorage.removeItem(OFFLINE_KEY); } catch { /* ignora */ }
  return on ? 'API simulada FORA do ar' : 'API simulada de volta';
};

// ── Utilitários ─────────────────────────────────────────────
const nextId = <T>(rows: T[], key: keyof T) => rows.reduce((m, r) => Math.max(m, Number(r[key])), 0) + 1;
const money = (v: number) => Math.round(v * 100) / 100;
function now(): string {
  const d = new Date(); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const iso = (sqlDate: string | null | undefined) => (sqlDate ? sqlDate.replace(' ', 'T') : null);

// ── DTOs (formato do contrato) ──────────────────────────────
function produtoDto(p: Produto) {
  return {
    id: p.id_produto, idCategoria: p.id_categoria,
    categoria: db.categoria.find(c => c.id_categoria === p.id_categoria)?.nome ?? '',
    nome: p.nome, descricao: p.descricao, marca: p.marca,
    preco: p.preco, precoAntigo: p.preco_antigo, estoque: p.estoque,
    imagemUrl: p.imagem_url, destaque: !!p.destaque, disponivel: p.disponivel !== 0,
  };
}
function usuarioDto(u: Usuario) {
  const conta = db.conta_cliente.find(x => x.id_usuario === u.id_usuario);
  return { id: u.id_usuario, nome: u.nome, email: u.email, papel: u.papel, ativo: u.ativo !== 0, dataCriacao: iso(u.data_criacao),
           ...(conta ? { idCliente: conta.id_cliente } : {}) };
}
function pedidoDto(p: Pedido) {
  const c = db.cliente.find(x => x.id_cliente === p.id_cliente);
  const pg = db.pagamento.find(x => x.id_pedido === p.id_pedido);
  return {
    id: p.id_pedido, numero: p.numero, status: p.status, tipoEntrega: p.tipo_entrega,
    enderecoEntrega: p.endereco_entrega, frete: p.frete, valorTotal: p.valor_total,
    observacoes: p.observacoes ?? null, motivoCancelamento: p.motivo_cancelamento,
    idEntregador: p.id_entregador, idMontagem: p.id_montagem ?? null, dataCriacao: iso(p.data_criacao), dataAtualizacao: iso(p.data_atualizacao),
    cliente: c ? { id: c.id_cliente, nome: c.nome, email: c.email, telefone: c.telefone, endereco: c.endereco } : null,
    itens: db.item_pedido.filter(i => i.id_pedido === p.id_pedido).map(i => {
      const prod = db.produto.find(x => x.id_produto === i.id_produto);
      return { idProduto: i.id_produto, nome: prod?.nome ?? '', imagemUrl: prod?.imagem_url ?? null,
               quantidade: i.quantidade, precoUnitario: i.preco_unitario, subtotal: money(i.quantidade * i.preco_unitario) };
    }),
    pagamento: pg ? { forma: pg.forma, parcelas: pg.parcelas, valor: pg.valor } : null,
  };
}

// ── Autenticação ────────────────────────────────────────────
function currentUser(req: HttpRequest<unknown>): Usuario | null {
  const m = /^Bearer mock\.(\d+)$/.exec(req.headers.get('Authorization') ?? '');
  return m ? db.usuario_painel.find(u => u.id_usuario === Number(m[1]) && u.ativo !== 0) ?? null : null;
}
function requireUser(req: HttpRequest<unknown>, ...papeis: string[]): Usuario {
  const u = currentUser(req);
  if (!u) throw new ApiError(401, 'Faça login para continuar.');
  if (papeis.length && !papeis.includes(u.papel)) throw new ApiError(403, 'Seu perfil não tem acesso a este recurso.');
  return u;
}

// ── Movimentações de estoque (igual à tabela movimentacao_estoque) ──
function movimentacoes(): Movimentacao[] {
  if (!db.movimentacao) {
    db.movimentacao = db.produto.filter(p => p.estoque > 0).map((p, i) => ({ id: i + 1, id_produto: p.id_produto, id_pedido: null,
      id_usuario: 2, tipo: 'entrada', quantidade: p.estoque, saldo_apos: p.estoque, motivo: 'Saldo inicial', data: '2026-09-01 09:00:00' }));
  }
  return db.movimentacao;
}
function registrarMov(idProduto: number, tipo: string, quantidade: number, motivo: string | null, idPedido: number | null, idUsuario: number | null) {
  const l = movimentacoes();
  const prod = db.produto.find(x => x.id_produto === idProduto)!;
  l.push({ id: nextId(l, 'id'), id_produto: idProduto, id_pedido: idPedido, id_usuario: idUsuario, tipo, quantidade,
    saldo_apos: prod.estoque, motivo, data: now() });
}
const minimo = (idProduto: number) => (db.estoque_minimo ??= {})[idProduto] ?? 10;

// ── Trigger trg_pedido_estoque ──────────────────────────────
function applyStockTrigger(p: Pedido, oldStatus: string, newStatus: string): void {
  const itens = db.item_pedido.filter(i => i.id_pedido === p.id_pedido);
  if (oldStatus === 'pendente' && newStatus === 'confirmado') {
    for (const i of itens) {
      const prod = db.produto.find(x => x.id_produto === i.id_produto)!;
      if (prod.estoque - i.quantidade < 0) {
        throw new ApiError(409, `Estoque insuficiente para "${prod.nome}" (restam ${prod.estoque}).`);
      }
    }
    itens.forEach(i => {
      db.produto.find(x => x.id_produto === i.id_produto)!.estoque -= i.quantidade;
      registrarMov(i.id_produto, 'saida', -i.quantidade, `Venda ${p.numero}`, p.id_pedido, null);
    });
  } else if (newStatus === 'cancelado' && ['confirmado', 'em_preparacao', 'pronto'].includes(oldStatus)) {
    itens.forEach(i => {
      db.produto.find(x => x.id_produto === i.id_produto)!.estoque += i.quantidade;
      registrarMov(i.id_produto, 'devolucao', i.quantidade, `Cancelamento ${p.numero}`, p.id_pedido, null);
    });
  }
}

// "pronto -> entregue" só para retirada; "pronto -> saiu_para_entrega" só para entrega (igual à API).
const TRANSITIONS: Record<string, string[]> = {
  pendente:          ['confirmado', 'cancelado'],
  confirmado:        ['em_preparacao', 'cancelado'],
  em_preparacao:     ['pronto', 'cancelado'],
  pronto:            ['saiu_para_entrega', 'entregue', 'cancelado'],
  saiu_para_entrega: ['entregue'],
  entregue:          [],
  cancelado:         [],
};

// ── Relatórios ──────────────────────────────────────────────
function inPeriod(req: HttpRequest<unknown>) {
  const ini = req.params.get('inicio');
  const fim = req.params.get('fim');
  return db.pedido.filter(p => {
    const dia = p.data_criacao.slice(0, 10);
    return (!ini || dia >= ini) && (!fim || dia <= fim);
  });
}

// ── Rotas ───────────────────────────────────────────────────
type Handler = (req: HttpRequest<any>, params: string[]) => unknown;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, path: string, h: Handler) =>
  routes.push([method, new RegExp('^' + path.replace(/:\w+/g, '(\\d+)') + '$'), h]);

route('POST', '/auth/login', req => {
  const { email, senha } = req.body ?? {};
  const u = db.usuario_painel.find(x => x.email === String(email ?? '').trim().toLowerCase());
  if (!u || (u.senha_mock ?? DEMO_PASSWORD) !== senha) throw new ApiError(401, 'E-mail ou senha incorretos.');
  if (u.ativo === 0) throw new ApiError(403, 'Usuário desativado.');
  return { token: `mock.${u.id_usuario}`, usuario: usuarioDto(u) };
});

route('GET', '/categorias', () => db.categoria.map(c => ({ id: c.id_categoria, nome: c.nome, descricao: c.descricao })));

route('GET', '/produtos', req => {
  const todos = req.params.get('incluirInativos') === 'true';
  const cat = req.params.get('categoria');
  const q = (req.params.get('busca') ?? '').toLowerCase();
  if (todos) requireUser(req, 'gerente');
  return db.produto
    .filter(p => todos || p.disponivel !== 0)
    .map(produtoDto)
    .filter(p => !cat || p.categoria === cat)
    .filter(p => !q || `${p.nome} ${p.marca} ${p.descricao}`.toLowerCase().includes(q));
});

route('GET', '/produtos/:id', (_r, [id]) => {
  const p = db.produto.find(x => x.id_produto === +id);
  if (!p) throw new ApiError(404, 'Produto não encontrado.');
  return produtoDto(p);
});

function validateProduto(b: any): void {
  if (!b?.nome?.trim()) throw new ApiError(400, 'O nome do produto é obrigatório.');
  if (!(Number(b.preco) > 0)) throw new ApiError(400, 'O preço deve ser maior que zero.');
  if (Number(b.estoque) < 0) throw new ApiError(400, 'O estoque não pode ser negativo.');
  if (!db.categoria.some(c => c.id_categoria === Number(b.idCategoria))) throw new ApiError(400, 'Categoria inválida.');
}
function produtoFromBody(b: any): Omit<Produto, 'id_produto'> {
  return { id_categoria: Number(b.idCategoria), nome: b.nome.trim(), descricao: b.descricao ?? null, marca: b.marca ?? null,
           preco: Number(b.preco), preco_antigo: b.precoAntigo ?? null, estoque: Number(b.estoque ?? 0),
           imagem_url: b.imagemUrl ?? null, destaque: b.destaque ? 1 : 0, disponivel: b.disponivel === false ? 0 : 1 };
}

route('POST', '/produtos', req => {
  requireUser(req, 'gerente');
  validateProduto(req.body);
  const p: Produto = { id_produto: nextId(db.produto, 'id_produto'), ...produtoFromBody(req.body) };
  db.produto.push(p);
  return produtoDto(p);
});

route('PUT', '/produtos/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  validateProduto(req.body);
  const p = db.produto.find(x => x.id_produto === +id);
  if (!p) throw new ApiError(404, 'Produto não encontrado.');
  Object.assign(p, produtoFromBody(req.body));
  return produtoDto(p);
});

route('PATCH', '/produtos/:id/disponivel', (req, [id]) => {
  requireUser(req, 'gerente');
  const p = db.produto.find(x => x.id_produto === +id);
  if (!p) throw new ApiError(404, 'Produto não encontrado.');
  p.disponivel = req.body?.disponivel ? 1 : 0;
  return produtoDto(p);
});

route('DELETE', '/produtos/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  if (db.item_pedido.some(i => i.id_produto === +id) || db.montagem.some(m => m.itens.some(i => i.idProduto === +id))) {
    throw new ApiError(409, 'Este produto já tem pedidos ou está em montagens e não pode ser excluído. Desative-o.');
  }
  db.especificacao = db.especificacao.filter(e => e.idProduto !== +id);
  db.produto = db.produto.filter(x => x.id_produto !== +id);
  db.produto_relacionado = db.produto_relacionado.filter(r => r.id_produto !== +id && r.id_produto_relacionado !== +id);
  return null;
});

route('GET', '/pedidos', req => {
  requireUser(req, 'gerente', 'estoque', 'logistica');
  const st = req.params.get('status');
  return db.pedido.filter(p => !st || p.status === st).map(pedidoDto);
});

route('GET', '/pedidos/cliente', req => {
  const tel = (req.params.get('telefone') ?? '').replace(/\D/g, '');
  const email = (req.params.get('email') ?? '').toLowerCase();
  if (!tel && !email) throw new ApiError(400, 'Informe telefone ou e-mail.');
  const ids = db.cliente
    .filter(c => (tel && c.telefone.replace(/\D/g, '') === tel) || (email && c.email === email))
    .map(c => c.id_cliente);
  return db.pedido.filter(p => ids.includes(p.id_cliente)).map(pedidoDto);
});

route('POST', '/pedidos', req => {
  const b = req.body ?? {};
  const cli = b.cliente ?? {};
  if (!cli.nome?.trim() || !cli.email?.trim() || !cli.telefone?.trim()) {
    throw new ApiError(400, 'Nome, e-mail e telefone do cliente são obrigatórios.');
  }
  if (!Array.isArray(b.itens) || !b.itens.length) throw new ApiError(400, 'O pedido precisa ter pelo menos um item.');
  if (!['credito', 'debito', 'pix', 'boleto'].includes(b.pagamento?.forma)) throw new ApiError(400, 'Forma de pagamento inválida.');
  const parcelas = Number(b.pagamento?.parcelas ?? 1);
  if (parcelas < 1 || parcelas > 12) throw new ApiError(400, 'Parcelas devem ser entre 1 e 12.');

  // Transação: trabalha numa cópia e só grava se tudo der certo.
  const backup = JSON.stringify(db);
  try {
    const email = cli.email.trim().toLowerCase();
    let c = db.cliente.find(x => x.email === email);
    if (c) Object.assign(c, { nome: cli.nome.trim(), telefone: cli.telefone, endereco: cli.endereco ?? c.endereco });
    else {
      c = { id_cliente: nextId(db.cliente, 'id_cliente'), nome: cli.nome.trim(), email, telefone: cli.telefone, endereco: cli.endereco ?? null, data_criacao: now() };
      db.cliente.push(c);
    }

    const idPedido = nextId(db.pedido, 'id_pedido');
    let subtotal = 0;
    const itens: Item[] = [];
    for (const it of b.itens) {
      const prod = db.produto.find(x => x.id_produto === Number(it.idProduto));
      if (!prod || prod.disponivel === 0) throw new ApiError(400, `Produto ${it.idProduto} indisponível.`);
      const qtd = Number(it.quantidade);
      if (!(qtd > 0)) throw new ApiError(400, 'Quantidade inválida.');
      if (prod.estoque < qtd) throw new ApiError(409, `Estoque insuficiente para "${prod.nome}" (restam ${prod.estoque}).`);
      const existing = itens.find(x => x.id_produto === prod.id_produto);
      if (existing) existing.quantidade += qtd;
      else itens.push({ id_item: 0, id_pedido: idPedido, id_produto: prod.id_produto, quantidade: qtd, preco_unitario: prod.preco });
      subtotal += prod.preco * qtd;
    }
    const retirada = b.tipoEntrega === 'retirada';
    const end = b.enderecoEntrega;
    const enderecoTexto = end?.logradouro
      ? `${end.logradouro}, ${end.numero}${end.complemento ? ' - ' + end.complemento : ''} - ${end.bairro}, ${end.cidade} - ${end.uf}`
        + (end.cep ? `, CEP ${String(end.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '')
      : (cli.endereco ?? null);
    if (!retirada && !enderecoTexto) throw new ApiError(400, 'Informe o endereço de entrega.');
    const frete = retirada ? 0 : shippingFor(subtotal);
    const total = money(subtotal + frete);
    const maxNum = db.pedido.reduce((m, p) => Math.max(m, Number(p.numero.replace(/\D/g, '')) || 0), 1000);

    // Peças de hardware do pedido viram uma montagem (UF e horas da Verificação do PC).
    const hardware = itens.filter(i => db.especificacao.some(e => e.idProduto === i.id_produto));
    let idMontagem: number | null = null;
    if (hardware.length) {
      idMontagem = nextId(db.montagem, 'id');
      const uf = db.tarifa.some(t => t.uf === b.montagem?.uf) ? b.montagem.uf : 'SP';
      db.montagem.push({ id: idMontagem, idCliente: c.id_cliente, nome: b.montagem?.nome || `PC do pedido VTX-${maxNum + 1}`,
        horasUsoDia: Math.min(24, Math.max(1, Number(b.montagem?.horasUsoDia ?? 4))), uf, exemplo: false,
        itens: hardware.map(i => ({ idProduto: i.id_produto, quantidade: i.quantidade })) });
    }

    const pedido: Pedido = {
      id_pedido: idPedido, numero: `VTX-${maxNum + 1}`, id_cliente: c.id_cliente, id_entregador: null, id_montagem: idMontagem,
      tipo_entrega: retirada ? 'retirada' : 'entrega', endereco_entrega: retirada ? null : enderecoTexto,
      frete, valor_total: total, status: 'pendente', motivo_cancelamento: null,
      observacoes: b.observacoes ?? null, data_criacao: now(), data_atualizacao: now(),
    };
    db.pedido.push(pedido);
    let nextItem = nextId(db.item_pedido, 'id_item');
    itens.forEach(i => { i.id_item = nextItem++; db.item_pedido.push(i); });
    db.pagamento.push({ id_pagamento: nextId(db.pagamento, 'id_pagamento'), id_pedido: idPedido, forma: b.pagamento.forma, parcelas, valor: total });

    // PIX e cartão: pagamento aprovado na hora -> UPDATE para 'confirmado' (dispara a trigger).
    if (b.pagamento.forma !== 'boleto') {
      applyStockTrigger(pedido, 'pendente', 'confirmado');
      pedido.status = 'confirmado';
    }
    return pedidoDto(pedido);
  } catch (e) {
    db = JSON.parse(backup) as Db; // ROLLBACK
    throw e;
  }
});

route('PATCH', '/pedidos/:id/status', (req, [id]) => {
  const user = requireUser(req, 'gerente', 'estoque', 'logistica');
  const p = db.pedido.find(x => x.id_pedido === +id);
  if (!p) throw new ApiError(404, 'Pedido não encontrado.');
  const novo = String(req.body?.status ?? '');
  const retirada = p.tipo_entrega === 'retirada';
  if (!(TRANSITIONS[p.status] ?? []).includes(novo)
      || (p.status === 'pronto' && novo === 'entregue' && !retirada) || (novo === 'saiu_para_entrega' && retirada)) {
    throw new ApiError(409, `Não é possível mudar de "${p.status}" para "${novo}".`);
  }
  if (novo === 'cancelado' && user.papel !== 'gerente') throw new ApiError(403, 'Só o gerente cancela pedidos.');
  applyStockTrigger(p, p.status, novo);
  p.status = novo;
  p.data_atualizacao = now();
  if (novo === 'cancelado') p.motivo_cancelamento = req.body?.motivoCancelamento ?? 'Cancelado pelo gerente';
  if (req.body?.idEntregador) p.id_entregador = Number(req.body.idEntregador);
  return pedidoDto(p);
});

route('GET', '/funcionarios', req => { requireUser(req, 'gerente'); return db.usuario_painel.filter(u => u.papel !== 'cliente').map(usuarioDto); });

function validateFuncionario(b: any, editingId?: number): void {
  if (!b?.nome?.trim()) throw new ApiError(400, 'O nome é obrigatório.');
  if (!/^\S+@\S+\.\S+$/.test(b?.email ?? '')) throw new ApiError(400, 'E-mail inválido.');
  if (!['gerente', 'estoque', 'logistica'].includes(b?.papel)) throw new ApiError(400, 'Papel inválido.');
  if (db.usuario_painel.some(u => u.email === b.email && u.id_usuario !== editingId)) throw new ApiError(409, 'Já existe um usuário com este e-mail.');
  if (!editingId && (b.senha ?? '').length < 6) throw new ApiError(400, 'A senha precisa ter pelo menos 6 caracteres.');
}

route('POST', '/funcionarios', req => {
  requireUser(req, 'gerente');
  validateFuncionario(req.body);
  const u: Usuario = { id_usuario: nextId(db.usuario_painel, 'id_usuario'), nome: req.body.nome.trim(), email: req.body.email,
    senha_hash: '(bcrypt na API)', senha_mock: req.body.senha, papel: req.body.papel, ativo: req.body.ativo === false ? 0 : 1, data_criacao: now() };
  db.usuario_painel.push(u);
  return usuarioDto(u);
});

route('PUT', '/funcionarios/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  const u = db.usuario_painel.find(x => x.id_usuario === +id);
  if (!u) throw new ApiError(404, 'Funcionário não encontrado.');
  validateFuncionario(req.body, u.id_usuario);
  Object.assign(u, { nome: req.body.nome.trim(), email: req.body.email, papel: req.body.papel, ativo: req.body.ativo === false ? 0 : 1 });
  if (req.body.senha) u.senha_mock = req.body.senha;
  return usuarioDto(u);
});

route('PATCH', '/funcionarios/:id/ativo', (req, [id]) => {
  const me = requireUser(req, 'gerente');
  const u = db.usuario_painel.find(x => x.id_usuario === +id);
  if (!u) throw new ApiError(404, 'Funcionário não encontrado.');
  if (u.id_usuario === me.id_usuario && !req.body?.ativo) throw new ApiError(409, 'Você não pode desativar o próprio usuário.');
  u.ativo = req.body?.ativo ? 1 : 0;
  return usuarioDto(u);
});

route('GET', '/recomendacoes', req => {
  const ids = (req.params.get('produtos') ?? '').split(',').map(Number).filter(Boolean);
  const limite = Number(req.params.get('limite') ?? 4);
  const score = new Map<number, number>();
  const add = (id: number, pts: number) => { if (!ids.includes(id)) score.set(id, (score.get(id) ?? 0) + pts); };

  // 1) vw_comprados_juntos: quem comprou X também levou Y (pedidos não cancelados)
  const validos = new Set(db.pedido.filter(p => p.status !== 'cancelado').map(p => p.id_pedido));
  const pedidosComX = new Set(db.item_pedido.filter(i => ids.includes(i.id_produto) && validos.has(i.id_pedido)).map(i => i.id_pedido));
  db.item_pedido.filter(i => pedidosComX.has(i.id_pedido)).forEach(i => add(i.id_produto, 10));
  // 2) produto_relacionado (cadastro manual)
  db.produto_relacionado.filter(r => ids.includes(r.id_produto)).forEach(r => add(r.id_produto_relacionado, 5));

  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => db.produto.find(p => p.id_produto === id))
    .filter((p): p is Produto => !!p && p.disponivel !== 0 && p.estoque > 0)
    .slice(0, limite)
    .map(produtoDto);
});

route('GET', '/relatorios/resumo', req => {
  requireUser(req, 'gerente');
  const all = inPeriod(req);
  const validos = all.filter(p => p.status !== 'cancelado');
  const faturamento = money(validos.reduce((s, p) => s + p.valor_total, 0));
  return { faturamento, totalPedidos: all.length,
           pedidosEntregues: all.filter(p => p.status === 'entregue').length,
           pedidosCancelados: all.length - validos.length,
           ticketMedio: validos.length ? money(faturamento / validos.length) : 0 };
});

route('GET', '/relatorios/faturamento-diario', req => {
  requireUser(req, 'gerente');
  const map = new Map<string, { pedidos: number; faturamento: number }>();
  inPeriod(req).filter(p => p.status !== 'cancelado').forEach(p => {
    const dia = p.data_criacao.slice(0, 10);
    const v = map.get(dia) ?? { pedidos: 0, faturamento: 0 };
    map.set(dia, { pedidos: v.pedidos + 1, faturamento: money(v.faturamento + p.valor_total) });
  });
  return [...map.entries()].sort().map(([dia, v]) => ({ dia, ...v }));
});

route('GET', '/relatorios/pedidos-por-status', req => {
  requireUser(req, 'gerente');
  const map = new Map<string, number>();
  inPeriod(req).forEach(p => map.set(p.status, (map.get(p.status) ?? 0) + 1));
  return [...map.entries()].map(([status, pedidos]) => ({ status, pedidos }));
});

route('GET', '/relatorios/mais-vendidos', req => {
  requireUser(req, 'gerente');
  const ids = new Set(inPeriod(req).filter(p => p.status !== 'cancelado').map(p => p.id_pedido));
  const map = new Map<number, { unidadesVendidas: number; receita: number }>();
  db.item_pedido.filter(i => ids.has(i.id_pedido)).forEach(i => {
    const v = map.get(i.id_produto) ?? { unidadesVendidas: 0, receita: 0 };
    map.set(i.id_produto, { unidadesVendidas: v.unidadesVendidas + i.quantidade, receita: money(v.receita + i.quantidade * i.preco_unitario) });
  });
  return [...map.entries()]
    .map(([idProduto, v]) => { const p = produtoDto(db.produto.find(x => x.id_produto === idProduto)!); return { idProduto, nome: p.nome, categoria: p.categoria, ...v }; })
    .sort((a, b) => b.unidadesVendidas - a.unidadesVendidas)
    .slice(0, Number(req.params.get('limite') ?? 5));
});

route('GET', '/relatorios/formas-pagamento', req => {
  requireUser(req, 'gerente');
  const ids = new Set(inPeriod(req).filter(p => p.status !== 'cancelado').map(p => p.id_pedido));
  const map = new Map<string, { pedidos: number; valor: number }>();
  db.pagamento.filter(pg => ids.has(pg.id_pedido)).forEach(pg => {
    const v = map.get(pg.forma) ?? { pedidos: 0, valor: 0 };
    map.set(pg.forma, { pedidos: v.pedidos + 1, valor: money(v.valor + pg.valor) });
  });
  return [...map.entries()].map(([forma, v]) => ({ forma, ...v })).sort((a, b) => b.pedidos - a.pedidos);
});

route('GET', '/relatorios/pedidos-por-hora', req => {
  requireUser(req, 'gerente');
  const map = new Map<number, number>();
  inPeriod(req).forEach(p => { const h = Number(p.data_criacao.slice(11, 13)); map.set(h, (map.get(h) ?? 0) + 1); });
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([hora, pedidos]) => ({ hora, pedidos }));
});

route('GET', '/relatorios/estoque-baixo', req => {
  requireUser(req, 'gerente');
  return db.produto.filter(p => p.disponivel !== 0 && p.estoque <= minimo(p.id_produto))
    .sort((a, b) => a.estoque - b.estoque)
    .map(p => ({ idProduto: p.id_produto, nome: p.nome, estoque: p.estoque }));
});

// ── Controle de estoque (Portal do Estoque) ─────────────────
function saldoDto(p: Produto) {
  const d = produtoDto(p);
  return { idProduto: p.id_produto, nome: d.nome, marca: d.marca, categoria: d.categoria, imagemUrl: d.imagemUrl,
    disponivel: d.disponivel, quantidade: p.estoque, estoqueMinimo: minimo(p.id_produto),
    baixo: p.estoque <= minimo(p.id_produto), atualizadoEm: now().replace(' ', 'T') };
}
function produtoDoEstoque(id: number): Produto {
  const p = db.produto.find(x => x.id_produto === id);
  if (!p) throw new ApiError(404, 'Produto sem registro de estoque.');
  return p;
}
route('GET', '/estoque', req => {
  requireUser(req, 'estoque', 'gerente');
  return db.produto.map(saldoDto).sort((a, b) => Number(b.baixo) - Number(a.baixo) || a.quantidade - b.quantidade || a.nome.localeCompare(b.nome));
});
route('GET', '/estoque/movimentacoes', req => {
  requireUser(req, 'estoque', 'gerente');
  const prod = Number(req.params.get('produto') ?? 0), tipo = req.params.get('tipo');
  return [...movimentacoes()].filter(m => (!prod || m.id_produto === prod) && (!tipo || m.tipo === tipo))
    .sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id).slice(0, Number(req.params.get('limite') ?? 200))
    .map(m => ({ id: m.id, idProduto: m.id_produto, produto: db.produto.find(p => p.id_produto === m.id_produto)?.nome ?? '',
      tipo: m.tipo, quantidade: m.quantidade, saldoApos: m.saldo_apos, motivo: m.motivo,
      pedido: db.pedido.find(p => p.id_pedido === m.id_pedido)?.numero ?? null,
      usuario: db.usuario_painel.find(u => u.id_usuario === m.id_usuario)?.nome ?? null, criadoEm: m.data.replace(' ', 'T') }));
});
route('POST', '/estoque/:id/entrada', (req, [id]) => {
  const u = requireUser(req, 'estoque', 'gerente');
  const q = Number(req.body?.quantidade);
  if (!(q >= 1)) throw new ApiError(400, 'Informe a quantidade recebida (maior que zero).');
  const p = produtoDoEstoque(+id);
  p.estoque += q;
  registrarMov(p.id_produto, 'entrada', q, req.body?.motivo?.trim() || 'Entrada de mercadoria', null, u.id_usuario);
  return saldoDto(p);
});
route('POST', '/estoque/:id/ajuste', (req, [id]) => {
  const u = requireUser(req, 'estoque', 'gerente');
  const n = Number(req.body?.novaQuantidade);
  if (!(n >= 0) || req.body?.novaQuantidade == null) throw new ApiError(400, 'Informe a quantidade contada (zero ou mais).');
  if (!req.body?.motivo?.trim()) throw new ApiError(400, 'Informe o motivo do ajuste (ex.: inventário, avaria, extravio).');
  const p = produtoDoEstoque(+id);
  if (n === p.estoque) throw new ApiError(400, 'A quantidade contada é igual ao saldo atual; não há o que ajustar.');
  const dif = n - p.estoque;
  p.estoque = n;
  registrarMov(p.id_produto, 'ajuste', dif, req.body.motivo.trim(), null, u.id_usuario);
  return saldoDto(p);
});
route('PATCH', '/estoque/:id/minimo', (req, [id]) => {
  requireUser(req, 'estoque', 'gerente');
  const m = Number(req.body?.estoqueMinimo);
  if (!(m >= 0)) throw new ApiError(400, 'Informe o estoque mínimo (zero ou mais).');
  const p = produtoDoEstoque(+id);
  (db.estoque_minimo ??= {})[p.id_produto] = m;
  return saldoDto(p);
});

// ── Monte seu PC (mesmas rotas e regras da API Java) ────────
function especDto(e: Especificacao): EspecificacaoApi {
  const d = produtoDto(db.produto.find(x => x.id_produto === e.idProduto)!);
  return { ...e, nome: d.nome, marca: d.marca, preco: d.preco, precoAntigo: d.precoAntigo, imagemUrl: d.imagemUrl,
           disponivel: d.disponivel, categoria: d.categoria, estoque: d.estoque };
}
function pecasDe(itens: { idProduto: number; quantidade?: number }[]): regras.Peca[] {
  const out: regras.Peca[] = [];
  for (const i of itens) {
    const e = db.especificacao.find(x => x.idProduto === Number(i.idProduto));
    if (!e) continue;
    const d = especDto(e);
    out.push({ ...d, preco: Number(d.preco), quantidade: Number(i.quantidade ?? 1) } as regras.Peca);
  }
  return out;
}
function kwh(uf: string): number {
  const t = db.tarifa.find(x => x.uf === String(uf ?? '').toUpperCase());
  if (!t) throw new ApiError(400, `Não há tarifa de energia cadastrada para a UF ${uf}.`);
  return Number(t.valorKwh);
}
function clienteLogado(req: HttpRequest<unknown>): number | null {
  const u = currentUser(req);
  return u?.papel === 'cliente' ? db.conta_cliente.find(c => c.id_usuario === u.id_usuario)?.id_cliente ?? null : null;
}
function montagemVisivel(req: HttpRequest<unknown>, id: number): MontagemApi {
  const m = db.montagem.find(x => x.id === id);
  const u = currentUser(req);
  if (m && (m.exemplo || (u && u.papel !== 'cliente') || (m.idCliente != null && m.idCliente === clienteLogado(req)))) return m;
  throw new ApiError(404, 'Montagem não encontrada.');
}
function horas(h: unknown, padrao = 4): number {
  if (h == null || h === '') return padrao;
  const n = Number(h);
  if (!(n >= 1 && n <= 24)) throw new ApiError(400, 'As horas de uso por dia devem ficar entre 1 e 24.');
  return n;
}

route('GET', '/especificacoes', req => {
  const tipo = req.params.get('tipo');
  return db.especificacao.filter(e => !tipo || e.tipoPeca === tipo).map(especDto).sort((a, b) => a.preco - b.preco);
});
route('PUT', '/especificacoes/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  if (!db.produto.some(p => p.id_produto === +id)) throw new ApiError(404, 'Produto não encontrado.');
  const b = req.body ?? {};
  const t = b.tipoPeca;
  if (!['cpu', 'gpu', 'placa_mae', 'ram', 'ssd', 'hdd', 'fonte', 'cooler', 'gabinete'].includes(t)) throw new ApiError(400, 'Escolha o tipo de peça.');
  if (['cpu', 'placa_mae'].includes(t) && !b.soquete) throw new ApiError(400, 'Informe o soquete.');
  if (['placa_mae', 'ram'].includes(t) && !b.tipoMemoria) throw new ApiError(400, 'Informe o tipo de memória (DDR4 ou DDR5).');
  if (['placa_mae', 'gabinete'].includes(t) && !b.formato) throw new ApiError(400, 'Informe o formato (ATX, mATX ou ITX).');
  if (t === 'gpu' && !(b.vramGb > 0)) throw new ApiError(400, 'Informe a VRAM da placa de vídeo.');
  if (['ram', 'ssd', 'hdd'].includes(t) && !(b.capacidadeGb > 0)) throw new ApiError(400, 'Informe a capacidade em GB.');
  if (t === 'fonte' && !(b.potenciaFonteW > 0)) throw new ApiError(400, 'Informe a potência da fonte.');
  const e: Especificacao = { id: db.especificacao.find(x => x.idProduto === +id)?.id ?? nextId(db.especificacao, 'id'), idProduto: +id,
    tipoPeca: t, consumoWatts: Number(b.consumoWatts ?? 0), scoreDesempenho: Number(b.scoreDesempenho ?? 0), soquete: b.soquete ?? null,
    tipoMemoria: b.tipoMemoria ?? null, formato: b.formato ?? null, vramGb: b.vramGb ?? null, capacidadeGb: b.capacidadeGb ?? null,
    potenciaFonteW: b.potenciaFonteW ?? null, eficienciaFonte: b.eficienciaFonte ?? null };
  db.especificacao = [...db.especificacao.filter(x => x.idProduto !== +id), e];
  return especDto(e);
});
route('DELETE', '/especificacoes/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  db.especificacao = db.especificacao.filter(x => x.idProduto !== +id);
  return null;
});

route('GET', '/tarifas', () => [...db.tarifa].sort((a, b) => a.uf.localeCompare(b.uf)));
route('PUT', '/tarifas/([A-Za-z]{2})', (req, [uf]) => {
  requireUser(req, 'gerente');
  const v = Number(req.body?.valorKwh);
  if (!req.body?.distribuidora?.trim()) throw new ApiError(400, 'Informe a distribuidora.');
  if (!(v > 0)) throw new ApiError(400, 'Informe o valor do kWh (maior que zero).');
  const t = db.tarifa.find(x => x.uf === uf.toUpperCase());
  if (t) Object.assign(t, { distribuidora: req.body.distribuidora.trim(), valorKwh: v });
  else db.tarifa.push({ id: nextId(db.tarifa, 'id'), uf: uf.toUpperCase(), distribuidora: req.body.distribuidora.trim(), valorKwh: v });
  return [...db.tarifa].sort((a, b) => a.uf.localeCompare(b.uf));
});

route('GET', '/softwares', () => [...db.software].sort((a, b) => b.popularidade - a.popularidade || a.nome.localeCompare(b.nome)));
function softwareDoCorpo(b: any, id: number): SoftwareApi {
  if (!b?.nome?.trim()) throw new ApiError(400, 'Informe o nome.');
  if (!['jogo', 'programa'].includes(b.tipo)) throw new ApiError(400, 'O tipo deve ser jogo ou programa.');
  if (!b.categoria?.trim()) throw new ApiError(400, 'Informe a categoria (ex.: FPS, Edição de vídeo).');
  if (!Array.isArray(b.requisitos) || b.requisitos.length !== 3) throw new ApiError(400, 'Informe os 3 níveis de requisito: mínimo, recomendado e ultra.');
  if (db.software.some(s => s.nome.toLowerCase() === b.nome.trim().toLowerCase() && s.id !== id)) throw new ApiError(409, 'Já existe um jogo ou programa com este nome.');
  return { id, nome: b.nome.trim(), tipo: b.tipo, categoria: b.categoria.trim(), imagemUrl: b.imagemUrl || null,
    popularidade: Number(b.popularidade ?? 0),
    requisitos: b.requisitos.map((r: any) => ({ ...r, fpsEstimado: b.tipo === 'jogo' ? r.fpsEstimado : null })) };
}
route('POST', '/softwares', req => {
  requireUser(req, 'gerente');
  const s = softwareDoCorpo(req.body, nextId(db.software, 'id'));
  db.software.push(s);
  return s;
});
route('PUT', '/softwares/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  if (!db.software.some(s => s.id === +id)) throw new ApiError(404, 'Jogo ou programa não encontrado.');
  const s = softwareDoCorpo(req.body, +id);
  db.software = db.software.map(x => (x.id === +id ? s : x));
  return s;
});
route('DELETE', '/softwares/:id', (req, [id]) => {
  requireUser(req, 'gerente');
  db.software = db.software.filter(s => s.id !== +id);
  return null;
});

route('GET', '/montagens', req => {
  const c = clienteLogado(req);
  return db.montagem.filter(m => m.exemplo || (c != null && m.idCliente === c))
    .sort((a, b) => Number(b.exemplo) - Number(a.exemplo) || a.id - b.id);
});
route('GET', '/montagens/:id', (req, [id]) => montagemVisivel(req, +id));
route('POST', '/montagens/avaliar', req => {
  const b = req.body ?? {};
  const uf = String(b.uf ?? 'SP').toUpperCase();
  const h = horas(b.horasUsoDia);
  return { uf, valorKwh: kwh(uf), horasUsoDia: h, avaliacao: regras.avaliar(pecasDe(b.itens ?? []), kwh(uf), h) };
});
route('POST', '/montagens', req => {
  const c = clienteLogado(req);
  if (c == null) throw new ApiError(currentUser(req) ? 403 : 401, 'Entre com a sua conta de cliente para salvar montagens.');
  const b = req.body ?? {};
  if (!b.nome?.trim()) throw new ApiError(400, 'Dê um nome para a montagem.');
  const pecas = pecasDe(b.itens ?? []);
  if (!pecas.length) throw new ApiError(400, 'Escolha pelo menos uma peça de hardware.');
  const uf = String(b.uf ?? 'SP').toUpperCase();
  kwh(uf);
  const m: MontagemApi = { id: nextId(db.montagem, 'id'), idCliente: c, nome: b.nome.trim(), horasUsoDia: horas(b.horasUsoDia), uf,
    exemplo: false, itens: pecas.map(p => ({ idProduto: p.idProduto, quantidade: p.quantidade })) };
  db.montagem.push(m);
  return m;
});
route('DELETE', '/montagens/:id', (req, [id]) => {
  const m = db.montagem.find(x => x.id === +id);
  if (!m) throw new ApiError(404, 'Montagem não encontrada.');
  if (m.exemplo || m.idCliente == null || m.idCliente !== clienteLogado(req)) throw new ApiError(403, 'Você só pode apagar as suas montagens.');
  if (db.pedido.some(p => p.id_montagem === m.id)) throw new ApiError(409, 'Esta montagem está ligada a um pedido e não pode ser apagada.');
  db.montagem = db.montagem.filter(x => x.id !== +id);
  return null;
});
route('GET', '/montagens/:id/consumo', (req, [id]) => {
  const m = montagemVisivel(req, +id);
  const uf = (req.params.get('uf') ?? m.uf).toUpperCase();
  const h = horas(req.params.get('horas'), Number(m.horasUsoDia));
  return { uf, valorKwh: kwh(uf), horasUsoDia: h, avaliacao: regras.avaliar(pecasDe(m.itens), kwh(uf), h) };
});
route('GET', '/comparar', req => {
  const a = montagemVisivel(req, Number(req.params.get('a')));
  const b = montagemVisivel(req, Number(req.params.get('b')));
  const uf = (req.params.get('uf') ?? 'SP').toUpperCase();
  const h = horas(req.params.get('horas'));
  const c = regras.comparar(a.nome, pecasDe(a.itens), b.nome, pecasDe(b.itens), kwh(uf), h);
  return { a: { id: a.id, nome: a.nome }, b: { id: b.id, nome: b.nome }, uf, horasUsoDia: h, ...c };
});
route('GET', '/roda', req => {
  const m = montagemVisivel(req, Number(req.params.get('montagem')));
  const s = db.software.find(x => x.id === Number(req.params.get('software')));
  if (!s) throw new ApiError(404, 'Jogo ou programa não encontrado.');
  const pecas = pecasDe(m.itens);
  const reqs = s.requisitos as regras.Requisito[];
  const r = regras.roda(pecas, reqs, s.tipo === 'jogo');
  const catalogo = db.especificacao.map(especDto).filter(e => e.disponivel && e.estoque > 0)
    .map(e => ({ ...e, preco: Number(e.preco), quantidade: 1 } as regras.Peca));
  const sug = regras.sugerir(r.limitante, reqs, pecas, catalogo);
  return { montagem: { id: m.id, nome: m.nome }, software: { id: s.id, nome: s.nome, tipo: s.tipo }, resultado: r,
    desempenho: regras.desempenho(pecas),
    sugestoes: sug.map(p => especDto(db.especificacao.find(e => e.idProduto === p.idProduto)!)) };
});

// ── Interceptor ─────────────────────────────────────────────
export const mockBackendInterceptor: HttpInterceptorFn = (req, next) => {
  if (!environment.useMock || !req.url.startsWith(environment.apiUrl)) return next(req);

  if (isOffline()) {
    return timer(300).pipe(mergeMap(() => throwError(() =>
      new HttpErrorResponse({ status: 0, statusText: 'Unknown Error', url: req.url }))));
  }

  const path = req.url.slice(environment.apiUrl.length).split('?')[0];
  const found = routes
    .filter(([method]) => method === req.method)
    .map(([, re, h]) => [re.exec(path), h] as const)
    .find(([m]) => m);

  const latency = 120 + Math.random() * 180;
  const fail = (status: number, mensagem: string) =>
    timer(latency).pipe(mergeMap(() => throwError(() =>
      new HttpErrorResponse({ status, error: { mensagem }, url: req.url, statusText: mensagem }))));

  if (!found) return fail(404, `[mock] rota não existe: ${req.method} ${path}`);

  try {
    const [match, handler] = found;
    const body = handler(req, match!.slice(1));
    if (req.method !== 'GET') save();
    const status = req.method === 'POST' && body !== null ? 201 : body === null ? 204 : 200;
    return timer(latency).pipe(mergeMap(() => of(new HttpResponse({ status, body, url: req.url }))));
  } catch (e) {
    if (e instanceof ApiError) return fail(e.status, e.mensagem);
    console.error('[mock] erro interno', e);
    return fail(500, 'Erro interno no mock.');
  }
};
