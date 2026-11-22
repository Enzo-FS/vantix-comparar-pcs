package com.vantix.api.controller;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.exception.ApiException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** Categorias e produtos (docs/API_CONTRATO.md, secao 2). */
@RestController
@RequestMapping("/api")
public class ProdutoController {

    public record ProdutoRequest(
            @NotNull(message = "Escolha a categoria.") Integer idCategoria,
            @NotBlank(message = "Informe o nome do produto.") String nome,
            String descricao,
            String marca,
            @NotNull(message = "Informe o preço.")
            @DecimalMin(value = "0.01", message = "O preço deve ser maior que zero.") BigDecimal preco,
            @DecimalMin(value = "0.01", message = "O preço antigo deve ser maior que zero.") BigDecimal precoAntigo,
            @NotNull(message = "Informe o estoque.")
            @Min(value = 0, message = "O estoque não pode ser negativo.") Integer estoque,
            String imagemUrl,
            Boolean destaque,
            Boolean disponivel) { }

    public record DisponivelRequest(@NotNull(message = "Informe se o produto está disponível.") Boolean disponivel) { }

    static final String SELECT_PRODUTO = """
            SELECT p.id_produto AS id, p.id_categoria AS idCategoria, c.nome AS categoria,
                   p.nome AS nome, p.descricao AS descricao, p.marca AS marca,
                   p.preco AS preco, p.preco_antigo AS precoAntigo, p.estoque AS estoque,
                   p.imagem_url AS imagemUrl, p.destaque AS destaque, p.disponivel AS disponivel
            FROM produto p JOIN categoria c ON c.id_categoria = p.id_categoria
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final JdbcTemplate simples;

    public ProdutoController(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.simples = jdbc.getJdbcTemplate();
    }

    @GetMapping("/categorias")
    public List<Map<String, Object>> categorias() {
        return simples.queryForList(
                "SELECT id_categoria AS id, nome, descricao FROM categoria ORDER BY nome");
    }

    @GetMapping("/produtos")
    public List<Map<String, Object>> listar(
            @RequestParam(required = false) String categoria,
            @RequestParam(required = false) String busca,
            @RequestParam(defaultValue = "false") boolean incluirInativos,
            Authentication auth) {
        boolean gerente = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> a.getAuthority().equals("ROLE_GERENTE"));
        StringBuilder sql = new StringBuilder(SELECT_PRODUTO).append(" WHERE 1 = 1");
        MapSqlParameterSource p = new MapSqlParameterSource();
        if (!(incluirInativos && gerente)) {
            sql.append(" AND p.disponivel = TRUE");
        }
        if (categoria != null && !categoria.isBlank()) {
            sql.append(" AND c.nome = :categoria");
            p.addValue("categoria", categoria.trim());
        }
        if (busca != null && !busca.isBlank()) {
            sql.append(" AND (p.nome LIKE :busca OR p.marca LIKE :busca OR p.descricao LIKE :busca)");
            p.addValue("busca", "%" + busca.trim() + "%");
        }
        sql.append(" ORDER BY p.destaque DESC, p.nome");
        return jdbc.queryForList(sql.toString(), p);
    }

    @GetMapping("/produtos/{id}")
    public Map<String, Object> buscar(@PathVariable int id) {
        return porId(id);
    }

    @PostMapping("/produtos")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> criar(@Valid @RequestBody ProdutoRequest r) {
        conferirCategoria(r.idCategoria());
        var keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update("""
                INSERT INTO produto (id_categoria, nome, descricao, marca, preco, preco_antigo, estoque,
                                     imagem_url, destaque, disponivel)
                VALUES (:idCategoria, :nome, :descricao, :marca, :preco, :precoAntigo, :estoque,
                        :imagemUrl, :destaque, :disponivel)
                """, parametros(r), keys, new String[] {"id_produto"});
        return porId(keys.getKey().intValue());
    }

    @PutMapping("/produtos/{id}")
    public Map<String, Object> atualizar(@PathVariable int id, @Valid @RequestBody ProdutoRequest r) {
        porId(id);
        conferirCategoria(r.idCategoria());
        jdbc.update("""
                UPDATE produto SET id_categoria = :idCategoria, nome = :nome, descricao = :descricao,
                       marca = :marca, preco = :preco, preco_antigo = :precoAntigo, estoque = :estoque,
                       imagem_url = :imagemUrl, destaque = :destaque, disponivel = :disponivel
                WHERE id_produto = :id
                """, parametros(r).addValue("id", id));
        return porId(id);
    }

    @PatchMapping("/produtos/{id}/disponivel")
    public Map<String, Object> disponibilidade(@PathVariable int id, @Valid @RequestBody DisponivelRequest r) {
        porId(id);
        simples.update("UPDATE produto SET disponivel = ? WHERE id_produto = ?", r.disponivel(), id);
        return porId(id);
    }

    @DeleteMapping("/produtos/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void excluir(@PathVariable int id) {
        porId(id);
        try {
            simples.update("DELETE FROM produto WHERE id_produto = ?", id);
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict("Este produto já tem pedidos e não pode ser excluído. Desative-o.");
        }
    }

    // ---------------------------------------------------------------- auxiliares

    private MapSqlParameterSource parametros(ProdutoRequest r) {
        return new MapSqlParameterSource()
                .addValue("idCategoria", r.idCategoria())
                .addValue("nome", r.nome().trim())
                .addValue("descricao", r.descricao())
                .addValue("marca", r.marca())
                .addValue("preco", r.preco())
                .addValue("precoAntigo", r.precoAntigo())
                .addValue("estoque", r.estoque())
                .addValue("imagemUrl", r.imagemUrl())
                .addValue("destaque", r.destaque() != null && r.destaque())
                .addValue("disponivel", r.disponivel() == null || r.disponivel());
    }

    private void conferirCategoria(int idCategoria) {
        Integer n = simples.queryForObject("SELECT COUNT(*) FROM categoria WHERE id_categoria = ?",
                Integer.class, idCategoria);
        if (n == null || n == 0) {
            throw ApiException.badRequest("Categoria não encontrada.");
        }
    }

    private Map<String, Object> porId(int id) {
        List<Map<String, Object>> l = jdbc.queryForList(SELECT_PRODUTO + " WHERE p.id_produto = :id",
                new MapSqlParameterSource("id", id));
        if (l.isEmpty()) {
            throw ApiException.notFound("Produto não encontrado.");
        }
        return l.get(0);
    }
}
