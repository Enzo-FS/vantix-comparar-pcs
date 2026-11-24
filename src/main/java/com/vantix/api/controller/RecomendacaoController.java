package com.vantix.api.controller;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * "Quem comprou tambem levou". Rota publica.
 * GET /api/recomendacoes?produtos=1,7&limite=4
 * Ordena por: vezes comprados juntos (vw_comprados_juntos) + o peso de cada linha da tabela recomendacao
 * (manual e compatibilidade). Remove os produtos informados, os indisponiveis e os sem estoque.
 */
@RestController
@RequestMapping("/api/recomendacoes")
public class RecomendacaoController {

    private final NamedParameterJdbcTemplate jdbc;

    public RecomendacaoController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<Map<String, Object>> recomendar(
            @RequestParam List<Long> produtos,
            @RequestParam(defaultValue = "4") int limite) {
        if (produtos == null || produtos.isEmpty()) {
            return List.of();
        }
        String sql = """
                SELECT p.id AS id,
                       p.categoria_id AS idCategoria,
                       c.nome AS categoria,
                       p.nome AS nome,
                       p.descricao AS descricao,
                       p.marca AS marca,
                       p.preco AS preco,
                       p.preco_antigo AS precoAntigo,
                       e.quantidade AS estoque,
                       p.imagem_url AS imagemUrl,
                       p.destaque AS destaque,
                       p.disponivel AS disponivel
                FROM (
                    SELECT recomendado_id AS id, SUM(vezes) AS pontos
                    FROM vw_comprados_juntos
                    WHERE produto_id IN (:ids)
                    GROUP BY recomendado_id
                    UNION ALL
                    SELECT produto_recomendado_id AS id, peso AS pontos
                    FROM recomendacao
                    WHERE produto_origem_id IN (:ids)
                ) r
                JOIN produto p ON p.id = r.id
                JOIN categoria c ON c.id = p.categoria_id
                JOIN estoque e ON e.produto_id = p.id
                WHERE p.id NOT IN (:ids)
                  AND p.disponivel = TRUE
                  AND e.quantidade > 0
                GROUP BY p.id, p.categoria_id, c.nome, p.nome, p.descricao, p.marca,
                         p.preco, p.preco_antigo, e.quantidade, p.imagem_url, p.destaque, p.disponivel
                ORDER BY SUM(r.pontos) DESC, p.destaque DESC, p.nome
                LIMIT :limite
                """;
        return jdbc.queryForList(sql, new MapSqlParameterSource()
                .addValue("ids", produtos)
                .addValue("limite", Math.max(1, Math.min(limite, 20))));
    }
}
