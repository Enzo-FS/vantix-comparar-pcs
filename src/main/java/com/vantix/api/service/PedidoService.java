package com.vantix.api.service;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import com.vantix.api.exception.ApiException;

/**
 * Regras de pedidos e estoque (docs/API_CONTRATO.md, secao 4).
 * O estoque quem baixa/devolve e a trigger trg_pedido_estoque do banco.
 */
@Service
public class PedidoService {

    public record ClienteDados(String nome, String email, String telefone, String endereco) { }
    public record ItemDados(Integer idProduto, Integer quantidade) { }
    public record PagamentoDados(String forma, Integer parcelas) { }
    public record NovoPedido(ClienteDados cliente, List<ItemDados> itens, PagamentoDados pagamento,
                             String tipoEntrega, String observacoes) { }

    private static final BigDecimal FRETE_GRATIS_A_PARTIR_DE = new BigDecimal("299.00");
    private static final BigDecimal FRETE = new BigDecimal("29.90");
    private static final Set<String> FORMAS = Set.of("credito", "debito", "pix", "boleto");

    /** De -> para permitidos. */
    private static final Map<String, Set<String>> TRANSICOES = Map.of(
            "pendente", Set.of("confirmado", "cancelado"),
            "confirmado", Set.of("em_preparacao", "cancelado"),
            "em_preparacao", Set.of("pronto", "cancelado"),
            "pronto", Set.of("saiu_para_entrega", "cancelado"),
            "saiu_para_entrega", Set.of("entregue"));

