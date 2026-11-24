# MER — Modelo Entidade-Relacionamento · Vantix Tech Store

> Projeto Final ADS – UNASP · Banco de dados: **MySQL 8 (InnoDB, utf8mb4)**
> O diagrama correspondente está em [DER.md](DER.md).
> **Imagem (notação de Chen, para apresentar):** [diagramas/mer.png](diagramas/mer.png)

## 1. Ponto de partida: como os dados são guardados hoje

| Item | Situação atual |
|---|---|
| Stack | Angular 17 (front) + Spring Boot 3.2 / JDBC (back) + MySQL 8 |
| Scripts | `database/01_estrutura.sql` e `database/02_dados.sql` (banco `vantix_db`) |
| Tabelas | `cliente`, `usuario_painel`, `categoria`, `produto`, `produto_relacionado`, `pedido`, `item_pedido`, `pagamento` (8) |
| Regras no banco | trigger `trg_pedido_estoque` (baixa/devolve estoque) e 8 views de relatório e recomendação |
| Fora do banco | carrinho e montagem do cliente ficam só no `localStorage` do navegador |

O projeto **já usa MySQL**, então não é preciso trocar de banco. A mudança é de **modelo**: o esquema novo atende aos requisitos (perfis, endereços, histórico de status, movimentação de estoque, carrinho persistido, entrega, inovações) e corrige estes problemas do modelo atual:

- **Atributo composto:** `cliente.endereco` e `pedido.endereco_entrega` guardam o endereço inteiro em uma única string, o que viola a 1FN.
- **Papel fixo:** `usuario_painel.papel` é um ENUM, então não há uma entidade de perfil e o cliente não pode ter conta.
- **Estoque sem auditoria:** `produto.estoque` é alterado sem registro de quem mudou ou por quê.
- **Status sem histórico:** só se conhece o status atual do pedido, e o `motivo_cancelamento` fica solto na tabela `pedido`.
- **Dados de entrega espalhados:** `id_entregador`, `tipo_entrega` e `frete` ficam dentro de `pedido`, misturando entrega com venda.

### 1.1 Migração sem perda de dados

| Hoje (`vantix_db`) | Novo (`vantix`) | Como migra |
|---|---|---|
| `usuario_painel` (3) | `usuario` + `perfil` | `papel` vira `perfil_id`. Senhas BCrypt são mantidas. |
| `cliente` (15) | `cliente` + `endereco` | O texto `"Rua, nº - Bairro, Cidade - UF"` é quebrado em colunas. CEP fica `NULL` quando não existir. |
| `categoria` (8) | `categoria` | Igual |
| `produto` (53) | `produto` + `estoque` | `produto.estoque` passa para `estoque.quantidade`, e cada produto ganha uma movimentação de `entrada` inicial. |
| `produto_relacionado` | `recomendacao` (`tipo = 'manual'`) | 1 para 1 |
| `pedido` (71) | `pedido` + `entrega` + `pedido_status_historico` | Tipo, frete, entregador e endereço vão para `entrega`. O status atual gera o histórico, e o motivo de cancelamento vai para a observação do histórico. |
| `item_pedido` | `pedido_item` | Igual (preço unitário histórico preservado) |
| `pagamento` | `pagamento` | Ganha `status` (aprovado/pendente) derivado do status do pedido |
| *(localStorage)* | `carrinho`, `carrinho_item`, `montagem`, `montagem_item` | Novas: passam a ser persistidas |
| — | `especificacao_tecnica`, `tarifa_energia`, `software`, `requisito` | Novas (inovações) |

Os números dos pedidos (`VTX-1001`…), as datas, os valores e os status ficam idênticos. Por isso os painéis e relatórios mostram os mesmos resultados depois da migração.

## 2. Convenções

- Toda tabela tem PK `id INT UNSIGNED AUTO_INCREMENT`.
- Toda FK segue o padrão `<tabela>_id` (ex.: `produto_id`).
- As datas são `DATETIME`, nas colunas `criado_em` e `atualizado_em`.
- Os valores em dinheiro são `DECIMAL(10,2)`.
- Domínios fechados e estáveis (status, forma de pagamento, tipo de peça) usam `ENUM`. Domínios que o gerente pode ampliar (perfil, categoria) viram tabela.
- Legenda dos atributos: **PK** chave primária · **FK** chave estrangeira · **UK** único · `?` aceita NULL.

