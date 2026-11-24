// Gera database/seed.sql para o modelo novo (database/schema.sql).
//
// 1) MIGRA todos os dados do banco anterior (database/02_dados.sql): usuarios, categorias,
//    53 produtos, clientes, 71 pedidos, itens e pagamentos — sem perder nada.
// 2) ACRESCENTA os dados das inovacoes: pecas novas para montar um PC completo,
//    especificacoes tecnicas, tarifas por UF, jogos/programas com requisitos e montagens de exemplo.
//
// Todos os dados sao FICTICIOS (nomes de pessoas, enderecos, pedidos, scores, consumos e tarifas).
// Uso: node scripts/gerar-seed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const antigo = readFileSync(join(root, 'database', '02_dados.sql'), 'utf8');

// ───────────────────────────── leitura do SQL antigo ─────────────────────────────
function parseTuples(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '(') { i++; continue; }
    i++;
    const row = [];
    let token = '', inStr = false, wasStr = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === '\\') { token += text[++i]; continue; }
        if (c === "'" && text[i + 1] === "'") { token += "'"; i++; continue; }
        if (c === "'") { inStr = false; continue; }
        token += c;
        continue;
      }
      if (c === "'") { inStr = true; wasStr = true; continue; }
      if (c === ',' || c === ')') {
        const raw = token.trim();
        row.push(wasStr ? raw : raw.toUpperCase() === 'NULL' ? null : Number(raw));
        token = ''; wasStr = false;
        if (c === ')') { i++; break; }
        continue;
      }
      token += c;
    }
    rows.push(row);
  }
  return rows;
}

const old = {};
const re = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*?);\s*$/gim;
for (let m; (m = re.exec(antigo));) {
  const cols = m[2].split(',').map(c => c.trim());
  (old[m[1]] ??= []).push(...parseTuples(m[3]).map(r => Object.fromEntries(cols.map((c, k) => [c, r[k]]))));
}
// No SQL antigo os ids eram AUTO_INCREMENT na ordem de insercao.
for (const t of ['usuario_painel', 'categoria', 'produto', 'cliente', 'pedido']) {
  old[t].forEach((r, k) => { r.id = k + 1; });
}

// ───────────────────────────── utilitarios ─────────────────────────────
const q = v => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
};
const out = [];
function insert(tabela, cols, rows, comentario) {
  if (!rows.length) return;
  if (comentario) out.push(`-- ${comentario}`);
  out.push(`INSERT INTO ${tabela} (${cols.join(', ')}) VALUES`);
  out.push(rows.map(r => `(${cols.map(c => q(r[c])).join(', ')})`).join(',\n') + ';\n');
}
const toMs = s => { const [d, h] = s.split(' '); const [Y, M, D] = d.split('-').map(Number); const [hh, mm, ss] = h.split(':').map(Number); return Date.UTC(Y, M - 1, D, hh, mm, ss); };
const fmt = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const fmtDate = ms => new Date(ms).toISOString().slice(0, 10);
const DIA = 86_400_000;

/** "Av. Paulista, 915 - Santana, São Paulo - SP" -> partes */
function parseEndereco(txt) {
  const m = /^(.+), (\S+) - (.+), (.+) - ([A-Z]{2})$/.exec(txt.trim());
  if (!m) throw new Error(`Endereço fora do padrão: ${txt}`);
  return { logradouro: m[1], numero: m[2], bairro: m[3], cidade: m[4], uf: m[5] };
}

// ───────────────────────────── 1. perfis e usuarios ─────────────────────────────
const PERFIS = [
  { id: 1, codigo: 'cliente',   nome: 'Cliente',   descricao: 'Compra na loja; com conta pode salvar montagens.' },
  { id: 2, codigo: 'gerente',   nome: 'Gerente',   descricao: 'Relatórios, pedidos, produtos, equipe e cadastros das inovações.' },
  { id: 3, codigo: 'estoque',   nome: 'Estoque',   descricao: 'Separação dos pedidos.' },
  { id: 4, codigo: 'logistica', nome: 'Logística', descricao: 'Entregas.' },
];
const perfilPorPapel = { gerente: 2, estoque: 3, logistica: 4 };
const SEED_DATA = '2026-09-01 09:00:00';

const usuarios = old.usuario_painel.map(u => ({
  id: u.id, perfil_id: perfilPorPapel[u.papel], nome: u.nome, email: u.email,
  senha_hash: u.senha_hash, ativo: true, criado_em: SEED_DATA,
}));
const hashDemo = old.usuario_painel[0].senha_hash; // mesma senha de demonstracao: vantix2024
const ID_GERENTE = 1, ID_ESTOQUE = 2, ID_LOGISTICA = 3;
// Uma cliente com conta (perfil cliente), para testar "Salvar montagem" logado.
const anaCliente = old.cliente[0];
usuarios.push({ id: 4, perfil_id: 1, nome: anaCliente.nome, email: anaCliente.email,
  senha_hash: hashDemo, ativo: true, criado_em: anaCliente.data_criacao });

// ───────────────────────────── 2. clientes e enderecos ─────────────────────────────
const clientes = old.cliente.map(c => ({
  id: c.id, usuario_id: c.id === anaCliente.id ? 4 : null, nome: c.nome, email: c.email,
  telefone: c.telefone, criado_em: c.data_criacao,
}));
const enderecos = [];
const enderecoPorTexto = new Map(); // "clienteId|texto" -> id
function addEndereco(clienteId, texto, principal, criadoEm) {
  const chave = `${clienteId}|${texto}`;
  if (enderecoPorTexto.has(chave)) return enderecoPorTexto.get(chave);
  const id = enderecos.length + 1;
  enderecos.push({ id, cliente_id: clienteId, apelido: principal ? 'Principal' : 'Outro endereço', cep: null,
    ...parseEndereco(texto), complemento: null, principal, criado_em: criadoEm });
  enderecoPorTexto.set(chave, id);
  return id;
}
for (const c of old.cliente) if (c.endereco) addEndereco(c.id, c.endereco, true, c.data_criacao);

// ───────────────────────────── 3. catalogo ─────────────────────────────
const categorias = old.categoria.map(c => ({ id: c.id, nome: c.nome, descricao: c.descricao, criado_em: SEED_DATA }));

const produtos = old.produto.map(p => ({
  id: p.id, categoria_id: p.id_categoria, nome: p.nome, descricao: p.descricao, marca: p.marca,
  preco: p.preco, preco_antigo: p.preco_antigo, imagem_url: p.imagem_url, destaque: !!p.destaque,
  disponivel: p.disponivel === undefined ? true : !!p.disponivel, criado_em: SEED_DATA, _estoque: p.estoque,
}));

