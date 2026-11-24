package com.vantix.api.pc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import com.vantix.api.pc.RegrasPc.Avaliacao;
import com.vantix.api.pc.RegrasPc.Comparacao;
import com.vantix.api.pc.RegrasPc.Consumo;
import com.vantix.api.pc.RegrasPc.ResultadoRoda;

/**
 * Testes das regras (docs/regras-inovacoes.md). As pecas e os resultados esperados
 * sao os mesmos do seed.sql e da view vw_consumo_montagem.
 */
class RegrasPcTest {

    // ---- pecas do seed (dados ficticios) ----
    static Peca cpu(int id, String nome, double preco, int w, int score, String soquete, String mem) {
        return new Peca(id, nome, preco, 1, "cpu", w, score, soquete, mem, null, null, null, null, null);
    }
    static Peca gpu(int id, String nome, double preco, int w, int score, int vram) {
        return new Peca(id, nome, preco, 1, "gpu", w, score, null, null, null, vram, null, null, null);
    }
    static Peca placa(int id, double preco, int w, String soquete, String mem, String formato) {
        return new Peca(id, "Placa " + soquete, preco, 1, "placa_mae", w, 50, soquete, mem, formato, null, null, null, null);
    }
    static Peca ram(int id, double preco, int w, String mem, int gb) {
        return new Peca(id, "RAM " + gb, preco, 1, "ram", w, 50, null, mem, null, null, gb, null, null);
    }
    static Peca disco(int id, String tipo, double preco, int w, int gb) {
        return new Peca(id, tipo + " " + gb, preco, 1, tipo, w, 50, null, null, null, null, gb, null, null);
    }
    static Peca fonte(int id, double preco, int potencia, double ef) {
        return new Peca(id, "Fonte " + potencia, preco, 1, "fonte", 0, 50, null, null, null, null, null, potencia, ef);
    }
    static Peca cooler(int id, double preco, int w, String soquetes) {
        return new Peca(id, "Cooler", preco, 1, "cooler", w, 50, soquetes, null, null, null, null, null, null);
    }
    static Peca gabinete(int id, double preco, int w, String formato) {
        return new Peca(id, "Gabinete " + formato, preco, 1, "gabinete", w, 50, null, null, formato, null, null, null, null);
    }

    static final double SP = 0.82;

    static List<Peca> pcBasico() {
        return List.of(cpu(54, "i3-12100", 649.90, 60, 38, "LGA1700", null),
                placa(65, 799.90, 35, "LGA1700", "DDR4", "mATX"), ram(70, 299.90, 6, "DDR4", 16),
                gpu(59, "GTX 1650", 899.90, 75, 25, 4), disco(74, "ssd", 219.90, 3, 480), fonte(81, 299.90, 500, 0.80),
                cooler(85, 99.90, 4, "AM4/AM5/LGA1700"), gabinete(89, 249.90, 6, "mATX"));
    }

    static List<Peca> pcIntermediario() {
        return List.of(cpu(57, "Ryzen 5 7600", 1199.90, 88, 68, "AM5", "DDR5"),
                placa(42, 999.90, 45, "AM5", "DDR5", "mATX"), ram(4, 1099.90, 10, "DDR5", 32),
                gpu(61, "RTX 4060", 1899.90, 115, 55, 8), disco(75, "ssd", 449.90, 6, 1000), fonte(82, 449.90, 650, 0.85),
                cooler(41, 329.90, 6, "AM5/LGA1700"), gabinete(43, 399.90, 8, "ATX"));
    }

    static List<Peca> pcAvancado() {
        return List.of(cpu(2, "Ryzen 7 7800X3D", 1699.90, 120, 92, "AM5", "DDR5"),
                placa(67, 2899.90, 80, "AM5", "DDR5", "ATX"), ram(73, 1999.90, 10, "DDR5", 64),
                gpu(63, "RTX 4090", 12999.90, 450, 100, 24), disco(3, "ssd", 849.90, 7, 2000),
                disco(78, "hdd", 429.90, 7, 2000), fonte(40, 899.90, 850, 0.90),
                cooler(87, 899.90, 15, "AM4/AM5/LGA1700"), gabinete(91, 899.90, 12, "ATX"));
    }

