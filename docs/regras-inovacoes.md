# Regras das inovações · Monte seu PC

> Este documento é a especificação das três inovações: **custo de energia**, **comparação de PCs** e **"Roda ou não?"**.
> As mesmas regras aparecem em dois lugares:
> - na view MySQL `vw_consumo_montagem` (`database/schema.sql`), que calcula consumo, custo e selo da fonte;
> - nas funções de cálculo da API (Etapa 3), que fazem todas as regras e têm testes.
>
> Os números dos exemplos vêm das montagens de exemplo do `seed.sql`. **Todos os valores são fictícios.**

## 1. Dados de entrada

Cada peça de hardware tem uma linha em `especificacao_tecnica`:

| Campo | Usado em |
|---|---|
| `consumo_watts` | Consumo da montagem (a fonte entra com 0 W, porque ela não consome: ela converte energia) |
| `score_desempenho` (0 a 100) | Desempenho de CPU e GPU ("Roda ou não?" e comparação) |
| `soquete` | Compatibilidade CPU × placa-mãe × cooler |
| `tipo_memoria` | Compatibilidade RAM × placa-mãe × CPU |
| `formato` | Compatibilidade placa-mãe × gabinete |
| `vram_gb`, `capacidade_gb` | "Roda ou não?" |
| `potencia_fonte_w`, `eficiencia_fonte` | Selo da fonte e consumo na tomada |

**Faixas usadas no seed:**

| Peça | Consumo |
|---|---|
| CPU | 35 a 170 W |
| GPU | 75 a 450 W (sem GPU dedicada, o vídeo integrado soma 0 W extra) |
| Placa-mãe | 25 a 80 W |
| RAM | 3 a 5 W por módulo (o produto é um kit: 2 módulos de 5 W = 10 W) |
| SSD | 3 a 8 W |
| HDD | 6 a 9 W |
| Cooler e fans (inclusive as do gabinete) | 2 a 15 W |

Eficiência da fonte: 0,80 (White), 0,85 (Bronze) ou 0,90 (Gold).

Tarifa: uma por UF em `tarifa_energia`, entre R$ 0,72 e R$ 1,10 por kWh.

## 2. Inovação 1: consumo e custo de energia

| Grandeza | Fórmula |
|---|---|
| Soma das peças (W) | Σ `consumo_watts × quantidade`, sem contar a fonte |
| **Consumo em uso** (W) | soma × **0,7** |
| **Consumo em carga máxima** (W) | soma × **1,0** |
| **Consumo na tomada** (W) | consumo ÷ eficiência da fonte. Sem fonte na montagem, usa-se **0,80** (o pior caso). |
| **Custo mensal** (R$) | (W na tomada **em uso** ÷ 1000) × horas por dia × 30 × valor do kWh da UF |
| **Custo anual** (R$) | custo mensal × 12 |

- O custo usa o consumo **em uso**, porque o PC não fica o tempo todo em carga máxima.
- Os cálculos usam os valores sem arredondamento. Só o resultado final é arredondado: W com 1 casa decimal, R$ com 2. Por isso o custo anual pode diferir em alguns centavos de "mensal arredondado × 12".
- Valores padrão da tela: **UF = SP** e **4 horas por dia**. O slider vai de 1 a 24 h, e o banco aceita de 1 a 24 (`ck_montagem_horas`).

### 2.1 Selo da fonte

Compara a potência da fonte com a **carga máxima** (soma × 1,0):

| Selo | Condição | Mensagem |
|---|---|---|
| 🔴 **Vermelho** | potência **<** carga máxima | "A fonte de X W não aguenta a carga máxima de Y W." |
| 🟡 **Amarelo** | potência < carga × 1,2 (folga **menor que 20%**) | "Fonte no limite: folga de Z%. Recomendado: pelo menos ⌈carga × 1,2⌉ W." |
| 🟢 **Verde** | potência ≥ carga × 1,2 (folga **de 20% ou mais**) | "Fonte com folga de Z%." |
| 🔴 **Sem fonte** | nenhuma fonte na montagem | "Sua montagem não tem fonte." |

