package com.vantix.api.pc;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Regras das inovacoes (docs/regras-inovacoes.md). Funcoes puras: sem banco, sem Spring.
 * A mesma logica existe em TypeScript em src/app/core/pc/regras.ts (calculo instantaneo na tela);
 * os testes dos dois lados usam os mesmos numeros das montagens de exemplo.
 */
public final class RegrasPc {

    private RegrasPc() { }

    public static final double FATOR_USO = 0.7;
    public static final double FATOR_CARGA = 1.0;
    public static final double EFICIENCIA_SEM_FONTE = 0.80;
    public static final double FOLGA_MINIMA = 0.20;
    public static final int SCORE_GPU_INTEGRADA = 8;
    public static final int DIAS_POR_MES = 30;
    public static final List<String> NIVEIS = List.of("minimo", "recomendado", "ultra");

    // =====================================================================
    // Resultados
    // =====================================================================

    public record Consumo(int somaWatts, double consumoUsoW, double consumoCargaW, Integer potenciaFonteW,
                          double eficienciaFonte, double tomadaUsoW, double tomadaCargaW,
                          double custoMensal, double custoAnual, String seloFonte, Double folgaPercentual,
                          String mensagemFonte) { }

    /** nivel: "erro" (vermelho) ou "alerta" (amarelo). categoria: incompatibilidade | faltando | fonte | aviso. */
    public record Aviso(String codigo, String nivel, String categoria, String mensagem) { }

    public record Desempenho(int scoreCpu, int scoreGpu, int scoreTotal, int ramGb, int vramGb,
                             int armazenamentoGb, boolean gpuIntegrada, double preco) { }

    public record Avaliacao(Consumo consumo, Desempenho desempenho, List<Aviso> avisos,
                            List<String> faltando, boolean temIncompatibilidade) { }

    public record Criterio(String criterio, String rotulo, int exigido, int montagem, boolean ok) { }

    public record NivelAvaliado(String nivel, boolean atendido, Integer fpsEstimado, List<Criterio> criterios) { }

    /** criterio que limita, a peca correspondente e o proximo nivel que ele impede. */
    public record Limitante(String criterio, String tipoPeca, String proximoNivel, int exigido, int atual,
                            double deficit) { }

    public record ResultadoRoda(String nivel, Integer fpsEstimado, List<NivelAvaliado> niveis, Limitante limitante) { }

    public record Metrica(String metrica, String rotulo, double a, double b, Double diferencaPercentual,
                          String melhor) { }

    public record Comparacao(List<Metrica> metricas, String resumo) { }

    // =====================================================================
    // Inovacao 1: consumo e custo de energia
    // =====================================================================

    public static Consumo consumo(List<Peca> pecas, double valorKwh, double horasDia) {
        int soma = 0;
        Peca fonte = null;
        for (Peca p : pecas) {
            if ("fonte".equals(p.tipoPeca())) {
                if (fonte == null) {
                    fonte = p;
                }
            } else {
                soma += p.consumoWatts() * p.quantidade();
            }
        }
        double uso = soma * FATOR_USO;
        double carga = soma * FATOR_CARGA;
        double ef = fonte != null && fonte.eficienciaFonte() != null ? fonte.eficienciaFonte() : EFICIENCIA_SEM_FONTE;
        double tomadaUso = uso / ef;
        double tomadaCarga = carga / ef;
        double mensal = tomadaUso / 1000.0 * horasDia * DIAS_POR_MES * valorKwh;
        double anual = mensal * 12;

        Integer potencia = fonte != null ? fonte.potenciaFonteW() : null;
        String selo;
        Double folga = null;
        String msg;
        if (potencia == null) {
            selo = "sem_fonte";
            msg = "Sua montagem não tem fonte.";
        } else {
            folga = carga > 0 ? round1((potencia - carga) / carga * 100) : null;
            if (potencia < carga) {
                selo = "vermelho";
                msg = String.format("A fonte de %d W não aguenta a carga máxima de %s W.", potencia, fmt0(carga));
            } else if (potencia < carga * (1 + FOLGA_MINIMA)) {
                selo = "amarelo";
                msg = String.format("Fonte no limite: folga de %s%%. Recomendado: pelo menos %d W.",
                        fmt1(folga), (int) Math.ceil(carga * (1 + FOLGA_MINIMA)));
            } else {
                selo = "verde";
                msg = folga == null ? "Fonte adequada." : String.format("Fonte com folga de %s%%.", fmt1(folga));
            }
        }
        return new Consumo(soma, round1(uso), round1(carga), potencia, ef, round1(tomadaUso), round1(tomadaCarga),
                round2(mensal), round2(anual), selo, folga, msg);
    }

