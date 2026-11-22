package com.vantix.api.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.exception.ApiException;
import com.vantix.api.security.JwtService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/** POST /api/auth/login: confere a senha com BCrypt e devolve o token. */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    public record LoginRequest(@NotBlank(message = "Informe o e-mail.") String email,
                               @NotBlank(message = "Informe a senha.") String senha) { }

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;
    private final JwtService jwt;

    public AuthController(JdbcTemplate jdbc, PasswordEncoder encoder, JwtService jwt) {
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.jwt = jwt;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@Valid @RequestBody LoginRequest req) {
        List<Map<String, Object>> linhas = jdbc.queryForList(
                "SELECT id_usuario, nome, email, senha_hash, papel, ativo FROM usuario_painel WHERE email = ?",
                req.email().trim().toLowerCase());
        if (linhas.isEmpty() || !encoder.matches(req.senha(), (String) linhas.get(0).get("senha_hash"))) {
            throw ApiException.unauthorized("E-mail ou senha incorretos.");
        }
        Map<String, Object> u = linhas.get(0);
        if (!Boolean.TRUE.equals(u.get("ativo"))) {
            throw ApiException.forbidden("Este usuário está desativado. Fale com o gerente.");
        }
        int id = ((Number) u.get("id_usuario")).intValue();
        String papel = (String) u.get("papel");

        Map<String, Object> usuario = new LinkedHashMap<>();
        usuario.put("id", id);
        usuario.put("nome", u.get("nome"));
        usuario.put("email", u.get("email"));
        usuario.put("papel", papel);
        usuario.put("ativo", true);

        Map<String, Object> resposta = new LinkedHashMap<>();
        resposta.put("token", jwt.gerar(id, (String) u.get("nome"), papel));
        resposta.put("usuario", usuario);
        return resposta;
    }
}