A folga é calculada assim: **folga = (potência − carga máxima) ÷ carga máxima**.

### 2.2 Exemplo: PC Básico (SP, R$ 0,82/kWh, 4 h/dia, fonte 500 W White)

| Peça | W |
|---|---|
| Core i3-12100 | 60 |
| Placa B760M | 35 |
| DDR4 16GB (2×8) | 6 |
| GTX 1650 | 75 |
| SSD SATA 480GB | 3 |
| Cooler Box | 4 |
| Gabinete com 3 fans | 6 |
| Fonte 500 W | 0 |
| **Soma** | **189** |

- Consumo em uso: 189 × 0,7 = **132,3 W**. Em carga máxima: **189 W**.
- Na tomada, em uso: 132,3 ÷ 0,80 = **165,4 W**.
- Custo mensal: 0,165375 × 4 × 30 × 0,82 = **R$ 16,27**. Custo anual: **R$ 195,27**.
- Selo: 500 ≥ 189 × 1,2 = 226,8, então **verde**, com folga de 164,6%.

**Resultados das montagens de exemplo** (saída real de `vw_consumo_montagem`):

| Montagem | Soma (W) | Uso (W) | Carga (W) | Fonte | Tomada em uso (W) | R$/mês | R$/ano | Selo |
|---|---|---|---|---|---|---|---|---|
| PC Básico (4 h) | 189 | 132,3 | 189 | 500 W White | 165,4 | 16,27 | 195,27 | verde |
| PC Intermediário (4 h) | 278 | 194,6 | 278 | 650 W Bronze | 228,9 | 22,53 | 270,33 | verde |
| PC Avançado (6 h) | 701 | 490,7 | 701 | 850 W Gold | 545,2 | 80,47 | 965,70 | verde (folga 21,3%) |

## 3. Compatibilidade

Cada regra resulta em ✔ (ok), ✖ vermelho (incompatível) ou ⚠ amarelo (aviso). Uma regra só é avaliada quando as duas peças envolvidas estão na montagem.

| # | Regra | Nível | Exemplo de mensagem |
|---|---|---|---|
| C1 | **Soquete da CPU = soquete da placa-mãe** | ✖ vermelho | "Soquete AM4 não é compatível com a placa AM5." |
| C2 | **Tipo de memória da RAM = tipo da placa-mãe** | ✖ vermelho | "Memória DDR5 não é compatível com a placa DDR4." |
| C3 | Tipo de memória da CPU = tipo da placa-mãe (quando a CPU define um tipo; Intel LGA1700 aceita os dois) | ✖ vermelho | "O Ryzen 5 5600 (AM4) só usa DDR4." |
| C4 | **Formato da placa cabe no gabinete**: gabinete ATX aceita ATX, mATX e ITX; mATX aceita mATX e ITX; ITX aceita só ITX | ✖ vermelho | "Placa ATX não cabe no gabinete mATX." |
| C5 | No máximo 1 CPU, 1 placa-mãe, 1 fonte e 1 gabinete | ✖ vermelho | "A montagem tem 2 fontes." |
| C6 | O soquete da CPU aparece na lista do cooler (ex.: `AM4/AM5/LGA1700`) | ⚠ amarelo | "O cooler não lista suporte ao soquete AM4." |
| C7 | Sem GPU dedicada: usa o vídeo integrado | ⚠ amarelo | "Sem placa de vídeo: usando o vídeo integrado do processador." |
| C8 | Fonte com selo vermelho ou amarelo (seção 2.1) | ✖ ou ⚠ | — |

**Peças essenciais.** A falta de qualquer uma destas gera aviso e sugestão de produtos:
- Obrigatórias, com aviso vermelho: **CPU, placa-mãe, RAM, armazenamento (SSD ou HDD), fonte e gabinete**. Exemplo: "Sua montagem não tem fonte."
- Opcionais, com aviso amarelo: **cooler** ("Sem cooler: confira se o processador acompanha cooler box") e **GPU** (regra C7).

