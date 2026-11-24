package com.vantix.api.pc;

/** O que um software exige em um nivel (minimo, recomendado ou ultra). */
public record Requisito(
        String nivel,
        int scoreCpuMin,
        int scoreGpuMin,
        int ramMinGb,
        int vramMinGb,
        int armazenamentoGb,
        Integer fpsEstimado) { }
