package com.vantix.api.controller;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.exception.ApiException;
import com.vantix.api.pc.PcRepositorio;

/**
 * Cadastros do "Monte seu PC" no painel do gerente (so GERENTE, ver SecurityConfig):
 *   PUT    /api/especificacoes/{idProduto}   cria ou altera a especificacao de um produto
 *   DELETE /api/especificacoes/{idProduto}
 *   PUT    /api/tarifas/{uf}                 cria ou altera a tarifa da UF
 *   POST   /api/softwares, PUT /api/softwares/{id}, DELETE /api/softwares/{id}  (com os 3 requisitos)
 */
@RestController
@RequestMapping("/api")
public class CadastroPcController {

    public record EspecificacaoRequest(String tipoPeca, Integer consumoWatts, Integer scoreDesempenho, String soquete,
                                       String tipoMemoria, String formato, Integer vramGb, Integer capacidadeGb,
                                       Integer potenciaFonteW, BigDecimal eficienciaFonte) { }

    public record TarifaRequest(String distribuidora, BigDecimal valorKwh) { }

    public record RequisitoRequest(String nivel, Integer scoreCpuMin, Integer scoreGpuMin, Integer ramMinGb,
                                   Integer vramMinGb, Integer armazenamentoGb, Integer fpsEstimado) { }

    public record SoftwareRequest(String nome, String tipo, String categoria, String imagemUrl, Integer popularidade,
                                 List<RequisitoRequest> requisitos) { }

    private static final Set<String> TIPOS = Set.of("cpu", "gpu", "placa_mae", "ram", "ssd", "hdd", "fonte", "cooler", "gabinete");
    private static final List<String> NIVEIS = List.of("minimo", "recomendado", "ultra");

    private final NamedParameterJdbcTemplate jdbc;
    private final PcRepositorio repo;

    public CadastroPcController(PcRepositorio repo) {
        this.repo = repo;
        this.jdbc = repo.jdbc();
    }

    // ---------------------------------------------------------------- especificacoes

