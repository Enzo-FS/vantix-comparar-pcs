# Contrato da API — Vantix Tech Store

Este é o formato que o **Angular já usa**. Se a API Java seguir exatamente isto, o front
funciona sem nenhuma mudança: basta trocar `useMock: true` por `false` em
`src/environments/environment.ts`.

- URL base: `http://localhost:8080/api` (configurável em `environment.ts`)
- JSON com nomes em **camelCase**, seguindo as colunas do MySQL (`database/schema.sql`; modelo em `docs/MER.md`)
- Datas em ISO 8601: `"2026-11-05T20:18:29"`
- Valores em dinheiro como número: `4899.9`
- **CORS**: liberar `http://localhost:4200` com os métodos `GET, POST, PUT, PATCH, DELETE` e o header `Authorization`
- **Erros**: devolver o status HTTP certo e o corpo `{ "mensagem": "texto para o usuário" }`. O front mostra esse texto num aviso (toast).

| Status | Quando |
|---|---|
| 400 | dado inválido (preço ≤ 0, e-mail inválido, etc.) |
| 401 | sem token, token inválido/expirado, ou login errado |
| 403 | logado, mas o papel não pode fazer aquilo |
| 404 | registro não existe |
| 409 | conflito: estoque insuficiente, e-mail repetido, transição de status inválida, produto com pedidos não pode ser excluído |

> Referência executável: `src/app/core/mock/mock-backend.interceptor.ts` implementa todas as
> rotas abaixo em TypeScript, com as mesmas regras. Os tipos estão em `src/app/core/api/api.types.ts`.

---

## Valores dos enums (iguais ao MySQL)

- `papel`: `gerente` | `estoque` | `logistica` | `cliente` (cliente com conta; só para salvar montagens)
- `status`: `pendente` | `confirmado` | `em_preparacao` | `pronto` | `saiu_para_entrega` | `entregue` | `cancelado`
- `forma` (pagamento): `credito` | `debito` | `pix` | `boleto`
- `tipoEntrega`: `entrega` | `retirada`

---

## 1. Login — Frente 2 (Lucas)

### `POST /api/auth/login` (público)
```json
{ "email": "gerente@vantix.com", "senha": "vantix2024" }
```
Resposta `200`:
```json
{
  "token": "eyJhbGciOi...",
  "usuario": { "id": 1, "nome": "Gerente Vantix", "email": "gerente@vantix.com", "papel": "gerente", "ativo": true }
}
```
- Senha errada → `401`. Usuário com `ativo = false` → `403`.
- Conferir a senha com BCrypt contra `senha_hash`. Os hashes do `02_dados.sql` são de `vantix2024`.
- Nas outras rotas o front envia `Authorization: Bearer <token>`.

**Quem acessa o quê:**

| Rota | Público | gerente | estoque | logistica |
|---|:-:|:-:|:-:|:-:|
| `GET /categorias`, `GET /produtos`, `GET /recomendacoes` | ✔ | ✔ | ✔ | ✔ |
| `POST /pedidos`, `GET /pedidos/cliente` | ✔ | ✔ | ✔ | ✔ |
| `GET /pedidos`, `PATCH /pedidos/{id}/status` | | ✔ | ✔ | ✔ |
| Escrita em `/produtos`, `/funcionarios`, todos os `/relatorios` | | ✔ | | |

---

## 2. Produtos e categorias — Frente 2 (Lucas)

### `GET /api/categorias`
```json
[ { "id": 1, "nome": "Hardware", "descricao": "Placas de vídeo, ..." } ]
```

### `GET /api/produtos`
Parâmetros opcionais: `categoria` (nome), `busca` (texto), `incluirInativos=true` (só gerente).
Sem `incluirInativos`, devolve só os produtos com `disponivel = true`.
```json
[{
  "id": 1, "idCategoria": 1, "categoria": "Hardware",
  "nome": "Placa de Vídeo GeForce RTX 4070 SUPER 12GB",
  "descricao": "Arquitetura Ada Lovelace...", "marca": "NVIDIA",
  "preco": 4899.9, "precoAntigo": 5599.9, "estoque": 14,
  "imagemUrl": "https://images.unsplash.com/...", "destaque": true, "disponivel": true
}]
```

### `GET /api/produtos/{id}` → o mesmo objeto acima

### `POST /api/produtos` e `PUT /api/produtos/{id}` (gerente)
Corpo: o objeto acima **sem** `id` e `categoria`. Resposta: o produto salvo.

### `PATCH /api/produtos/{id}/disponivel` (gerente)
```json
{ "disponivel": false }
```

### `DELETE /api/produtos/{id}` (gerente)
`204`. Se o produto já aparece em `item_pedido` (FK RESTRICT) → `409` com a mensagem
"Este produto já tem pedidos e não pode ser excluído. Desative-o."