## 3. Entidades e atributos

Total: **22 entidades**, divididas em 5 grupos.

### 3.1 Acesso e pessoas

**perfil**: papel de acesso ao sistema.
`id` PK · `codigo` UK (`cliente`, `gerente`, `estoque`, `logistica`) · `nome` · `descricao?`

**usuario**: quem faz login (funcionários e clientes com conta).
`id` PK · `perfil_id` FK · `nome` · `email` UK · `senha_hash` (BCrypt) · `ativo` · `criado_em` · `atualizado_em`

**cliente**: quem compra. Pode comprar sem conta (identificado por e-mail e telefone).
`id` PK · `usuario_id?` FK UK · `nome` · `email` UK · `telefone` · `criado_em` · `atualizado_em`

**endereco**: endereços do cliente.
`id` PK · `cliente_id` FK · `apelido?` (Casa, Trabalho) · `cep?` · `logradouro` · `numero` · `complemento?` · `bairro` · `cidade` · `uf` · `principal` · `criado_em`

### 3.2 Catálogo e estoque

**categoria**: `id` PK · `nome` UK · `descricao?` · `criado_em`

**produto**: item vendável.
`id` PK · `categoria_id` FK · `nome` · `descricao?` · `marca?` · `preco` · `preco_antigo?` · `imagem_url?` · `destaque` · `disponivel` · `criado_em` · `atualizado_em`

**estoque**: saldo atual de cada produto (1:1).
`id` PK · `produto_id` FK UK · `quantidade` (≥ 0) · `estoque_minimo` · `atualizado_em`

**movimentacao_estoque**: registro de toda entrada e saída.
`id` PK · `produto_id` FK · `pedido_id?` FK · `usuario_id?` FK · `tipo` (`entrada`, `saida`, `ajuste`, `devolucao`) · `quantidade` · `saldo_apos` · `motivo?` · `criado_em`

**recomendacao**: "quem vê A também deve ver B".
`id` PK · `produto_origem_id` FK · `produto_recomendado_id` FK · `tipo` (`manual`, `comprados_juntos`, `compatibilidade`) · `peso` · `criado_em` · UK(`produto_origem_id`, `produto_recomendado_id`, `tipo`)

### 3.3 Compra

**carrinho**: o carrinho de compras, persistido no banco.
`id` PK · `cliente_id?` FK · `token_sessao?` UK (visitante) · `status` (`aberto`, `convertido`, `abandonado`) · `criado_em` · `atualizado_em`

**carrinho_item**: `id` PK · `carrinho_id` FK · `produto_id` FK · `quantidade` · `adicionado_em` · UK(`carrinho_id`, `produto_id`)

**pedido**: a venda.
`id` PK · `numero` UK (`VTX-1001`) · `cliente_id` FK · `carrinho_id?` FK UK · `montagem_id?` FK · `status` · `valor_total` · `observacoes?` · `criado_em` · `atualizado_em`

**pedido_item**: `id` PK · `pedido_id` FK · `produto_id` FK · `quantidade` · `preco_unitario` · `subtotal` (coluna gerada) · UK(`pedido_id`, `produto_id`)

**pedido_status_historico**: cada mudança de status.
`id` PK · `pedido_id` FK · `status_anterior?` · `status_novo` · `usuario_id?` FK (quem mudou; NULL = sistema ou cliente) · `observacao?` (ex.: motivo do cancelamento) · `criado_em`

**pagamento**: `id` PK · `pedido_id` FK UK · `forma` (`credito`, `debito`, `pix`, `boleto`) · `parcelas` (1 a 12) · `valor` · `status` (`pendente`, `aprovado`, `recusado`, `estornado`) · `codigo_transacao?` · `pago_em?` · `criado_em`

**entrega**: logística do pedido, tanto para entrega quanto para retirada.
`id` PK · `pedido_id` FK UK · `modalidade` (`entrega`, `retirada`) · `entregador_id?` FK→usuario · `endereco_id?` FK · `cep?` · `logradouro?` · `numero?` · `complemento?` · `bairro?` · `cidade?` · `uf?` · `valor_frete` · `codigo_rastreio?` · `previsao_entrega?` · `saiu_em?` · `entregue_em?`

### 3.4 Inovações: montagem de PC

