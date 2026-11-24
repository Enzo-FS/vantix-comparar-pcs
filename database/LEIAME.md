# Banco de dados · Vantix Tech Store (MySQL 8)

| Arquivo | O que é |
|---|---|
| `schema.sql` | **Modelo novo.** Cria o banco `vantix`: 22 tabelas, triggers e views (inclusive `vw_consumo_montagem`). |
| `seed.sql` | **Dados fictícios** do modelo novo: tudo o que estava em `02_dados.sql`, migrado, mais as peças, especificações, tarifas, jogos/programas e montagens das inovações. |
| `01_estrutura.sql`, `02_dados.sql` | Modelo **anterior** (banco `vantix_db`). Ficam até a API Java ser adaptada ao modelo novo, e o `02_dados.sql` é a fonte da migração. |

## Como rodar

```bash
mysql -u root -p < database/schema.sql   # ATENÇÃO: apaga e recria o banco "vantix"
mysql -u root -p < database/seed.sql     # no fim mostra a contagem e o consumo das montagens
```

Para rodar no MySQL Workbench: abra cada arquivo e execute com o raio (Ctrl+Shift+Enter), primeiro o `schema.sql` e depois o `seed.sql`.

## Regerar o seed

O `seed.sql` é gerado por um script. Se o `02_dados.sql` ou os dados das inovações mudarem, gere de novo:

```bash
node scripts/gerar-seed.mjs
```

## Logins de teste (senha de todos: `vantix2024`)

| Perfil | E-mail |
|---|---|
| Gerente | gerente@vantix.com |
| Estoque | estoque@vantix.com |
| Logística | logistica@vantix.com |
| Cliente com conta | ana.beatriz.souza@email.com |

Documentação: [docs/MER.md](../docs/MER.md), [docs/DER.md](../docs/DER.md), [docs/regras-inovacoes.md](../docs/regras-inovacoes.md).
