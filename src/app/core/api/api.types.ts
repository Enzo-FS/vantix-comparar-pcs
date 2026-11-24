// ============================================================
// CONTRATO DA API (JSON que a API Java recebe e devolve)
// Os nomes seguem as colunas do MySQL (database/schema.sql).
// A documentação completa está em docs/API_CONTRATO.md.
// ============================================================

export type PapelApi = 'gerente' | 'estoque' | 'logistica' | 'cliente';
export type StatusApi =
  | 'pendente' | 'confirmado' | 'em_preparacao' | 'pronto'
  | 'saiu_para_entrega' | 'entregue' | 'cancelado';
export type FormaPagamentoApi = 'credito' | 'debito' | 'pix' | 'boleto';
export type TipoEntregaApi = 'entrega' | 'retirada';

// ── Auth ────────────────────────────────────────────────────
export interface LoginRequest { email: string; senha: string; }
export interface UsuarioApi {
  id: number;
  nome: string;
  email: string;
  papel: PapelApi;
  ativo: boolean;
  dataCriacao?: string;
  idCliente?: number;         // só quando papel = 'cliente'
}
export interface LoginResponse { token: string; usuario: UsuarioApi; }

// ── Catálogo ────────────────────────────────────────────────
export interface CategoriaApi { id: number; nome: string; descricao?: string | null; }

export interface ProdutoApi {
  id: number;
  idCategoria: number;
  categoria: string;          // nome da categoria (JOIN)
  nome: string;
  descricao: string | null;
  marca: string | null;
  preco: number;
  precoAntigo: number | null;
  estoque: number;
  imagemUrl: string | null;
  destaque: boolean;
  disponivel: boolean;
}
export type ProdutoRequest = Omit<ProdutoApi, 'id' | 'categoria'>;

// ── Pedidos ─────────────────────────────────────────────────
export interface ClienteApi {
  id?: number;
  nome: string;
  email: string;
  telefone: string;
  endereco: string | null;
}

export interface ItemPedidoApi {
  idProduto: number;
  nome: string;
  imagemUrl: string | null;
  quantidade: number;
  precoUnitario: number;
  subtotal: number;
}

export interface PagamentoApi { forma: FormaPagamentoApi; parcelas: number; valor: number; }

export interface PedidoApi {
  id: number;
  numero: string;
  status: StatusApi;
  tipoEntrega: TipoEntregaApi;
  enderecoEntrega: string | null;
  frete: number;
  valorTotal: number;
  observacoes: string | null;
  motivoCancelamento: string | null;
  idEntregador: number | null;
  idMontagem?: number | null; // montagem do PC salva com o pedido (Verificação do PC)
  dataCriacao: string;        // ISO 8601
  dataAtualizacao: string | null;
  cliente: ClienteApi;
  itens: ItemPedidoApi[];
  pagamento: PagamentoApi;
}

export interface EnderecoApi {
  cep: string | null;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
}

export interface NovoPedidoRequest {
  cliente: ClienteApi;
  enderecoEntrega?: EnderecoApi | null;
  itens: { idProduto: number; quantidade: number }[];
  pagamento: { forma: FormaPagamentoApi; parcelas: number };
  tipoEntrega: TipoEntregaApi;
  observacoes: string | null;
  /** UF e horas escolhidas na Verificação do PC (montagem salva com o pedido). */
  montagem?: { nome?: string; uf: string; horasUsoDia: number } | null;
}

export interface MudarStatusRequest {
  status: StatusApi;
  motivoCancelamento?: string;
  idEntregador?: number;
}

// ── Funcionários ────────────────────────────────────────────
export interface FuncionarioRequest {
  nome: string;
  email: string;
  papel: PapelApi;
  ativo: boolean;
  senha?: string;             // obrigatória no cadastro, opcional na edição
}

