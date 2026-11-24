package com.vantix.api.service;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.vantix.api.exception.ApiException;

/**
 * Regras de pedidos e estoque (docs/API_CONTRATO.md, secao 4) sobre o modelo novo:
 * pedido + pedido_item + pedido_status_historico + pagamento + entrega (+ montagem do PC).
 * O estoque quem baixa/devolve e a trigger trg_pedido_estoque, que tambem grava movimentacao_estoque.
 * O JSON devolvido e o mesmo de antes, para o front nao precisar mudar.
 */
@Service
public class PedidoService {

    public record ClienteDados(String nome, String email, String telefone, String endereco) { }
    public record EnderecoDados(String cep, String logradouro, String numero, String complemento,
                                String bairro, String cidade, String uf) { }
    public record ItemDados(Integer idProduto, Integer quantidade) { }
    public record PagamentoDados(String forma, Integer parcelas) { }
    /** Dados da Verificacao do PC: UF e horas usadas no calculo de energia da montagem salva com o pedido. */
    public record MontagemDados(String nome, String uf, Double horasUsoDia) { }
    public record NovoPedido(ClienteDados cliente, EnderecoDados enderecoEntrega, List<ItemDados> itens,
                             PagamentoDados pagamento, String tipoEntrega, String observacoes,
                             MontagemDados montagem) { }

    private static final BigDecimal FRETE_GRATIS_A_PARTIR_DE = new BigDecimal("299.00");
    private static final BigDecimal FRETE = new BigDecimal("29.90");
    private static final Set<String> FORMAS = Set.of("credito", "debito", "pix", "boleto");

    /** De -> para permitidos. "pronto -> entregue" so vale para retirada; "pronto -> saiu" so para entrega. */
    private static final Map<String, Set<String>> TRANSICOES = Map.of(
            "pendente", Set.of("confirmado", "cancelado"),
            "confirmado", Set.of("em_preparacao", "cancelado"),
            "em_preparacao", Set.of("pronto", "cancelado"),
            "pronto", Set.of("saiu_para_entrega", "entregue", "cancelado"),
            "saiu_para_entrega", Set.of("entregue"));

