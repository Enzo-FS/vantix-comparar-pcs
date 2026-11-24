package com.vantix.api.pc;

/**
 * Uma peca de hardware dentro de uma montagem: dados do produto + especificacao_tecnica + quantidade.
 * Campos que nao se aplicam ao tipo de peca ficam null.
 */
public record Peca(
        int idProduto,
        String nome,
        double preco,
        int quantidade,
        String tipoPeca,          // cpu, gpu, placa_mae, ram, ssd, hdd, fonte, cooler, gabinete
        int consumoWatts,
        int scoreDesempenho,
        String soquete,
        String tipoMemoria,       // DDR4 | DDR5
        String formato,           // ATX | mATX | ITX
        Integer vramGb,
        Integer capacidadeGb,
        Integer potenciaFonteW,
        Double eficienciaFonte) {

    public Peca comQuantidade(int q) {
        return new Peca(idProduto, nome, preco, q, tipoPeca, consumoWatts, scoreDesempenho, soquete,
                tipoMemoria, formato, vramGb, capacidadeGb, potenciaFonteW, eficienciaFonte);
    }
}