    // =====================================================================
    // Desempenho (usado no "Roda ou nao?" e na comparacao)
    // =====================================================================

    public static Desempenho desempenho(List<Peca> pecas) {
        Peca cpu = primeira(pecas, "cpu");
        Peca gpu = pecas.stream().filter(p -> "gpu".equals(p.tipoPeca()))
                .max(Comparator.comparingInt(Peca::scoreDesempenho)).orElse(null);
        int scoreCpu = cpu != null ? cpu.scoreDesempenho() : 0;
        int scoreGpu = gpu != null ? gpu.scoreDesempenho() : SCORE_GPU_INTEGRADA;
        int ram = somaCapacidade(pecas, "ram");
        int disco = somaCapacidade(pecas, "ssd") + somaCapacidade(pecas, "hdd");
        int vram = gpu != null && gpu.vramGb() != null ? gpu.vramGb() : 0;
        double preco = pecas.stream().mapToDouble(p -> p.preco() * p.quantidade()).sum();
        return new Desempenho(scoreCpu, scoreGpu, scoreTotal(scoreCpu, scoreGpu), ram, vram, disco, gpu == null,
                round2(preco));
    }

    public static int scoreTotal(int cpu, int gpu) {
        return (int) Math.round(0.4 * cpu + 0.6 * gpu);
    }

    // =====================================================================
    // Compatibilidade e pecas faltando
    // =====================================================================

    private static final Map<String, Integer> TAMANHO_FORMATO = Map.of("ITX", 1, "mATX", 2, "ATX", 3);
    private static final Map<String, String> NOME_PECA = Map.of(
            "cpu", "processador", "placa_mae", "placa-mãe", "ram", "memória RAM", "armazenamento",
            "armazenamento (SSD ou HD)", "fonte", "fonte", "gabinete", "gabinete", "cooler", "cooler", "gpu",
            "placa de vídeo");