// Especificacoes dos produtos de hardware que JA existiam (ids do banco anterior).
// O produto 5 ("PC Gamer ... montado") e um computador pronto, nao uma peca: nao tem especificacao.
const especificacoes = [
  { produto_id: 1,  tipo_peca: 'gpu',       consumo_watts: 220, score_desempenho: 76, vram_gb: 12 },
  { produto_id: 2,  tipo_peca: 'cpu',       consumo_watts: 120, score_desempenho: 92, soquete: 'AM5', tipo_memoria: 'DDR5' },
  { produto_id: 3,  tipo_peca: 'ssd',       consumo_watts: 7,   score_desempenho: 85, capacidade_gb: 2000 },
  { produto_id: 4,  tipo_peca: 'ram',       consumo_watts: 10,  score_desempenho: 80, tipo_memoria: 'DDR5', capacidade_gb: 32 },
  { produto_id: 40, tipo_peca: 'fonte',     consumo_watts: 0,   score_desempenho: 85, potencia_fonte_w: 850, eficiencia_fonte: 0.90 },
  { produto_id: 41, tipo_peca: 'cooler',    consumo_watts: 6,   score_desempenho: 75, soquete: 'AM5/LGA1700' },
  { produto_id: 42, tipo_peca: 'placa_mae', consumo_watts: 45,  score_desempenho: 70, soquete: 'AM5', tipo_memoria: 'DDR5', formato: 'mATX' },
  { produto_id: 43, tipo_peca: 'gabinete',  consumo_watts: 8,   score_desempenho: 70, formato: 'ATX' },
  { produto_id: 44, tipo_peca: 'ssd',       consumo_watts: 3,   score_desempenho: 45, capacidade_gb: 1000 },
];