// ── Relatórios ──────────────────────────────────────────────
export interface ResumoApi {
  faturamento: number;
  totalPedidos: number;
  pedidosEntregues: number;
  pedidosCancelados: number;
  ticketMedio: number;
}
export interface FaturamentoDiaApi { dia: string; pedidos: number; faturamento: number; }
export interface PedidosStatusApi { status: StatusApi; pedidos: number; }
export interface MaisVendidoApi { idProduto: number; nome: string; categoria: string; unidadesVendidas: number; receita: number; }
export interface FormaPagamentoRelApi { forma: FormaPagamentoApi; pedidos: number; valor: number; }
export interface PedidosHoraApi { hora: number; pedidos: number; }
export interface EstoqueBaixoApi { idProduto: number; nome: string; estoque: number; }

// ── Monte seu PC ────────────────────────────────────────────
export interface EspecificacaoApi {
  id: number;                 // id da especificação
  idProduto: number;
  nome: string;
  marca: string | null;
  preco: number;
  precoAntigo: number | null;
  imagemUrl: string | null;
  disponivel: boolean;
  categoria: string;
  estoque: number;
  tipoPeca: 'cpu' | 'gpu' | 'placa_mae' | 'ram' | 'ssd' | 'hdd' | 'fonte' | 'cooler' | 'gabinete';
  consumoWatts: number;
  scoreDesempenho: number;
  soquete: string | null;
  tipoMemoria: 'DDR4' | 'DDR5' | null;
  formato: 'ATX' | 'mATX' | 'ITX' | null;
  vramGb: number | null;
  capacidadeGb: number | null;
  potenciaFonteW: number | null;
  eficienciaFonte: number | null;
}
export type EspecificacaoRequest = Omit<EspecificacaoApi,
  'id' | 'idProduto' | 'nome' | 'marca' | 'preco' | 'precoAntigo' | 'imagemUrl' | 'disponivel' | 'categoria' | 'estoque'>;

export interface TarifaApi { id: number; uf: string; distribuidora: string; valorKwh: number; }

export interface RequisitoApi {
  nivel: 'minimo' | 'recomendado' | 'ultra';
  scoreCpuMin: number;
  scoreGpuMin: number;
  ramMinGb: number;
  vramMinGb: number;
  armazenamentoGb: number;
  fpsEstimado: number | null;
}
export interface SoftwareApi {
  id: number;
  nome: string;
  tipo: 'jogo' | 'programa';
  categoria: string;
  imagemUrl: string | null;
  popularidade: number;
  requisitos: RequisitoApi[];
}
export type SoftwareRequest = Omit<SoftwareApi, 'id'>;

export interface ItemMontagemApi { idProduto: number; quantidade: number; }
export interface MontagemApi {
  id: number;
  idCliente: number | null;
  nome: string;
  horasUsoDia: number;
  uf: string;
  exemplo: boolean;
  criadoEm?: string;
  itens: ItemMontagemApi[];
}
export interface MontagemRequest { nome: string; uf: string; horasUsoDia: number; itens: ItemMontagemApi[]; }

/** Erro padrão da API: { mensagem: "..." } */
export interface ErroApi { mensagem: string; }

// ── Controle de estoque (Portal do Estoque) ─────────────────
export interface SaldoEstoqueApi {
  idProduto: number;
  nome: string;
  marca: string | null;
  categoria: string;
  imagemUrl: string | null;
  disponivel: boolean;
  quantidade: number;
  estoqueMinimo: number;
  baixo: boolean | number;    // o MySQL devolve 0/1
  atualizadoEm: string;
}
export type TipoMovimentacaoApi = 'entrada' | 'saida' | 'ajuste' | 'devolucao';
export interface MovimentacaoApi {
  id: number;
  idProduto: number;
  produto: string;
  tipo: TipoMovimentacaoApi;
  quantidade: number;         // negativa nas saídas e ajustes para baixo
  saldoApos: number;
  motivo: string | null;
  pedido: string | null;      // número do pedido (vendas e cancelamentos)
  usuario: string | null;     // quem registrou (null = sistema)
  criadoEm: string;
}
