package com.vantix.api.controller;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.exception.ApiException;

/**
 * Controle de estoque (Portal do Estoque e gerente). Usa as tabelas estoque e movimentacao_estoque.
 *   GET   /api/estoque                          saldo de cada produto (quantidade, minimo, alerta)
 *   GET   /api/estoque/movimentacoes            historico de entradas, saidas, devolucoes e ajustes
 *   POST  /api/estoque/{idProduto}/entrada      recebimento de mercadoria { quantidade, motivo }
 *   POST  /api/estoque/{idProduto}/ajuste       contagem/correcao { novaQuantidade, motivo }
 *   PATCH /api/estoque/{idProduto}/minimo       estoque minimo { estoqueMinimo }
 * Saidas e devolucoes por venda sao gravadas pela trigger trg_pedido_estoque, nao por aqui.
 */
@RestController
@RequestMapping("/api/estoque")
public class EstoqueController {

    public record EntradaRequest(Integer quantidade, String motivo) { }
    public record AjusteRequest(Integer novaQuantidade, String motivo) { }
    public record MinimoRequest(Integer estoqueMinimo) { }

    private static final String SELECT_SALDO = """
            SELECT p.id AS idProduto, p.nome AS nome, p.marca AS marca, c.nome AS categoria,
                   p.imagem_url AS imagemUrl, p.disponivel AS disponivel,
                   e.quantidade AS quantidade, e.estoque_minimo AS estoqueMinimo,
                   (e.quantidade <= e.estoque_minimo) AS baixo, e.atualizado_em AS atualizadoEm
            FROM estoque e
            JOIN produto p ON p.id = e.produto_id
            JOIN categoria c ON c.id = p.categoria_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public EstoqueController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> saldo() {
        return jdbc.queryForList(SELECT_SALDO + " ORDER BY baixo DESC, e.quantidade, p.nome", new MapSqlParameterSource());
    }

    @GetMapping("/movimentacoes")
    public List<Map<String, Object>> movimentacoes(@RequestParam(required = false) Integer produto,
                                                   @RequestParam(required = false) String tipo,
                                                   @RequestParam(defaultValue = "200") int limite) {
        StringBuilder sql = new StringBuilder("""
                SELECT m.id AS id, m.produto_id AS idProduto, p.nome AS produto, m.tipo AS tipo,
                       m.quantidade AS quantidade, m.saldo_apos AS saldoApos, m.motivo AS motivo,
                       pe.numero AS pedido, u.nome AS usuario, m.criado_em AS criadoEm
                FROM movimentacao_estoque m
                JOIN produto p ON p.id = m.produto_id
                LEFT JOIN pedido pe ON pe.id = m.pedido_id
                LEFT JOIN usuario u ON u.id = m.usuario_id
                WHERE 1 = 1
                """);
        MapSqlParameterSource p = new MapSqlParameterSource();
        if (produto != null) {
            sql.append(" AND m.produto_id = :produto");
            p.addValue("produto", produto);
        }
        if (tipo != null && !tipo.isBlank()) {
            sql.append(" AND m.tipo = :tipo");
            p.addValue("tipo", tipo);
        }
        sql.append(" ORDER BY m.criado_em DESC, m.id DESC LIMIT :limite");
        p.addValue("limite", Math.max(1, Math.min(limite, 1000)));
        return jdbc.queryForList(sql.toString(), p);
    }

    @PostMapping("/{idProduto}/entrada")
    @Transactional
    public Map<String, Object> entrada(@PathVariable int idProduto, @RequestBody EntradaRequest r, Authentication auth) {
        if (r == null || r.quantidade() == null || r.quantidade() < 1 || r.quantidade() > 100000) {
            throw ApiException.badRequest("Informe a quantidade recebida (maior que zero).");
        }
        int atual = travar(idProduto);
        int novo = atual + r.quantidade();
        gravar(idProduto, novo, r.quantidade(), "entrada", vazio(r.motivo()) ? "Entrada de mercadoria" : r.motivo().trim(), auth);
        return porId(idProduto);
    }

    @PostMapping("/{idProduto}/ajuste")
    @Transactional
    public Map<String, Object> ajuste(@PathVariable int idProduto, @RequestBody AjusteRequest r, Authentication auth) {
        if (r == null || r.novaQuantidade() == null || r.novaQuantidade() < 0) {
            throw ApiException.badRequest("Informe a quantidade contada (zero ou mais).");
        }
        if (vazio(r.motivo())) {
            throw ApiException.badRequest("Informe o motivo do ajuste (ex.: inventário, avaria, extravio).");
        }
        int atual = travar(idProduto);
        if (atual == r.novaQuantidade()) {
            throw ApiException.badRequest("A quantidade contada é igual ao saldo atual; não há o que ajustar.");
        }
        gravar(idProduto, r.novaQuantidade(), r.novaQuantidade() - atual, "ajuste", r.motivo().trim(), auth);
        return porId(idProduto);
    }

    @PatchMapping("/{idProduto}/minimo")
    public Map<String, Object> minimo(@PathVariable int idProduto, @RequestBody MinimoRequest r) {
        if (r == null || r.estoqueMinimo() == null || r.estoqueMinimo() < 0 || r.estoqueMinimo() > 100000) {
            throw ApiException.badRequest("Informe o estoque mínimo (zero ou mais).");
        }
        exigirRegistroDeEstoque(idProduto);
        jdbc.update("UPDATE estoque SET estoque_minimo = :m WHERE produto_id = :p",
                new MapSqlParameterSource().addValue("m", r.estoqueMinimo()).addValue("p", idProduto));
        return porId(idProduto);
    }

    // ---------------------------------------------------------------- auxiliares

    /** Trava a linha do estoque (FOR UPDATE) e devolve o saldo atual. */
    private int travar(int idProduto) {
        List<Integer> q = jdbc.queryForList("SELECT quantidade FROM estoque WHERE produto_id = :p FOR UPDATE",
                new MapSqlParameterSource("p", idProduto), Integer.class);
        if (q.isEmpty()) {
            throw ApiException.notFound("Produto sem registro de estoque.");
        }
        return q.get(0);
    }

    private void exigirRegistroDeEstoque(int idProduto) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM estoque WHERE produto_id = :p",
                new MapSqlParameterSource("p", idProduto), Integer.class);
        if (n == null || n == 0) {
            throw ApiException.notFound("Produto sem registro de estoque.");
        }
    }

    private void gravar(int idProduto, int saldo, int quantidade, String tipo, String motivo, Authentication auth) {
        jdbc.update("UPDATE estoque SET quantidade = :q WHERE produto_id = :p",
                new MapSqlParameterSource().addValue("q", saldo).addValue("p", idProduto));
        jdbc.update("""
                INSERT INTO movimentacao_estoque (produto_id, usuario_id, tipo, quantidade, saldo_apos, motivo)
                VALUES (:p, :u, :t, :q, :s, :m)
                """, new MapSqlParameterSource().addValue("p", idProduto).addValue("u", auth.getPrincipal())
                        .addValue("t", tipo).addValue("q", quantidade).addValue("s", saldo)
                        .addValue("m", motivo.length() > 255 ? motivo.substring(0, 255) : motivo));
    }

    private Map<String, Object> porId(int idProduto) {
        return jdbc.queryForList(SELECT_SALDO + " WHERE p.id = :p", new MapSqlParameterSource("p", idProduto)).get(0);
    }

    private static boolean vazio(String s) {
        return s == null || s.isBlank();
    }
}