// Pecas novas (ficticias) para ter pelo menos 4 opcoes de cada tipo e cobrir AM4, AM5 e LGA1700.
// [nome, descricao, marca, preco, preco_antigo, estoque, especificacao]
const imagemPorTipo = { cpu: 2, gpu: 1, ssd: 3, hdd: 3, ram: 4, fonte: 40, cooler: 41, placa_mae: 42, gabinete: 43 };
const NOVAS = [
  // CPU
  ['Processador Intel Core i3-12100 LGA1700', '4 núcleos, 8 threads, até 4,3 GHz e vídeo integrado UHD 730. Ótimo para escritório, estudo e jogos leves.', 'Intel', 649.90, 799.90, 30,
    { tipo_peca: 'cpu', consumo_watts: 60, score_desempenho: 38, soquete: 'LGA1700' }],
  ['Processador AMD Ryzen 5 5600 AM4', '6 núcleos, 12 threads e até 4,4 GHz. Custo-benefício clássico para jogos em Full HD na plataforma AM4 (DDR4).', 'AMD', 699.90, 899.90, 35,
    { tipo_peca: 'cpu', consumo_watts: 65, score_desempenho: 52, soquete: 'AM4', tipo_memoria: 'DDR4' }],
  ['Processador Intel Core i5-12400F LGA1700', '6 núcleos, 12 threads e até 4,4 GHz. Sem vídeo integrado: use com placa de vídeo dedicada.', 'Intel', 799.90, 999.90, 28,
    { tipo_peca: 'cpu', consumo_watts: 65, score_desempenho: 56, soquete: 'LGA1700' }],
  ['Processador AMD Ryzen 5 7600 AM5', '6 núcleos, 12 threads, até 5,1 GHz e suporte a DDR5 e PCIe 5.0. Base moderna para jogos em 1080p e 1440p.', 'AMD', 1199.90, 1399.90, 24,
    { tipo_peca: 'cpu', consumo_watts: 88, score_desempenho: 68, soquete: 'AM5', tipo_memoria: 'DDR5' }],
  ['Processador Intel Core i7-14700K LGA1700', '20 núcleos (8P + 12E), 28 threads e até 5,6 GHz. Para jogos no máximo, streaming e edição pesada.', 'Intel', 2599.90, 2999.90, 12,
    { tipo_peca: 'cpu', consumo_watts: 170, score_desempenho: 90, soquete: 'LGA1700' }],
  // GPU
  ['Placa de Vídeo GeForce GTX 1650 4GB', 'Entrada para jogos competitivos em Full HD. Consome pouco e não precisa de conector extra de energia.', 'NVIDIA', 899.90, 1099.90, 25,
    { tipo_peca: 'gpu', consumo_watts: 75, score_desempenho: 25, vram_gb: 4 }],
  ['Placa de Vídeo Radeon RX 6600 8GB', '8GB GDDR6 e ótimo desempenho em 1080p com qualidade alta.', 'AMD', 1299.90, 1599.90, 20,
    { tipo_peca: 'gpu', consumo_watts: 132, score_desempenho: 45, vram_gb: 8 }],
  ['Placa de Vídeo GeForce RTX 4060 8GB', 'DLSS 3, Ray Tracing e baixo consumo. Ideal para 1080p no alto com taxas altas.', 'NVIDIA', 1899.90, 2199.90, 22,
    { tipo_peca: 'gpu', consumo_watts: 115, score_desempenho: 55, vram_gb: 8 }],
  ['Placa de Vídeo Radeon RX 7800 XT 16GB', '16GB GDDR6 para jogar em 1440p no ultra com folga de memória.', 'AMD', 3699.90, 4199.90, 10,
    { tipo_peca: 'gpu', consumo_watts: 263, score_desempenho: 80, vram_gb: 16 }],
  ['Placa de Vídeo GeForce RTX 4090 24GB', 'A mais rápida da linha: 4K com Ray Tracing, IA e renderização 3D sem limites.', 'NVIDIA', 12999.90, 14999.90, 4,
    { tipo_peca: 'gpu', consumo_watts: 450, score_desempenho: 100, vram_gb: 24 }],
  // Placa-mae
  ['Placa-Mãe A520M AM4 DDR4', 'Soquete AM4, 2 slots DDR4 e M.2 NVMe. Formato Micro-ATX.', 'ASRock', 499.90, 599.90, 18,
    { tipo_peca: 'placa_mae', consumo_watts: 30, score_desempenho: 40, soquete: 'AM4', tipo_memoria: 'DDR4', formato: 'mATX' }],
  ['Placa-Mãe B760M LGA1700 DDR4', 'Soquete LGA1700 (Intel 12ª a 14ª geração), 4 slots DDR4 e 2 M.2. Formato Micro-ATX.', 'MSI', 799.90, 949.90, 20,
    { tipo_peca: 'placa_mae', consumo_watts: 35, score_desempenho: 55, soquete: 'LGA1700', tipo_memoria: 'DDR4', formato: 'mATX' }],
  ['Placa-Mãe Z790 LGA1700 DDR5 ATX Wi-Fi', 'Chipset Z790 para overclock, DDR5, PCIe 5.0, Wi-Fi 6E e 4 slots M.2. Formato ATX.', 'ASUS', 2299.90, 2699.90, 9,
    { tipo_peca: 'placa_mae', consumo_watts: 70, score_desempenho: 88, soquete: 'LGA1700', tipo_memoria: 'DDR5', formato: 'ATX' }],
  ['Placa-Mãe X670E AM5 DDR5 ATX Wi-Fi', 'Topo de linha AM5: PCIe 5.0 na placa de vídeo e no M.2, Wi-Fi 6E e VRM reforçado. Formato ATX.', 'ASUS', 2899.90, 3299.90, 7,
    { tipo_peca: 'placa_mae', consumo_watts: 80, score_desempenho: 92, soquete: 'AM5', tipo_memoria: 'DDR5', formato: 'ATX' }],
  ['Placa-Mãe B650I AM5 DDR5 Mini-ITX', 'AM5 em formato compacto Mini-ITX, com DDR5, Wi-Fi 6E e M.2 PCIe 4.0.', 'Gigabyte', 1599.90, 1899.90, 8,
    { tipo_peca: 'placa_mae', consumo_watts: 40, score_desempenho: 72, soquete: 'AM5', tipo_memoria: 'DDR5', formato: 'ITX' }],
  // RAM
  ['Memória DDR4 8GB 3200MHz', 'Módulo único de 8GB DDR4 3200MHz.', 'Kingston', 159.90, 199.90, 60,
    { tipo_peca: 'ram', consumo_watts: 3, score_desempenho: 30, tipo_memoria: 'DDR4', capacidade_gb: 8 }],
  ['Memória DDR4 16GB (2x8GB) 3200MHz', 'Kit dual channel DDR4 3200MHz.', 'Kingston', 299.90, 369.90, 45,
    { tipo_peca: 'ram', consumo_watts: 6, score_desempenho: 45, tipo_memoria: 'DDR4', capacidade_gb: 16 }],
  ['Memória DDR4 32GB (2x16GB) 3600MHz RGB', 'Kit dual channel DDR4 3600MHz com iluminação RGB.', 'Corsair', 549.90, 649.90, 30,
    { tipo_peca: 'ram', consumo_watts: 8, score_desempenho: 60, tipo_memoria: 'DDR4', capacidade_gb: 32 }],
  ['Memória DDR5 16GB (2x8GB) 5600MHz', 'Kit dual channel DDR5 5600MHz para AM5 e Intel 12ª geração ou mais nova.', 'Kingston', 449.90, 549.90, 35,
    { tipo_peca: 'ram', consumo_watts: 8, score_desempenho: 65, tipo_memoria: 'DDR5', capacidade_gb: 16 }],
  ['Memória DDR5 64GB (2x32GB) 6000MHz RGB', 'Kit de 64GB DDR5 para edição de vídeo, 3D e máquinas virtuais.', 'Corsair', 1999.90, 2399.90, 10,
    { tipo_peca: 'ram', consumo_watts: 10, score_desempenho: 92, tipo_memoria: 'DDR5', capacidade_gb: 64 }],
  // SSD
  ['SSD SATA 480GB 2,5"', 'Leitura de até 500 MB/s. Upgrade barato para tirar o PC da lentidão.', 'Kingston', 219.90, 279.90, 50,
    { tipo_peca: 'ssd', consumo_watts: 3, score_desempenho: 35, capacidade_gb: 480 }],
  ['SSD NVMe 1TB PCIe 4.0', 'Leitura de até 5.000 MB/s em formato M.2 2280.', 'WD', 449.90, 549.90, 45,
    { tipo_peca: 'ssd', consumo_watts: 6, score_desempenho: 70, capacidade_gb: 1000 }],
  ['SSD NVMe 4TB PCIe 4.0 com Dissipador', 'Leitura de até 7.450 MB/s e dissipador incluso. Espaço para a biblioteca inteira de jogos.', 'Samsung', 1899.90, 2299.90, 12,
    { tipo_peca: 'ssd', consumo_watts: 8, score_desempenho: 92, capacidade_gb: 4000 }],
  // HDD
  ['HD Interno 1TB 7200RPM', 'HD de 3,5" SATA para arquivos, fotos e backups.', 'Seagate', 299.90, 369.90, 30,
    { tipo_peca: 'hdd', consumo_watts: 6, score_desempenho: 30, capacidade_gb: 1000 }],
  ['HD Interno 2TB 7200RPM', 'HD de 3,5" SATA com 256MB de cache.', 'Seagate', 429.90, 499.90, 25,
    { tipo_peca: 'hdd', consumo_watts: 7, score_desempenho: 35, capacidade_gb: 2000 }],
  ['HD Interno 4TB 5400RPM', 'Silencioso e econômico, ideal para guardar muitos arquivos.', 'WD', 649.90, 799.90, 18,
    { tipo_peca: 'hdd', consumo_watts: 6, score_desempenho: 32, capacidade_gb: 4000 }],
  ['HD NAS 8TB 7200RPM', 'Feito para funcionar 24 horas por dia em servidores de arquivos.', 'WD', 1499.90, 1799.90, 8,
    { tipo_peca: 'hdd', consumo_watts: 9, score_desempenho: 40, capacidade_gb: 8000 }],
  // Fonte
  ['Fonte 500W 80 Plus White', 'Fonte ATX de 500W com PFC ativo. Para PCs de escritório e jogos leves.', 'PCYES', 299.90, 369.90, 30,
    { tipo_peca: 'fonte', consumo_watts: 0, score_desempenho: 40, potencia_fonte_w: 500, eficiencia_fonte: 0.80 }],
  ['Fonte 650W 80 Plus Bronze', 'Fonte ATX de 650W com proteções OVP, UVP e SCP.', 'Corsair', 449.90, 549.90, 28,
    { tipo_peca: 'fonte', consumo_watts: 0, score_desempenho: 60, potencia_fonte_w: 650, eficiencia_fonte: 0.85 }],
  ['Fonte 750W 80 Plus Gold Modular', 'Totalmente modular, silenciosa e com capacitores japoneses.', 'MSI', 649.90, 799.90, 20,
    { tipo_peca: 'fonte', consumo_watts: 0, score_desempenho: 78, potencia_fonte_w: 750, eficiencia_fonte: 0.90 }],
  ['Fonte 1000W 80 Plus Gold ATX 3.0', 'Padrão ATX 3.0 com conector 12VHPWR nativo para placas de vídeo topo de linha.', 'Corsair', 1299.90, 1499.90, 10,
    { tipo_peca: 'fonte', consumo_watts: 0, score_desempenho: 92, potencia_fonte_w: 1000, eficiencia_fonte: 0.90 }],
  // Cooler
  ['Cooler Box 120mm AM4/AM5/LGA1700', 'Air cooler simples de 120mm com 4 heatpipes.', 'DeepCool', 99.90, 139.90, 50,
    { tipo_peca: 'cooler', consumo_watts: 4, score_desempenho: 35, soquete: 'AM4/AM5/LGA1700' }],
  ['Water Cooler 240mm ARGB', 'Radiador de 240mm, duas fans ARGB e bomba silenciosa.', 'DeepCool', 449.90, 549.90, 20,
    { tipo_peca: 'cooler', consumo_watts: 10, score_desempenho: 80, soquete: 'AM4/AM5/LGA1700' }],
  ['Water Cooler 360mm ARGB', 'Radiador de 360mm e três fans ARGB para processadores de alto consumo.', 'Corsair', 899.90, 1099.90, 12,
    { tipo_peca: 'cooler', consumo_watts: 15, score_desempenho: 92, soquete: 'AM4/AM5/LGA1700' }],
  ['Cooler Low Profile para Mini-ITX', 'Apenas 47mm de altura. Feito para gabinetes compactos.', 'Noctua', 349.90, 429.90, 15,
    { tipo_peca: 'cooler', consumo_watts: 3, score_desempenho: 60, soquete: 'AM4/AM5/LGA1700' }],
  // Gabinete
  ['Gabinete Micro ATX com 3 Fans', 'Lateral em vidro e 3 fans inclusas. Aceita placas Micro-ATX e Mini-ITX.', 'Pichau', 249.90, 319.90, 25,
    { tipo_peca: 'gabinete', consumo_watts: 6, score_desempenho: 50, formato: 'mATX' }],
  ['Gabinete Mini-ITX Compacto', 'Apenas 14 litros. Aceita placas Mini-ITX e placas de vídeo de até 32cm.', 'Cooler Master', 499.90, 599.90, 10,
    { tipo_peca: 'gabinete', consumo_watts: 2, score_desempenho: 60, formato: 'ITX' }],
  ['Gabinete Full Tower ATX Airflow 6 Fans', 'Frente em mesh, 6 fans e espaço para radiador de 360mm. Aceita ATX, Micro-ATX e Mini-ITX.', 'Lian Li', 899.90, 1099.90, 8,
    { tipo_peca: 'gabinete', consumo_watts: 12, score_desempenho: 85, formato: 'ATX' }],
];
const imagemDe = id => produtos.find(p => p.id === id).imagem_url;
for (const [nome, descricao, marca, preco, preco_antigo, estoque, spec] of NOVAS) {
  const id = produtos.length + 1;
  produtos.push({ id, categoria_id: 1, nome, descricao, marca, preco, preco_antigo,
    imagem_url: imagemDe(imagemPorTipo[spec.tipo_peca]), destaque: false, disponivel: true,
    criado_em: '2026-11-20 09:00:00', _estoque: estoque });
  especificacoes.push({ produto_id: id, ...spec });
}
especificacoes.forEach((e, k) => { e.id = k + 1; });
const specDe = id => especificacoes.find(e => e.produto_id === id);
const idPorNome = nome => { const p = produtos.find(x => x.nome === nome); if (!p) throw new Error(nome); return p.id; };

