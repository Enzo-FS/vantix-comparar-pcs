-- =====================================================================
-- VANTIX TECH STORE - schema.sql (MySQL 8.0+)
-- Projeto Final ADS - UNASP
--
-- Cria o banco "vantix" com todas as tabelas, indices, triggers e views.
-- Rode este arquivo primeiro e depois o seed.sql:
--     mysql -u root -p < database/schema.sql
--     mysql -u root -p < database/seed.sql
--
-- ATENCAO: a linha DROP abaixo apaga o banco "vantix" se ele ja existir.
-- Modelo documentado em docs/MER.md e docs/DER.md.
-- Regras das inovacoes em docs/regras-inovacoes.md.
-- =====================================================================
DROP DATABASE IF EXISTS vantix;
CREATE DATABASE vantix DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE vantix;

SET NAMES utf8mb4;

-- =====================================================================
-- 1. ACESSO E PESSOAS
-- =====================================================================

-- Perfis de acesso: cliente, gerente, estoque, logistica
CREATE TABLE perfil (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo      VARCHAR(20)  NOT NULL,
    nome        VARCHAR(50)  NOT NULL,
    descricao   VARCHAR(255) NULL,
    CONSTRAINT uq_perfil_codigo UNIQUE (codigo)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Quem faz login (funcionarios e clientes com conta). Senha sempre em BCrypt.
CREATE TABLE usuario (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    perfil_id     INT UNSIGNED NOT NULL,
    nome          VARCHAR(100) NOT NULL,
    email         VARCHAR(100) NOT NULL,
    senha_hash    VARCHAR(255) NOT NULL,
    ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
    criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_usuario_email UNIQUE (email),
    INDEX idx_usuario_perfil (perfil_id),
    CONSTRAINT fk_usuario_perfil FOREIGN KEY (perfil_id) REFERENCES perfil (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Quem compra. Pode comprar sem conta (usuario_id NULL), identificado por e-mail/telefone.
CREATE TABLE cliente (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    usuario_id    INT UNSIGNED NULL,
    nome          VARCHAR(100) NOT NULL,
    email         VARCHAR(100) NOT NULL,
    telefone      VARCHAR(20)  NOT NULL,
    criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_cliente_email UNIQUE (email),
    CONSTRAINT uq_cliente_usuario UNIQUE (usuario_id),
    INDEX idx_cliente_telefone (telefone),
    CONSTRAINT fk_cliente_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE endereco (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id  INT UNSIGNED NOT NULL,
    apelido     VARCHAR(30)  NULL,
    cep         CHAR(8)      NULL,
    logradouro  VARCHAR(150) NOT NULL,
    numero      VARCHAR(10)  NOT NULL,
    complemento VARCHAR(60)  NULL,
    bairro      VARCHAR(80)  NOT NULL,
    cidade      VARCHAR(80)  NOT NULL,
    uf          CHAR(2)      NOT NULL,
    principal   BOOLEAN      NOT NULL DEFAULT FALSE,
    criado_em   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_endereco_cliente (cliente_id),
    INDEX idx_endereco_cep (cep),
    CONSTRAINT ck_endereco_cep CHECK (cep IS NULL OR cep REGEXP '^[0-9]{8}$'),
    CONSTRAINT fk_endereco_cliente FOREIGN KEY (cliente_id) REFERENCES cliente (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- =====================================================================
-- 2. CATALOGO E ESTOQUE
-- =====================================================================

CREATE TABLE categoria (
    id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome      VARCHAR(100) NOT NULL,
    descricao TEXT         NULL,
    criado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_categoria_nome UNIQUE (nome)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE produto (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    categoria_id  INT UNSIGNED  NOT NULL,
    nome          VARCHAR(150)  NOT NULL,
    descricao     TEXT          NULL,
    marca         VARCHAR(60)   NULL,
    preco         DECIMAL(10,2) NOT NULL,
    preco_antigo  DECIMAL(10,2) NULL,
    imagem_url    VARCHAR(255)  NULL,
    destaque      BOOLEAN       NOT NULL DEFAULT FALSE,
    disponivel    BOOLEAN       NOT NULL DEFAULT TRUE,
    criado_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT ck_produto_preco CHECK (preco > 0),
    CONSTRAINT ck_produto_preco_antigo CHECK (preco_antigo IS NULL OR preco_antigo > 0),
    INDEX idx_produto_categoria (categoria_id),
    INDEX idx_produto_nome (nome),
    INDEX idx_produto_marca (marca),
    INDEX idx_produto_vitrine (disponivel, destaque),
    FULLTEXT INDEX ft_produto_busca (nome, descricao, marca),
    CONSTRAINT fk_produto_categoria FOREIGN KEY (categoria_id) REFERENCES categoria (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Saldo atual (1:1 com produto). O CHECK impede vender sem estoque.
CREATE TABLE estoque (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    produto_id     INT UNSIGNED NOT NULL,
    quantidade     INT          NOT NULL DEFAULT 0,
    estoque_minimo INT          NOT NULL DEFAULT 10,
    atualizado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_estoque_produto UNIQUE (produto_id),
    CONSTRAINT ck_estoque_quantidade CHECK (quantidade >= 0),
    CONSTRAINT ck_estoque_minimo CHECK (estoque_minimo >= 0),
    CONSTRAINT fk_estoque_produto FOREIGN KEY (produto_id) REFERENCES produto (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- =====================================================================
-- 3. COMPRA (parte 1: carrinho; pedido vem depois da montagem por causa da FK)
-- =====================================================================

CREATE TABLE carrinho (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id    INT UNSIGNED NULL,
    token_sessao  VARCHAR(64)  NULL,
    status        ENUM('aberto', 'convertido', 'abandonado') NOT NULL DEFAULT 'aberto',
    criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_carrinho_token UNIQUE (token_sessao),
    INDEX idx_carrinho_cliente_status (cliente_id, status),
    CONSTRAINT fk_carrinho_cliente FOREIGN KEY (cliente_id) REFERENCES cliente (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Sem preco: o carrinho sempre usa o preco atual de produto (3FN).
CREATE TABLE carrinho_item (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    carrinho_id   INT UNSIGNED NOT NULL,
    produto_id    INT UNSIGNED NOT NULL,
    quantidade    INT          NOT NULL DEFAULT 1,
    adicionado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_carrinho_item UNIQUE (carrinho_id, produto_id),
    CONSTRAINT ck_carrinho_item_qtd CHECK (quantidade > 0),
    INDEX idx_carrinho_item_produto (produto_id),
    CONSTRAINT fk_carrinho_item_carrinho FOREIGN KEY (carrinho_id) REFERENCES carrinho (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_carrinho_item_produto FOREIGN KEY (produto_id) REFERENCES produto (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- =====================================================================
-- 4. INOVACOES: MONTAGEM DE PC
-- =====================================================================

-- Dados tecnicos das pecas de hardware (1:1 com produto).
-- Os CHECKs garantem que cada tipo de peca tenha os campos de que as regras precisam.
CREATE TABLE especificacao_tecnica (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    produto_id       INT UNSIGNED NOT NULL,
    tipo_peca        ENUM('cpu', 'gpu', 'placa_mae', 'ram', 'ssd', 'hdd', 'fonte', 'cooler', 'gabinete') NOT NULL,
    consumo_watts    INT          NOT NULL DEFAULT 0,
    score_desempenho TINYINT UNSIGNED NOT NULL DEFAULT 0,
    soquete          VARCHAR(20)  NULL,
    tipo_memoria     ENUM('DDR4', 'DDR5') NULL,
    formato          ENUM('ATX', 'mATX', 'ITX') NULL,
    vram_gb          INT          NULL,
    capacidade_gb    INT          NULL,
    potencia_fonte_w INT          NULL,
    eficiencia_fonte DECIMAL(3,2) NULL,
    CONSTRAINT uq_especificacao_produto UNIQUE (produto_id),
    CONSTRAINT ck_espec_consumo CHECK (consumo_watts BETWEEN 0 AND 600),
    CONSTRAINT ck_espec_score CHECK (score_desempenho BETWEEN 0 AND 100),
    CONSTRAINT ck_espec_soquete CHECK (tipo_peca NOT IN ('cpu', 'placa_mae') OR soquete IS NOT NULL),
    CONSTRAINT ck_espec_memoria CHECK (tipo_peca NOT IN ('placa_mae', 'ram') OR tipo_memoria IS NOT NULL),
    CONSTRAINT ck_espec_formato CHECK (tipo_peca NOT IN ('placa_mae', 'gabinete') OR formato IS NOT NULL),
    -- IS NOT NULL explicito: em SQL, um CHECK que da NULL e considerado aprovado.
    CONSTRAINT ck_espec_vram CHECK (tipo_peca <> 'gpu' OR (vram_gb IS NOT NULL AND vram_gb > 0)),
    CONSTRAINT ck_espec_capacidade CHECK (tipo_peca NOT IN ('ram', 'ssd', 'hdd')
        OR (capacidade_gb IS NOT NULL AND capacidade_gb > 0)),
    CONSTRAINT ck_espec_fonte CHECK (tipo_peca <> 'fonte'
        OR (potencia_fonte_w IS NOT NULL AND potencia_fonte_w > 0
            AND eficiencia_fonte IS NOT NULL AND eficiencia_fonte BETWEEN 0.50 AND 1.00)),
    INDEX idx_espec_tipo (tipo_peca),
    INDEX idx_espec_soquete (soquete),
    CONSTRAINT fk_especificacao_produto FOREIGN KEY (produto_id) REFERENCES produto (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Uma tarifa por UF (valores ficticios).
CREATE TABLE tarifa_energia (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    uf            CHAR(2)      NOT NULL,
    distribuidora VARCHAR(100) NOT NULL,
    valor_kwh     DECIMAL(5,2) NOT NULL,
    atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_tarifa_uf UNIQUE (uf),
    CONSTRAINT ck_tarifa_valor CHECK (valor_kwh > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- PC montado: salvo pelo cliente, de exemplo (exemplo = TRUE) ou gerado na Verificacao do PC.
CREATE TABLE montagem (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cliente_id    INT UNSIGNED NULL,
    nome          VARCHAR(100) NOT NULL,
    horas_uso_dia DECIMAL(4,1) NOT NULL DEFAULT 4.0,
    uf            CHAR(2)      NOT NULL DEFAULT 'SP',
    exemplo       BOOLEAN      NOT NULL DEFAULT FALSE,
    criado_em     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_montagem_horas CHECK (horas_uso_dia BETWEEN 1 AND 24),
    INDEX idx_montagem_cliente (cliente_id),
    INDEX idx_montagem_uf (uf),
    INDEX idx_montagem_exemplo (exemplo),
    CONSTRAINT fk_montagem_cliente FOREIGN KEY (cliente_id) REFERENCES cliente (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_montagem_tarifa FOREIGN KEY (uf) REFERENCES tarifa_energia (uf)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE montagem_item (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    montagem_id INT UNSIGNED NOT NULL,
    produto_id  INT UNSIGNED NOT NULL,
    quantidade  INT          NOT NULL DEFAULT 1,
    CONSTRAINT uq_montagem_item UNIQUE (montagem_id, produto_id),
    CONSTRAINT ck_montagem_item_qtd CHECK (quantidade > 0),
    INDEX idx_montagem_item_produto (produto_id),
    CONSTRAINT fk_montagem_item_montagem FOREIGN KEY (montagem_id) REFERENCES montagem (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_montagem_item_produto FOREIGN KEY (produto_id) REFERENCES produto (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE software (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nome         VARCHAR(100) NOT NULL,
    tipo         ENUM('jogo', 'programa') NOT NULL,
    categoria    VARCHAR(50)  NOT NULL,
    imagem_url   VARCHAR(255) NULL,
    popularidade INT          NOT NULL DEFAULT 0,
    CONSTRAINT uq_software_nome UNIQUE (nome),
    INDEX idx_software_tipo (tipo),
    INDEX idx_software_popularidade (popularidade)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE requisito (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    software_id      INT UNSIGNED NOT NULL,
    nivel            ENUM('minimo', 'recomendado', 'ultra') NOT NULL,
    score_cpu_min    TINYINT UNSIGNED NOT NULL,
    score_gpu_min    TINYINT UNSIGNED NOT NULL,
    ram_min_gb       INT          NOT NULL,
    vram_min_gb      INT          NOT NULL DEFAULT 0,
    armazenamento_gb INT          NOT NULL,
    fps_estimado     INT          NULL,
    CONSTRAINT uq_requisito_nivel UNIQUE (software_id, nivel),
    CONSTRAINT ck_requisito_scores CHECK (score_cpu_min <= 100 AND score_gpu_min <= 100),
    CONSTRAINT ck_requisito_valores CHECK (ram_min_gb > 0 AND vram_min_gb >= 0 AND armazenamento_gb > 0),
    CONSTRAINT fk_requisito_software FOREIGN KEY (software_id) REFERENCES software (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- =====================================================================
-- 5. COMPRA (parte 2: pedido e o que pertence a ele)
-- =====================================================================

-- status atual fica no pedido (consultado o tempo todo pelos paineis);
-- a trilha completa fica em pedido_status_historico.
CREATE TABLE pedido (
    id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    numero        VARCHAR(20)   NOT NULL,
    cliente_id    INT UNSIGNED  NOT NULL,
    carrinho_id   INT UNSIGNED  NULL,
    montagem_id   INT UNSIGNED  NULL,
    status        ENUM('pendente', 'confirmado', 'em_preparacao', 'pronto',
                       'saiu_para_entrega', 'entregue', 'cancelado') NOT NULL DEFAULT 'pendente',
    valor_total   DECIMAL(10,2) NOT NULL,
    observacoes   TEXT          NULL,
    criado_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT uq_pedido_numero UNIQUE (numero),
    CONSTRAINT uq_pedido_carrinho UNIQUE (carrinho_id),
    CONSTRAINT ck_pedido_total CHECK (valor_total >= 0),
    INDEX idx_pedido_cliente_data (cliente_id, criado_em),
    INDEX idx_pedido_status (status),
    INDEX idx_pedido_data (criado_em),
    INDEX idx_pedido_montagem (montagem_id),
    CONSTRAINT fk_pedido_cliente FOREIGN KEY (cliente_id) REFERENCES cliente (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_pedido_carrinho FOREIGN KEY (carrinho_id) REFERENCES carrinho (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_pedido_montagem FOREIGN KEY (montagem_id) REFERENCES montagem (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- preco_unitario = preco NA DATA DA VENDA; subtotal e calculado pelo banco.
CREATE TABLE pedido_item (
    id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id      INT UNSIGNED  NOT NULL,
    produto_id     INT UNSIGNED  NOT NULL,
    quantidade     INT           NOT NULL,
    preco_unitario DECIMAL(10,2) NOT NULL,
    subtotal       DECIMAL(10,2) GENERATED ALWAYS AS (quantidade * preco_unitario) STORED,
    CONSTRAINT uq_pedido_item UNIQUE (pedido_id, produto_id),
    CONSTRAINT ck_pedido_item_qtd CHECK (quantidade > 0),
    CONSTRAINT ck_pedido_item_preco CHECK (preco_unitario > 0),
    INDEX idx_pedido_item_produto (produto_id),
    CONSTRAINT fk_pedido_item_pedido FOREIGN KEY (pedido_id) REFERENCES pedido (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_pedido_item_produto FOREIGN KEY (produto_id) REFERENCES produto (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE pedido_status_historico (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id       INT UNSIGNED NOT NULL,
    status_anterior ENUM('pendente', 'confirmado', 'em_preparacao', 'pronto',
                         'saiu_para_entrega', 'entregue', 'cancelado') NULL,
    status_novo     ENUM('pendente', 'confirmado', 'em_preparacao', 'pronto',
                         'saiu_para_entrega', 'entregue', 'cancelado') NOT NULL,
    usuario_id      INT UNSIGNED NULL,
    observacao      VARCHAR(255) NULL,
    criado_em       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_historico_pedido_data (pedido_id, criado_em),
    INDEX idx_historico_usuario (usuario_id),
    CONSTRAINT fk_historico_pedido FOREIGN KEY (pedido_id) REFERENCES pedido (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_historico_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE pagamento (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id        INT UNSIGNED  NOT NULL,
    forma            ENUM('credito', 'debito', 'pix', 'boleto') NOT NULL,
    parcelas         TINYINT UNSIGNED NOT NULL DEFAULT 1,
    valor            DECIMAL(10,2) NOT NULL,
    status           ENUM('pendente', 'aprovado', 'recusado', 'estornado') NOT NULL DEFAULT 'pendente',
    codigo_transacao VARCHAR(64)   NULL,
    pago_em          DATETIME      NULL,
    criado_em        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pagamento_pedido UNIQUE (pedido_id),
    CONSTRAINT ck_pagamento_parcelas CHECK (parcelas BETWEEN 1 AND 12),
    CONSTRAINT ck_pagamento_valor CHECK (valor >= 0),
    INDEX idx_pagamento_forma (forma),
    CONSTRAINT fk_pagamento_pedido FOREIGN KEY (pedido_id) REFERENCES pedido (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Entrega OU retirada. O endereco e copiado (historico) e endereco_id indica a origem.
CREATE TABLE entrega (
    id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    pedido_id        INT UNSIGNED  NOT NULL,
    modalidade       ENUM('entrega', 'retirada') NOT NULL DEFAULT 'entrega',
    entregador_id    INT UNSIGNED  NULL,
    endereco_id      INT UNSIGNED  NULL,
    cep              CHAR(8)       NULL,
    logradouro       VARCHAR(150)  NULL,
    numero           VARCHAR(10)   NULL,
    complemento      VARCHAR(60)   NULL,
    bairro           VARCHAR(80)   NULL,
    cidade           VARCHAR(80)   NULL,
    uf               CHAR(2)       NULL,
    valor_frete      DECIMAL(10,2) NOT NULL DEFAULT 0,
    codigo_rastreio  VARCHAR(30)   NULL,
    previsao_entrega DATE          NULL,
    saiu_em          DATETIME      NULL,
    entregue_em      DATETIME      NULL,
    CONSTRAINT uq_entrega_pedido UNIQUE (pedido_id),
    CONSTRAINT ck_entrega_frete CHECK (valor_frete >= 0),
    CONSTRAINT ck_entrega_endereco CHECK (modalidade = 'retirada' OR logradouro IS NOT NULL),
    INDEX idx_entrega_entregador (entregador_id),
    INDEX idx_entrega_endereco (endereco_id),
    CONSTRAINT fk_entrega_pedido FOREIGN KEY (pedido_id) REFERENCES pedido (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_entrega_entregador FOREIGN KEY (entregador_id) REFERENCES usuario (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_entrega_endereco FOREIGN KEY (endereco_id) REFERENCES endereco (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- Auditoria do estoque. saldo_apos = quantidade em estoque logo depois do movimento.
CREATE TABLE movimentacao_estoque (
    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    produto_id INT UNSIGNED NOT NULL,
    pedido_id  INT UNSIGNED NULL,
    usuario_id INT UNSIGNED NULL,
    tipo       ENUM('entrada', 'saida', 'ajuste', 'devolucao') NOT NULL,
    quantidade INT          NOT NULL,
    saldo_apos INT          NOT NULL,
    motivo     VARCHAR(255) NULL,
    criado_em  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_mov_quantidade CHECK (quantidade <> 0),
    CONSTRAINT ck_mov_saldo CHECK (saldo_apos >= 0),
    INDEX idx_mov_produto_data (produto_id, criado_em),
    INDEX idx_mov_pedido (pedido_id),
    INDEX idx_mov_usuario (usuario_id),
    CONSTRAINT fk_mov_produto FOREIGN KEY (produto_id) REFERENCES produto (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_mov_pedido FOREIGN KEY (pedido_id) REFERENCES pedido (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- "Quem ve A tambem deve ver B". Substitui a antiga produto_relacionado.
CREATE TABLE recomendacao (
    id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    produto_origem_id      INT UNSIGNED NOT NULL,
    produto_recomendado_id INT UNSIGNED NOT NULL,
    tipo                   ENUM('manual', 'comprados_juntos', 'compatibilidade') NOT NULL DEFAULT 'manual',
    peso                   DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    criado_em              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recomendacao UNIQUE (produto_origem_id, produto_recomendado_id, tipo),
    CONSTRAINT ck_recomendacao_peso CHECK (peso > 0),
    INDEX idx_recomendacao_recomendado (produto_recomendado_id),
    CONSTRAINT fk_recomendacao_origem FOREIGN KEY (produto_origem_id) REFERENCES produto (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_recomendacao_recomendado FOREIGN KEY (produto_recomendado_id) REFERENCES produto (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- =====================================================================
-- 6. TRIGGERS
-- =====================================================================
DELIMITER $$

-- O MySQL nao deixa usar CHECK em colunas de FK com ON DELETE/ON UPDATE CASCADE,
-- entao "um produto nao recomenda ele mesmo" e garantido por trigger.
CREATE TRIGGER trg_recomendacao_bi BEFORE INSERT ON recomendacao
FOR EACH ROW
BEGIN
    IF NEW.produto_origem_id = NEW.produto_recomendado_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Um produto nao pode recomendar ele mesmo.';
    END IF;
END$$

CREATE TRIGGER trg_recomendacao_bu BEFORE UPDATE ON recomendacao
FOR EACH ROW
BEGIN
    IF NEW.produto_origem_id = NEW.produto_recomendado_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Um produto nao pode recomendar ele mesmo.';
    END IF;
END$$

-- Estoque acompanha o status do pedido e cada mudanca vira uma linha em movimentacao_estoque:
--  * pendente -> confirmado: baixa o estoque (se faltar, o CHECK da erro e a transacao e desfeita)
--  * cancelado depois de confirmado (e antes de sair p/ entrega): devolve o estoque
CREATE TRIGGER trg_pedido_estoque AFTER UPDATE ON pedido
FOR EACH ROW
BEGIN
    IF OLD.status = 'pendente' AND NEW.status = 'confirmado' THEN
        UPDATE estoque e
        JOIN pedido_item i ON i.produto_id = e.produto_id
        SET e.quantidade = e.quantidade - i.quantidade
        WHERE i.pedido_id = NEW.id;

        INSERT INTO movimentacao_estoque (produto_id, pedido_id, tipo, quantidade, saldo_apos, motivo)
        SELECT i.produto_id, NEW.id, 'saida', -i.quantidade, e.quantidade, CONCAT('Venda ', NEW.numero)
        FROM pedido_item i JOIN estoque e ON e.produto_id = i.produto_id
        WHERE i.pedido_id = NEW.id;
    ELSEIF NEW.status = 'cancelado' AND OLD.status IN ('confirmado', 'em_preparacao', 'pronto') THEN
        UPDATE estoque e
        JOIN pedido_item i ON i.produto_id = e.produto_id
        SET e.quantidade = e.quantidade + i.quantidade
        WHERE i.pedido_id = NEW.id;

        INSERT INTO movimentacao_estoque (produto_id, pedido_id, tipo, quantidade, saldo_apos, motivo)
        SELECT i.produto_id, NEW.id, 'devolucao', i.quantidade, e.quantidade, CONCAT('Cancelamento ', NEW.numero)
        FROM pedido_item i JOIN estoque e ON e.produto_id = i.produto_id
        WHERE i.pedido_id = NEW.id;
    END IF;
END$$

DELIMITER ;

-- =====================================================================
-- 7. VIEWS
-- =====================================================================

-- ---------- Relatorios do painel do gerente (mesmos resultados do banco anterior) ----------
CREATE VIEW vw_faturamento_diario AS
SELECT DATE(criado_em) AS dia, COUNT(*) AS pedidos, SUM(valor_total) AS faturamento
FROM pedido WHERE status <> 'cancelado'
GROUP BY DATE(criado_em);

CREATE VIEW vw_pedidos_por_status AS
SELECT status, COUNT(*) AS pedidos FROM pedido GROUP BY status;

CREATE VIEW vw_produtos_mais_vendidos AS
SELECT p.id AS produto_id, p.nome, c.nome AS categoria,
       SUM(i.quantidade) AS unidades_vendidas, SUM(i.subtotal) AS receita
FROM pedido_item i
JOIN pedido pe ON pe.id = i.pedido_id AND pe.status <> 'cancelado'
JOIN produto p ON p.id = i.produto_id
JOIN categoria c ON c.id = p.categoria_id
GROUP BY p.id, p.nome, c.nome;

CREATE VIEW vw_formas_pagamento AS
SELECT pg.forma, COUNT(*) AS pedidos, SUM(pg.valor) AS valor
FROM pagamento pg JOIN pedido pe ON pe.id = pg.pedido_id
WHERE pe.status <> 'cancelado'
GROUP BY pg.forma;

CREATE VIEW vw_pedidos_por_hora AS
SELECT HOUR(criado_em) AS hora, COUNT(*) AS pedidos FROM pedido GROUP BY HOUR(criado_em);

CREATE VIEW vw_estoque_baixo AS
SELECT p.id AS produto_id, p.nome, e.quantidade AS estoque, e.estoque_minimo
FROM produto p JOIN estoque e ON e.produto_id = p.id
WHERE p.disponivel = TRUE AND e.quantidade <= e.estoque_minimo;

-- Recomendacao: "quem comprou o produto A tambem levou o produto B"
CREATE VIEW vw_comprados_juntos AS
SELECT a.produto_id AS produto_id, b.produto_id AS recomendado_id, COUNT(*) AS vezes
FROM pedido_item a
JOIN pedido_item b ON b.pedido_id = a.pedido_id AND b.produto_id <> a.produto_id
JOIN pedido pe ON pe.id = a.pedido_id AND pe.status <> 'cancelado'
GROUP BY a.produto_id, b.produto_id;

-- ---------- Inovacao 1: consumo e custo de energia de cada montagem ----------
-- Regras em docs/regras-inovacoes.md:
--   soma_watts       = soma(consumo_watts x quantidade) das pecas (a fonte entra com 0 W)
--   consumo_uso_w    = soma x 0,7       |  consumo_carga_w = soma x 1,0
--   tomada           = consumo / eficiencia da fonte (sem fonte: 0,80, o pior caso)
--   custo_mensal     = (W na tomada em uso / 1000) x horas/dia x 30 x R$/kWh
--   custo_anual      = custo_mensal x 12
CREATE VIEW vw_consumo_montagem AS
SELECT m.id                                        AS montagem_id,
       m.nome                                      AS montagem,
       m.uf                                        AS uf,
       m.horas_uso_dia                             AS horas_uso_dia,
       t.valor_kwh                                 AS valor_kwh,
       c.soma_watts                                AS soma_watts,
       ROUND(c.soma_watts * 0.7, 1)                AS consumo_uso_w,
       c.soma_watts                                AS consumo_carga_w,
       c.potencia_fonte_w                          AS potencia_fonte_w,
       COALESCE(c.eficiencia_fonte, 0.80)          AS eficiencia_fonte,
       ROUND(c.soma_watts * 0.7 / COALESCE(c.eficiencia_fonte, 0.80), 1) AS tomada_uso_w,
       ROUND(c.soma_watts / COALESCE(c.eficiencia_fonte, 0.80), 1)       AS tomada_carga_w,
       ROUND(c.soma_watts * 0.7 / COALESCE(c.eficiencia_fonte, 0.80) / 1000
             * m.horas_uso_dia * 30 * t.valor_kwh, 2)                    AS custo_mensal,
       ROUND(c.soma_watts * 0.7 / COALESCE(c.eficiencia_fonte, 0.80) / 1000
             * m.horas_uso_dia * 30 * t.valor_kwh * 12, 2)               AS custo_anual,
       CASE
           WHEN c.potencia_fonte_w IS NULL                 THEN 'sem_fonte'
           WHEN c.potencia_fonte_w < c.soma_watts          THEN 'vermelho'
           WHEN c.potencia_fonte_w < c.soma_watts * 1.2    THEN 'amarelo'
           ELSE 'verde'
       END                                         AS selo_fonte
FROM montagem m
JOIN tarifa_energia t ON t.uf = m.uf
JOIN (
    SELECT m0.id AS montagem_id,
           COALESCE(SUM(CASE WHEN e.tipo_peca <> 'fonte' THEN e.consumo_watts * mi.quantidade END), 0) AS soma_watts,
           MAX(CASE WHEN e.tipo_peca = 'fonte' THEN e.potencia_fonte_w END) AS potencia_fonte_w,
           MAX(CASE WHEN e.tipo_peca = 'fonte' THEN e.eficiencia_fonte END) AS eficiencia_fonte
    FROM montagem m0
    LEFT JOIN montagem_item mi ON mi.montagem_id = m0.id
    LEFT JOIN especificacao_tecnica e ON e.produto_id = mi.produto_id
    GROUP BY m0.id
) c ON c.montagem_id = m.id;

SHOW TABLES;
