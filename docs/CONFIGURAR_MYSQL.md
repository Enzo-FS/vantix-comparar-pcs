# Como configurar o MySQL e publicar o projeto

O projeto tem três partes:

| Parte | Tecnologia | Onde roda |
|---|---|---|
| Front-end | Angular 17 | Netlify (site estático) ou `npm start` |
| API | Spring Boot 3 / Java 17 | um servidor Java (local ou na nuvem) |
| Banco | MySQL 8 | um servidor MySQL (local, Docker ou na nuvem) |

> **O Netlify só hospeda arquivos estáticos (HTML, JS e CSS).** Ele não roda Java nem MySQL.
> Por isso a API e o banco precisam ficar em outro serviço, e o site do Netlify chama a API pela internet.

---

## 1. Criar o banco

### Opção A: MySQL instalado no computador

```bash
mysql -u root -p < database/schema.sql   # cria o banco "vantix" (APAGA o anterior, se existir)
mysql -u root -p < database/seed.sql     # dados fictícios; no fim mostra a contagem e o consumo das montagens
```

No **MySQL Workbench**: *File → Open SQL Script*, abra o `schema.sql` e execute com o raio. Depois faça o mesmo com o `seed.sql`.

### Opção B: Docker (sem instalar o MySQL)

```bash
docker run -d --name vantix-mysql -e MYSQL_ROOT_PASSWORD=root -p 3306:3306 mysql:8.4 --character-set-server=utf8mb4
# espere uns 20 s e rode:
docker exec -i vantix-mysql mysql -uroot -proot --default-character-set=utf8mb4 < database/schema.sql
docker exec -i vantix-mysql mysql -uroot -proot --default-character-set=utf8mb4 < database/seed.sql
```

### Conferir

```sql
USE vantix;
SELECT COUNT(*) FROM produto;          -- 91
SELECT * FROM vw_consumo_montagem;     -- PC Básico: 189 W, R$ 16,27/mês ...
```

---

## 2. Variáveis de ambiente da API

A API lê a configuração de `src/main/resources/application.properties`. Cada valor pode ser trocado por uma variável de ambiente, sem mexer no código:

| Variável | Para quê | Padrão (desenvolvimento) |
|---|---|---|
| `DB_URL` | Endereço JDBC do MySQL | `jdbc:mysql://localhost:3306/vantix?useSSL=false&allowPublicKeyRetrieval=true&connectionTimeZone=-03:00&forceConnectionTimeZoneToSession=true` |
| `DB_USER` | Usuário do MySQL | `root` |
| `DB_PASSWORD` | Senha do MySQL | `root` |
| `JWT_SECRET` | Chave dos tokens de login (mínimo de 32 caracteres) | uma chave de desenvolvimento. **Troque em produção.** |
| `CORS_ORIGEM` | Endereço(s) do site que pode chamar a API, separados por vírgula | `http://localhost:4200` |
| `PORT` | Porta HTTP da API | `8080` |

> Mantenha `connectionTimeZone=-03:00&forceConnectionTimeZoneToSession=true` na `DB_URL`: as datas são `DATETIME`
> e, sem isso, pedidos e movimentações ficariam com o horário do servidor (normalmente UTC, 3 horas adiantado).

### Rodar a API localmente

```bash
# Windows (PowerShell)
$env:DB_PASSWORD = "sua_senha"; mvn spring-boot:run

# Linux / macOS / Git Bash
DB_PASSWORD=sua_senha mvn spring-boot:run
```

Sem o Maven instalado, use o da IDE (IntelliJ/Eclipse: rodar `VantixApiApplication`) ou gere o `.jar` e rode com `java -jar target/api-1.0.0.jar`.

### Testar a API

Com o banco **recém-criado** e a API no ar:

```bash
npm run test:api     # 73 verificações: login, perfis, pedidos, relatórios e Monte seu PC
```

O teste cria pedidos e montagens. Rode-o em um banco de teste e recrie o banco depois.

---

## 3. Ligar o front na API

| Arquivo | `useMock` | `apiUrl` | Quando usar |
|---|---|---|---|
| `src/environments/environment.ts` | `false` | `http://localhost:8080/api` | `npm start`, com a API local |
| `src/environments/environment.prod.ts` | `false` | **endereço público da API** | `npm run build`, para publicar com API |
| `src/environments/environment.mock.ts` | `true` | (não usa) | `npm run start:mock` ou `npm run build:mock`, sem Java nem MySQL |

O modo **mock** usa um back-end falso dentro do navegador, com os mesmos dados do `seed.sql` e as mesmas regras. Serve para demonstrar o site no Netlify sem servidor.

---

## 4. Onde hospedar (sugestões)

Qualquer serviço que rode **MySQL 8** e **Java 17** serve. Opções conhecidas, que costumam ter plano gratuito ou de estudante (confira as condições atuais no site de cada um):

| O quê | Opções |
|---|---|
| **Banco MySQL** | Railway (MySQL), Aiven for MySQL, TiDB Cloud Serverless (compatível com MySQL), Clever Cloud (MySQL) |
| **API Java** | Render, Railway, Fly.io, Koyeb (via Docker ou build Maven) |
| **Front** | Netlify (atual) ou Vercel |

### Passo a passo (exemplo genérico)

1. **Banco:** crie uma instância MySQL 8 no serviço escolhido. Anote o host, a porta, o usuário e a senha.
2. **Carregue os scripts** pelo terminal: `mysql -h HOST -P PORTA -u USUARIO -p < database/schema.sql`, e depois o `seed.sql`.
   - Alguns serviços não deixam criar o banco com `CREATE DATABASE`. Nesse caso, crie um banco chamado `vantix` pelo painel e apague as linhas `DROP DATABASE`, `CREATE DATABASE` e `USE` do começo do `schema.sql`.
   - Se o serviço exige conexão segura, use `?sslMode=REQUIRED` na `DB_URL`.
3. **API:** publique o projeto Maven (comando de build `mvn -DskipTests package`, comando de start `java -jar target/api-1.0.0.jar`) e configure as variáveis:
   ```
   DB_URL=jdbc:mysql://HOST:PORTA/vantix?sslMode=REQUIRED&connectionTimeZone=-03:00&forceConnectionTimeZoneToSession=true
   DB_USER=...            DB_PASSWORD=...
   JWT_SECRET=uma-frase-longa-e-secreta-com-mais-de-32-caracteres
   CORS_ORIGEM=https://vantixtechstore.netlify.app
   ```
4. **Front:** em `src/environments/environment.prod.ts`, troque `apiUrl` pelo endereço público da API (ex.: `https://vantix-api.onrender.com/api`). Rode `npm run build` e publique a pasta `dist/vantix-store/browser` no Netlify.
5. Abra o site, entre como `gerente@vantix.com` / `vantix2024` e confira os painéis.

> Para publicar **sem** API (só demonstração), use `npm run build:mock` e publique a mesma pasta.
> Nesse modo, os dados ficam no navegador de cada visitante.

### Rotas do Angular no Netlify

O arquivo `src/_redirects` (já incluído no build) manda o Netlify devolver o `index.html` em qualquer rota.
Assim um F5 em `/monte-seu-pc/comparar` não dá erro 404.
