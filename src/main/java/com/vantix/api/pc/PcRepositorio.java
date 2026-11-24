package com.vantix.api.pc;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import com.vantix.api.exception.ApiException;

/** Acesso ao MySQL das tabelas do "Monte seu PC". Os calculos ficam em RegrasPc. */
@Repository
public class PcRepositorio {

    public record ItemMontagem(Integer idProduto, Integer quantidade) { }

    static final String SELECT_ESPEC = """
            SELECT p.id AS idProduto, p.nome AS nome, p.marca AS marca, p.preco AS preco,
                   p.preco_antigo AS precoAntigo, p.imagem_url AS imagemUrl, p.disponivel AS disponivel,
                   c.nome AS categoria, COALESCE(s.quantidade, 0) AS estoque,
                   e.id AS id, e.tipo_peca AS tipoPeca, e.consumo_watts AS consumoWatts,
                   e.score_desempenho AS scoreDesempenho, e.soquete AS soquete, e.tipo_memoria AS tipoMemoria,
                   e.formato AS formato, e.vram_gb AS vramGb, e.capacidade_gb AS capacidadeGb,
                   e.potencia_fonte_w AS potenciaFonteW, e.eficiencia_fonte AS eficienciaFonte
            FROM especificacao_tecnica e
            JOIN produto p ON p.id = e.produto_id
            JOIN categoria c ON c.id = p.categoria_id
            LEFT JOIN estoque s ON s.produto_id = p.id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public PcRepositorio(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---------------------------------------------------------------- especificacoes

    public List<Map<String, Object>> especificacoes(String tipo) {
        if (tipo == null || tipo.isBlank()) {
            return jdbc.queryForList(SELECT_ESPEC + " ORDER BY e.tipo_peca, p.preco", new MapSqlParameterSource());
        }
        return jdbc.queryForList(SELECT_ESPEC + " WHERE e.tipo_peca = :t ORDER BY p.preco",
                new MapSqlParameterSource("t", tipo));
    }

    public Map<String, Object> especificacao(int idProduto) {
        List<Map<String, Object>> l = jdbc.queryForList(SELECT_ESPEC + " WHERE p.id = :id",
                new MapSqlParameterSource("id", idProduto));
        if (l.isEmpty()) {
            throw ApiException.notFound("Este produto não tem especificação técnica.");
        }
        return l.get(0);
    }

    /** Pecas de hardware disponiveis e com estoque (base das sugestoes de troca). */
    public List<Peca> catalogoDisponivel() {
        return jdbc.queryForList(SELECT_ESPEC + " WHERE p.disponivel = TRUE AND s.quantidade > 0",
                new MapSqlParameterSource()).stream().map(r -> paraPeca(r, 1)).toList();
    }

    /** Converte itens (id + quantidade) em pecas. Produtos sem especificacao sao ignorados. */
    public List<Peca> pecas(List<ItemMontagem> itens) {
        if (itens == null || itens.isEmpty()) {
            return List.of();
        }
        Map<Integer, Integer> qtd = new TreeMap<>();
        for (ItemMontagem i : itens) {
            if (i.idProduto() == null) {
                throw ApiException.badRequest("Item da montagem sem produto.");
            }
            int q = i.quantidade() == null ? 1 : i.quantidade();
            if (q < 1 || q > 8) {
                throw ApiException.badRequest("Quantidade inválida na montagem (de 1 a 8 por peça).");
            }
            qtd.merge(i.idProduto(), q, Integer::sum);
        }
        return jdbc.queryForList(SELECT_ESPEC + " WHERE p.id IN (:ids) ORDER BY p.id",
                        new MapSqlParameterSource("ids", qtd.keySet()))
                .stream().map(r -> paraPeca(r, qtd.get(((Number) r.get("idProduto")).intValue()))).toList();
    }

    static Peca paraPeca(Map<String, Object> r, int quantidade) {
        return new Peca(
                ((Number) r.get("idProduto")).intValue(), (String) r.get("nome"),
                ((BigDecimal) r.get("preco")).doubleValue(), quantidade, (String) r.get("tipoPeca"),
                ((Number) r.get("consumoWatts")).intValue(), ((Number) r.get("scoreDesempenho")).intValue(),
                (String) r.get("soquete"), (String) r.get("tipoMemoria"), (String) r.get("formato"),
                inteiro(r.get("vramGb")), inteiro(r.get("capacidadeGb")), inteiro(r.get("potenciaFonteW")),
                r.get("eficienciaFonte") != null ? ((BigDecimal) r.get("eficienciaFonte")).doubleValue() : null);
    }

    private static Integer inteiro(Object o) {
        return o == null ? null : ((Number) o).intValue();
    }

    // ---------------------------------------------------------------- tarifas

    public List<Map<String, Object>> tarifas() {
        return jdbc.queryForList("SELECT id, uf, distribuidora, valor_kwh AS valorKwh FROM tarifa_energia ORDER BY uf",
                new MapSqlParameterSource());
    }

    public double valorKwh(String uf) {
        List<BigDecimal> v = jdbc.queryForList("SELECT valor_kwh FROM tarifa_energia WHERE uf = :uf",
                new MapSqlParameterSource("uf", uf == null ? "" : uf.trim().toUpperCase()), BigDecimal.class);
        if (v.isEmpty()) {
            throw ApiException.badRequest("Não há tarifa de energia cadastrada para a UF " + uf + ".");
        }
        return v.get(0).doubleValue();
    }

    // ---------------------------------------------------------------- softwares

    public List<Map<String, Object>> softwares() {
        List<Map<String, Object>> lista = jdbc.queryForList("""
                SELECT id, nome, tipo, categoria, imagem_url AS imagemUrl, popularidade
                FROM software ORDER BY popularidade DESC, nome
                """, new MapSqlParameterSource());
        Map<Object, List<Map<String, Object>>> reqs = new LinkedHashMap<>();
        jdbc.queryForList("""
                SELECT software_id, nivel, score_cpu_min AS scoreCpuMin, score_gpu_min AS scoreGpuMin,
                       ram_min_gb AS ramMinGb, vram_min_gb AS vramMinGb, armazenamento_gb AS armazenamentoGb,
                       fps_estimado AS fpsEstimado
                FROM requisito ORDER BY software_id, FIELD(nivel, 'minimo', 'recomendado', 'ultra')
                """, new MapSqlParameterSource()).forEach(r -> {
                    Object sw = r.remove("software_id");
                    reqs.computeIfAbsent(sw, k -> new ArrayList<>()).add(r);
                });
        for (Map<String, Object> s : lista) {
            s.put("requisitos", reqs.getOrDefault(s.get("id"), List.of()));
        }
        return lista;
    }

    public Map<String, Object> software(int id) {
        return softwares().stream().filter(s -> ((Number) s.get("id")).intValue() == id).findFirst()
                .orElseThrow(() -> ApiException.notFound("Jogo ou programa não encontrado."));
    }

    @SuppressWarnings("unchecked")
    public static List<Requisito> requisitos(Map<String, Object> software) {
        return ((List<Map<String, Object>>) software.get("requisitos")).stream().map(r -> new Requisito(
                (String) r.get("nivel"), ((Number) r.get("scoreCpuMin")).intValue(),
                ((Number) r.get("scoreGpuMin")).intValue(), ((Number) r.get("ramMinGb")).intValue(),
                ((Number) r.get("vramMinGb")).intValue(), ((Number) r.get("armazenamentoGb")).intValue(),
                inteiro(r.get("fpsEstimado")))).toList();
    }

    // ---------------------------------------------------------------- montagens

    private static final String SELECT_MONTAGEM = """
            SELECT id, cliente_id AS idCliente, nome, horas_uso_dia AS horasUsoDia, uf, exemplo, criado_em AS criadoEm
            FROM montagem
            """;

    /** As montagens de exemplo e, se houver cliente logado, as dele. */
    public List<Map<String, Object>> montagens(Integer idCliente) {
        List<Map<String, Object>> l = jdbc.queryForList(SELECT_MONTAGEM
                        + " WHERE exemplo = TRUE OR (cliente_id = :c AND :c IS NOT NULL) ORDER BY exemplo DESC, id",
                new MapSqlParameterSource("c", idCliente));
        anexarItens(l);
        return l;
    }

    public Map<String, Object> montagem(int id) {
        List<Map<String, Object>> l = jdbc.queryForList(SELECT_MONTAGEM + " WHERE id = :id",
                new MapSqlParameterSource("id", id));
        if (l.isEmpty()) {
            throw ApiException.notFound("Montagem não encontrada.");
        }
        anexarItens(l);
        return l.get(0);
    }

    private void anexarItens(List<Map<String, Object>> montagens) {
        if (montagens.isEmpty()) {
            return;
        }
        List<Object> ids = montagens.stream().map(m -> m.get("id")).toList();
        Map<Object, List<Map<String, Object>>> itens = new LinkedHashMap<>();
        jdbc.queryForList("""
                SELECT montagem_id, produto_id AS idProduto, quantidade FROM montagem_item
                WHERE montagem_id IN (:ids) ORDER BY id
                """, new MapSqlParameterSource("ids", ids)).forEach(r -> {
                    Object m = r.remove("montagem_id");
                    itens.computeIfAbsent(m, k -> new ArrayList<>()).add(r);
                });
        for (Map<String, Object> m : montagens) {
            m.put("itens", itens.getOrDefault(m.get("id"), List.of()));
        }
    }

    @SuppressWarnings("unchecked")
    public static List<ItemMontagem> itens(Map<String, Object> montagem) {
        return ((List<Map<String, Object>>) montagem.get("itens")).stream()
                .map(i -> new ItemMontagem(((Number) i.get("idProduto")).intValue(), ((Number) i.get("quantidade")).intValue()))
                .toList();
    }

    public int criarMontagem(Integer idCliente, String nome, String uf, double horas, List<ItemMontagem> itens) {
        var keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update("INSERT INTO montagem (cliente_id, nome, horas_uso_dia, uf, exemplo) VALUES (:c, :n, :h, :uf, FALSE)",
                new MapSqlParameterSource().addValue("c", idCliente).addValue("n", nome).addValue("h", horas)
                        .addValue("uf", uf), keys, new String[] {"id"});
        int id = keys.getKey().intValue();
        Map<Integer, Integer> qtd = new TreeMap<>();
        itens.forEach(i -> qtd.merge(i.idProduto(), i.quantidade() == null ? 1 : i.quantidade(), Integer::sum));
        qtd.forEach((p, q) -> jdbc.update(
                "INSERT INTO montagem_item (montagem_id, produto_id, quantidade) VALUES (:m, :p, :q)",
                new MapSqlParameterSource().addValue("m", id).addValue("p", p).addValue("q", q)));
        return id;
    }

    public void apagarMontagem(int id) {
        jdbc.update("DELETE FROM montagem WHERE id = :id", new MapSqlParameterSource("id", id));
    }

    public Integer clienteDoUsuario(int idUsuario) {
        List<Integer> l = jdbc.queryForList("SELECT id FROM cliente WHERE usuario_id = :u",
                new MapSqlParameterSource("u", idUsuario), Integer.class);
        return l.isEmpty() ? null : l.get(0);
    }

    public NamedParameterJdbcTemplate jdbc() {
        return jdbc;
    }
}