// Estoque (1:1) e movimentacao inicial de cada produto
const estoques = produtos.map(p => ({ id: p.id, produto_id: p.id, quantidade: p._estoque, estoque_minimo: 10 }));
const movimentacoes = produtos.filter(p => p._estoque > 0).map(p => ({
  produto_id: p.id, pedido_id: null, usuario_id: ID_ESTOQUE, tipo: 'entrada', quantidade: p._estoque,
  saldo_apos: p._estoque, criado_em: p.criado_em,
  motivo: p.id <= old.produto.length ? 'Saldo migrado do banco anterior' : 'Estoque inicial',
}));

// ───────────────────────────── 4. recomendacoes ─────────────────────────────
const recomendacoes = old.produto_relacionado.map(r => ({
  produto_origem_id: r.id_produto, produto_recomendado_id: r.id_produto_relacionado, tipo: 'manual', peso: 1.00,
}));
// Compatibilidade: CPU -> placas-mae do mesmo soquete; placa-mae -> memorias do mesmo tipo
for (const cpu of especificacoes.filter(e => e.tipo_peca === 'cpu')) {
  for (const pm of especificacoes.filter(e => e.tipo_peca === 'placa_mae' && e.soquete === cpu.soquete)) {
    recomendacoes.push({ produto_origem_id: cpu.produto_id, produto_recomendado_id: pm.produto_id, tipo: 'compatibilidade', peso: 2.00 });
  }
}
for (const pm of especificacoes.filter(e => e.tipo_peca === 'placa_mae')) {
  for (const ram of especificacoes.filter(e => e.tipo_peca === 'ram' && e.tipo_memoria === pm.tipo_memoria)) {
    recomendacoes.push({ produto_origem_id: pm.produto_id, produto_recomendado_id: ram.produto_id, tipo: 'compatibilidade', peso: 1.00 });
  }
}
recomendacoes.forEach((r, k) => { r.id = k + 1; r.criado_em = SEED_DATA; });

// ───────────────────────────── 5. pedidos (migrados) ─────────────────────────────
const pagamentosAntigos = new Map(old.pagamento.map(p => [p.id_pedido, p]));
const pedidos = [], itens = [], historicos = [], pagamentos = [], entregas = [];
const inconsistentes = new Set(); // pedidos cujo status não combina com o tipo de entrega (mantidos como vieram)