    @PutMapping("/especificacoes/{idProduto}")
    public Map<String, Object> salvarEspecificacao(@PathVariable int idProduto, @RequestBody EspecificacaoRequest r) {
        Integer existe = jdbc.queryForObject("SELECT COUNT(*) FROM produto WHERE id = :id",
                new MapSqlParameterSource("id", idProduto), Integer.class);
        if (existe == null || existe == 0) {
            throw ApiException.notFound("Produto não encontrado.");
        }
        if (r == null || r.tipoPeca() == null || !TIPOS.contains(r.tipoPeca())) {
            throw ApiException.badRequest("Escolha o tipo de peça.");
        }
        int consumo = r.consumoWatts() == null ? 0 : r.consumoWatts();
        int score = r.scoreDesempenho() == null ? 0 : r.scoreDesempenho();
        if (consumo < 0 || consumo > 600) {
            throw ApiException.badRequest("O consumo deve ficar entre 0 e 600 W.");
        }
        if (score < 0 || score > 100) {
            throw ApiException.badRequest("O score deve ficar entre 0 e 100.");
        }
        String t = r.tipoPeca();
        exigir(Set.of("cpu", "placa_mae").contains(t) && vazio(r.soquete()), "Informe o soquete.");
        exigir(Set.of("placa_mae", "ram").contains(t) && vazio(r.tipoMemoria()), "Informe o tipo de memória (DDR4 ou DDR5).");
        exigir(Set.of("placa_mae", "gabinete").contains(t) && vazio(r.formato()), "Informe o formato (ATX, mATX ou ITX).");
        exigir("gpu".equals(t) && (r.vramGb() == null || r.vramGb() <= 0), "Informe a VRAM da placa de vídeo.");
        exigir(Set.of("ram", "ssd", "hdd").contains(t) && (r.capacidadeGb() == null || r.capacidadeGb() <= 0),
                "Informe a capacidade em GB.");
        exigir("fonte".equals(t) && (r.potenciaFonteW() == null || r.potenciaFonteW() <= 0), "Informe a potência da fonte.");
        exigir("fonte".equals(t) && (r.eficienciaFonte() == null
                        || r.eficienciaFonte().compareTo(new BigDecimal("0.5")) < 0
                        || r.eficienciaFonte().compareTo(BigDecimal.ONE) > 0),
                "Informe a eficiência da fonte (0,80 White, 0,85 Bronze ou 0,90 Gold).");
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("produto", idProduto).addValue("tipo", t)
                .addValue("consumo", consumo).addValue("score", score)
                .addValue("soquete", vazio(r.soquete()) ? null : r.soquete().trim())
                .addValue("mem", vazio(r.tipoMemoria()) ? null : r.tipoMemoria())
                .addValue("formato", vazio(r.formato()) ? null : r.formato())
                .addValue("vram", r.vramGb()).addValue("cap", r.capacidadeGb())
                .addValue("pot", r.potenciaFonteW()).addValue("ef", r.eficienciaFonte());
        try {
            jdbc.update("""
                    INSERT INTO especificacao_tecnica (produto_id, tipo_peca, consumo_watts, score_desempenho, soquete,
                        tipo_memoria, formato, vram_gb, capacidade_gb, potencia_fonte_w, eficiencia_fonte)
                    VALUES (:produto, :tipo, :consumo, :score, :soquete, :mem, :formato, :vram, :cap, :pot, :ef)
                    ON DUPLICATE KEY UPDATE tipo_peca = VALUES(tipo_peca), consumo_watts = VALUES(consumo_watts),
                        score_desempenho = VALUES(score_desempenho), soquete = VALUES(soquete),
                        tipo_memoria = VALUES(tipo_memoria), formato = VALUES(formato), vram_gb = VALUES(vram_gb),
                        capacidade_gb = VALUES(capacidade_gb), potencia_fonte_w = VALUES(potencia_fonte_w),
                        eficiencia_fonte = VALUES(eficiencia_fonte)
                    """, p);
        } catch (DataIntegrityViolationException e) {
            throw ApiException.badRequest("Dados técnicos inválidos para este tipo de peça.");
        }
        return repo.especificacao(idProduto);
    }

    @DeleteMapping("/especificacoes/{idProduto}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void apagarEspecificacao(@PathVariable int idProduto) {
        jdbc.update("DELETE FROM especificacao_tecnica WHERE produto_id = :id", new MapSqlParameterSource("id", idProduto));
    }

    // ---------------------------------------------------------------- tarifas

    @PutMapping("/tarifas/{uf}")
    public List<Map<String, Object>> salvarTarifa(@PathVariable String uf, @RequestBody TarifaRequest r) {
        String u = uf.trim().toUpperCase();
        exigir(!u.matches("[A-Z]{2}"), "UF inválida.");
        exigir(r == null || vazio(r.distribuidora()), "Informe a distribuidora.");
        exigir(r.valorKwh() == null || r.valorKwh().signum() <= 0 || r.valorKwh().compareTo(new BigDecimal("10")) > 0,
                "Informe o valor do kWh (maior que zero).");
        jdbc.update("""
                INSERT INTO tarifa_energia (uf, distribuidora, valor_kwh) VALUES (:uf, :d, :v)
                ON DUPLICATE KEY UPDATE distribuidora = VALUES(distribuidora), valor_kwh = VALUES(valor_kwh)
                """, new MapSqlParameterSource().addValue("uf", u).addValue("d", r.distribuidora().trim())
                        .addValue("v", r.valorKwh()));
        return repo.tarifas();
    }

    // ---------------------------------------------------------------- softwares

    @PostMapping("/softwares")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> criarSoftware(@RequestBody SoftwareRequest r) {
        validar(r);
        var keys = new org.springframework.jdbc.support.GeneratedKeyHolder();
        try {
            jdbc.update("""
                    INSERT INTO software (nome, tipo, categoria, imagem_url, popularidade)
                    VALUES (:nome, :tipo, :cat, :img, :pop)
                    """, softwareParams(r), keys, new String[] {"id"});
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("Já existe um jogo ou programa com este nome.");
        }
        int id = keys.getKey().intValue();
        gravarRequisitos(id, r);
        return repo.software(id);
    }

