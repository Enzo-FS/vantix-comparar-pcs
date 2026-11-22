package com.vantix.api.security;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

import javax.crypto.SecretKey;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

@Service
public class JwtService {

    private final SecretKey chave;
    private final long horas;

    public JwtService(@Value("${vantix.jwt.secret}") String segredo, @Value("${vantix.jwt.horas}") long horas) {
        this.chave = Keys.hmacShaKeyFor(segredo.getBytes(StandardCharsets.UTF_8));
        this.horas = horas;
    }

    public String gerar(int idUsuario, String nome, String papel) {
        Instant agora = Instant.now();
        return Jwts.builder()
                .subject(String.valueOf(idUsuario))
                .claim("nome", nome)
                .claim("papel", papel)
                .issuedAt(Date.from(agora))
                .expiration(Date.from(agora.plus(horas, ChronoUnit.HOURS)))
                .signWith(chave)
                .compact();
    }

    /** Devolve os dados do token ou null se for invalido/expirado. */
    public Claims ler(String token) {
        try {
            return Jwts.parser().verifyWith(chave).build().parseSignedClaims(token).getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            return null;
        }
    }
}
