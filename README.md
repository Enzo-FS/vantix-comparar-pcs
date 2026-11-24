# VANTIX Tech Store — Angular 17 + Java (Spring Boot) + MySQL

Loja virtual de tecnologia (hardware, periféricos, notebooks, smartphones e games),
derivada do projeto acadêmico **Maka Delivery**. O design system e a arquitetura
foram mantidos; mudaram a paleta (azul + navy + off-white), a tipografia e o domínio.

## Novidades: Monte seu PC

Três inovações, com regras em **[docs/regras-inovacoes.md](docs/regras-inovacoes.md)**:

1. **Custo de energia** da montagem: consumo em W (em uso e em carga máxima), custo em R$ por mês e por ano pela tarifa da UF, e selo da fonte (verde, amarelo ou vermelho).
2. **Comparar PCs**: barras por métrica, diferença percentual e um resumo automático.
3. **"Roda ou não?"**: diz se um jogo ou programa roda na montagem, em qual nível e com qual FPS, mostra a peça que limita e sugere produtos para trocar.

Onde aparecem:
- menu **Monte seu PC** (abas Montar, Comparar e Roda ou não?);
- etapa nova **Verificação do PC** entre o carrinho e o checkout, obrigatória quando o carrinho tem hardware;
- bloco técnico na página de cada peça de hardware;
- cadastros no painel do gerente.

Banco: **[docs/MER.md](docs/MER.md)**, **[docs/DER.md](docs/DER.md)**, `database/schema.sql` e `database/seed.sql`.

## Como rodar

```bash
npm install
```

| Modo | Comando | Precisa de |
|---|---|---|
| **Completo** (Angular + API Java + MySQL) | `npm start` → http://localhost:4200 | MySQL com `schema.sql` + `seed.sql` e a API rodando (`mvn spring-boot:run`) |
| **Só o front** (back-end falso no navegador) | `npm run start:mock` → http://localhost:4300 | nada além do Node |

O passo a passo do MySQL (variáveis de ambiente, scripts e onde hospedar, já que o Netlify não roda MySQL) está em **[docs/CONFIGURAR_MYSQL.md](docs/CONFIGURAR_MYSQL.md)**.

- O formato de cada rota está em **[docs/API_CONTRATO.md](docs/API_CONTRATO.md)**.
- No modo mock, os dados ficam salvos no navegador. Para zerar, rode `vantixMockReset()` no console (F12).
- Para ver as mensagens de erro (RNF10), simule a API fora do ar com `vantixMockOffline(true)` no console e volte com `vantixMockOffline(false)`.
- Se os dados mudarem, gere de novo com `node scripts/gerar-seed.mjs` (atualiza o `seed.sql` e os dados do Monte seu PC no mock). Se o `02_dados.sql` mudar, rode também `node scripts/sql-to-mock.mjs`.

## Testes

| Comando | O que testa |
|---|---|
| `mvn test` | Regras das inovações em Java (JUnit, 19 testes) |
| `npm run test:regras` | As mesmas regras em TypeScript (12 testes, executor nativo do Node 22.18+) |
| `npm run test:api` | API + MySQL de ponta a ponta (73 verificações). Use um banco recém-criado. |

## Credenciais de acesso (demo)

| Portal    | E-mail              | Senha     |
|-----------|---------------------|-----------|
| Gerente   | gerente@vantix.com   | vantix2024 |
| Estoque   | estoque@vantix.com   | vantix2024 |
| Logística | logistica@vantix.com | vantix2024 |
| Cliente com conta | ana.beatriz.souza@email.com | vantix2024 |

> Esses logins vêm do `database/seed.sql` (senha gravada com BCrypt). A conta de cliente serve para salvar montagens do Monte seu PC na conta; quem não entra salva só no navegador.

### Cliente (sem senha)

O cliente não tem login: ele se identifica pelo **telefone usado nas compras** (botão "Identificar-se" no topo da loja).
Com isso o site mostra "Olá, Nome", preenche o checkout e exibe **"Recomendado para você"** na home e em Meus pedidos,
com base no que ele já comprou. Para testar, use o telefone de uma cliente do banco: `(11) 96487-6234`.

## Rotas principais