    public static Avaliacao avaliar(List<Peca> pecas, double valorKwh, double horasDia) {
        Consumo consumo = consumo(pecas, valorKwh, horasDia);
        List<Aviso> avisos = new ArrayList<>();
        Peca cpu = primeira(pecas, "cpu");
        Peca placa = primeira(pecas, "placa_mae");
        Peca gabinete = primeira(pecas, "gabinete");
        Peca cooler = primeira(pecas, "cooler");

        // C1 soquete CPU x placa
        if (cpu != null && placa != null && !igual(cpu.soquete(), placa.soquete())) {
            avisos.add(new Aviso("C1", "erro", "incompatibilidade", String.format(
                    "Soquete %s não é compatível com a placa %s.", cpu.soquete(), placa.soquete())));
        }
        // C2 memoria x placa
        if (placa != null) {
            for (Peca ram : todas(pecas, "ram")) {
                if (!igual(ram.tipoMemoria(), placa.tipoMemoria())) {
                    avisos.add(new Aviso("C2", "erro", "incompatibilidade", String.format(
                            "Memória %s não é compatível com a placa %s.", ram.tipoMemoria(), placa.tipoMemoria())));
                    break;
                }
            }
        }
        // C3 memoria suportada pela CPU x placa
        if (cpu != null && placa != null && cpu.tipoMemoria() != null && placa.tipoMemoria() != null
                && !cpu.tipoMemoria().equals(placa.tipoMemoria())) {
            avisos.add(new Aviso("C3", "erro", "incompatibilidade", String.format(
                    "O processador usa %s, mas a placa-mãe é %s.", cpu.tipoMemoria(), placa.tipoMemoria())));
        }
        // C4 formato da placa x gabinete
        if (placa != null && gabinete != null && placa.formato() != null && gabinete.formato() != null
                && TAMANHO_FORMATO.getOrDefault(placa.formato(), 3) > TAMANHO_FORMATO.getOrDefault(gabinete.formato(), 3)) {
            avisos.add(new Aviso("C4", "erro", "incompatibilidade", String.format(
                    "Placa %s não cabe no gabinete %s.", placa.formato(), gabinete.formato())));
        }
        // C5 no maximo 1 de cada peca unica
        for (String tipo : List.of("cpu", "placa_mae", "fonte", "gabinete")) {
            int n = todas(pecas, tipo).stream().mapToInt(Peca::quantidade).sum();
            if (n > 1) {
                avisos.add(new Aviso("C5", "erro", "incompatibilidade", String.format(
                        "A montagem tem %d unidades de %s; use apenas 1.", n, NOME_PECA.get(tipo))));
            }
        }
        // C6 cooler x soquete
        if (cooler != null && cpu != null && cooler.soquete() != null && cpu.soquete() != null
                && !List.of(cooler.soquete().split("/")).contains(cpu.soquete())) {
            avisos.add(new Aviso("C6", "alerta", "aviso", String.format(
                    "O cooler não lista suporte ao soquete %s.", cpu.soquete())));
        }
        // C7 sem GPU dedicada
        if (primeira(pecas, "gpu") == null && !pecas.isEmpty()) {
            avisos.add(new Aviso("C7", "alerta", "aviso",
                    "Sem placa de vídeo: usando o vídeo integrado do processador."));
        }
        // C8 fonte
        if ("vermelho".equals(consumo.seloFonte())) {
            avisos.add(new Aviso("C8", "erro", "fonte", consumo.mensagemFonte()));
        } else if ("amarelo".equals(consumo.seloFonte())) {
            avisos.add(new Aviso("C8", "alerta", "fonte", consumo.mensagemFonte()));
        }

        // Pecas essenciais
        List<String> faltando = new ArrayList<>();
        for (String tipo : List.of("cpu", "placa_mae", "ram", "armazenamento", "fonte", "gabinete")) {
            boolean tem = "armazenamento".equals(tipo)
                    ? primeira(pecas, "ssd") != null || primeira(pecas, "hdd") != null
                    : primeira(pecas, tipo) != null;
            if (!tem) {
                faltando.add(tipo);
                avisos.add(new Aviso("F", "erro", "faltando", "Sua montagem não tem " + NOME_PECA.get(tipo) + "."));
            }
        }
        if (cooler == null && !pecas.isEmpty()) {
            avisos.add(new Aviso("F", "alerta", "faltando",
                    "Sem cooler: confira se o processador acompanha cooler box."));
        }
        boolean incompat = avisos.stream().anyMatch(a -> "erro".equals(a.nivel())
                && ("incompatibilidade".equals(a.categoria()) || "fonte".equals(a.categoria())));
        return new Avaliacao(consumo, desempenho(pecas), avisos, faltando, incompat);
    }

    // =====================================================================
    // Inovacao 3: "Roda ou nao?"
    // =====================================================================

    public static ResultadoRoda roda(List<Peca> pecas, List<Requisito> requisitos, boolean jogo) {
        Desempenho d = desempenho(pecas);
        List<NivelAvaliado> niveis = new ArrayList<>();
        String melhor = "nao_roda";
        Integer fps = null;
        for (String nivel : NIVEIS) {
            Requisito r = requisitos.stream().filter(x -> nivel.equals(x.nivel())).findFirst().orElse(null);
            if (r == null) {
                continue;
            }
            List<Criterio> cs = criterios(d, r);
            boolean ok = cs.stream().allMatch(Criterio::ok);
            niveis.add(new NivelAvaliado(nivel, ok, jogo ? r.fpsEstimado() : null, cs));
            if (ok) {
                melhor = nivel;
                fps = jogo ? r.fpsEstimado() : null;
            }
        }
        Limitante limitante = null;
        if (!"ultra".equals(melhor)) {
            int idx = "nao_roda".equals(melhor) ? 0 : NIVEIS.indexOf(melhor) + 1;
            String proximo = NIVEIS.get(idx);
            NivelAvaliado alvo = niveis.stream().filter(n -> proximo.equals(n.nivel())).findFirst().orElse(null);
            if (alvo != null) {
                Criterio pior = null;
                double maiorDeficit = -1;
                for (Criterio c : alvo.criterios()) {
                    if (!c.ok()) {
                        double deficit = c.exigido() > 0 ? (c.exigido() - c.montagem()) / (double) c.exigido() : 1;
                        if (deficit > maiorDeficit) {
                            maiorDeficit = deficit;
                            pior = c;
                        }
                    }
                }
                if (pior != null) {
                    limitante = new Limitante(pior.criterio(), pecaDoCriterio(pior.criterio()), proximo,
                            pior.exigido(), pior.montagem(), round1(maiorDeficit * 100));
                }
            }
        }
        return new ResultadoRoda(melhor, fps, niveis, limitante);
    }