---

## 3. Funcionários — Frente 2 (Lucas)

Tabela `usuario_painel`. Só o gerente acessa.

### `GET /api/funcionarios`
```json
[{ "id": 1, "nome": "Gerente Vantix", "email": "gerente@vantix.com", "papel": "gerente", "ativo": true, "dataCriacao": "2026-09-01T09:00:00" }]
```
**Nunca** devolver `senha_hash`.

### `POST /api/funcionarios`
```json
{ "nome": "Ana Souza", "email": "ana@vantix.com", "papel": "estoque", "ativo": true, "senha": "123456" }
```
A senha é obrigatória no cadastro (mínimo 6 caracteres) e é gravada com BCrypt. E-mail repetido → `409`.

### `PUT /api/funcionarios/{id}`
O mesmo corpo do cadastro. A `senha` é opcional: se não vier, mantém a senha atual.

### `PATCH /api/funcionarios/{id}/ativo`
```json
{ "ativo": false }
```
O gerente não pode desativar o próprio usuário → `409`.

---

## 4. Pedidos e estoque — Frente 3

### `POST /api/pedidos` (público — checkout)
```json
{
  "cliente": { "nome": "Cliente Demo", "email": "cliente@email.com", "telefone": "(11) 91234-5678",
               "endereco": "Av. Paulista, 1000 — Bela Vista, São Paulo — SP, CEP 01310-100" },
  "itens": [ { "idProduto": 1, "quantidade": 1 }, { "idProduto": 2, "quantidade": 2 } ],
  "pagamento": { "forma": "credito", "parcelas": 3 },
  "enderecoEntrega": { "cep": "01310100", "logradouro": "Av. Paulista", "numero": "1000", "complemento": "Apto 12",
                       "bairro": "Bela Vista", "cidade": "São Paulo", "uf": "SP" },
  "tipoEntrega": "entrega",
  "observacoes": "Deixar na portaria",
  "montagem": { "uf": "RJ", "horasUsoDia": 6 }
}
```
- `enderecoEntrega` (novo): endereço em campos separados, gravado em `endereco` e copiado em `entrega`.
  Se não vier, a API tenta separar o texto de `cliente.endereco` (formato antigo).
- `montagem` (novo, opcional): UF e horas escolhidas na **Verificação do PC**. As peças de hardware do pedido
  (produtos com `especificacao_tecnica`) viram uma `montagem` ligada ao pedido (`pedido.montagem_id`).
Tudo numa **única transação** (`@Transactional`):
1. Procurar o cliente pelo `email`. Se existir, atualizar nome, telefone e endereço; se não, inserir.
2. **Preço, frete, total e número são calculados pela API.** Não confiar em valores vindos do navegador.
   - Preço unitário = `produto.preco` atual.
   - Frete = `0` se subtotal ≥ 299,00, senão `29,90` (mesma regra mostrada no carrinho). Retirada = `0`.
   - Número = `VTX-` + próximo número (ex.: `VTX-1057`).
3. Inserir `pedido` (status `pendente`), `item_pedido` e `pagamento` (`valor` = total).
4. Se a forma **não** for `boleto`, o pagamento é aprovado na hora: fazer `UPDATE pedido SET status='confirmado'`.
   Isso dispara a `trg_pedido_estoque`, que baixa o estoque. Se faltar estoque, o `CHECK (estoque >= 0)`
   falha → rollback → responder `409` com `"Estoque insuficiente para \"<produto>\" (restam N)."`.
   Para não vender a última unidade para dois clientes, travar as linhas com
   `SELECT ... FOR UPDATE` (ou `@Lock(PESSIMISTIC_WRITE)`) antes do UPDATE.

Resposta `201`: o pedido completo (formato abaixo).

### Formato do pedido (usado em todas as respostas)
```json
{
  "id": 57, "numero": "VTX-1057", "status": "confirmado", "tipoEntrega": "entrega",
  "enderecoEntrega": "Av. Paulista, 1000 ...", "frete": 0, "valorTotal": 7299.8,
  "observacoes": null, "motivoCancelamento": null, "idEntregador": null, "idMontagem": 5,
  "dataCriacao": "2026-11-11T17:46:02", "dataAtualizacao": "2026-11-11T17:46:02",
  "cliente": { "id": 16, "nome": "Cliente Demo", "email": "cliente@email.com", "telefone": "(11) 91234-5678", "endereco": "..." },
  "itens": [ { "idProduto": 1, "nome": "Placa de Vídeo ...", "imagemUrl": "https://...", "quantidade": 1, "precoUnitario": 4899.9, "subtotal": 4899.9 } ],
  "pagamento": { "forma": "credito", "parcelas": 3, "valor": 7299.8 }
}
```

