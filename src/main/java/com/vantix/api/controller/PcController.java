package com.vantix.api.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.exception.ApiException;
import com.vantix.api.pc.Peca;
import com.vantix.api.pc.PcRepositorio;
import com.vantix.api.pc.PcRepositorio.ItemMontagem;
import com.vantix.api.pc.RegrasPc;
import com.vantix.api.pc.RegrasPc.ResultadoRoda;
import com.vantix.api.pc.Requisito;

/**
 * Monte seu PC (docs/regras-inovacoes.md):
 *   GET  /api/especificacoes            pecas de hardware com dados tecnicos (?tipo=cpu)
 *   GET  /api/tarifas                   tarifa de energia por UF
 *   GET  /api/softwares                 jogos e programas com os requisitos
 *   GET  /api/montagens                 exemplos + as do cliente logado
 *   GET  /api/montagens/{id}            uma montagem
 *   POST /api/montagens                 salva (cliente logado)
 *   DELETE /api/montagens/{id}          apaga (dono)
 *   GET  /api/montagens/{id}/consumo    consumo, custo, selo da fonte e compatibilidade (?uf=&horas=)
 *   POST /api/montagens/avaliar         o mesmo, para uma montagem ainda nao salva
 *   GET  /api/comparar?a=&b=            comparacao entre duas montagens (?uf=&horas=)
 *   GET  /api/roda?montagem=&software=  "Roda ou nao?" + sugestoes de troca
 */
@RestController
@RequestMapping("/api")
public class PcController {

    public record MontagemRequest(String nome, String uf, Double horasUsoDia, List<ItemMontagem> itens) { }

    private final PcRepositorio repo;

    public PcController(PcRepositorio repo) {
        this.repo = repo;
    }

    @GetMapping("/especificacoes")
    public List<Map<String, Object>> especificacoes(@RequestParam(required = false) String tipo) {
        return repo.especificacoes(tipo);
    }

    @GetMapping("/tarifas")
    public List<Map<String, Object>> tarifas() {
        return repo.tarifas();
    }

    @GetMapping("/softwares")
    public List<Map<String, Object>> softwares() {
        return repo.softwares();
    }

    // ---------------------------------------------------------------- montagens

    @GetMapping("/montagens")
    public List<Map<String, Object>> montagens(Authentication auth) {
        return repo.montagens(clienteLogado(auth));
    }

    @GetMapping("/montagens/{id}")
    public Map<String, Object> montagem(@PathVariable int id, Authentication auth) {
        return montagemVisivel(id, auth);
    }

    @PostMapping("/montagens")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> salvar(@RequestBody MontagemRequest r, Authentication auth) {
        Integer idCliente = clienteLogado(auth);
        if (idCliente == null) {
            throw ApiException.forbidden("Entre com a sua conta de cliente para salvar montagens.");
        }
        if (r == null || r.nome() == null || r.nome().isBlank()) {
            throw ApiException.badRequest("Dê um nome para a montagem.");
        }
        if (r.nome().trim().length() > 100) {
            throw ApiException.badRequest("O nome da montagem pode ter no máximo 100 caracteres.");
        }
        List<Peca> pecas = repo.pecas(r.itens());
        if (pecas.isEmpty()) {
            throw ApiException.badRequest("Escolha pelo menos uma peça de hardware.");
        }
        String uf = r.uf() == null ? "SP" : r.uf().trim().toUpperCase();
        repo.valorKwh(uf); // valida a UF
        double horas = horas(r.horasUsoDia());
        List<ItemMontagem> itens = pecas.stream().map(p -> new ItemMontagem(p.idProduto(), p.quantidade())).toList();
        return repo.montagem(repo.criarMontagem(idCliente, r.nome().trim(), uf, horas, itens));
    }

    @DeleteMapping("/montagens/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void apagar(@PathVariable int id, Authentication auth) {
        Map<String, Object> m = repo.montagem(id);
        Integer dono = m.get("idCliente") == null ? null : ((Number) m.get("idCliente")).intValue();
        if (Boolean.TRUE.equals(m.get("exemplo")) || dono == null || !dono.equals(clienteLogado(auth))) {
            throw ApiException.forbidden("Você só pode apagar as suas montagens.");
        }
        try {
            repo.apagarMontagem(id);
        } catch (org.springframework.dao.DataIntegrityViolationException e) {
            throw ApiException.conflict("Esta montagem está ligada a um pedido e não pode ser apagada.");
        }
    }

    // ---------------------------------------------------------------- calculos