**especificacao_tecnica**: dados técnicos de peças de hardware (1:1 com produto).
`id` PK · `produto_id` FK UK · `tipo_peca` (`cpu`, `gpu`, `placa_mae`, `ram`, `ssd`, `hdd`, `fonte`, `cooler`, `gabinete`) · `consumo_watts` · `score_desempenho` (0 a 100) · `soquete?` · `tipo_memoria?` (`DDR4`, `DDR5`) · `formato?` (`ATX`, `mATX`, `ITX`) · `vram_gb?` · `capacidade_gb?` · `potencia_fonte_w?` · `eficiencia_fonte?`

**tarifa_energia**: `id` PK · `uf` UK · `distribuidora` · `valor_kwh` · `atualizado_em`

**montagem**: um PC montado pelo cliente, de exemplo, ou gerado na verificação do carrinho.
`id` PK · `cliente_id?` FK (NULL = visitante ou exemplo) · `nome` · `horas_uso_dia` · `uf` FK→tarifa_energia.uf · `exemplo` (as 3 montagens da loja) · `criado_em`

**montagem_item**: `id` PK · `montagem_id` FK · `produto_id` FK · `quantidade` · UK(`montagem_id`, `produto_id`)

**software**: jogo ou programa.
`id` PK · `nome` UK · `tipo` (`jogo`, `programa`) · `categoria` (FPS, Edição de vídeo…) · `imagem_url?` · `popularidade` (ordena os "3 mais populares")

**requisito**: o que cada software exige em cada nível.
`id` PK · `software_id` FK · `nivel` (`minimo`, `recomendado`, `ultra`) · `score_cpu_min` · `score_gpu_min` · `ram_min_gb` · `vram_min_gb` · `armazenamento_gb` · `fps_estimado?` (NULL para programas) · UK(`software_id`, `nivel`)

### 3.5 Valores calculados (não são guardados)

Estes valores vêm de **views e funções**, nunca de colunas, porque dependem de outros dados e ficariam desatualizados:

- **Consumo da montagem:** soma de `consumo_watts × quantidade`, exposta pela view `vw_consumo_montagem`.
- **Custo de energia, selo da fonte, compatibilidade, "Roda ou não?" e comparação:** calculados por funções da API, com as regras em `docs/regras-inovacoes.md` (Etapa 2).
- **Subtotal do carrinho:** soma de `produto.preco × quantidade` no momento da leitura.

## 4. Relacionamentos e cardinalidades

| # | Relacionamento | Cardinalidade | Leitura |
|---|---|---|---|
| R1 | perfil – usuario | 1 : N | Um perfil é dado a vários usuários; cada usuário tem exatamente um perfil. |
| R2 | usuario – cliente | 1 : 0..1 | Um cliente **pode** ter uma conta de login; uma conta é de no máximo um cliente. |
| R3 | cliente – endereco | 1 : 0..N | O cliente cadastra zero ou mais endereços; um deles é o principal. |
| R4 | categoria – produto | 1 : N | Cada produto pertence a uma categoria. |
| R5 | produto – estoque | 1 : 1 | Cada produto tem exatamente um saldo de estoque. |
| R6 | produto – movimentacao_estoque | 1 : 0..N | Cada entrada ou saída se refere a um produto. |
| R7 | pedido – movimentacao_estoque | 0..1 : 0..N | Saídas e devoluções por venda apontam para o pedido; ajustes manuais não. |
| R8 | usuario – movimentacao_estoque | 0..1 : 0..N | Registra o funcionário que fez o ajuste manual. |
| R9 | produto – recomendacao (origem) | 1 : 0..N | **Auto-relacionamento N:N** de produto, resolvido pela tabela associativa `recomendacao`. |
| R10 | produto – recomendacao (recomendado) | 1 : 0..N | Mesmo relacionamento, lado do produto sugerido. |
| R11 | cliente – carrinho | 0..1 : 0..N | O carrinho é do cliente ou de um visitante (`token_sessao`). |
| R12 | carrinho – carrinho_item – produto | N : N | Um carrinho tem vários produtos e um produto está em vários carrinhos. |
| R13 | cliente – pedido | 1 : 0..N | Cada pedido é de um cliente. |
| R14 | carrinho – pedido | 0..1 : 0..1 | O pedido nasce de no máximo um carrinho, e o carrinho vira no máximo um pedido. |
| R15 | pedido – pedido_item – produto | N : N | O pedido tem 1..N produtos, com preço da época da venda. |
| R16 | pedido – pedido_status_historico | 1 : 1..N | Todo pedido tem pelo menos o registro de criação. |
| R17 | usuario – pedido_status_historico | 0..1 : 0..N | Quem mudou o status (NULL = sistema ou cliente). |
| R18 | pedido – pagamento | 1 : 1 | Cada pedido tem um pagamento. |
| R19 | pedido – entrega | 1 : 1 | Cada pedido tem um registro de entrega ou de retirada. |
| R20 | usuario (logística) – entrega | 0..1 : 0..N | Um entregador faz várias entregas. |
| R21 | endereco – entrega | 0..1 : 0..N | Indica de qual endereço veio a cópia gravada na entrega. |
| R22 | produto – especificacao_tecnica | 1 : 0..1 | Só peças de hardware têm especificação (**especialização parcial** de produto). |
| R23 | cliente – montagem | 0..1 : 0..N | O cliente salva várias montagens; visitantes e exemplos ficam com `cliente_id` NULL. |
| R24 | tarifa_energia – montagem | 1 : 0..N | A montagem usa a tarifa da UF escolhida. |
| R25 | montagem – montagem_item – produto | N : N | Uma montagem tem várias peças e uma peça está em várias montagens. |
| R26 | montagem – pedido | 0..1 : 0..N | O pedido guarda a montagem conferida na Verificação do PC. |
| R27 | software – requisito | 1 : 1..3 | Um requisito por nível (mínimo, recomendado, ultra). |