### `GET /api/pedidos` (painéis, com login)
Todos os pedidos, mais recentes primeiro. Filtro opcional: `?status=pronto`.
Os painéis de Estoque e Logística chamam esta rota **a cada 5 segundos**, então ela precisa ser leve
(usar `JOIN FETCH` ou `@EntityGraph` para não cair no problema N+1).

### `GET /api/pedidos/cliente?telefone=(11) 91234-5678` (público — "Meus pedidos")
Também aceita `?email=`. Comparar o telefone **só pelos dígitos**.

### `PATCH /api/pedidos/{id}/status`
```json
{ "status": "saiu_para_entrega", "idEntregador": 3 }
{ "status": "cancelado", "motivoCancelamento": "Desistência do cliente" }
```
Transições permitidas (outras → `409`):

| De | Para | Quem usa no front |
|---|---|---|
| `pendente` | `confirmado` | Gerente ("Aprovar pagamento", boleto) |
| `confirmado` | `em_preparacao` | Estoque ("Iniciar separação") |
| `em_preparacao` | `pronto` | Estoque ("Embalado") |
| `pronto` | `saiu_para_entrega` | Logística ("Despachar pacote", envia `idEntregador`). **Só entrega.** |
| `pronto` | `entregue` | Estoque/gerente ("Entregue ao cliente"). **Só retirada na loja.** |
| `saiu_para_entrega` | `entregue` | Logística ("Confirmar entrega") |
| `pendente`, `confirmado`, `em_preparacao`, `pronto` | `cancelado` | Só gerente, com `motivoCancelamento` |

A trigger devolve o estoque quando um pedido `confirmado`, `em_preparacao` ou `pronto` é cancelado.

---

## 5. Relatórios e recomendação — Frente 4

Todos os relatórios aceitam `?inicio=YYYY-MM-DD&fim=YYYY-MM-DD` (inclusivo, por `DATE(data_criacao)`).
Sem esses parâmetros = todo o período. Só o gerente acessa. O painel atualiza a cada 15 segundos.

| Rota | Resposta | Base no SQL |
|---|---|---|
| `GET /api/relatorios/resumo` | `{ "faturamento": 339416.7, "totalPedidos": 57, "pedidosEntregues": 46, "pedidosCancelados": 4, "ticketMedio": 6404.09 }` | faturamento e ticket **sem** cancelados |
| `GET /api/relatorios/faturamento-diario` | `[{ "dia": "2026-11-05", "pedidos": 3, "faturamento": 15699.2 }]` (ordem por dia) | `vw_faturamento_diario` |
| `GET /api/relatorios/pedidos-por-status` | `[{ "status": "entregue", "pedidos": 46 }]` | `vw_pedidos_por_status` |
| `GET /api/relatorios/mais-vendidos?limite=5` | `[{ "idProduto": 1, "nome": "...", "categoria": "Hardware", "unidadesVendidas": 9, "receita": 44099.1 }]` | `vw_produtos_mais_vendidos` |
| `GET /api/relatorios/formas-pagamento` | `[{ "forma": "pix", "pedidos": 20, "valor": 98000 }]` | `vw_formas_pagamento` |
| `GET /api/relatorios/pedidos-por-hora` | `[{ "hora": 14, "pedidos": 6 }]` | `vw_pedidos_por_hora` |
| `GET /api/relatorios/estoque-baixo` | `[{ "idProduto": 5, "nome": "PC Gamer ...", "estoque": 6 }]` (sem filtro de data) | `vw_estoque_baixo` |

> As views atuais não recebem período. Para o filtro funcionar, use a consulta da view com
> `WHERE DATE(data_criacao) BETWEEN :inicio AND :fim` (`@Query(nativeQuery = true)`).

### `GET /api/recomendacoes?produtos=1,7&limite=4` (público)
"Quem comprou também levou". Devolve uma **lista de produtos** (mesmo formato de `GET /produtos`):
1. Usar `vw_comprados_juntos` para os produtos informados, somando `vezes`.
2. Completar com `produto_relacionado`.
3. Tirar os próprios produtos informados, os indisponíveis e os sem estoque. Ordenar por relevância.

É usada na tela de produtos (1 id) e no carrinho (todos os ids do carrinho).

---

## 5.1 Controle de estoque (Portal do Estoque e gerente)

Acesso: papéis `estoque` e `gerente`. Usa as tabelas `estoque` e `movimentacao_estoque`.