    private static List<Criterio> criterios(Desempenho d, Requisito r) {
        return List.of(
                new Criterio("cpu", "Processador (score)", r.scoreCpuMin(), d.scoreCpu(), d.scoreCpu() >= r.scoreCpuMin()),
                new Criterio("gpu", "Placa de vídeo (score)", r.scoreGpuMin(), d.scoreGpu(), d.scoreGpu() >= r.scoreGpuMin()),
                new Criterio("ram", "Memória RAM (GB)", r.ramMinGb(), d.ramGb(), d.ramGb() >= r.ramMinGb()),
                new Criterio("vram", "Memória de vídeo (GB)", r.vramMinGb(), d.vramGb(), d.vramGb() >= r.vramMinGb()),
                new Criterio("armazenamento", "Armazenamento (GB)", r.armazenamentoGb(), d.armazenamentoGb(),
                        d.armazenamentoGb() >= r.armazenamentoGb()));
    }

    public static String pecaDoCriterio(String criterio) {
        return switch (criterio) {
            case "cpu" -> "cpu";
            case "gpu", "vram" -> "gpu";
            case "ram" -> "ram";
            default -> "ssd";
        };
    }

    /**
     * Ate 3 pecas do catalogo que resolvem o criterio que limita, compativeis com o resto da montagem,
     * do menor para o maior preco. O catalogo ja deve vir filtrado (disponivel e com estoque).
     */
    public static List<Peca> sugerir(Limitante lim, List<Requisito> requisitos, List<Peca> montagem, List<Peca> catalogo) {
        if (lim == null) {
            return List.of();
        }
        Requisito alvo = requisitos.stream().filter(r -> lim.proximoNivel().equals(r.nivel())).findFirst().orElse(null);
        if (alvo == null) {
            return List.of();
        }
        Peca placa = primeira(montagem, "placa_mae");
        Desempenho d = desempenho(montagem);
        return catalogo.stream()
                .filter(p -> switch (lim.criterio()) {
                    case "cpu" -> "cpu".equals(p.tipoPeca()) && p.scoreDesempenho() >= alvo.scoreCpuMin()
                            && (placa == null || igual(p.soquete(), placa.soquete()));
                    case "gpu", "vram" -> "gpu".equals(p.tipoPeca()) && p.scoreDesempenho() >= alvo.scoreGpuMin()
                            && p.vramGb() != null && p.vramGb() >= alvo.vramMinGb();
                    case "ram" -> "ram".equals(p.tipoPeca()) && p.capacidadeGb() != null
                            && p.capacidadeGb() >= alvo.ramMinGb()
                            && (placa == null || igual(p.tipoMemoria(), placa.tipoMemoria()));
                    default -> ("ssd".equals(p.tipoPeca()) || "hdd".equals(p.tipoPeca())) && p.capacidadeGb() != null
                            && p.capacidadeGb() + d.armazenamentoGb() >= alvo.armazenamentoGb();
                })
                .filter(p -> montagem.stream().noneMatch(m -> m.idProduto() == p.idProduto()))
                .sorted(Comparator.comparingDouble(Peca::preco))
                .limit(3)
                .toList();
    }

    // =====================================================================
    // Inovacao 2: comparacao
    // =====================================================================