    @PutMapping("/softwares/{id}")
    @Transactional
    public Map<String, Object> atualizarSoftware(@PathVariable int id, @RequestBody SoftwareRequest r) {
        repo.software(id);
        validar(r);
        try {
            jdbc.update("""
                    UPDATE software SET nome = :nome, tipo = :tipo, categoria = :cat, imagem_url = :img,
                           popularidade = :pop WHERE id = :id
                    """, softwareParams(r).addValue("id", id));
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("Já existe um jogo ou programa com este nome.");
        }
        jdbc.update("DELETE FROM requisito WHERE software_id = :id", new MapSqlParameterSource("id", id));
        gravarRequisitos(id, r);
        return repo.software(id);
    }

    @DeleteMapping("/softwares/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void apagarSoftware(@PathVariable int id) {
        repo.software(id);
        jdbc.update("DELETE FROM software WHERE id = :id", new MapSqlParameterSource("id", id));
    }

    private void validar(SoftwareRequest r) {
        exigir(r == null || vazio(r.nome()), "Informe o nome.");
        exigir(!"jogo".equals(r.tipo()) && !"programa".equals(r.tipo()), "O tipo deve ser jogo ou programa.");
        exigir(vazio(r.categoria()), "Informe a categoria (ex.: FPS, Edição de vídeo).");
        exigir(r.requisitos() == null || r.requisitos().size() != 3
                        || !r.requisitos().stream().map(RequisitoRequest::nivel).toList().containsAll(NIVEIS),
                "Informe os 3 níveis de requisito: mínimo, recomendado e ultra.");
        for (RequisitoRequest q : r.requisitos()) {
            exigir(q.scoreCpuMin() == null || q.scoreGpuMin() == null || q.scoreCpuMin() < 0 || q.scoreCpuMin() > 100
                    || q.scoreGpuMin() < 0 || q.scoreGpuMin() > 100, "Os scores mínimos devem ficar entre 0 e 100.");
            exigir(q.ramMinGb() == null || q.ramMinGb() <= 0, "Informe a RAM mínima de cada nível.");
            exigir(q.armazenamentoGb() == null || q.armazenamentoGb() <= 0, "Informe o armazenamento de cada nível.");
            exigir(q.vramMinGb() != null && q.vramMinGb() < 0, "A VRAM não pode ser negativa.");
        }
    }

    private MapSqlParameterSource softwareParams(SoftwareRequest r) {
        return new MapSqlParameterSource().addValue("nome", r.nome().trim()).addValue("tipo", r.tipo())
                .addValue("cat", r.categoria().trim()).addValue("img", vazio(r.imagemUrl()) ? null : r.imagemUrl().trim())
                .addValue("pop", r.popularidade() == null ? 0 : r.popularidade());
    }

    private void gravarRequisitos(int id, SoftwareRequest r) {
        for (RequisitoRequest q : r.requisitos()) {
            jdbc.update("""
                    INSERT INTO requisito (software_id, nivel, score_cpu_min, score_gpu_min, ram_min_gb, vram_min_gb,
                                           armazenamento_gb, fps_estimado)
                    VALUES (:s, :n, :cpu, :gpu, :ram, :vram, :disco, :fps)
                    """, new MapSqlParameterSource().addValue("s", id).addValue("n", q.nivel())
                            .addValue("cpu", q.scoreCpuMin()).addValue("gpu", q.scoreGpuMin())
                            .addValue("ram", q.ramMinGb()).addValue("vram", q.vramMinGb() == null ? 0 : q.vramMinGb())
                            .addValue("disco", q.armazenamentoGb())
                            .addValue("fps", "jogo".equals(r.tipo()) ? q.fpsEstimado() : null));
        }
    }

    private static void exigir(boolean erro, String mensagem) {
        if (erro) {
            throw ApiException.badRequest(mensagem);
        }
    }

    private static boolean vazio(String s) {
        return s == null || s.isBlank();
    }
}