| Rota | Corpo / parâmetros | O que faz |
|---|---|---|
| `GET /api/estoque` | — | Saldo de cada produto: `idProduto`, `nome`, `marca`, `categoria`, `imagemUrl`, `disponivel`, `quantidade`, `estoqueMinimo`, `baixo`, `atualizadoEm` (abaixo do mínimo primeiro) |
| `GET /api/estoque/movimentacoes` | `?produto=&tipo=entrada\|saida\|devolucao\|ajuste&limite=200` | Histórico: `tipo`, `quantidade` (negativa nas saídas), `saldoApos`, `motivo`, `pedido` (número), `usuario` (null = sistema), `criadoEm` |
| `POST /api/estoque/{idProduto}/entrada` | `{ "quantidade": 10, "motivo": "NF 555" }` | Recebimento de mercadoria |
| `POST /api/estoque/{idProduto}/ajuste` | `{ "novaQuantidade": 12, "motivo": "Avaria" }` | Contagem de inventário (motivo obrigatório; igual ao saldo → `400`) |
| `PATCH /api/estoque/{idProduto}/minimo` | `{ "estoqueMinimo": 5 }` | Estoque mínimo (alerta e relatório de estoque baixo) |

Saídas e devoluções de vendas continuam sendo gravadas pela trigger `trg_pedido_estoque`.

---

## 6. Monte seu PC (inovações)

Regras e fórmulas em [regras-inovacoes.md](regras-inovacoes.md). Cálculos em `com.vantix.api.pc.RegrasPc` (Java)
e `src/app/core/pc/regras.ts` (front e mock), com os mesmos testes.

| Rota | Acesso | O que faz |
|---|---|---|
| `GET /api/especificacoes?tipo=cpu` | público | Peças com dados técnicos (`idProduto`, `nome`, `preco`, `estoque`, `tipoPeca`, `consumoWatts`, `scoreDesempenho`, `soquete`, `tipoMemoria`, `formato`, `vramGb`, `capacidadeGb`, `potenciaFonteW`, `eficienciaFonte`) |
| `PUT /api/especificacoes/{idProduto}` | gerente | Cria ou altera a especificação de um produto |
| `DELETE /api/especificacoes/{idProduto}` | gerente | Remove a especificação (o produto continua à venda) |
| `GET /api/tarifas` | público | `[{ "id", "uf", "distribuidora", "valorKwh" }]` |
| `PUT /api/tarifas/{uf}` | gerente | `{ "distribuidora", "valorKwh" }` |
| `GET /api/softwares` | público | Jogos/programas com `requisitos` (3 níveis), por popularidade |
| `POST /api/softwares`, `PUT /api/softwares/{id}`, `DELETE /api/softwares/{id}` | gerente | Cadastro com os 3 requisitos |
| `GET /api/montagens` | público | Montagens de exemplo + as do cliente logado |
| `GET /api/montagens/{id}` | público* | Uma montagem (`itens: [{ idProduto, quantidade }]`) |
| `POST /api/montagens` | cliente | `{ "nome", "uf", "horasUsoDia", "itens" }` |
| `DELETE /api/montagens/{id}` | cliente (dono) | Apaga a própria montagem |
| `GET /api/montagens/{id}/consumo?uf=&horas=` | público* | Consumo, custo, selo da fonte, compatibilidade e desempenho |
| `POST /api/montagens/avaliar` | público | O mesmo, para uma montagem ainda não salva (`{ uf, horasUsoDia, itens }`) |
| `GET /api/comparar?a=&b=&uf=&horas=` | público* | Métricas A×B (diferença % e melhor de cada linha) + texto de resumo |
| `GET /api/roda?montagem=&software=` | público* | Nível atingido, FPS, tabela por nível, peça que limita e até 3 `sugestoes` |

\* Montagens de exemplo são públicas. As de cliente só o dono (logado) ou um funcionário veem; para os outros, `404`.

Exemplo de `GET /api/roda?montagem=1&software=7` (PC Básico × EA SPORTS FC 26):
```json
{ "resultado": { "nivel": "nao_roda", "fpsEstimado": null,
    "limitante": { "criterio": "gpu", "tipoPeca": "gpu", "proximoNivel": "minimo", "exigido": 30, "atual": 25, "deficit": 16.7 },
    "niveis": [ { "nivel": "minimo", "atendido": false, "fpsEstimado": 60,
                  "criterios": [ { "criterio": "cpu", "rotulo": "Processador (score)", "exigido": 35, "montagem": 38, "ok": true } ] } ] },
  "sugestoes": [ { "idProduto": 60, "nome": "Placa de Vídeo Radeon RX 6600 8GB", "preco": 1299.90 } ] }
```

---

## Observações para a Letícia (SQL)

- A trigger só roda em `UPDATE`. Por isso o pedido é inserido como `pendente` e atualizado para `confirmado` logo depois (passo 4 do `POST /pedidos`).
- O pedido `VTX-1056` do `02_dados.sql` é `retirada` com status `saiu_para_entrega`. Na migração ele foi mantido como veio (o histórico explica a inconsistência); a API aceita concluí-lo (`saiu_para_entrega` → `entregue`).
- O plano cita uma coluna `tags` em PRODUTO, mas ela não existe no banco. O front não depende dela.