    public static Comparacao comparar(String nomeA, List<Peca> a, String nomeB, List<Peca> b,
                                      double valorKwh, double horasDia) {
        Desempenho da = desempenho(a), db = desempenho(b);
        Consumo ca = consumo(a, valorKwh, horasDia), cb = consumo(b, valorKwh, horasDia);
        List<Metrica> ms = List.of(
                metrica("scoreCpu", "Score de CPU", da.scoreCpu(), db.scoreCpu(), true),
                metrica("scoreGpu", "Score de GPU", da.scoreGpu(), db.scoreGpu(), true),
                metrica("scoreTotal", "Score total", da.scoreTotal(), db.scoreTotal(), true),
                metrica("consumo", "Consumo em carga (W)", ca.consumoCargaW(), cb.consumoCargaW(), false),
                metrica("custoMensal", "Custo mensal (R$)", ca.custoMensal(), cb.custoMensal(), false),
                metrica("preco", "Preço (R$)", da.preco(), db.preco(), false));
        return new Comparacao(ms, resumo(nomeA, nomeB, da.scoreTotal(), db.scoreTotal(), ca.custoMensal(), cb.custoMensal()));
    }

    public static Double diferencaPercentual(double a, double b) {
        return a == 0 ? null : round1((b - a) / a * 100);
    }

    private static Metrica metrica(String id, String rotulo, double a, double b, boolean maiorMelhor) {
        String melhor = a == b ? "empate" : (b > a) == maiorMelhor ? "b" : "a";
        return new Metrica(id, rotulo, a, b, diferencaPercentual(a, b), melhor);
    }

    static String resumo(String nomeA, String nomeB, int scoreA, int scoreB, double custoA, double custoB) {
        // O texto fala sempre do PC mais rapido; o outro e a referencia da porcentagem.
        String rapido = scoreB >= scoreA ? nomeB : nomeA;
        int sRapido = Math.max(scoreA, scoreB), sLento = Math.min(scoreA, scoreB);
        double cRapido = scoreB >= scoreA ? custoB : custoA, cLento = scoreB >= scoreA ? custoA : custoB;
        double difCusto = round2(cRapido - cLento);
        String custo = moeda(Math.abs(difCusto));
        if (scoreA == scoreB) {
            if (difCusto == 0) {
                return "Os dois têm o mesmo desempenho e o mesmo custo de energia.";
            }
            return String.format("Os dois têm o mesmo desempenho; o %s custa %s a %s por mês de energia.",
                    nomeB, moeda(Math.abs(round2(custoB - custoA))), custoB > custoA ? "mais" : "menos");
        }
        String pct = sLento == 0 ? "muito" : fmt0(Math.round((sRapido - sLento) / (double) sLento * 100)) + "%";
        if (difCusto > 0) {
            return String.format("O %s é %s mais rápido, mas custa %s a mais por mês de energia.", rapido, pct, custo);
        }
        if (difCusto < 0) {
            return String.format("O %s é %s mais rápido e ainda economiza %s por mês de energia.", rapido, pct, custo);
        }
        return String.format("O %s é %s mais rápido, com o mesmo custo de energia.", rapido, pct);
    }

    // =====================================================================
    // Auxiliares
    // =====================================================================

    private static Peca primeira(List<Peca> pecas, String tipo) {
        return pecas.stream().filter(p -> tipo.equals(p.tipoPeca())).findFirst().orElse(null);
    }

    private static List<Peca> todas(List<Peca> pecas, String tipo) {
        return pecas.stream().filter(p -> tipo.equals(p.tipoPeca())).toList();
    }

    private static int somaCapacidade(List<Peca> pecas, String tipo) {
        return todas(pecas, tipo).stream()
                .mapToInt(p -> (p.capacidadeGb() != null ? p.capacidadeGb() : 0) * p.quantidade()).sum();
    }

    private static boolean igual(String a, String b) {
        return a != null && a.equals(b);
    }

    public static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }

    public static double round2(double v) {
        return Math.round(v * 100) / 100.0;
    }

    private static String fmt0(double v) {
        return String.format(Locale.forLanguageTag("pt-BR"), "%.0f", v);
    }

    private static String fmt1(double v) {
        return String.format(Locale.forLanguageTag("pt-BR"), "%.1f", v);
    }

    static String moeda(double v) {
        return "R$ " + String.format(Locale.forLanguageTag("pt-BR"), "%,.2f", v);
    }
}