for (const p of old.pedido) {
  const t0 = toMs(p.data_criacao), t1 = toMs(p.data_atualizacao);
  const pg = pagamentosAntigos.get(p.id);
  if (!pg) throw new Error(`Pedido ${p.numero} sem pagamento`);
  const retirada = p.tipo_entrega === 'retirada';

  // Caminho de status que levou ao status atual
  let caminho;
  if (p.status === 'cancelado') {
    caminho = p.motivo_cancelamento === 'Pagamento não aprovado'
      ? ['pendente', 'cancelado'] : ['pendente', 'confirmado', 'cancelado'];
  } else {
    const completo = ['pendente', 'confirmado', 'em_preparacao', 'pronto', 'saiu_para_entrega', 'entregue'];
    const fluxo = retirada ? completo.filter(s => s !== 'saiu_para_entrega') : completo;
    // Dado de origem inconsistente (ex.: VTX-1056 é retirada com status "saiu_para_entrega"):
    // o status é mantido como veio e o histórico segue o fluxo completo.
    const base = fluxo.includes(p.status) ? fluxo : completo;
    caminho = base.slice(0, base.indexOf(p.status) + 1);
    if (base !== fluxo) inconsistentes.add(p.numero);
  }
  if (!caminho.length) throw new Error(`Pedido ${p.numero} ficaria sem histórico (status ${p.status})`);
  const quando = k => fmt(caminho.length === 1 ? t0 : t0 + Math.round((t1 - t0) * k / (caminho.length - 1) / 1000) * 1000);
  const tempos = {};
  caminho.forEach((st, k) => {
    tempos[st] = quando(k);
    const autor = {
      pendente: null,
      confirmado: pg.forma === 'boleto' ? ID_GERENTE : null,
      em_preparacao: ID_ESTOQUE, pronto: ID_ESTOQUE,
      saiu_para_entrega: p.id_entregador ?? ID_LOGISTICA,
      entregue: retirada ? ID_ESTOQUE : (p.id_entregador ?? ID_LOGISTICA),
      cancelado: ID_GERENTE,
    }[st];
    const obs = {
      pendente: 'Pedido criado',
      confirmado: pg.forma === 'boleto' ? 'Pagamento do boleto aprovado' : 'Pagamento aprovado automaticamente',
      entregue: retirada ? 'Retirado na loja' : 'Entregue ao cliente',
      cancelado: p.motivo_cancelamento,
      saiu_para_entrega: inconsistentes.has(p.numero) ? 'Migrado como veio: pedido de retirada com status "saiu para entrega"' : undefined,
    }[st] ?? null;
    historicos.push({ pedido_id: p.id, status_anterior: k ? caminho[k - 1] : null, status_novo: st,
      usuario_id: autor, observacao: obs, criado_em: tempos[st] });
  });

  pedidos.push({ id: p.id, numero: p.numero, cliente_id: p.id_cliente, carrinho_id: null, montagem_id: null,
    status: p.status, valor_total: p.valor_total, observacoes: null, criado_em: p.data_criacao, atualizado_em: p.data_atualizacao });

  pagamentos.push({ id: p.id, pedido_id: p.id, forma: pg.forma, parcelas: pg.parcelas, valor: pg.valor,
    status: p.status === 'pendente' ? 'pendente'
      : p.status === 'cancelado' ? (caminho.includes('confirmado') ? 'estornado' : 'recusado') : 'aprovado',
    codigo_transacao: tempos.confirmado ? `TXN-${p.numero.replace('-', '')}` : null,
    pago_em: tempos.confirmado ?? null, criado_em: p.data_criacao });

  const end = !retirada && p.endereco_entrega ? parseEndereco(p.endereco_entrega) : null;
  entregas.push({ id: p.id, pedido_id: p.id, modalidade: retirada ? 'retirada' : 'entrega',
    entregador_id: p.id_entregador, endereco_id: end ? addEndereco(p.id_cliente, p.endereco_entrega, false, p.data_criacao) : null,
    cep: null, logradouro: end?.logradouro ?? null, numero: end?.numero ?? null, complemento: null,
    bairro: end?.bairro ?? null, cidade: end?.cidade ?? null, uf: end?.uf ?? null, valor_frete: p.frete,
    codigo_rastreio: tempos.saiu_para_entrega ? `BR${p.numero.slice(4)}VTX` : null,
    previsao_entrega: fmtDate(t0 + (retirada ? 1 : 5) * DIA),
    saiu_em: tempos.saiu_para_entrega ?? null, entregue_em: tempos.entregue ?? null });
}
let itemId = 0;
for (const i of old.item_pedido) {
  itens.push({ id: ++itemId, pedido_id: i.id_pedido, produto_id: i.id_produto, quantidade: i.quantidade, preco_unitario: i.preco_unitario });
}
historicos.forEach((h, k) => { h.id = k + 1; });

// ───────────────────────────── 6. tarifas de energia (ficticias) ─────────────────────────────
const TARIFAS = [
  ['AC', 'Energisa Acre', 0.98], ['AL', 'Equatorial Alagoas', 0.89], ['AM', 'Amazonas Energia', 1.05],
  ['AP', 'CEA Equatorial', 0.92], ['BA', 'Neoenergia Coelba', 0.93], ['CE', 'Enel Ceará', 0.88],
  ['DF', 'Neoenergia Brasília', 0.80], ['ES', 'EDP Espírito Santo', 0.86], ['GO', 'Equatorial Goiás', 0.90],
  ['MA', 'Equatorial Maranhão', 0.91], ['MG', 'Cemig', 0.95], ['MS', 'Energisa Mato Grosso do Sul', 1.02],
  ['MT', 'Energisa Mato Grosso', 1.04], ['PA', 'Equatorial Pará', 1.10], ['PB', 'Energisa Paraíba', 0.83],
  ['PE', 'Neoenergia Pernambuco', 0.87], ['PI', 'Equatorial Piauí', 0.97], ['PR', 'Copel', 0.78],
  ['RJ', 'Light', 1.06], ['RN', 'Neoenergia Cosern', 0.81], ['RO', 'Energisa Rondônia', 0.94],
  ['RR', 'Roraima Energia', 0.74], ['RS', 'CEEE Equatorial', 0.85], ['SC', 'Celesc', 0.72],
  ['SE', 'Energisa Sergipe', 0.84], ['SP', 'Enel São Paulo', 0.82], ['TO', 'Energisa Tocantins', 1.00],
].map(([uf, distribuidora, valor_kwh], k) => ({ id: k + 1, uf, distribuidora, valor_kwh }));

