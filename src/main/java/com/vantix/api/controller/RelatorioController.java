package com.vantix.api.controller;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Relatorios do painel do gerente (acesso so do gerente, ver SecurityConfig).
 * Segue docs/API_CONTRATO.md: todos aceitam ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD (inclusivo).
 */
@RestController
@RequestMapping("/api/relatorios")
public class RelatorioController {

    private static final LocalDate INICIO_PADRAO = LocalDate.of(1900, 1, 1);
    private static final LocalDate FIM_PADRAO = LocalDate.of(9999, 12, 31);

    private final NamedParameterJdbcTemplate jdbc;

    public RelatorioController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private MapSqlParameterSource periodo(LocalDate inicio, LocalDate fim) {
        return new MapSqlParameterSource()
                .addValue("inicio", inicio != null ? inicio : INICIO_PADRAO)
                .addValue("fim", fim != null ? fim : FIM_PADRAO);
    }

    @GetMapping("/resumo")
    public Map<String, Object> resumo(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate inicio,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fim) {
        String sql = """
                SELECT
                  COALESCE(SUM(CASE WHEN status <> 'cancelado' THEN valor_total END), 0) AS faturamento,
                  COUNT(*) AS totalPedidos,
                  COALESCE(SUM(status = 'entregue'), 0) AS pedidosEntregues,
                  COALESCE(SUM(status = 'cancelado'), 0) AS pedidosCancelados,
                  COALESCE(ROUND(SUM(CASE WHEN status <> 'cancelado' THEN valor_total END)
                         / NULLIF(SUM(status <> 'cancelado'), 0), 2), 0) AS ticketMedio
                FROM pedido
                WHERE DATE(criado_em) BETWEEN :inicio AND :fim
                """;
        return jdbc.queryForMap(sql, periodo(inicio, fim));
    }

    @GetMapping("/faturamento-diario")
    public List<Map<String, Object>> faturamentoDiario(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate inicio,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fim) {
        String sql = """
                SELECT DATE_FORMAT(criado_em, '%Y-%m-%d') AS dia,
                       COUNT(*) AS pedidos,
                       SUM(valor_total) AS faturamento
                FROM pedido
                WHERE status <> 'cancelado'
                  AND DATE(criado_em) BETWEEN :inicio AND :fim
                GROUP BY DATE_FORMAT(criado_em, '%Y-%m-%d')
                ORDER BY dia
                """;
        return jdbc.queryForList(sql, periodo(inicio, fim));
    }

    @GetMapping("/pedidos-por-status")
    public List<Map<String, Object>> pedidosPorStatus(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate inicio,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fim) {
        String sql = """
                SELECT status, COUNT(*) AS pedidos
                FROM pedido
                WHERE DATE(criado_em) BETWEEN :inicio AND :fim
                GROUP BY status
                ORDER BY pedidos DESC
                """;
        return jdbc.queryForList(sql, periodo(inicio, fim));
    }

    @GetMapping("/mais-vendidos")
    public List<Map<String, Object>> maisVendidos(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate inicio,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fim,
            @RequestParam(defaultValue = "5") int limite) {
        String sql = """
                SELECT p.id AS idProduto,
                       p.nome AS nome,
                       c.nome AS categoria,
                       SUM(i.quantidade) AS unidadesVendidas,
                       SUM(i.subtotal) AS receita
                FROM pedido_item i
                JOIN pedido pe ON pe.id = i.pedido_id AND pe.status <> 'cancelado'
                JOIN produto p ON p.id = i.produto_id
                JOIN categoria c ON c.id = p.categoria_id
                WHERE DATE(pe.criado_em) BETWEEN :inicio AND :fim
                GROUP BY p.id, p.nome, c.nome
                ORDER BY unidadesVendidas DESC, receita DESC
                LIMIT :limite
                """;
        return jdbc.queryForList(sql, periodo(inicio, fim).addValue("limite", Math.max(1, Math.min(limite, 50))));
    }

    @GetMapping("/formas-pagamento")
    public List<Map<String, Object>> formasPagamento(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate inicio,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fim) {
        String sql = """
                SELECT pg.forma AS forma, COUNT(*) AS pedidos, SUM(pg.valor) AS valor
                FROM pagamento pg
                JOIN pedido pe ON pe.id = pg.pedido_id AND pe.status <> 'cancelado'
                WHERE DATE(pe.criado_em) BETWEEN :inicio AND :fim
                GROUP BY pg.forma
                ORDER BY pedidos DESC
                """;
        return jdbc.queryForList(sql, periodo(inicio, fim));
    }

    @GetMapping("/pedidos-por-hora")
    public List<Map<String, Object>> pedidosPorHora(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate inicio,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate fim) {
        String sql = """
                SELECT HOUR(criado_em) AS hora, COUNT(*) AS pedidos
                FROM pedido
                WHERE DATE(criado_em) BETWEEN :inicio AND :fim
                GROUP BY HOUR(criado_em)
                ORDER BY hora
                """;
        return jdbc.queryForList(sql, periodo(inicio, fim));
    }

    @GetMapping("/estoque-baixo")
    public List<Map<String, Object>> estoqueBaixo() {
        String sql = """
                SELECT produto_id AS idProduto, nome, estoque
                FROM vw_estoque_baixo
                ORDER BY estoque, nome
                """;
        return jdbc.getJdbcTemplate().queryForList(sql);
    }
}