    static List<Requisito> fc26() {
        return List.of(new Requisito("minimo", 35, 30, 8, 4, 100, 60),
                new Requisito("recomendado", 55, 50, 12, 6, 100, 60),
                new Requisito("ultra", 70, 70, 16, 8, 100, 120));
    }

    @Nested
    class Consumo_ {
        @Test
        void pcBasicoBateComAViewDoBanco() {
            Consumo c = RegrasPc.consumo(pcBasico(), SP, 4);
            assertEquals(189, c.somaWatts());
            assertEquals(132.3, c.consumoUsoW());
            assertEquals(189.0, c.consumoCargaW());
            assertEquals(165.4, c.tomadaUsoW());
            assertEquals(16.27, c.custoMensal());
            assertEquals(195.27, c.custoAnual());
            assertEquals("verde", c.seloFonte());
        }

        @Test
        void pcIntermediarioEAvancado() {
            Consumo i = RegrasPc.consumo(pcIntermediario(), SP, 4);
            assertEquals(278, i.somaWatts());
            assertEquals(22.53, i.custoMensal());
            assertEquals(270.33, i.custoAnual());
            Consumo a = RegrasPc.consumo(pcAvancado(), SP, 6);
            assertEquals(701, a.somaWatts());
            assertEquals(545.2, a.tomadaUsoW());
            assertEquals(80.47, a.custoMensal());
            assertEquals(965.70, a.custoAnual());
            assertEquals("verde", a.seloFonte());
            assertEquals(21.3, a.folgaPercentual());
        }

        @Test
        void fonteNaoEntraNaSomaEQuantidadeMultiplica() {
            List<Peca> p = List.of(ram(1, 100, 5, "DDR5", 16).comQuantidade(2), fonte(2, 100, 500, 0.85));
            assertEquals(10, RegrasPc.consumo(p, 1, 1).somaWatts());
        }

        @Test
        void semFonteUsaEficienciaDePiorCaso() {
            Consumo c = RegrasPc.consumo(List.of(gpu(1, "x", 1, 100, 50, 8)), 1.0, 10);
            assertEquals("sem_fonte", c.seloFonte());
            assertEquals(0.80, c.eficienciaFonte());
            assertEquals(87.5, c.tomadaUsoW()); // 70 / 0,8
        }

        @Test
        void seloAmareloEVermelho() {
            List<Peca> base = List.of(gpu(1, "x", 1, 450, 100, 24), cpu(2, "y", 1, 170, 90, "AM5", "DDR5"));
            // carga 620 W
            List<Peca> amarelo = new ArrayList<>(base);
            amarelo.add(fonte(3, 1, 700, 0.9)); // 700 < 744 (620 x 1,2)
            Consumo ca = RegrasPc.consumo(amarelo, 1, 1);
            assertEquals("amarelo", ca.seloFonte());
            assertTrue(ca.mensagemFonte().contains("744 W"));
            List<Peca> vermelho = new ArrayList<>(base);
            vermelho.add(fonte(3, 1, 500, 0.8));
            assertEquals("vermelho", RegrasPc.consumo(vermelho, 1, 1).seloFonte());
            List<Peca> limite = new ArrayList<>(base);
            limite.add(fonte(3, 1, 744, 0.9)); // exatamente 20% de folga = verde
            assertEquals("verde", RegrasPc.consumo(limite, 1, 1).seloFonte());
        }
    }

    @Nested
    class Compatibilidade {
        @Test
        void montagensDeExemploNaoTemErro() {
            for (List<Peca> pc : List.of(pcBasico(), pcIntermediario(), pcAvancado())) {
                Avaliacao a = RegrasPc.avaliar(pc, SP, 4);
                assertFalse(a.temIncompatibilidade(), a.avisos().toString());
                assertTrue(a.faltando().isEmpty());
            }
        }