// ───────────────────────────── 7. jogos e programas (requisitos ficticios) ─────────────────────────────
const IMG = id => `https://images.unsplash.com/photo-${id}?w=800&q=80`;
const IMG_JOGO = ['1606144042614-b2417e99c4e3', '1592840496694-26d035b52b48', '1527443224154-c4a3942d3acf', '1616763355548-1b606f439f86', '1587202372775-e229f172b9d7'];
const IMG_PROG = ['1496181133206-80ce9b88a853', '1517336714731-489689fd1ca8', '1590602847861-f357a9332bbc', '1587826080692-f439cd0b70da'];
// nome, tipo, categoria, popularidade, minimo, recomendado, ultra
// cada nivel: [score_cpu, score_gpu, ram_gb, vram_gb, armazenamento_gb, fps]
const SOFTWARES = [
  ['Counter-Strike 2', 'jogo', 'FPS competitivo', 98, [25, 15, 8, 2, 85, 60], [45, 35, 16, 4, 85, 144], [65, 55, 16, 8, 85, 300]],
  ['Valorant', 'jogo', 'FPS competitivo', 95, [20, 10, 4, 1, 35, 60], [35, 25, 8, 2, 35, 144], [55, 45, 16, 4, 35, 240]],
  ['Fortnite', 'jogo', 'Battle royale', 92, [30, 20, 8, 2, 40, 60], [50, 45, 16, 4, 40, 90], [75, 75, 16, 8, 40, 144]],
  ['League of Legends', 'jogo', 'MOBA', 90, [15, 8, 4, 1, 20, 60], [30, 20, 8, 2, 20, 144], [45, 35, 16, 4, 20, 240]],
  ['Minecraft', 'jogo', 'Sandbox', 88, [20, 10, 4, 1, 10, 60], [35, 25, 8, 2, 10, 120], [60, 60, 16, 6, 10, 200]],
  ['GTA V', 'jogo', 'Mundo aberto', 85, [30, 20, 8, 2, 110, 40], [45, 40, 16, 4, 110, 60], [65, 60, 16, 8, 110, 120]],
  ['EA SPORTS FC 26', 'jogo', 'Esporte', 82, [35, 30, 8, 4, 100, 60], [55, 50, 12, 6, 100, 60], [70, 70, 16, 8, 100, 120]],
  ['Call of Duty: Warzone', 'jogo', 'Battle royale', 80, [40, 30, 8, 4, 150, 60], [60, 55, 16, 8, 150, 90], [80, 80, 16, 10, 150, 144]],
  ['Cyberpunk 2077', 'jogo', 'RPG', 78, [45, 40, 12, 6, 70, 30], [65, 60, 16, 8, 70, 60], [88, 95, 16, 12, 70, 90]],
  ['Red Dead Redemption 2', 'jogo', 'Mundo aberto', 75, [40, 35, 8, 4, 150, 30], [60, 55, 12, 6, 150, 60], [80, 85, 16, 10, 150, 90]],
  ['Elden Ring', 'jogo', 'RPG', 72, [40, 35, 12, 3, 60, 30], [60, 55, 16, 8, 60, 60], [80, 80, 16, 10, 60, 60]],
  ["Baldur's Gate 3", 'jogo', 'RPG', 70, [40, 35, 8, 4, 150, 30], [60, 50, 16, 8, 150, 60], [80, 80, 16, 10, 150, 90]],
  ['Forza Horizon 5', 'jogo', 'Corrida', 68, [35, 30, 8, 4, 110, 30], [55, 50, 16, 6, 110, 60], [75, 80, 16, 10, 110, 90]],
  ['Hogwarts Legacy', 'jogo', 'RPG', 65, [45, 40, 16, 4, 85, 30], [65, 60, 16, 8, 85, 60], [85, 85, 32, 12, 85, 90]],
  ['OBS Studio', 'programa', 'Streaming', 60, [30, 15, 4, 1, 1, null], [50, 35, 8, 2, 1, null], [70, 55, 16, 6, 1, null]],
  ['Adobe Photoshop', 'programa', 'Edição de imagem', 58, [30, 10, 8, 1, 20, null], [50, 30, 16, 2, 20, null], [70, 50, 32, 4, 20, null]],
  ['Adobe Premiere Pro', 'programa', 'Edição de vídeo', 55, [40, 25, 8, 2, 30, null], [60, 45, 16, 4, 30, null], [85, 70, 32, 8, 50, null]],
  ['Blender', 'programa', 'Modelagem 3D', 50, [35, 20, 8, 2, 10, null], [60, 55, 16, 8, 10, null], [85, 85, 32, 12, 10, null]],
  ['DaVinci Resolve', 'programa', 'Edição de vídeo', 45, [40, 35, 16, 2, 10, null], [65, 55, 32, 8, 10, null], [85, 85, 32, 12, 10, null]],
  ['AutoCAD', 'programa', 'CAD', 40, [35, 15, 8, 1, 10, null], [55, 35, 16, 4, 10, null], [75, 55, 32, 8, 10, null]],
];
const softwares = [], requisitos = [];
let jogoN = 0, progN = 0;
SOFTWARES.forEach(([nome, tipo, categoria, popularidade, ...niveis], k) => {
  const id = k + 1;
  const imagem_url = IMG(tipo === 'jogo' ? IMG_JOGO[jogoN++ % IMG_JOGO.length] : IMG_PROG[progN++ % IMG_PROG.length]);
  softwares.push({ id, nome, tipo, categoria, imagem_url, popularidade });
  ['minimo', 'recomendado', 'ultra'].forEach((nivel, n) => {
    const [score_cpu_min, score_gpu_min, ram_min_gb, vram_min_gb, armazenamento_gb, fps_estimado] = niveis[n];
    requisitos.push({ id: requisitos.length + 1, software_id: id, nivel, score_cpu_min, score_gpu_min,
      ram_min_gb, vram_min_gb, armazenamento_gb, fps_estimado });
  });
});

// ───────────────────────────── 8. montagens de exemplo ─────────────────────────────
const MONTAGENS = [
  { nome: 'PC Básico', horas: 4, uf: 'SP', exemplo: true, cliente_id: null, pecas: [
    'Processador Intel Core i3-12100 LGA1700', 'Placa-Mãe B760M LGA1700 DDR4', 'Memória DDR4 16GB (2x8GB) 3200MHz',
    'Placa de Vídeo GeForce GTX 1650 4GB', 'SSD SATA 480GB 2,5"', 'Fonte 500W 80 Plus White',
    'Cooler Box 120mm AM4/AM5/LGA1700', 'Gabinete Micro ATX com 3 Fans'] },
  { nome: 'PC Intermediário', horas: 4, uf: 'SP', exemplo: true, cliente_id: null, pecas: [
    'Processador AMD Ryzen 5 7600 AM5', 'Placa-Mãe B650M AM5 DDR5 Wi-Fi', 'Memória DDR5 32GB (2x16GB) 6000MHz RGB',
    'Placa de Vídeo GeForce RTX 4060 8GB', 'SSD NVMe 1TB PCIe 4.0', 'Fonte 650W 80 Plus Bronze',
    'Cooler para Processador Dual Tower AM5/LGA1700', 'Gabinete Mid Tower Vidro Temperado + 4 Fans'] },
  { nome: 'PC Avançado', horas: 6, uf: 'SP', exemplo: true, cliente_id: null, pecas: [
    'Processador AMD Ryzen 7 7800X3D', 'Placa-Mãe X670E AM5 DDR5 ATX Wi-Fi', 'Memória DDR5 64GB (2x32GB) 6000MHz RGB',
    'Placa de Vídeo GeForce RTX 4090 24GB', 'SSD NVMe 2TB PCIe 4.0', 'HD Interno 2TB 7200RPM',
    'Fonte 850W 80 Plus Gold Modular', 'Water Cooler 360mm ARGB', 'Gabinete Full Tower ATX Airflow 6 Fans'] },
  // Montagem salva por uma cliente, de proposito com problemas (soquete e pecas faltando) para testar os avisos.
  { nome: 'Upgrade do meu PC (rascunho)', horas: 3, uf: 'SP', exemplo: false, cliente_id: anaCliente.id, pecas: [
    'Processador AMD Ryzen 5 5600 AM4', 'Placa-Mãe B650M AM5 DDR5 Wi-Fi', 'Memória DDR5 16GB (2x8GB) 5600MHz',
    'Placa de Vídeo Radeon RX 6600 8GB', 'Fonte 500W 80 Plus White'] },
];
const montagens = [], montagemItens = [];
MONTAGENS.forEach((m, k) => {
  const id = k + 1;
  montagens.push({ id, cliente_id: m.cliente_id, nome: m.nome, horas_uso_dia: m.horas, uf: m.uf, exemplo: m.exemplo, criado_em: '2026-11-20 10:00:00' });
  for (const nome of m.pecas) {
    const pid = idPorNome(nome);
    if (!specDe(pid)) throw new Error(`Peça sem especificação: ${nome}`);
    montagemItens.push({ id: montagemItens.length + 1, montagem_id: id, produto_id: pid, quantidade: 1 });
  }
});