    @GetMapping("/montagens/{id}/consumo")
    public Map<String, Object> consumo(@PathVariable int id, @RequestParam(required = false) String uf,
                                       @RequestParam(required = false) Double horas, Authentication auth) {
        Map<String, Object> m = montagemVisivel(id, auth);
        String ufUsada = uf != null ? uf.toUpperCase() : (String) m.get("uf");
        double h = horas != null ? horas(horas) : ((Number) m.get("horasUsoDia")).doubleValue();
        return avaliacao(repo.pecas(PcRepositorio.itens(m)), ufUsada, h);
    }

    @PostMapping("/montagens/avaliar")
    public Map<String, Object> avaliar(@RequestBody MontagemRequest r) {
        if (r == null) {
            throw ApiException.badRequest("Envie as peças da montagem.");
        }
        return avaliacao(repo.pecas(r.itens()), r.uf() == null ? "SP" : r.uf().toUpperCase(), horas(r.horasUsoDia()));
    }

    private Map<String, Object> avaliacao(List<Peca> pecas, String uf, double horas) {
        double kwh = repo.valorKwh(uf);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("uf", uf);
        out.put("valorKwh", kwh);
        out.put("horasUsoDia", horas);
        out.put("avaliacao", RegrasPc.avaliar(pecas, kwh, horas));
        return out;
    }

    @GetMapping("/comparar")
    public Map<String, Object> comparar(@RequestParam int a, @RequestParam int b,
                                        @RequestParam(defaultValue = "SP") String uf,
                                        @RequestParam(defaultValue = "4") double horas, Authentication auth) {
        Map<String, Object> ma = montagemVisivel(a, auth), mb = montagemVisivel(b, auth);
        double kwh = repo.valorKwh(uf);
        double h = horas(horas);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("a", Map.of("id", a, "nome", ma.get("nome")));
        out.put("b", Map.of("id", b, "nome", mb.get("nome")));
        out.put("uf", uf.toUpperCase());
        out.put("horasUsoDia", h);
        RegrasPc.Comparacao c = RegrasPc.comparar((String) ma.get("nome"), repo.pecas(PcRepositorio.itens(ma)),
                (String) mb.get("nome"), repo.pecas(PcRepositorio.itens(mb)), kwh, h);
        out.put("metricas", c.metricas());
        out.put("resumo", c.resumo());
        return out;
    }

    @GetMapping("/roda")
    public Map<String, Object> roda(@RequestParam int montagem, @RequestParam int software, Authentication auth) {
        Map<String, Object> m = montagemVisivel(montagem, auth);
        Map<String, Object> sw = repo.software(software);
        List<Peca> pecas = repo.pecas(PcRepositorio.itens(m));
        List<Requisito> reqs = PcRepositorio.requisitos(sw);
        ResultadoRoda r = RegrasPc.roda(pecas, reqs, "jogo".equals(sw.get("tipo")));
        List<Integer> sugeridas = RegrasPc.sugerir(r.limitante(), reqs, pecas, repo.catalogoDisponivel())
                .stream().map(Peca::idProduto).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("montagem", Map.of("id", montagem, "nome", m.get("nome")));
        out.put("software", Map.of("id", software, "nome", sw.get("nome"), "tipo", sw.get("tipo")));
        out.put("resultado", r);
        out.put("desempenho", RegrasPc.desempenho(pecas));
        out.put("sugestoes", sugeridas.stream().map(repo::especificacao).toList());
        return out;
    }

    // ---------------------------------------------------------------- auxiliares

    /** Exemplos sao publicos; as demais so o dono (cliente) ou um funcionario veem. */
    private Map<String, Object> montagemVisivel(int id, Authentication auth) {
        Map<String, Object> m = repo.montagem(id);
        if (Boolean.TRUE.equals(m.get("exemplo"))) {
            return m;
        }
        boolean funcionario = auth != null && auth.getAuthorities().stream()
                .anyMatch(a -> !a.getAuthority().equals("ROLE_CLIENTE"));
        Integer dono = m.get("idCliente") == null ? null : ((Number) m.get("idCliente")).intValue();
        if (funcionario || (dono != null && dono.equals(clienteLogado(auth)))) {
            return m;
        }
        throw ApiException.notFound("Montagem não encontrada.");
    }

    private Integer clienteLogado(Authentication auth) {
        if (auth == null || auth.getAuthorities().stream().noneMatch(a -> a.getAuthority().equals("ROLE_CLIENTE"))) {
            return null;
        }
        return repo.clienteDoUsuario((Integer) auth.getPrincipal());
    }

    private static double horas(Double h) {
        if (h == null) {
            return 4;
        }
        if (h < 1 || h > 24) {
            throw ApiException.badRequest("As horas de uso por dia devem ficar entre 1 e 24.");
        }
        return h;
    }
}