**Botões de compra:**
- Com **qualquer item vermelho**, o botão "Adicionar tudo ao carrinho" do Monte seu PC fica desabilitado.
- Na Verificação do PC, aparece o aviso e o botão muda para **"Continuar mesmo assim"**.

## 4. Inovação 3: "Roda ou não?"

### 4.1 Valores da montagem

| Valor | Como se obtém |
|---|---|
| Score de CPU | `score_desempenho` da CPU (0 se não houver) |
| Score de GPU | `score_desempenho` da GPU. Sem GPU dedicada: **8** (vídeo integrado) |
| RAM (GB) | Σ `capacidade_gb × quantidade` das memórias |
| VRAM (GB) | `vram_gb` da GPU. Sem GPU dedicada: **0** |
| Armazenamento (GB) | Σ `capacidade_gb × quantidade` de SSDs e HDDs |

### 4.2 Resultado

Um nível é **atendido** quando a montagem cumpre **todos os 5 critérios** dele:

- score de CPU ≥ `score_cpu_min`
- score de GPU ≥ `score_gpu_min`
- RAM ≥ `ram_min_gb`
- VRAM ≥ `vram_min_gb`
- armazenamento ≥ `armazenamento_gb`

O resultado é o **maior nível atendido**, na ordem **Não roda < Mínimo < Recomendado < Ultra**. Os níveis são avaliados de forma independente; na prática, os requisitos crescem de um nível para o outro.

- **FPS estimado:** o `fps_estimado` do nível atingido, apenas para jogos. Programas e o resultado "Não roda" não mostram FPS.
- **Tabela ✔/✖:** para cada nível, mostra os 5 critérios com o valor exigido, o valor da montagem e ✔ ou ✖.

### 4.3 Peça que limita e sugestões

Se o resultado não for Ultra, olha-se o **próximo nível**, aquele logo acima do resultado:

1. Para cada critério reprovado nesse nível, calcula-se o déficit relativo: (exigido − montagem) ÷ exigido.
2. A **peça que limita** é a do critério com o **maior déficit**:
   - CPU → processador
   - GPU ou VRAM → placa de vídeo
   - RAM → memória
   - armazenamento → SSD/HDD
3. Para essa peça, sugerem-se **até 3 produtos** do catálogo que:
   - estão disponíveis e com estoque maior que zero;
   - sozinhos resolvem aquele critério;
   - são compatíveis com o restante da montagem (soquete e tipo de memória).

   A ordem é do **menor preço** para o maior. O botão "Trocar peça" substitui a peça na montagem.

**Exemplo: PC Básico × EA SPORTS FC 26**
- O nível mínimo exige GPU 30, e o PC Básico tem GPU 25. O resultado é **Não roda**.
- A peça que limita é a **placa de vídeo**: déficit de (30 − 25) ÷ 30 = 16,7%.
- As sugestões são GPUs com score ≥ 30 e VRAM ≥ 4 GB, da mais barata para a mais cara: Radeon RX 6600 (R$ 1.299,90), GeForce RTX 4060 (R$ 1.899,90) e Radeon RX 7800 XT (R$ 3.699,90).

### 4.4 Resultados com o seed

| Software | PC Básico | PC Intermediário | PC Avançado |
|---|---|---|---|
| Counter-Strike 2 | Mínimo | Ultra | Ultra |
| Valorant | Recomendado | Ultra | Ultra |
| Fortnite | Mínimo | Recomendado | Ultra |
| League of Legends | Recomendado | Ultra | Ultra |
| Minecraft | Recomendado | Recomendado | Ultra |
| GTA V | Mínimo | Recomendado | Ultra |
| EA SPORTS FC 26 | Não roda | Recomendado | Ultra |
| Call of Duty: Warzone | Não roda | Recomendado | Ultra |
| Cyberpunk 2077 | Não roda | Mínimo | Ultra |
| Hogwarts Legacy | Não roda | Mínimo | Ultra |
| Adobe Premiere Pro | Não roda | Recomendado | Ultra |
| Blender | Mínimo | Recomendado | Ultra |