// ───────────────────────────── 9. carrinhos de exemplo ─────────────────────────────
const carrinhos = [
  { id: 1, cliente_id: anaCliente.id, token_sessao: null, status: 'aberto', criado_em: '2026-11-21 19:30:00' },
  { id: 2, cliente_id: null, token_sessao: 'demo-visitante-0001', status: 'aberto', criado_em: '2026-11-22 14:05:00' },
];
const carrinhoItens = [
  { id: 1, carrinho_id: 1, produto_id: idPorNome('Processador AMD Ryzen 5 7600 AM5'), quantidade: 1, adicionado_em: '2026-11-21 19:31:00' },
  { id: 2, carrinho_id: 1, produto_id: idPorNome('Placa de Vídeo GeForce RTX 4060 8GB'), quantidade: 1, adicionado_em: '2026-11-21 19:33:00' },
  { id: 3, carrinho_id: 2, produto_id: idPorNome('Placa de Vídeo GeForce GTX 1650 4GB'), quantidade: 1, adicionado_em: '2026-11-22 14:06:00' },
];

// ───────────────────────────── saida ─────────────────────────────
movimentacoes.forEach((m, k) => { m.id = k + 1; });
const espCols = ['id', 'produto_id', 'tipo_peca', 'consumo_watts', 'score_desempenho', 'soquete', 'tipo_memoria',
  'formato', 'vram_gb', 'capacidade_gb', 'potencia_fonte_w', 'eficiencia_fonte'];

out.push(`-- =====================================================================
-- VANTIX TECH STORE - seed.sql (rode DEPOIS do schema.sql)
--
-- *** TODOS OS DADOS DESTE ARQUIVO SAO FICTICIOS ***
-- Pessoas, e-mails, telefones, enderecos, pedidos, scores de desempenho, consumos em watts,
-- tarifas de energia e requisitos de jogos/programas foram inventados para fins academicos.
--
-- Gerado por scripts/gerar-seed.mjs a partir de database/02_dados.sql (dados migrados)
-- + dados novos das inovacoes. Para regerar: node scripts/gerar-seed.mjs
--
-- Logins (senha de todos: vantix2024):
--   gerente@vantix.com | estoque@vantix.com | logistica@vantix.com
--   ${anaCliente.email}  (perfil cliente, com montagem salva)
-- =====================================================================
USE vantix;
SET NAMES utf8mb4;
SET time_zone = '-03:00';
START TRANSACTION;
`);

out.push('-- ===================== ACESSO E PESSOAS =====================');
insert('perfil', ['id', 'codigo', 'nome', 'descricao'], PERFIS);
insert('usuario', ['id', 'perfil_id', 'nome', 'email', 'senha_hash', 'ativo', 'criado_em'], usuarios,
  'Migrados de usuario_painel + 1 cliente com conta');
insert('cliente', ['id', 'usuario_id', 'nome', 'email', 'telefone', 'criado_em'], clientes, 'Migrados de cliente');
insert('endereco', ['id', 'cliente_id', 'apelido', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'principal', 'criado_em'],
  enderecos, 'Endereco em texto do banco anterior separado em colunas (CEP nao existia: NULL)');

out.push('-- ===================== CATALOGO =====================');
insert('categoria', ['id', 'nome', 'descricao', 'criado_em'], categorias);
insert('produto', ['id', 'categoria_id', 'nome', 'descricao', 'marca', 'preco', 'preco_antigo', 'imagem_url', 'destaque', 'disponivel', 'criado_em'],
  produtos, `Ids 1-${old.produto.length}: migrados. Ids ${old.produto.length + 1}-${produtos.length}: pecas novas (ficticias) para o "Monte seu PC"`);
insert('estoque', ['id', 'produto_id', 'quantidade', 'estoque_minimo'], estoques);

out.push('-- ===================== INOVACOES =====================');
insert('especificacao_tecnica', espCols, especificacoes.map(e => Object.fromEntries(espCols.map(c => [c, e[c] ?? null]))),
  'Especificacoes ficticias. Faixas: CPU 35-170 W, GPU 75-450 W, placa-mae 25-80 W, RAM 3-5 W por modulo, SSD 3-8 W, HDD 6-9 W, cooler/fans 2-15 W');
insert('tarifa_energia', ['id', 'uf', 'distribuidora', 'valor_kwh'], TARIFAS, 'Tarifas ficticias (R$ 0,65 a R$ 1,10 por kWh), uma por UF');
insert('montagem', ['id', 'cliente_id', 'nome', 'horas_uso_dia', 'uf', 'exemplo', 'criado_em'], montagens);
insert('montagem_item', ['id', 'montagem_id', 'produto_id', 'quantidade'], montagemItens);
insert('software', ['id', 'nome', 'tipo', 'categoria', 'imagem_url', 'popularidade'], softwares,
  'Nomes reais de jogos/programas; requisitos, scores e FPS sao FICTICIOS');
insert('requisito', ['id', 'software_id', 'nivel', 'score_cpu_min', 'score_gpu_min', 'ram_min_gb', 'vram_min_gb', 'armazenamento_gb', 'fps_estimado'], requisitos);

