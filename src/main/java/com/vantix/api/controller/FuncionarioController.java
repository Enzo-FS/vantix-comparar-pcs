package com.vantix.api.controller;

import java.util.List;
import java.util.Map;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.exception.ApiException;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** Funcionarios (tabela usuario_painel). So o gerente acessa. Nunca devolve senha_hash. */
@RestController
@RequestMapping("/api/funcionarios")
public class FuncionarioController {

    public record FuncionarioRequest(
            @NotBlank(message = "Informe o nome.") String nome,
            @NotBlank(message = "Informe o e-mail.") @Email(message = "E-mail inválido.") String email,
            @NotNull(message = "Escolha o papel.")
            @Pattern(regexp = "gerente|estoque|logistica", message = "Papel inválido.") String papel,
            Boolean ativo,
            String senha) { }

    public record AtivoRequest(@NotNull(message = "Informe se o funcionário está ativo.") Boolean ativo) { }

    private static final String SELECT = """
            SELECT id_usuario AS id, nome, email, papel, ativo, data_criacao AS dataCriacao
            FROM usuario_painel
            """;

    private final JdbcTemplate jdbc;
    private final PasswordEncoder encoder;

    public FuncionarioController(JdbcTemplate jdbc, PasswordEncoder encoder) {
        this.jdbc = jdbc;
        this.encoder = encoder;
    }

    @GetMapping
    public List<Map<String, Object>> listar() {
        return jdbc.queryForList(SELECT + " ORDER BY nome");
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> criar(@Valid @RequestBody FuncionarioRequest r) {
        if (r.senha() == null || r.senha().length() < 6) {
            throw ApiException.badRequest("A senha é obrigatória e deve ter pelo menos 6 caracteres.");
        }
        var keys = new GeneratedKeyHolder();
        try {
            jdbc.update(con -> {
                var ps = con.prepareStatement(
                        "INSERT INTO usuario_painel (nome, email, senha_hash, papel, ativo) VALUES (?, ?, ?, ?, ?)",
                        new String[] {"id_usuario"});
                ps.setString(1, r.nome().trim());
                ps.setString(2, r.email().trim().toLowerCase());
                ps.setString(3, encoder.encode(r.senha()));
                ps.setString(4, r.papel());
                ps.setBoolean(5, r.ativo() == null || r.ativo());
                return ps;
            }, keys);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("Já existe um funcionário com este e-mail.");
        }
        return porId(keys.getKey().intValue());
    }

    @PutMapping("/{id}")
    public Map<String, Object> atualizar(@PathVariable int id, @Valid @RequestBody FuncionarioRequest r,
                                         Authentication auth) {
        porId(id);
        boolean ativo = r.ativo() == null || r.ativo();
        if (id == (Integer) auth.getPrincipal() && (!ativo || !"gerente".equals(r.papel()))) {
            throw ApiException.conflict("Você não pode desativar nem rebaixar o seu próprio usuário.");
        }
        if (r.senha() != null && !r.senha().isEmpty() && r.senha().length() < 6) {
            throw ApiException.badRequest("A senha deve ter pelo menos 6 caracteres.");
        }
        try {
            jdbc.update("UPDATE usuario_painel SET nome = ?, email = ?, papel = ?, ativo = ? WHERE id_usuario = ?",
                    r.nome().trim(), r.email().trim().toLowerCase(), r.papel(), ativo, id);
            if (r.senha() != null && !r.senha().isEmpty()) {
                jdbc.update("UPDATE usuario_painel SET senha_hash = ? WHERE id_usuario = ?",
                        encoder.encode(r.senha()), id);
            }
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("Já existe um funcionário com este e-mail.");
        }
        return porId(id);
    }

    @PatchMapping("/{id}/ativo")
    public Map<String, Object> ativar(@PathVariable int id, @Valid @RequestBody AtivoRequest r,
                                      Authentication auth) {
        porId(id);
        if (!r.ativo() && id == (Integer) auth.getPrincipal()) {
            throw ApiException.conflict("Você não pode desativar o seu próprio usuário.");
        }
        jdbc.update("UPDATE usuario_painel SET ativo = ? WHERE id_usuario = ?", r.ativo(), id);
        return porId(id);
    }

    private Map<String, Object> porId(int id) {
        List<Map<String, Object>> l = jdbc.queryForList(SELECT + " WHERE id_usuario = ?", id);
        if (l.isEmpty()) {
            throw ApiException.notFound("Funcionário não encontrado.");
        }
        return l.get(0);
    }
}