        @Test
        void soqueteDiferenteEMemoriaErrada() {
            List<Peca> p = List.of(cpu(55, "Ryzen 5 5600", 1, 65, 52, "AM4", "DDR4"),
                    placa(42, 1, 45, "AM5", "DDR5", "mATX"), ram(72, 1, 8, "DDR4", 16));
            Avaliacao a = RegrasPc.avaliar(p, SP, 4);
            assertTrue(a.temIncompatibilidade());
            assertTrue(tem(a, "C1", "Soquete AM4 não é compatível com a placa AM5."));
            assertTrue(tem(a, "C2", "Memória DDR4 não é compatível com a placa DDR5."));
            assertTrue(tem(a, "C3", null));
        }

        @Test
        void placaAtxNaoCabeEmGabineteMenor() {
            List<Peca> p = List.of(placa(67, 1, 80, "AM5", "DDR5", "ATX"), gabinete(89, 1, 6, "mATX"));
            assertTrue(tem(RegrasPc.avaliar(p, SP, 4), "C4", "Placa ATX não cabe no gabinete mATX."));
            List<Peca> ok = List.of(placa(68, 1, 40, "AM5", "DDR5", "ITX"), gabinete(43, 1, 8, "ATX"));
            assertFalse(tem(RegrasPc.avaliar(ok, SP, 4), "C4", null));
        }

        @Test
        void pecaUnicaRepetidaCoolerEGpuIntegrada() {
            List<Peca> p = List.of(fonte(1, 1, 500, 0.8).comQuantidade(2),
                    cpu(55, "x", 1, 65, 52, "AM4", "DDR4"), cooler(41, 1, 6, "AM5/LGA1700"));
            Avaliacao a = RegrasPc.avaliar(p, SP, 4);
            assertTrue(tem(a, "C5", null));
            assertTrue(tem(a, "C6", "O cooler não lista suporte ao soquete AM4."));
            assertTrue(tem(a, "C7", null));
        }

        @Test
        void faltandoNaoBloqueiaCompra() {
            Avaliacao a = RegrasPc.avaliar(List.of(gpu(1, "x", 1, 100, 50, 8)), SP, 4);
            assertEquals(List.of("cpu", "placa_mae", "ram", "armazenamento", "fonte", "gabinete"), a.faltando());
            assertTrue(tem(a, "F", "Sua montagem não tem fonte."));
            assertFalse(a.temIncompatibilidade());
        }
    }

    @Nested
    class Roda {
        @Test
        void pcBasicoNaoRodaFc26ELimitaPelaGpu() {
            ResultadoRoda r = RegrasPc.roda(pcBasico(), fc26(), true);
            assertEquals("nao_roda", r.nivel());
            assertNull(r.fpsEstimado());
            assertEquals("gpu", r.limitante().criterio());
            assertEquals("gpu", r.limitante().tipoPeca());
            assertEquals("minimo", r.limitante().proximoNivel());
            assertEquals(16.7, r.limitante().deficit());
        }

        @Test
        void intermediarioRecomendadoEAvancadoUltra() {
            ResultadoRoda i = RegrasPc.roda(pcIntermediario(), fc26(), true);
            assertEquals("recomendado", i.nivel());
            assertEquals(60, i.fpsEstimado());
            assertEquals("ultra", i.limitante().proximoNivel());
            ResultadoRoda a = RegrasPc.roda(pcAvancado(), fc26(), true);
            assertEquals("ultra", a.nivel());
            assertEquals(120, a.fpsEstimado());
            assertNull(a.limitante());
            assertEquals(3, a.niveis().size());
            assertEquals(5, a.niveis().get(0).criterios().size());
        }

        @Test
        void programaNaoTemFps() {
            ResultadoRoda r = RegrasPc.roda(pcAvancado(), fc26(), false);
            assertEquals("ultra", r.nivel());
            assertNull(r.fpsEstimado());
        }

        @Test
        void semArmazenamentoNaoRoda() {
            List<Peca> semDisco = pcIntermediario().stream().filter(p -> !"ssd".equals(p.tipoPeca())).toList();
            ResultadoRoda r = RegrasPc.roda(semDisco, fc26(), true);
            assertEquals("nao_roda", r.nivel());
            assertEquals("armazenamento", r.limitante().criterio());
        }