| Rota                   | Descrição                          |
|------------------------|------------------------------------|
| /                      | Home                               |
| /produtos              | Catálogo com busca e categorias    |
| /produtos/:id          | Detalhes do produto + recomendações |
| /carrinho              | Carrinho                           |
| /verificacao           | Verificação do PC (só com hardware no carrinho) |
| /checkout              | Finalizar pedido                   |
| /monte-seu-pc/montar   | Monte seu PC: slots, resumo e custo de energia |
| /monte-seu-pc/comparar | Comparar dois PCs                  |
| /monte-seu-pc/roda     | "Roda ou não?"                     |
| /meus-pedidos          | Acompanhar pedidos                 |
| /portais               | Seleção de portais internos        |
| /login/manager         | Login gerente                      |
| /login/kitchen         | Login estoque                      |
| /login/delivery        | Login logística                    |
| /gerente/insights      | Relatórios                         |
| /gerente/pedidos       | Gestão de pedidos                  |
| /gerente/produtos      | Cadastro de produtos               |
| /gerente/controle-estoque | Controle de estoque (visão do gerente) |
| /gerente/estoque       | Separação (visão do gerente)       |
| /gerente/entregas      | Entregas (visão do gerente)        |
| /gerente/funcionarios  | Equipe                             |
| /gerente/monte-seu-pc  | Especificações, tarifas, jogos e requisitos |
| /estoque/controle      | Controle de estoque: saldo, entradas, ajustes e movimentações (tela inicial do Portal do Estoque) |
| /estoque/painel        | Kanban de separação de pedidos     |
| /logistica/painel      | Painel da logística                |

## Onde mudar as coisas

| O quê                          | Arquivo                                              |
|--------------------------------|------------------------------------------------------|
| Paleta, fontes, sombras        | `src/styles.scss` (bloco `:root` e `.light-mode`)    |
| Catálogo, clientes e pedidos   | `scripts/gerar-seed.mjs` → `database/seed.sql` (MySQL) |
| Peças, tarifas, jogos (Monte seu PC) | `scripts/gerar-seed.mjs` ou painel do gerente (`/gerente/monte-seu-pc`) |
| Fórmulas de energia, compatibilidade, "Roda ou não?" | `src/main/java/com/vantix/api/pc/RegrasPc.java` e `src/app/core/pc/regras.ts` (mudar nos dois e rodar os testes) |
| Chamadas à API                 | `src/app/services/*.service.ts` e `src/app/core/api/`  |
| Frete e frete grátis           | `src/app/services/cart.service.ts` (`SHIPPING_FEE`, `FREE_SHIPPING_MIN`) |
| Máximo de parcelas             | `MAX_INSTALLMENTS` em `pages/menu` e `pages/checkout` |
| Rótulos dos status do pedido   | `src/app/models/index.ts` (`STATUS_CONFIG`) e `pages/my-orders` |
| Nome da loja                   | busque por `VANTIX` no projeto                        |

### Paleta

| Token          | Hex       | Uso                                  |
|----------------|-----------|--------------------------------------|
| `--brand-600`  | `#1D5BD6` | Botões, links, preços, destaques     |
| `--brand-400`  | `#5F8FF7` | Acento sobre fundos escuros          |
| `--navy`       | `#0B1B3F` | Header, footer, seções escuras       |
| `--bg-base` (portais) | `#070D1C` | Fundo dos portais internos    |
| `--offwhite`   | `#F7F5F0` | Fundo das páginas do cliente         |
| `--warning`    | `#F59E0B` | Status "Em separação" (não é marca)  |

Tipografia: **Sora** (títulos) + **Inter** (texto). Para voltar à serifada original,
troque `--font-display` em `src/styles.scss`.

## Observações técnicas

- Os nomes internos (`MenuService`, `MenuItem`, papéis `kitchen`/`delivery`) foram
  mantidos para não reescrever a base; só o que o usuário vê foi renomeado.
- Imagens de produto usam a diretiva `appImgFallback`: se a URL falhar, aparece um placeholder.
- O build de produção baixa a fonte do Google Fonts para embuti-la no CSS — precisa de internet.
- `database/01_estrutura.sql` e `02_dados.sql` são o modelo **anterior** (banco `vantix_db`). Ficam como origem da migração; a API usa o banco `vantix` (`schema.sql` + `seed.sql`).