    private static final String SELECT_PEDIDO = """
            SELECT pe.id_pedido, pe.numero, pe.status, pe.tipo_entrega, pe.endereco_entrega, pe.frete,
                   pe.valor_total, pe.observacoes, pe.motivo_cancelamento, pe.id_entregador,
                   pe.data_criacao, pe.data_atualizacao,
                   c.id_cliente, c.nome AS c_nome, c.email AS c_email, c.telefone AS c_telefone,
                   c.endereco AS c_endereco,
                   pg.forma, pg.parcelas, pg.valor AS pg_valor
            FROM pedido pe
            JOIN cliente c ON c.id_cliente = pe.id_cliente
            LEFT JOIN pagamento pg ON pg.id_pedido = pe.id_pedido
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
        if ("entrega".equals(n.tipoEntrega()) && vazio(c.endereco())) {
            throw ApiException.badRequest("Informe o endereço de entrega.");
        }
    }

    private Integer gravar(NovoPedido n) {
        // 1) cliente: procura pelo e-mail, atualiza ou insere
        ClienteDados c = n.cliente();
        String email = c.email().trim().toLowerCase();
        List<Integer> existente = jdbc.queryForList("SELECT id_cliente FROM cliente WHERE email = :email",
                new MapSqlParameterSource("email", email), Integer.class);
        int idCliente;
        if (existente.isEmpty()) {
            var keys = new GeneratedKeyHolder();
            jdbc.update("INSERT INTO cliente (nome, email, telefone, endereco) VALUES (:nome, :email, :tel, :end)",
                    new MapSqlParameterSource().addValue("nome", c.nome().trim()).addValue("email", email)
                            .addValue("tel", c.telefone().trim()).addValue("end", c.endereco()),
                    keys, new String[] {"id_cliente"});
            idCliente = keys.getKey().intValue();
        } else {
            idCliente = existente.get(0);
            jdbc.update("UPDATE cliente SET nome = :nome, telefone = :tel, endereco = :end WHERE id_cliente = :id",
                    new MapSqlParameterSource().addValue("nome", c.nome().trim())
                            .addValue("tel", c.telefone().trim()).addValue("end", c.endereco())
                            .addValue("id", idCliente));
        }

        // 2) juntar itens repetidos e travar os produtos (FOR UPDATE, em ordem de id)
        Map<Integer, Integer> quantidades = new java.util.TreeMap<>();
        for (ItemDados i : n.itens()) {
            quantidades.merge(i.idProduto(), i.quantidade(), Integer::sum);
        }
        List<Map<String, Object>> produtos = jdbc.queryForList(
                "SELECT id_produto, nome, preco, estoque, disponivel FROM produto "
                        + "WHERE id_produto IN (:ids) ORDER BY id_produto FOR UPDATE",
                new MapSqlParameterSource("ids", quantidades.keySet()));
        if (produtos.size() != quantidades.size()) {
            throw ApiException.badRequest("Um dos produtos do pedido não existe.");
        }

        // 3) preco, frete e total sao calculados aqui (nunca confiar no navegador)
        BigDecimal subtotal = BigDecimal.ZERO;
        for (Map<String, Object> p : produtos) {
            int idProduto = ((Number) p.get("id_produto")).intValue();
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
        boolean entrega = "entrega".equals(n.tipoEntrega());
        BigDecimal frete = (!entrega || subtotal.compareTo(FRETE_GRATIS_A_PARTIR_DE) >= 0)
                ? BigDecimal.ZERO : FRETE;
        BigDecimal total = subtotal.add(frete);

        // 4) numero VTX-xxxx
        Integer maior = jdbc.getJdbcTemplate().queryForObject(
                "SELECT COALESCE(MAX(CAST(SUBSTRING(numero, 5) AS UNSIGNED)), 1000) FROM pedido", Integer.class);
        String numero = "VTX-" + (maior + 1);

        // 5) pedido (pendente), itens e pagamento
        var keys = new GeneratedKeyHolder();
        jdbc.update("""
                INSERT INTO pedido (numero, id_cliente, tipo_entrega, endereco_entrega, frete, valor_total,
                                    status, observacoes)
                VALUES (:numero, :cliente, :tipo, :endereco, :frete, :total, 'pendente', :obs)
                """, new MapSqlParameterSource().addValue("numero", numero).addValue("cliente", idCliente)
                        .addValue("tipo", n.tipoEntrega()).addValue("endereco", entrega ? c.endereco() : null)
                        .addValue("frete", frete).addValue("total", total)
                        .addValue("obs", vazio(n.observacoes()) ? null : n.observacoes().trim()),
                keys, new String[] {"id_pedido"});
        int idPedido = keys.getKey().intValue();

        for (Map<String, Object> p : produtos) {
            int idProduto = ((Number) p.get("id_produto")).intValue();
            jdbc.update("INSERT INTO item_pedido (id_pedido, id_produto, quantidade, preco_unitario) "
                            + "VALUES (:ped, :prod, :qtd, :preco)",
                    new MapSqlParameterSource().addValue("ped", idPedido).addValue("prod", idProduto)
                            .addValue("qtd", quantidades.get(idProduto)).addValue("preco", p.get("preco")));
        }
        String forma = n.pagamento().forma();
        int parcelas = "credito".equals(forma) && n.pagamento().parcelas() != null ? n.pagamento().parcelas() : 1;
        jdbc.update("INSERT INTO pagamento (id_pedido, forma, parcelas, valor) VALUES (:ped, :forma, :parc, :valor)",
                new MapSqlParameterSource().addValue("ped", idPedido).addValue("forma", forma)
                        .addValue("parc", parcelas).addValue("valor", total));

        // 6) pagamento aprovado na hora (menos boleto): confirma e a trigger baixa o estoque
        if (!"boleto".equals(forma)) {
            confirmar(idPedido);
        }
        return idPedido;
    }

    private void confirmar(int idPedido) {
        try {
            jdbc.update("UPDATE pedido SET status = 'confirmado' WHERE id_pedido = :id",
                    new MapSqlParameterSource("id", idPedido));
        } catch (DataAccessException e) {
            throw ApiException.conflict("Estoque insuficiente para concluir o pedido. Revise o carrinho.");
        }
    }

    // ------------------------------------------------------------------ status

    public Map<String, Object> mudarStatus(int id, String novo, Integer idEntregador, String motivo,
                                           boolean gerente) {
        synchronized (trava) {
            tx.executeWithoutResult(s -> alterar(id, novo, idEntregador, motivo, gerente));
        }
        return buscar(id);
    }

    private void alterar(int id, String novo, Integer idEntregador, String motivo, boolean gerente) {
        List<String> atual = jdbc.queryForList("SELECT status FROM pedido WHERE id_pedido = :id FOR UPDATE",
                new MapSqlParameterSource("id", id), String.class);
        if (atual.isEmpty()) {
            throw ApiException.notFound("Pedido não encontrado.");
        }
        String de = atual.get(0);
        if (novo == null || !TRANSICOES.getOrDefault(de, Set.of()).contains(novo)) {
            throw ApiException.conflict("Não é possível mudar o pedido de \"" + de + "\" para \"" + novo + "\".");
        }
        if (("cancelado".equals(novo) || "confirmado".equals(novo)) && !gerente) {
            throw ApiException.forbidden("Só o gerente pode aprovar pagamento ou cancelar pedidos.");
        }
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("id", id).addValue("novo", novo);
        String extra = "";
        if ("cancelado".equals(novo)) {
            if (vazio(motivo)) {
                throw ApiException.badRequest("Informe o motivo do cancelamento.");
            }
            extra = ", motivo_cancelamento = :motivo";
            p.addValue("motivo", motivo.trim());
        }
        if ("saiu_para_entrega".equals(novo)) {
            if (idEntregador == null) {
                throw ApiException.badRequest("Escolha o entregador.");
            }
            Integer ok = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM usuario_painel WHERE id_usuario = :e AND papel = 'logistica' AND ativo = TRUE",
                    new MapSqlParameterSource("e", idEntregador), Integer.class);
            if (ok == null || ok == 0) {
                throw ApiException.badRequest("Entregador inválido.");
            }
            extra = ", id_entregador = :entregador";
            p.addValue("entregador", idEntregador);
        }
        try {
            jdbc.update("UPDATE pedido SET status = :novo" + extra + " WHERE id_pedido = :id", p);
        } catch (DataAccessException e) {
            if ("confirmado".equals(novo)) {
                throw new ApiException(HttpStatus.CONFLICT, "Estoque insuficiente para aprovar este pedido.");
            }
            throw e;
        }
    }

    // ------------------------------------------------------------------ consultas

    public Map<String, Object> buscar(int id) {
        List<Map<String, Object>> l = montar(SELECT_PEDIDO + " WHERE pe.id_pedido = :id",
                new MapSqlParameterSource("id", id));
        if (l.isEmpty()) {
            throw ApiException.notFound("Pedido não encontrado.");
        }
        return l.get(0);
    }

    public List<Map<String, Object>> listar(String status) {
        if (vazio(status)) {
            return montar(SELECT_PEDIDO + " ORDER BY pe.data_criacao DESC, pe.id_pedido DESC",
                    new MapSqlParameterSource());
        }
        return montar(SELECT_PEDIDO + " WHERE pe.status = :status ORDER BY pe.data_criacao DESC, pe.id_pedido DESC",
                new MapSqlParameterSource("status", status));
    }

    public List<Map<String, Object>> doCliente(String telefone, String email) {
        if (!vazio(telefone)) {
            String digitos = telefone.replaceAll("\\D", "");
            if (digitos.isEmpty()) {
                return List.of();
            }
            return montar(SELECT_PEDIDO + " WHERE REGEXP_REPLACE(c.telefone, '[^0-9]', '') = :tel "
                    + "ORDER BY pe.data_criacao DESC, pe.id_pedido DESC", new MapSqlParameterSource("tel", digitos));
        }
        if (!vazio(email)) {
            return montar(SELECT_PEDIDO + " WHERE c.email = :email ORDER BY pe.data_criacao DESC, pe.id_pedido DESC",
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
                SELECT i.id_pedido, i.id_produto AS idProduto, p.nome AS nome, p.imagem_url AS imagemUrl,
                       i.quantidade AS quantidade, i.preco_unitario AS precoUnitario, i.subtotal AS subtotal
                FROM item_pedido i JOIN produto p ON p.id_produto = i.id_produto
                WHERE i.id_pedido IN (:ids) ORDER BY i.id_item
                """, new MapSqlParameterSource("ids", ids)).forEach(r -> {
                    Object idPedido = r.remove("id_pedido");
                    itensPorPedido.computeIfAbsent(idPedido, k -> new ArrayList<>()).add(r);
                });

        List<Map<String, Object>> saida = new ArrayList<>();
        for (Map<String, Object> r : linhas) {
            Map<String, Object> pedido = new LinkedHashMap<>();
            pedido.put("id", r.get("id_pedido"));
            pedido.put("numero", r.get("numero"));
            pedido.put("status", r.get("status"));
            pedido.put("tipoEntrega", r.get("tipo_entrega"));
            pedido.put("enderecoEntrega", r.get("endereco_entrega"));
            pedido.put("frete", r.get("frete"));
            pedido.put("valorTotal", r.get("valor_total"));
            pedido.put("observacoes", r.get("observacoes"));
            pedido.put("motivoCancelamento", r.get("motivo_cancelamento"));
            pedido.put("idEntregador", r.get("id_entregador"));
            pedido.put("dataCriacao", data(r.get("data_criacao")));
            pedido.put("dataAtualizacao", data(r.get("data_atualizacao")));

            Map<String, Object> cliente = new LinkedHashMap<>();
            cliente.put("id", r.get("id_cliente"));
            cliente.put("nome", r.get("c_nome"));
            cliente.put("email", r.get("c_email"));
            cliente.put("telefone", r.get("c_telefone"));
            cliente.put("endereco", r.get("c_endereco"));
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

    private static Object data(Object o) {
        return o instanceof Timestamp t ? t.toLocalDateTime() : o;
    }

    private static boolean vazio(String s) {
        return s == null || s.isBlank();
    }
}