        @Test
        void sugereAte3GpusMaisBaratasQueResolvem() {
            List<Peca> catalogo = List.of(gpu(60, "RX 6600", 1299.90, 132, 45, 8), gpu(61, "RTX 4060", 1899.90, 115, 55, 8),
                    gpu(62, "RX 7800 XT", 3699.90, 263, 80, 16), gpu(1, "RTX 4070 SUPER", 4699.90, 220, 76, 12),
                    gpu(59, "GTX 1650", 899.90, 75, 25, 4), cpu(57, "Ryzen", 1, 88, 68, "AM5", "DDR5"));
            ResultadoRoda r = RegrasPc.roda(pcBasico(), fc26(), true);
            List<Peca> s = RegrasPc.sugerir(r.limitante(), fc26(), pcBasico(), catalogo);
            assertEquals(List.of(60, 61, 62), s.stream().map(Peca::idProduto).toList());
        }

        @Test
        void sugestaoDeCpuRespeitaOSoqueteDaPlaca() {
            List<Requisito> pesado = List.of(new Requisito("minimo", 60, 10, 8, 1, 10, 30),
                    new Requisito("recomendado", 70, 10, 8, 1, 10, 60), new Requisito("ultra", 90, 10, 8, 1, 10, 90));
            List<Peca> catalogo = List.of(cpu(57, "Ryzen 5 7600", 1199.90, 88, 68, "AM5", "DDR5"),
                    cpu(58, "i7-14700K", 2599.90, 170, 90, "LGA1700", null),
                    cpu(56, "i5-12400F", 799.90, 65, 56, "LGA1700", null));
            ResultadoRoda r = RegrasPc.roda(pcBasico(), pesado, true);
            assertEquals("cpu", r.limitante().criterio());
            List<Peca> s = RegrasPc.sugerir(r.limitante(), pesado, pcBasico(), catalogo);
            assertEquals(List.of(58), s.stream().map(Peca::idProduto).toList()); // placa do Basico e LGA1700
        }
    }

    @Nested
    class Comparar {
        @Test
        void basicoContraIntermediario() {
            Comparacao c = RegrasPc.comparar("PC Básico", pcBasico(), "PC Intermediário", pcIntermediario(), SP, 4);
            assertEquals(78.9, metrica(c, "scoreCpu").diferencaPercentual());
            assertEquals(120.0, metrica(c, "scoreGpu").diferencaPercentual());
            assertEquals(30.0, metrica(c, "scoreTotal").a());
            assertEquals(60.0, metrica(c, "scoreTotal").b());
            assertEquals(100.0, metrica(c, "scoreTotal").diferencaPercentual());
            assertEquals(47.1, metrica(c, "consumo").diferencaPercentual());
            assertEquals(38.5, metrica(c, "custoMensal").diferencaPercentual());
            assertEquals(94.1, metrica(c, "preco").diferencaPercentual());
            assertEquals("b", metrica(c, "scoreTotal").melhor());
            assertEquals("a", metrica(c, "custoMensal").melhor());
            assertEquals("O PC Intermediário é 100% mais rápido, mas custa R$ 6,26 a mais por mês de energia.", c.resumo());
        }

        @Test
        void resumoQuandoAEMaisRapidoOuEmpate() {
            Comparacao c = RegrasPc.comparar("PC A", pcAvancado(), "PC B", pcBasico(), SP, 4);
            assertTrue(c.resumo().startsWith("O PC A é "), c.resumo());
            Comparacao e = RegrasPc.comparar("PC A", pcBasico(), "PC B", pcBasico(), SP, 4);
            assertEquals("Os dois têm o mesmo desempenho e o mesmo custo de energia.", e.resumo());
            assertEquals("empate", metrica(e, "preco").melhor());
        }

        @Test
        void diferencaComBaseZero() {
            assertNull(RegrasPc.diferencaPercentual(0, 10));
        }
    }

    static boolean tem(Avaliacao a, String codigo, String mensagem) {
        return a.avisos().stream().anyMatch(x -> x.codigo().equals(codigo) && (mensagem == null || x.mensagem().equals(mensagem)));
    }

    static RegrasPc.Metrica metrica(Comparacao c, String id) {
        return c.metricas().stream().filter(m -> m.metrica().equals(id)).findFirst().orElseThrow();
    }
}
