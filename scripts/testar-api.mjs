// Teste de ponta a ponta da API Java + MySQL (rotas antigas e as do "Monte seu PC").
// Pre-requisitos: banco recem-criado (schema.sql + seed.sql) e a API rodando.
// Uso: node scripts/testar-api.mjs [http://localhost:8080/api]
// ATENCAO: cria pedidos, montagens e um jogo de teste no banco. Rode em um banco de teste.
const API = process.argv[2] ?? 'http://localhost:8080/api';
let falhas = 0, total = 0;

function ok(cond, msg, extra) {
  total++;
  if (cond) console.log(`  ✔ ${msg}`);
  else { falhas++; console.log(`  ✖ ${msg}`, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}
async function req(method, path, { token, body } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
  return { status: r.status, body: json };
}
const login = async (email, senha = 'vantix2024') => (await req('POST', '/auth/login', { body: { email, senha } })).body;

console.log('\n1) Login e perfis');
const gerente = await login('gerente@vantix.com');
const estoque = await login('estoque@vantix.com');
const logistica = await login('logistica@vantix.com');
const ana = await login('ana.beatriz.souza@email.com');
ok(gerente?.usuario?.papel === 'gerente', 'gerente entra');
ok(estoque?.usuario?.papel === 'estoque', 'estoque entra');
ok(logistica?.usuario?.papel === 'logistica', 'logística entra');
ok(ana?.usuario?.papel === 'cliente' && ana.usuario.idCliente === 1, 'cliente com conta entra (papel cliente)');
ok((await req('POST', '/auth/login', { body: { email: 'gerente@vantix.com', senha: 'errada' } })).status === 401, 'senha errada = 401');
ok((await req('GET', '/pedidos', { token: ana.token })).status === 403, 'cliente NÃO lista todos os pedidos (403)');
ok((await req('GET', '/funcionarios', { token: estoque.token })).status === 403, 'estoque não vê funcionários (403)');

console.log('\n2) Catálogo (formato do JSON igual ao de antes)');
const cats = (await req('GET', '/categorias')).body;
ok(cats.length === 8, '8 categorias', cats.length);
const prods = (await req('GET', '/produtos')).body;
ok(prods.length === 91, '91 produtos disponíveis (53 migrados + 38 peças novas)', prods.length);
const p1 = (await req('GET', '/produtos/1')).body;
ok(p1.nome.startsWith('Placa de Vídeo GeForce RTX 4070') && p1.estoque === 14 && p1.idCategoria === 1
  && 'precoAntigo' in p1 && 'imagemUrl' in p1, 'GET /produtos/1 com os mesmos campos', p1);
ok((await req('GET', '/produtos?busca=ryzen')).body.length >= 3, 'busca por texto');
ok((await req('GET', '/recomendacoes?produtos=2&limite=4')).body.length > 0, 'recomendações do produto 2');

console.log('\n3) Gerente: produto e estoque');
const novo = await req('POST', '/produtos', { token: gerente.token, body: {
  idCategoria: 8, nome: 'Produto de Teste', descricao: 'teste', marca: 'Teste', preco: 10, precoAntigo: null,
  estoque: 5, imagemUrl: null, destaque: false, disponivel: true } });
ok(novo.status === 201 && novo.body.estoque === 5, 'cria produto com estoque', novo.body);
const editado = await req('PUT', `/produtos/${novo.body.id}`, { token: gerente.token, body: { ...novo.body, estoque: 8 } });
ok(editado.body.estoque === 8, 'altera estoque (gera movimentação de ajuste)');
ok((await req('DELETE', `/produtos/${novo.body.id}`, { token: gerente.token })).status === 204, 'apaga produto sem vendas');
ok((await req('DELETE', '/produtos/1', { token: gerente.token })).status === 409, 'não apaga produto já vendido (409)');

console.log('\n4) Pedido completo: entrega');
const estoqueAntes = (await req('GET', '/produtos/57')).body.estoque;
const pedido = await req('POST', '/pedidos', { body: {
  cliente: { nome: 'Cliente Teste', email: 'teste.api@email.com', telefone: '(11) 90000-0001', endereco: null },
  enderecoEntrega: { cep: '01310-100', logradouro: 'Av. Paulista', numero: '1000', complemento: 'Apto 12',
    bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' },
  itens: [{ idProduto: 57, quantidade: 1 }, { idProduto: 42, quantidade: 1 }, { idProduto: 6, quantidade: 1 }],
  pagamento: { forma: 'pix', parcelas: 1 }, tipoEntrega: 'entrega', observacoes: null,
  montagem: { uf: 'RJ', horasUsoDia: 6 } } });
ok(pedido.status === 201 && pedido.body.status === 'confirmado', 'PIX cria pedido já confirmado', pedido.body);
ok(pedido.body.enderecoEntrega === 'Av. Paulista, 1000 - Apto 12 - Bela Vista, São Paulo - SP, CEP 01310-100',
  'endereço estruturado gravado e devolvido como texto', pedido.body.enderecoEntrega);
ok(pedido.body.idMontagem != null, 'montagem do PC salva e ligada ao pedido (peças de hardware)');
ok((await req('GET', '/produtos/57')).body.estoque === estoqueAntes - 1, 'trigger baixou o estoque');
const mont = (await req('GET', `/montagens/${pedido.body.idMontagem}`, { token: gerente.token })).body;
ok(mont.itens?.length === 2 && mont.uf === 'RJ' && Number(mont.horasUsoDia) === 6,
  'montagem do pedido tem só as 2 peças de hardware, UF e horas da verificação', mont);
const id = pedido.body.id;
const st = (s, token, extra = {}) => req('PATCH', `/pedidos/${id}/status`, { token, body: { status: s, ...extra } });
ok((await st('em_preparacao', estoque.token)).status === 200, 'estoque: em preparação');
ok((await st('pronto', estoque.token)).status === 200, 'estoque: pronto');
ok((await st('entregue', logistica.token)).status === 409, 'entrega não pula "saiu para entrega" (409)');
ok((await st('saiu_para_entrega', logistica.token, { idEntregador: 3 })).status === 200, 'logística: saiu para entrega');
const entregue = await st('entregue', logistica.token);
ok(entregue.body.status === 'entregue' && entregue.body.idEntregador === 3, 'logística: entregue');
const meus = (await req('GET', '/pedidos/cliente?telefone=11900000001')).body;
ok(meus.length === 1 && meus[0].numero === pedido.body.numero, '"Meus pedidos" pelo telefone');

console.log('\n5) Retirada na loja (antes travava em "Pronto") e cancelamento');
const ret = (await req('POST', '/pedidos', { body: {
  cliente: { nome: 'Cliente Teste', email: 'teste.api@email.com', telefone: '(11) 90000-0001' },
  itens: [{ idProduto: 6, quantidade: 1 }], pagamento: { forma: 'debito', parcelas: 1 }, tipoEntrega: 'retirada' } })).body;
ok(ret.tipoEntrega === 'retirada' && ret.frete === 0 && ret.enderecoEntrega === null && ret.idMontagem === null,
  'retirada sem frete, sem endereço e sem montagem (não tem hardware)', ret);
for (const s of ['em_preparacao', 'pronto']) await req('PATCH', `/pedidos/${ret.id}/status`, { token: estoque.token, body: { status: s } });
ok((await req('PATCH', `/pedidos/${ret.id}/status`, { token: logistica.token, body: { status: 'saiu_para_entrega', idEntregador: 3 } })).status === 409,
  'retirada não sai para entrega (409)');
ok((await req('PATCH', `/pedidos/${ret.id}/status`, { token: estoque.token, body: { status: 'entregue' } })).body?.status === 'entregue',
  'retirada: pronto → entregue');
const bol = (await req('POST', '/pedidos', { body: {
  cliente: { nome: 'Cliente Teste', email: 'teste.api@email.com', telefone: '(11) 90000-0001' },
  enderecoEntrega: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Campinas', uf: 'SP' },
  itens: [{ idProduto: 7, quantidade: 1 }], pagamento: { forma: 'boleto', parcelas: 1 }, tipoEntrega: 'entrega' } })).body;
ok(bol.status === 'pendente', 'boleto fica pendente');
ok((await req('PATCH', `/pedidos/${bol.id}/status`, { token: estoque.token, body: { status: 'cancelado', motivoCancelamento: 'x' } })).status === 403,
  'só o gerente cancela (403)');
const canc = await req('PATCH', `/pedidos/${bol.id}/status`, { token: gerente.token, body: { status: 'cancelado', motivoCancelamento: 'Boleto vencido' } });
ok(canc.body.status === 'cancelado' && canc.body.motivoCancelamento === 'Boleto vencido', 'gerente cancela com motivo');
const estoqueSemFalta = await req('POST', '/pedidos', { body: {
  cliente: { nome: 'X', email: 'x@x.com', telefone: '1' }, itens: [{ idProduto: 63, quantidade: 999 }],
  pagamento: { forma: 'pix' }, tipoEntrega: 'retirada' } });
ok(estoqueSemFalta.status === 409, 'estoque insuficiente = 409', estoqueSemFalta.body);

console.log('\n6) Relatórios e funcionários');
const resumo = (await req('GET', '/relatorios/resumo', { token: gerente.token })).body;
ok(resumo.totalPedidos === 74 && resumo.pedidosCancelados === 5, 'resumo: 71 migrados + 3 novos, 4+1 cancelados', resumo);
for (const r of ['faturamento-diario', 'pedidos-por-status', 'mais-vendidos', 'formas-pagamento', 'pedidos-por-hora', 'estoque-baixo']) {
  const x = await req('GET', `/relatorios/${r}`, { token: gerente.token });
  ok(x.status === 200 && Array.isArray(x.body) && x.body.length > 0, `relatório ${r}`);
}
const funcs = (await req('GET', '/funcionarios', { token: gerente.token })).body;
ok(funcs.length === 3 && funcs.every(f => !('senha_hash' in f)), 'funcionários: 3, sem senha e sem a cliente');
const f = await req('POST', '/funcionarios', { token: gerente.token, body: { nome: 'Novo', email: 'novo@vantix.com', papel: 'estoque', ativo: true, senha: '123456' } });
ok(f.status === 201 && f.body.papel === 'estoque', 'cadastra funcionário');
ok((await login('novo@vantix.com', '123456'))?.usuario?.papel === 'estoque', 'funcionário novo entra');

console.log('\n7) Monte seu PC: dados');
const espec = (await req('GET', '/especificacoes')).body;
ok(espec.length === 47, '47 especificações', espec.length);
const porTipo = espec.reduce((m, e) => ((m[e.tipoPeca] = (m[e.tipoPeca] ?? 0) + 1), m), {});
ok(Object.values(porTipo).every(n => n >= 4) && Object.keys(porTipo).length === 9, 'pelo menos 4 opções por tipo de peça', porTipo);
ok((await req('GET', '/tarifas')).body.length === 27, '27 tarifas (uma por UF)');
const sws = (await req('GET', '/softwares')).body;
ok(sws.length === 20 && sws.every(s => s.requisitos.length === 3), '20 softwares com 3 níveis');
ok(sws.slice(0, 3).map(s => s.nome).join(',') === 'Counter-Strike 2,Valorant,Fortnite', '3 mais populares');
const exemplos = (await req('GET', '/montagens')).body;
ok(exemplos.length === 3 && exemplos.every(m => m.exemplo), 'visitante vê só as 3 montagens de exemplo');
const daAna = (await req('GET', '/montagens', { token: ana.token })).body;
ok(daAna.length === 4, 'cliente logada vê exemplos + a dela');
ok((await req('GET', '/montagens/4')).status === 404, 'montagem de cliente é privada (404 para visitante)');

console.log('\n8) Monte seu PC: cálculos (mesmos números de docs/regras-inovacoes.md)');
const c1 = (await req('GET', '/montagens/1/consumo')).body.avaliacao;
ok(c1.consumo.somaWatts === 189 && c1.consumo.custoMensal === 16.27 && c1.consumo.custoAnual === 195.27
  && c1.consumo.seloFonte === 'verde', 'PC Básico: 189 W, R$ 16,27/mês, R$ 195,27/ano, selo verde', c1.consumo);
const c3 = (await req('GET', '/montagens/3/consumo')).body.avaliacao;
ok(c3.consumo.custoMensal === 80.47 && c3.consumo.folgaPercentual === 21.3, 'PC Avançado: R$ 80,47/mês, folga 21,3%');
const c4 = (await req('GET', '/montagens/4/consumo', { token: ana.token })).body.avaliacao;
ok(c4.temIncompatibilidade && c4.avisos.some(a => a.mensagem === 'Soquete AM4 não é compatível com a placa AM5.')
  && c4.faltando.includes('armazenamento'), 'rascunho da Ana: soquete incompatível e sem armazenamento');
const av = (await req('POST', '/montagens/avaliar', { body: { uf: 'PA', horasUsoDia: 8, itens: [{ idProduto: 63 }, { idProduto: 81 }] } })).body;
ok(av.avaliacao.consumo.seloFonte === 'amarelo' && av.valorKwh === 1.1, 'avaliar sem salvar: RTX 4090 (450 W) + fonte 500 W = amarelo');
const av2 = (await req('POST', '/montagens/avaliar', { body: { itens: [{ idProduto: 63 }, { idProduto: 58 }, { idProduto: 81 }] } })).body;
ok(av2.avaliacao.consumo.seloFonte === 'vermelho' && av2.avaliacao.temIncompatibilidade, '+ i7-14700K (620 W) = vermelho e bloqueia');
const cmp = (await req('GET', '/comparar?a=1&b=2&uf=SP&horas=4')).body;
ok(cmp.resumo === 'O PC Intermediário é 100% mais rápido, mas custa R$ 6,26 a mais por mês de energia.', 'comparar: resumo', cmp.resumo);
ok(cmp.metricas.find(m => m.metrica === 'scoreCpu').diferencaPercentual === 78.9, 'comparar: CPU +78,9%');
const roda = (await req('GET', '/roda?montagem=1&software=7')).body;
ok(roda.resultado.nivel === 'nao_roda' && roda.resultado.limitante.tipoPeca === 'gpu', 'PC Básico × FC 26: não roda, GPU limita');
ok(roda.sugestoes.map(s => s.idProduto).join(',') === '60,61,62', 'sugere RX 6600, RTX 4060, RX 7800 XT', roda.sugestoes.map(s => s.nome));
const roda2 = (await req('GET', '/roda?montagem=3&software=9')).body;
ok(roda2.resultado.nivel === 'ultra' && roda2.resultado.fpsEstimado === 90 && roda2.sugestoes.length === 0, 'PC Avançado × Cyberpunk: Ultra, 90 FPS');

console.log('\n9) Monte seu PC: salvar e cadastros do gerente');
const salva = await req('POST', '/montagens', { token: ana.token, body: { nome: 'Meu PC novo', uf: 'MG', horasUsoDia: 5, itens: [{ idProduto: 57 }, { idProduto: 42 }] } });
ok(salva.status === 201 && salva.body.idCliente === 1, 'cliente salva montagem', salva.body);
ok((await req('POST', '/montagens', { body: { nome: 'x', itens: [{ idProduto: 57 }] } })).status === 401, 'visitante não salva no servidor (401)');
ok((await req('DELETE', '/montagens/1', { token: ana.token })).status === 403, 'não apaga montagem de exemplo');
ok((await req('DELETE', `/montagens/${salva.body.id}`, { token: ana.token })).status === 204, 'cliente apaga a própria montagem');
const esp = await req('PUT', '/especificacoes/5', { token: gerente.token, body: { tipoPeca: 'fonte', consumoWatts: 0, scoreDesempenho: 50 } });
ok(esp.status === 400 && esp.body.mensagem === 'Informe a potência da fonte.', 'especificação incompleta é recusada');
const esp2 = await req('PUT', '/especificacoes/44', { token: gerente.token, body: { tipoPeca: 'ssd', consumoWatts: 4, scoreDesempenho: 50, capacidadeGb: 1000 } });
ok(esp2.status === 200 && esp2.body.consumoWatts === 4, 'gerente altera especificação');
ok((await req('PUT', '/especificacoes/44', { token: estoque.token, body: {} })).status === 403, 'estoque não altera especificação');
const tar = await req('PUT', '/tarifas/SP', { token: gerente.token, body: { distribuidora: 'Enel São Paulo', valorKwh: 0.9 } });
ok(tar.status === 200 && tar.body.find(t => t.uf === 'SP').valorKwh === 0.9, 'gerente altera tarifa');
const req3 = (cpu) => ['minimo', 'recomendado', 'ultra'].map((nivel, i) => ({ nivel, scoreCpuMin: cpu + i * 10, scoreGpuMin: 10, ramMinGb: 8, vramMinGb: 1, armazenamentoGb: 10, fpsEstimado: 60 }));
const sw = await req('POST', '/softwares', { token: gerente.token, body: { nome: 'Jogo de Teste', tipo: 'jogo', categoria: 'Teste', popularidade: 1, requisitos: req3(10) } });
ok(sw.status === 201 && sw.body.requisitos.length === 3, 'gerente cadastra jogo com 3 requisitos');
const sw2 = await req('PUT', `/softwares/${sw.body.id}`, { token: gerente.token, body: { nome: 'Jogo de Teste', tipo: 'jogo', categoria: 'Teste', popularidade: 1, requisitos: req3(20) } });
ok(sw2.body.requisitos[0].scoreCpuMin === 20, 'gerente edita requisitos');
ok((await req('DELETE', `/softwares/${sw.body.id}`, { token: gerente.token })).status === 204, 'gerente apaga jogo');

console.log('\n10) Controle de estoque (Portal do Estoque)');
const saldo = (await req('GET', '/estoque', { token: estoque.token })).body;
ok(saldo.length === 91 && saldo[0].baixo == 1, 'estoque vê o saldo de todos os produtos (abaixo do mínimo primeiro)');
ok((await req('GET', '/estoque', { token: logistica.token })).status === 403 && (await req('GET', '/estoque')).status === 401,
  'logística e visitante não acessam o estoque');
const antes = saldo.find(s => s.idProduto === 63).quantidade;
const ent = await req('POST', '/estoque/63/entrada', { token: estoque.token, body: { quantidade: 10, motivo: 'NF 555' } });
ok(ent.body.quantidade === antes + 10, 'entrada de mercadoria soma ao saldo', ent.body);
const aj = await req('POST', '/estoque/63/ajuste', { token: estoque.token, body: { novaQuantidade: antes + 8, motivo: 'Avaria' } });
ok(aj.body.quantidade === antes + 8, 'ajuste de inventário grava o saldo contado');
ok((await req('POST', '/estoque/63/ajuste', { token: estoque.token, body: { novaQuantidade: 1 } })).status === 400, 'ajuste sem motivo é recusado');
const hist = (await req('GET', '/estoque/movimentacoes?produto=63', { token: estoque.token })).body;
ok(hist[0].tipo === 'ajuste' && hist[0].quantidade === -2 && hist[1].tipo === 'entrada' && hist[1].motivo === 'NF 555',
  'histórico registra entrada e ajuste, com usuário e motivo', hist.slice(0, 2));
const saidas = (await req('GET', '/estoque/movimentacoes?tipo=saida', { token: gerente.token })).body;
ok(saidas.length > 0 && saidas.every(m => m.tipo === 'saida' && m.pedido), 'vendas aparecem como saídas, com o número do pedido');

console.log(`\n${total - falhas}/${total} verificações passaram.`);
process.exit(falhas ? 1 : 0);