**Entidades fracas e associativas:**
- **Associativas** (resolvem N:N): `carrinho_item`, `pedido_item`, `montagem_item`, `recomendacao`.
- **Fracas** (dependem do pai e são apagadas em cascata): `endereco`, `estoque`, `pedido_status_historico`, `pagamento`, `entrega`, `requisito`.

## 5. Normalização (até a 3FN)

**1FN: atributos atômicos, sem grupos repetidos**
- O endereço em texto único foi dividido em `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade` e `uf`.
- Listas como "itens do pedido", "peças da montagem" e "requisitos por nível" viraram linhas em tabelas filhas, em vez de colunas `item1`, `item2`… ou campos JSON.

**2FN: nenhum atributo depende de só parte da chave**
- Todas as tabelas usam PK simples (`id`). As antigas chaves naturais compostas viraram `UNIQUE`: (`pedido_id`, `produto_id`), (`montagem_id`, `produto_id`), (`software_id`, `nivel`).
- Em `pedido_item`, `preco_unitario` depende do par pedido+produto (o preço **naquela venda**), não só do produto. Por isso ele fica em `pedido_item` e não em `produto`.
- `carrinho_item` **não** guarda preço: o preço do carrinho sempre é o atual de `produto`.

**3FN: nenhum atributo não-chave depende de outro atributo não-chave**
- O nome do perfil saiu do usuário: `usuario.papel` virou `usuario.perfil_id` → `perfil.nome`.
- O nome da categoria não é repetido no produto, só `categoria_id`.
- O valor do kWh não é guardado na montagem: `montagem.uf` → `tarifa_energia.valor_kwh`. Se a tarifa mudar, todas as montagens recalculam o custo sozinhas.
- O consumo e o score não ficam em `montagem_item`: vêm de `especificacao_tecnica` através do `produto_id`.
- `subtotal` de `pedido_item` é uma **coluna gerada** (`quantidade × preco_unitario`). O banco calcula, e o valor nunca fica inconsistente.

### 5.1 Decisões importantes e redundâncias controladas