A montagem "Upgrade do meu PC (rascunho)", da cliente de exemplo, não roda nada porque **não tem armazenamento**. Ela também tem soquete incompatível (CPU AM4 em placa AM5). Isso foi feito de propósito, para testar os avisos.

Os **3 jogos mais populares** (por `software.popularidade`), mostrados na Verificação do PC, são Counter-Strike 2, Valorant e Fortnite.

## 5. Inovação 2: comparação entre dois PCs

**Score total = arredondar(0,4 × score de CPU + 0,6 × score de GPU).** A GPU pesa mais porque é ela que mais limita jogos.

Para cada métrica, a **diferença percentual de B em relação a A** é:

**diferença % = (B − A) ÷ A × 100.** Se A = 0, mostra-se "—".

| Métrica | Melhor valor (destaque verde) |
|---|---|
| Score de CPU, de GPU e total | maior |
| Consumo (carga máxima, W) | menor |
| Custo mensal (R$) | menor |
| Preço (R$) | menor |

Para comparar o custo de forma justa, as duas montagens usam a **mesma UF e as mesmas horas por dia**: os valores escolhidos na tela, com padrão SP e 4 h.

**Texto de resumo automático.** O texto fala sempre do PC **mais rápido** e compara com o outro:
- "O {mais rápido} é **X% mais rápido**, mas custa **R$ Y a mais por mês** de energia." X é a diferença do score total em relação ao mais lento e Y é a diferença do custo mensal.
- Se o mais rápido também gastar menos: "O {mais rápido} é X% mais rápido e ainda economiza R$ Y por mês de energia."
- Se os scores totais forem iguais: "Os dois têm o mesmo desempenho; o {B} custa R$ Y a mais (ou a menos) por mês de energia."

**Exemplo: PC Básico (A) × PC Intermediário (B), SP, 4 h/dia**

| Métrica | A | B | Diferença |
|---|---|---|---|
| Score de CPU | 38 | 68 | +78,9% |
| Score de GPU | 25 | 55 | +120,0% |
| Score total | 30 | 60 | +100,0% |
| Consumo em carga (W) | 189 | 278 | +47,1% |
| Custo mensal (R$) | 16,27 | 22,53 | +38,5% |
| Preço (R$) | 3.519,20 | 6.829,20 | +94,1% |

> "O PC Intermediário é 100% mais rápido, mas custa R$ 6,26 a mais por mês de energia."

## 6. Verificação do PC (etapa antes do checkout)

1. Ela aparece quando o carrinho tem pelo menos um produto com `especificacao_tecnica`, ou seja, uma peça de hardware.
2. Uma **montagem temporária** é criada com essas peças e suas quantidades. Nela são aplicadas as seções 2, 3 e 4, esta última com os 3 jogos mais populares.
3. Quando o pedido é finalizado, a montagem é gravada (`montagem`, com `cliente_id` do comprador) e ligada ao pedido por `pedido.montagem_id`.

## 7. Limitações conhecidas (simplificações acadêmicas)

- **Scores 0 a 100:** são fictícios e servem como uma escala única. Não representam benchmarks reais.
- **Vídeo integrado:** o modelo não guarda se a CPU tem vídeo integrado. Toda montagem sem GPU dedicada recebe score de GPU 8, inclusive CPUs da série "F", que na prática não têm vídeo.
- **Consumo:** fatores fixos de uso (70%) e carga (100%). Não consideram perfil de uso, overclock nem consumo em repouso.
- **Tarifa:** um único valor por UF, sem bandeira tarifária nem impostos separados.
- **Compatibilidade:** não verifica o tamanho da placa de vídeo no gabinete, a altura do cooler, a quantidade de slots M.2/SATA nem os conectores da fonte.
- **PC montado:** o produto "PC Gamer Ryzen 7 · RTX 4070 · 32GB" é um computador pronto, não uma peça, então não tem especificação técnica. Uma alternativa seria cadastrá-lo também como montagem.