    private static final String SELECT_PEDIDO = """
            SELECT pe.id AS id_pedido, pe.numero, pe.status, pe.valor_total, pe.observacoes, pe.montagem_id,
                   pe.criado_em, pe.atualizado_em,
                   en.modalidade, en.valor_frete, en.entregador_id, en.cep, en.logradouro, en.numero AS en_numero,
                   en.complemento, en.bairro, en.cidade, en.uf,
                   (SELECT h.observacao FROM pedido_status_historico h
                     WHERE h.pedido_id = pe.id AND h.status_novo = 'cancelado'
                     ORDER BY h.id DESC LIMIT 1) AS motivo_cancelamento,
                   c.id AS id_cliente, c.nome AS c_nome, c.email AS c_email, c.telefone AS c_telefone,
                   ec.cep AS ec_cep, ec.logradouro AS ec_logradouro, ec.numero AS ec_numero,
                   ec.complemento AS ec_complemento, ec.bairro AS ec_bairro, ec.cidade AS ec_cidade, ec.uf AS ec_uf,
                   pg.forma, pg.parcelas, pg.valor AS pg_valor
            FROM pedido pe
            JOIN cliente c ON c.id = pe.cliente_id
            LEFT JOIN entrega en ON en.pedido_id = pe.id
            LEFT JOIN pagamento pg ON pg.pedido_id = pe.id
            LEFT JOIN endereco ec ON ec.id = (SELECT e2.id FROM endereco e2 WHERE e2.cliente_id = c.id
                                              ORDER BY e2.principal DESC, e2.id LIMIT 1)
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final Object trava = new Object();

    public PedidoService(NamedParameterJdbcTemplate jdbc, PlatformTransactionManager tm) {
        this.jdbc = jdbc;
        this.tx = new TransactionTemplate(tm);
    }

    // ------------------------------------------------------------------ criar

    /** Um pedido por vez, numa unica transacao (evita numero repetido e venda dupla da ultima unidade). */
    public Map<String, Object> criar(NovoPedido novo) {
        validar(novo);
        synchronized (trava) {
            Integer id = tx.execute(status -> gravar(novo));
            return buscar(id);
        }
    }

    private void validar(NovoPedido n) {
        if (n == null || n.cliente() == null || n.itens() == null || n.itens().isEmpty()) {
            throw ApiException.badRequest("O pedido precisa de cliente e de pelo menos um item.");
        }
        ClienteDados c = n.cliente();
        if (vazio(c.nome()) || vazio(c.email()) || vazio(c.telefone())) {
            throw ApiException.badRequest("Informe nome, e-mail e telefone do cliente.");
        }
        for (ItemDados i : n.itens()) {
            if (i.idProduto() == null || i.quantidade() == null || i.quantidade() < 1) {
                throw ApiException.badRequest("Item inválido: informe o produto e uma quantidade maior que zero.");
            }
        }
        if (n.pagamento() == null || n.pagamento().forma() == null || !FORMAS.contains(n.pagamento().forma())) {
            throw ApiException.badRequest("Forma de pagamento inválida.");
        }
        Integer parc = n.pagamento().parcelas();
        if (parc != null && (parc < 1 || parc > 12)) {
            throw ApiException.badRequest("O número de parcelas deve ficar entre 1 e 12.");
        }
        if (!"entrega".equals(n.tipoEntrega()) && !"retirada".equals(n.tipoEntrega())) {
            throw ApiException.badRequest("Tipo de entrega inválido.");
        }
        if ("entrega".equals(n.tipoEntrega()) && enderecoDe(n) == null) {
            throw ApiException.badRequest("Informe o endereço de entrega.");
        }
    }

    private Integer gravar(NovoPedido n) {
        ClienteDados c = n.cliente();
        boolean entrega = "entrega".equals(n.tipoEntrega());

        // 1) cliente: procura pelo e-mail, atualiza ou insere
        String email = c.email().trim().toLowerCase();
        List<Integer> existente = jdbc.queryForList("SELECT id FROM cliente WHERE email = :email",
                new MapSqlParameterSource("email", email), Integer.class);
        int idCliente;
        if (existente.isEmpty()) {
            var keys = new GeneratedKeyHolder();
            jdbc.update("INSERT INTO cliente (nome, email, telefone) VALUES (:nome, :email, :tel)",
                    new MapSqlParameterSource().addValue("nome", c.nome().trim()).addValue("email", email)
                            .addValue("tel", c.telefone().trim()),
                    keys, new String[] {"id"});
            idCliente = keys.getKey().intValue();
        } else {
            idCliente = existente.get(0);
            jdbc.update("UPDATE cliente SET nome = :nome, telefone = :tel WHERE id = :id",
                    new MapSqlParameterSource().addValue("nome", c.nome().trim())
                            .addValue("tel", c.telefone().trim()).addValue("id", idCliente));
        }

        // 2) endereco do cliente (reaproveita se ja existe um igual)
        EnderecoDados end = entrega ? enderecoDe(n) : null;
        Integer idEndereco = end != null ? gravarEndereco(idCliente, end) : null;

        // 3) juntar itens repetidos e travar os produtos/estoque (FOR UPDATE, em ordem de id)
        Map<Integer, Integer> quantidades = new TreeMap<>();
        for (ItemDados i : n.itens()) {
            quantidades.merge(i.idProduto(), i.quantidade(), Integer::sum);
        }
        List<Map<String, Object>> produtos = jdbc.queryForList("""
                SELECT p.id, p.nome, p.preco, p.disponivel, e.quantidade AS estoque
                FROM produto p JOIN estoque e ON e.produto_id = p.id
                WHERE p.id IN (:ids) ORDER BY p.id FOR UPDATE
                """, new MapSqlParameterSource("ids", quantidades.keySet()));
        if (produtos.size() != quantidades.size()) {
            throw ApiException.badRequest("Um dos produtos do pedido não existe.");
        }

        // 4) preco, frete e total sao calculados aqui (nunca confiar no navegador)
        BigDecimal subtotal = BigDecimal.ZERO;
        for (Map<String, Object> p : produtos) {
            int idProduto = ((Number) p.get("id")).intValue();
            int qtd = quantidades.get(idProduto);
            String nome = (String) p.get("nome");
            if (!Boolean.TRUE.equals(p.get("disponivel"))) {
                throw ApiException.conflict("O produto \"" + nome + "\" não está mais disponível.");
            }
            int estoque = ((Number) p.get("estoque")).intValue();
            if (estoque < qtd) {
                throw ApiException.conflict("Estoque insuficiente para \"" + nome + "\" (restam " + estoque + ").");
            }
            subtotal = subtotal.add(((BigDecimal) p.get("preco")).multiply(BigDecimal.valueOf(qtd)));
        }
        BigDecimal frete = (!entrega || subtotal.compareTo(FRETE_GRATIS_A_PARTIR_DE) >= 0) ? BigDecimal.ZERO : FRETE;
        BigDecimal total = subtotal.add(frete);

        // 5) numero VTX-xxxx
        Integer maior = jdbc.getJdbcTemplate().queryForObject(
                "SELECT COALESCE(MAX(CAST(SUBSTRING(numero, 5) AS UNSIGNED)), 1000) FROM pedido", Integer.class);
        String numero = "VTX-" + (maior + 1);

        // 6) montagem do PC: as pecas de hardware do pedido viram uma montagem ligada a ele
        Integer idMontagem = gravarMontagem(idCliente, numero, quantidades, n.montagem());

        // 7) pedido (pendente), itens, historico, pagamento e entrega
        var keys = new GeneratedKeyHolder();
        jdbc.update("""
                INSERT INTO pedido (numero, cliente_id, montagem_id, status, valor_total, observacoes)
                VALUES (:numero, :cliente, :montagem, 'pendente', :total, :obs)
                """, new MapSqlParameterSource().addValue("numero", numero).addValue("cliente", idCliente)
                        .addValue("montagem", idMontagem).addValue("total", total)
                        .addValue("obs", vazio(n.observacoes()) ? null : n.observacoes().trim()),
                keys, new String[] {"id"});
        int idPedido = keys.getKey().intValue();

        for (Map<String, Object> p : produtos) {
            int idProduto = ((Number) p.get("id")).intValue();
            jdbc.update("INSERT INTO pedido_item (pedido_id, produto_id, quantidade, preco_unitario) "
                            + "VALUES (:ped, :prod, :qtd, :preco)",
                    new MapSqlParameterSource().addValue("ped", idPedido).addValue("prod", idProduto)
                            .addValue("qtd", quantidades.get(idProduto)).addValue("preco", p.get("preco")));
        }
        historico(idPedido, null, "pendente", null, "Pedido criado");

        String forma = n.pagamento().forma();
        int parcelas = "credito".equals(forma) && n.pagamento().parcelas() != null ? n.pagamento().parcelas() : 1;
        jdbc.update("INSERT INTO pagamento (pedido_id, forma, parcelas, valor, status) "
                        + "VALUES (:ped, :forma, :parc, :valor, 'pendente')",
                new MapSqlParameterSource().addValue("ped", idPedido).addValue("forma", forma)
                        .addValue("parc", parcelas).addValue("valor", total));

        jdbc.update("""
                INSERT INTO entrega (pedido_id, modalidade, endereco_id, cep, logradouro, numero, complemento,
                                     bairro, cidade, uf, valor_frete, previsao_entrega)
                VALUES (:ped, :mod, :end, :cep, :log, :num, :comp, :bai, :cid, :uf, :frete, :prev)
                """, new MapSqlParameterSource().addValue("ped", idPedido).addValue("mod", n.tipoEntrega())
                        .addValue("end", idEndereco)
                        .addValue("cep", end != null ? end.cep() : null)
                        .addValue("log", end != null ? end.logradouro() : null)
                        .addValue("num", end != null ? end.numero() : null)
                        .addValue("comp", end != null ? end.complemento() : null)
                        .addValue("bai", end != null ? end.bairro() : null)
                        .addValue("cid", end != null ? end.cidade() : null)
                        .addValue("uf", end != null ? end.uf() : null)
                        .addValue("frete", frete)
                        .addValue("prev", LocalDate.now().plusDays(entrega ? 5 : 1)));

        // 8) pagamento aprovado na hora (menos boleto): confirma e a trigger baixa o estoque
        if (!"boleto".equals(forma)) {
            confirmar(idPedido, numero);
            historico(idPedido, "pendente", "confirmado", null, "Pagamento aprovado automaticamente");
        }
        return idPedido;
    }

    private void confirmar(int idPedido, String numero) {
        try {
            jdbc.update("UPDATE pedido SET status = 'confirmado' WHERE id = :id",
                    new MapSqlParameterSource("id", idPedido));
        } catch (DataAccessException e) {
            throw ApiException.conflict("Estoque insuficiente para concluir o pedido. Revise o carrinho.");
        }
        jdbc.update("UPDATE pagamento SET status = 'aprovado', pago_em = NOW(), codigo_transacao = :cod "
                        + "WHERE pedido_id = :id",
                new MapSqlParameterSource().addValue("id", idPedido).addValue("cod", "TXN-" + numero.replace("-", "")));
    }

    private Integer gravarEndereco(int idCliente, EnderecoDados e) {
        List<Integer> igual = jdbc.queryForList("""
                SELECT id FROM endereco WHERE cliente_id = :c AND logradouro = :log AND numero = :num
                  AND COALESCE(complemento, '') = COALESCE(:comp, '') AND cidade = :cid
                ORDER BY id LIMIT 1
                """, new MapSqlParameterSource().addValue("c", idCliente).addValue("log", e.logradouro())
                        .addValue("num", e.numero()).addValue("comp", e.complemento()).addValue("cid", e.cidade()),
                Integer.class);
        if (!igual.isEmpty()) {
            if (e.cep() != null) {
                jdbc.update("UPDATE endereco SET cep = :cep WHERE id = :id",
                        new MapSqlParameterSource().addValue("cep", e.cep()).addValue("id", igual.get(0)));
            }
            return igual.get(0);
        }
        Integer qtd = jdbc.queryForObject("SELECT COUNT(*) FROM endereco WHERE cliente_id = :c",
                new MapSqlParameterSource("c", idCliente), Integer.class);
        var keys = new GeneratedKeyHolder();
        jdbc.update("""
                INSERT INTO endereco (cliente_id, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, principal)
                VALUES (:c, :apelido, :cep, :log, :num, :comp, :bai, :cid, :uf, :principal)
                """, new MapSqlParameterSource().addValue("c", idCliente)
                        .addValue("apelido", qtd == 0 ? "Principal" : "Outro endereço").addValue("cep", e.cep())
                        .addValue("log", e.logradouro()).addValue("num", e.numero()).addValue("comp", e.complemento())
                        .addValue("bai", e.bairro()).addValue("cid", e.cidade()).addValue("uf", e.uf())
                        .addValue("principal", qtd == 0),
                keys, new String[] {"id"});
        return keys.getKey().intValue();
    }

    /** Cria a montagem com as pecas de hardware do pedido (as que tem especificacao_tecnica). */
    private Integer gravarMontagem(int idCliente, String numero, Map<Integer, Integer> quantidades, MontagemDados m) {
        List<Integer> hardware = jdbc.queryForList(
                "SELECT produto_id FROM especificacao_tecnica WHERE produto_id IN (:ids) ORDER BY produto_id",
                new MapSqlParameterSource("ids", quantidades.keySet()), Integer.class);
        if (hardware.isEmpty()) {
            return null;
        }
        String uf = m != null && m.uf() != null ? m.uf().trim().toUpperCase() : "SP";
        Integer ufOk = jdbc.queryForObject("SELECT COUNT(*) FROM tarifa_energia WHERE uf = :uf",
                new MapSqlParameterSource("uf", uf), Integer.class);
        if (ufOk == null || ufOk == 0) {
            uf = "SP";
        }
        double horas = m != null && m.horasUsoDia() != null ? Math.max(1, Math.min(24, m.horasUsoDia())) : 4;
        String nome = m != null && !vazio(m.nome()) ? m.nome().trim() : "PC do pedido " + numero;
        var keys = new GeneratedKeyHolder();
        jdbc.update("INSERT INTO montagem (cliente_id, nome, horas_uso_dia, uf, exemplo) VALUES (:c, :n, :h, :uf, FALSE)",
                new MapSqlParameterSource().addValue("c", idCliente).addValue("n", nome).addValue("h", horas)
                        .addValue("uf", uf), keys, new String[] {"id"});
        int idMontagem = keys.getKey().intValue();
        for (Integer idProduto : hardware) {
            jdbc.update("INSERT INTO montagem_item (montagem_id, produto_id, quantidade) VALUES (:m, :p, :q)",
                    new MapSqlParameterSource().addValue("m", idMontagem).addValue("p", idProduto)
                            .addValue("q", quantidades.get(idProduto)));
        }
        return idMontagem;
    }

    private void historico(int idPedido, String de, String para, Integer idUsuario, String obs) {
        jdbc.update("""
                INSERT INTO pedido_status_historico (pedido_id, status_anterior, status_novo, usuario_id, observacao)
                VALUES (:p, :de, :para, :u, :obs)
                """, new MapSqlParameterSource().addValue("p", idPedido).addValue("de", de).addValue("para", para)
                        .addValue("u", idUsuario).addValue("obs", obs));
    }

    // ------------------------------------------------------------------ status

    public Map<String, Object> mudarStatus(int id, String novo, Integer idEntregador, String motivo,
                                           boolean gerente, Integer idUsuario) {
        synchronized (trava) {
            tx.executeWithoutResult(s -> alterar(id, novo, idEntregador, motivo, gerente, idUsuario));
        }
        return buscar(id);
    }

    private void alterar(int id, String novo, Integer idEntregador, String motivo, boolean gerente, Integer idUsuario) {
        List<Map<String, Object>> atual = jdbc.queryForList("""
                SELECT pe.status, pe.numero, en.modalidade FROM pedido pe
                LEFT JOIN entrega en ON en.pedido_id = pe.id
                WHERE pe.id = :id FOR UPDATE
                """, new MapSqlParameterSource("id", id));
        if (atual.isEmpty()) {
            throw ApiException.notFound("Pedido não encontrado.");
        }
        String de = (String) atual.get(0).get("status");
        String numero = (String) atual.get(0).get("numero");
        boolean retirada = "retirada".equals(atual.get(0).get("modalidade"));
        boolean permitido = novo != null && TRANSICOES.getOrDefault(de, Set.of()).contains(novo)
                && !("pronto".equals(de) && "entregue".equals(novo) && !retirada)
                && !("saiu_para_entrega".equals(novo) && retirada);
        if (!permitido) {
            throw ApiException.conflict("Não é possível mudar o pedido de \"" + de + "\" para \"" + novo + "\".");
        }
        if (("cancelado".equals(novo) || "confirmado".equals(novo)) && !gerente) {
            throw ApiException.forbidden("Só o gerente pode aprovar pagamento ou cancelar pedidos.");
        }
        String obs = null;
        if ("cancelado".equals(novo)) {
            if (vazio(motivo)) {
                throw ApiException.badRequest("Informe o motivo do cancelamento.");
            }
            obs = motivo.trim();
        }
        if ("saiu_para_entrega".equals(novo)) {
            if (idEntregador == null) {
                throw ApiException.badRequest("Escolha o entregador.");
            }
            Integer ok = jdbc.queryForObject("""
                    SELECT COUNT(*) FROM usuario u JOIN perfil p ON p.id = u.perfil_id
                    WHERE u.id = :e AND p.codigo = 'logistica' AND u.ativo = TRUE
                    """, new MapSqlParameterSource("e", idEntregador), Integer.class);
            if (ok == null || ok == 0) {
                throw ApiException.badRequest("Entregador inválido.");
            }
        }
        try {
            jdbc.update("UPDATE pedido SET status = :novo WHERE id = :id",
                    new MapSqlParameterSource().addValue("id", id).addValue("novo", novo));
        } catch (DataAccessException e) {
            if ("confirmado".equals(novo)) {
                throw ApiException.conflict("Estoque insuficiente para aprovar este pedido.");
            }
            throw e;
        }
        MapSqlParameterSource p = new MapSqlParameterSource("id", id);
        switch (novo) {
            case "confirmado" -> {
                jdbc.update("UPDATE pagamento SET status = 'aprovado', pago_em = NOW(), codigo_transacao = :cod "
                        + "WHERE pedido_id = :id", p.addValue("cod", "TXN-" + numero.replace("-", "")));
                obs = "Pagamento aprovado pelo gerente";
            }
            case "cancelado" -> jdbc.update("UPDATE pagamento SET status = IF(status = 'aprovado', 'estornado', "
                    + "'recusado') WHERE pedido_id = :id", p);
            case "saiu_para_entrega" -> jdbc.update("""
                    UPDATE entrega SET entregador_id = :e, saiu_em = NOW(),
                           codigo_rastreio = COALESCE(codigo_rastreio, :rastreio)
                    WHERE pedido_id = :id
                    """, p.addValue("e", idEntregador).addValue("rastreio", "BR" + numero.substring(4) + "VTX"));
            case "entregue" -> {
                jdbc.update("UPDATE entrega SET entregue_em = NOW() WHERE pedido_id = :id", p);
                obs = retirada ? "Retirado na loja" : "Entregue ao cliente";
            }
            default -> { }
        }
        historico(id, de, novo, idUsuario, obs);
    }

    // ------------------------------------------------------------------ consultas

    public Map<String, Object> buscar(int id) {
        List<Map<String, Object>> l = montar(SELECT_PEDIDO + " WHERE pe.id = :id", new MapSqlParameterSource("id", id));
        if (l.isEmpty()) {
            throw ApiException.notFound("Pedido não encontrado.");
        }
        return l.get(0);
    }

    public List<Map<String, Object>> listar(String status) {
        if (vazio(status)) {
            return montar(SELECT_PEDIDO + " ORDER BY pe.criado_em DESC, pe.id DESC", new MapSqlParameterSource());
        }
        return montar(SELECT_PEDIDO + " WHERE pe.status = :status ORDER BY pe.criado_em DESC, pe.id DESC",
                new MapSqlParameterSource("status", status));
    }

    public List<Map<String, Object>> doCliente(String telefone, String email) {
        if (!vazio(telefone)) {
            String digitos = telefone.replaceAll("\\D", "");
            if (digitos.isEmpty()) {
                return List.of();
            }
            return montar(SELECT_PEDIDO + " WHERE REGEXP_REPLACE(c.telefone, '[^0-9]', '') = :tel "
                    + "ORDER BY pe.criado_em DESC, pe.id DESC", new MapSqlParameterSource("tel", digitos));
        }
        if (!vazio(email)) {
            return montar(SELECT_PEDIDO + " WHERE c.email = :email ORDER BY pe.criado_em DESC, pe.id DESC",
                    new MapSqlParameterSource("email", email.trim().toLowerCase()));
        }
        throw ApiException.badRequest("Informe o telefone ou o e-mail.");
    }

    /** Duas consultas no total (pedidos + todos os itens de uma vez), sem N+1. */
    private List<Map<String, Object>> montar(String sql, MapSqlParameterSource params) {
        List<Map<String, Object>> linhas = jdbc.queryForList(sql, params);
        if (linhas.isEmpty()) {
            return List.of();
        }
        List<Object> ids = new ArrayList<>();
        for (Map<String, Object> r : linhas) {
            ids.add(r.get("id_pedido"));
        }
        Map<Object, List<Map<String, Object>>> itensPorPedido = new LinkedHashMap<>();
        jdbc.queryForList("""
                SELECT i.pedido_id, i.produto_id AS idProduto, p.nome AS nome, p.imagem_url AS imagemUrl,
                       i.quantidade AS quantidade, i.preco_unitario AS precoUnitario, i.subtotal AS subtotal
                FROM pedido_item i JOIN produto p ON p.id = i.produto_id
                WHERE i.pedido_id IN (:ids) ORDER BY i.id
                """, new MapSqlParameterSource("ids", ids)).forEach(r -> {
                    Object idPedido = r.remove("pedido_id");
                    itensPorPedido.computeIfAbsent(idPedido, k -> new ArrayList<>()).add(r);
                });

        List<Map<String, Object>> saida = new ArrayList<>();
        for (Map<String, Object> r : linhas) {
            Map<String, Object> pedido = new LinkedHashMap<>();
            pedido.put("id", r.get("id_pedido"));
            pedido.put("numero", r.get("numero"));
            pedido.put("status", r.get("status"));
            pedido.put("tipoEntrega", r.get("modalidade") != null ? r.get("modalidade") : "entrega");
            pedido.put("enderecoEntrega", textoEndereco(r.get("cep"), r.get("logradouro"), r.get("en_numero"),
                    r.get("complemento"), r.get("bairro"), r.get("cidade"), r.get("uf")));
            pedido.put("frete", r.get("valor_frete") != null ? r.get("valor_frete") : BigDecimal.ZERO);
            pedido.put("valorTotal", r.get("valor_total"));
            pedido.put("observacoes", r.get("observacoes"));
            pedido.put("motivoCancelamento", r.get("motivo_cancelamento"));
            pedido.put("idEntregador", r.get("entregador_id"));
            pedido.put("idMontagem", r.get("montagem_id"));
            pedido.put("dataCriacao", data(r.get("criado_em")));
            pedido.put("dataAtualizacao", data(r.get("atualizado_em")));

            Map<String, Object> cliente = new LinkedHashMap<>();
            cliente.put("id", r.get("id_cliente"));
            cliente.put("nome", r.get("c_nome"));
            cliente.put("email", r.get("c_email"));
            cliente.put("telefone", r.get("c_telefone"));
            cliente.put("endereco", textoEndereco(r.get("ec_cep"), r.get("ec_logradouro"), r.get("ec_numero"),
                    r.get("ec_complemento"), r.get("ec_bairro"), r.get("ec_cidade"), r.get("ec_uf")));
            pedido.put("cliente", cliente);

            pedido.put("itens", itensPorPedido.getOrDefault(r.get("id_pedido"), List.of()));

            Map<String, Object> pagamento = new LinkedHashMap<>();
            pagamento.put("forma", r.get("forma"));
            pagamento.put("parcelas", r.get("parcelas"));
            pagamento.put("valor", r.get("pg_valor"));
            pedido.put("pagamento", pagamento);
            saida.add(pedido);
        }
        return saida;
    }

    // ------------------------------------------------------------------ endereco

    /** Endereco estruturado do pedido; se o front mandou so o texto, tenta separar as partes. */
    private static EnderecoDados enderecoDe(NovoPedido n) {
        EnderecoDados e = n.enderecoEntrega();
        if (e != null && !vazio(e.logradouro()) && !vazio(e.numero()) && !vazio(e.cidade()) && !vazio(e.uf())) {
            String cep = e.cep() != null ? e.cep().replaceAll("\\D", "") : null;
            return new EnderecoDados(cep != null && cep.length() == 8 ? cep : null, e.logradouro().trim(),
                    e.numero().trim(), vazio(e.complemento()) ? null : e.complemento().trim(),
                    vazio(e.bairro()) ? "-" : e.bairro().trim(), e.cidade().trim(), e.uf().trim().toUpperCase());
        }
        String texto = n.cliente() != null ? n.cliente().endereco() : null;
        return vazio(texto) ? null : enderecoDoTexto(texto.trim());
    }

    private static final Pattern ENDERECO_TEXTO = Pattern.compile("^(.+), (\\S+) - (.+), (.+) - ([A-Z]{2})$");

    /** "Av. Paulista, 915 - Santana, São Paulo - SP". Fora desse padrao, guarda o texto inteiro no logradouro. */
    static EnderecoDados enderecoDoTexto(String texto) {
        Matcher m = ENDERECO_TEXTO.matcher(texto);
        if (m.matches()) {
            return new EnderecoDados(null, m.group(1), m.group(2), null, m.group(3), m.group(4), m.group(5));
        }
        String log = texto.length() > 150 ? texto.substring(0, 150) : texto;
        return new EnderecoDados(null, log, "S/N", null, "-", "-", "SP");
    }

    /** Monta o texto do endereco no mesmo formato do banco anterior (+ complemento e CEP, quando houver). */
    static String textoEndereco(Object cep, Object logradouro, Object numero, Object complemento,
                                Object bairro, Object cidade, Object uf) {
        if (logradouro == null) {
            return null;
        }
        StringBuilder s = new StringBuilder().append(logradouro).append(", ").append(numero);
        if (complemento != null) {
            s.append(" - ").append(complemento);
        }
        s.append(" - ").append(bairro).append(", ").append(cidade).append(" - ").append(uf);
        if (cep != null) {
            String c = cep.toString();
            s.append(", CEP ").append(c.length() == 8 ? c.substring(0, 5) + "-" + c.substring(5) : c);
        }
        return s.toString();
    }

    private static Object data(Object o) {
        return o instanceof Timestamp t ? t.toLocalDateTime() : o;
    }

    private static boolean vazio(String s) {
        return s == null || s.isBlank();
    }
}