| Decisão | Justificativa |
|---|---|
| **`especificacao_tecnica` em uma tabela só**, com colunas que aceitam NULL por tipo de peça | Definido no enunciado. Todos os atributos dependem só da PK, então a tabela está na 3FN; colunas NULL não ferem a normalização. A alternativa (uma subtabela por tipo de peça: `spec_cpu`, `spec_gpu`…) exigiria 9 JOINs para calcular uma montagem. A coerência por tipo (ex.: `potencia_fonte_w` só em fonte) é garantida com `CHECK`. |
| **`estoque` separado de `produto`** (1:1) | O saldo muda a cada venda; o cadastro do produto quase nunca. Separar evita travar a linha do produto (`FOR UPDATE`) e deixa o estoque mínimo no lugar certo. |
| **`estoque.quantidade` guardado**, mesmo sendo a soma das movimentações | Redundância controlada para desempenho e para o `CHECK (quantidade >= 0)`, que impede vender sem estoque. A trigger atualiza o saldo e grava a movimentação na mesma transação, então os dois nunca divergem. |
| **`pedido.status` guardado**, mesmo existindo o histórico | O status atual é filtrado o tempo todo (painéis de estoque e logística). Buscar "o último registro do histórico" em cada consulta seria lento. A API atualiza os dois na mesma transação. |
| **`pedido.valor_total` guardado** | É o valor **fechado** da venda (itens + frete) no momento da compra, usado por pagamento, relatórios e views. Não pode mudar se o frete ou o produto mudarem depois. |
| **Endereço copiado em `entrega`** além de `endereco_id` | O pedido precisa mostrar o endereço **para onde foi entregue**, mesmo que o cliente edite ou apague o endereço depois. `endereco_id` só indica a origem (fica NULL se o endereço for apagado). |
| **`cidade` e `uf` junto do `cep`** em `endereco` | A rigor, CEP → cidade/UF seria dependência transitiva. Mantivemos porque não existe uma tabela oficial de CEPs no sistema, há CEPs únicos para cidades inteiras e os dados migrados não têm CEP. |
| **`perfil` como tabela** e **status como ENUM** | Perfis podem crescer (ex.: "suporte") e carregam nome e descrição. Os status de pedido são fixos, controlados por regra de transição e usados pela trigger de estoque; uma tabela só acrescentaria JOINs. |
| **Cliente separado de usuário** | Hoje o cliente compra sem senha, só com telefone e e-mail. Para não quebrar isso, `cliente.usuario_id` é opcional: a conta é um extra, necessária só para salvar montagens no servidor. |
| **`montagem.uf` como FK para `tarifa_energia.uf`** | Garante que só se escolhe uma UF que tenha tarifa cadastrada, sem precisar de outra tabela de UFs. |
| **`entrega` existe também para retirada** (`modalidade`) | Um único lugar para frete, entregador e datas. Isso permite, na Etapa 3, concluir pedidos de retirada (hoje eles travam em "Pronto"). |
| **`recomendacao` substitui `produto_relacionado`** | Mesma tabela associativa, mas com `tipo` e `peso`. O "comprados juntos" continua sendo uma **view** (`vw_comprados_juntos`), porque é derivado dos pedidos. |

## 6. Regras de integridade referencial

| FK | ON DELETE | Motivo |
|---|---|---|
| usuario.perfil_id | RESTRICT | Não se apaga um perfil em uso. |
| cliente.usuario_id | SET NULL | Apagar a conta não apaga o cliente nem as compras dele. |
| endereco.cliente_id | CASCADE | O endereço não existe sem o cliente. |
| produto.categoria_id | RESTRICT | É preciso mover os produtos antes de apagar a categoria. |
| estoque / especificacao_tecnica / recomendacao → produto | CASCADE | São extensões do produto. |
| movimentacao_estoque.produto_id | CASCADE | Um produto só pode ser apagado se nunca foi vendido. Sem venda, o histórico dele não tem valor. |
| movimentacao_estoque.pedido_id | RESTRICT | Preserva a auditoria. |
| movimentacao_estoque.usuario_id | SET NULL | Preserva a auditoria. |
| carrinho.cliente_id, carrinho_item.* | CASCADE | Dados temporários. |
| pedido.cliente_id | RESTRICT | Quem tem pedido não pode ser apagado. |
| pedido.carrinho_id, pedido.montagem_id | SET NULL | O pedido continua válido. |
| pedido_item.produto_id | RESTRICT | Produto já vendido não pode ser apagado; deve ser **desativado** (regra que já existe). |
| pedido_item / pedido_status_historico / pagamento / entrega → pedido | CASCADE | Partes do pedido. |
| entrega.entregador_id, entrega.endereco_id, historico.usuario_id | SET NULL | O histórico permanece. |
| montagem.cliente_id | CASCADE | Montagens são do cliente. |
| montagem_item.montagem_id | CASCADE | Item da montagem. |
| montagem_item.produto_id | RESTRICT | Protege as montagens de exemplo; o produto deve ser desativado. |
| montagem.uf | RESTRICT | Não se apaga uma tarifa em uso. |
| requisito.software_id | CASCADE | Requisito não existe sem software. |

Todas as FKs usam `ON UPDATE CASCADE`. As PKs são AUTO_INCREMENT e não mudam, mas, se alguém alterar uma, as referências acompanham.