out.push('-- ===================== COMPRA =====================');
insert('carrinho', ['id', 'cliente_id', 'token_sessao', 'status', 'criado_em'], carrinhos);
insert('carrinho_item', ['id', 'carrinho_id', 'produto_id', 'quantidade', 'adicionado_em'], carrinhoItens);
insert('pedido', ['id', 'numero', 'cliente_id', 'carrinho_id', 'montagem_id', 'status', 'valor_total', 'observacoes', 'criado_em', 'atualizado_em'],
  pedidos, 'Migrados (numeros, datas, valores e status identicos ao banco anterior)');
insert('pedido_item', ['id', 'pedido_id', 'produto_id', 'quantidade', 'preco_unitario'], itens);
insert('pedido_status_historico', ['id', 'pedido_id', 'status_anterior', 'status_novo', 'usuario_id', 'observacao', 'criado_em'],
  historicos, 'Historico reconstruido a partir do status atual, distribuido entre data de criacao e de atualizacao');
insert('pagamento', ['id', 'pedido_id', 'forma', 'parcelas', 'valor', 'status', 'codigo_transacao', 'pago_em', 'criado_em'], pagamentos);
insert('entrega', ['id', 'pedido_id', 'modalidade', 'entregador_id', 'endereco_id', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'valor_frete', 'codigo_rastreio', 'previsao_entrega', 'saiu_em', 'entregue_em'], entregas, 'Tipo, frete, entregador e endereco que ficavam em pedido');
insert('movimentacao_estoque', ['id', 'produto_id', 'pedido_id', 'usuario_id', 'tipo', 'quantidade', 'saldo_apos', 'motivo', 'criado_em'], movimentacoes);
insert('recomendacao', ['id', 'produto_origem_id', 'produto_recomendado_id', 'tipo', 'peso', 'criado_em'], recomendacoes,
  'manual = antiga produto_relacionado; compatibilidade = CPU->placa do mesmo soquete, placa->memoria do mesmo tipo');

out.push(`COMMIT;

-- ===================== CONFERENCIA =====================
SELECT 'perfis' AS tabela, COUNT(*) AS total FROM perfil
UNION ALL SELECT 'usuarios', COUNT(*) FROM usuario
UNION ALL SELECT 'clientes', COUNT(*) FROM cliente
UNION ALL SELECT 'enderecos', COUNT(*) FROM endereco
UNION ALL SELECT 'categorias', COUNT(*) FROM categoria
UNION ALL SELECT 'produtos', COUNT(*) FROM produto
UNION ALL SELECT 'especificacoes', COUNT(*) FROM especificacao_tecnica
UNION ALL SELECT 'pedidos', COUNT(*) FROM pedido
UNION ALL SELECT 'itens de pedido', COUNT(*) FROM pedido_item
UNION ALL SELECT 'historico de status', COUNT(*) FROM pedido_status_historico
UNION ALL SELECT 'tarifas', COUNT(*) FROM tarifa_energia
UNION ALL SELECT 'softwares', COUNT(*) FROM software
UNION ALL SELECT 'requisitos', COUNT(*) FROM requisito
UNION ALL SELECT 'montagens', COUNT(*) FROM montagem;

SELECT montagem, soma_watts, consumo_uso_w, consumo_carga_w, potencia_fonte_w, tomada_uso_w, custo_mensal, custo_anual, selo_fonte
FROM vw_consumo_montagem ORDER BY montagem_id;
`);

writeFileSync(join(root, 'database', 'seed.sql'), out.join('\n'), 'utf8');

// ───────────────────────────── dados do "Monte seu PC" para o back-end falso do front ─────────────────────────────
// (src/app/core/mock/mock-backend.interceptor.ts usa quando environment.useMock = true)
const mock = {
  produtosNovos: produtos.filter(p => p.id > old.produto.length).map(p => ({
    id_produto: p.id, id_categoria: p.categoria_id, nome: p.nome, descricao: p.descricao, marca: p.marca, preco: p.preco,
    preco_antigo: p.preco_antigo, estoque: p._estoque, imagem_url: p.imagem_url, destaque: 0, disponivel: 1 })),
  especificacoes: especificacoes.map(e => ({ id: e.id, idProduto: e.produto_id, tipoPeca: e.tipo_peca, consumoWatts: e.consumo_watts,
    scoreDesempenho: e.score_desempenho, soquete: e.soquete ?? null, tipoMemoria: e.tipo_memoria ?? null, formato: e.formato ?? null,
    vramGb: e.vram_gb ?? null, capacidadeGb: e.capacidade_gb ?? null, potenciaFonteW: e.potencia_fonte_w ?? null,
    eficienciaFonte: e.eficiencia_fonte ?? null })),
  tarifas: TARIFAS.map(t => ({ id: t.id, uf: t.uf, distribuidora: t.distribuidora, valorKwh: t.valor_kwh })),
  softwares: softwares.map(s => ({ id: s.id, nome: s.nome, tipo: s.tipo, categoria: s.categoria, imagemUrl: s.imagem_url,
    popularidade: s.popularidade, requisitos: requisitos.filter(r => r.software_id === s.id).map(r => ({ nivel: r.nivel,
      scoreCpuMin: r.score_cpu_min, scoreGpuMin: r.score_gpu_min, ramMinGb: r.ram_min_gb, vramMinGb: r.vram_min_gb,
      armazenamentoGb: r.armazenamento_gb, fpsEstimado: r.fps_estimado })) })),
  montagens: montagens.map(m => ({ id: m.id, idCliente: m.cliente_id, nome: m.nome, horasUsoDia: m.horas_uso_dia, uf: m.uf,
    exemplo: m.exemplo, itens: montagemItens.filter(i => i.montagem_id === m.id).map(i => ({ idProduto: i.produto_id, quantidade: i.quantidade })) })),
  clienteComConta: { idUsuario: 4, idCliente: anaCliente.id, nome: anaCliente.nome, email: anaCliente.email },
};
writeFileSync(join(root, 'src', 'app', 'core', 'mock', 'mock-pc-seed.json'), JSON.stringify(mock, null, 1), 'utf8');

if (inconsistentes.size) console.log(`Aviso: ${[...inconsistentes].join(', ')} é retirada com status "saiu_para_entrega" no banco anterior (mantido; histórico segue o fluxo de entrega).`);
console.log(`seed.sql gerado: ${produtos.length} produtos (${NOVAS.length} novos), ${especificacoes.length} especificações, `
  + `${clientes.length} clientes, ${enderecos.length} endereços, ${pedidos.length} pedidos, ${itens.length} itens, `
  + `${historicos.length} registros de histórico, ${softwares.length} softwares, ${requisitos.length} requisitos, ${montagens.length} montagens.`);
