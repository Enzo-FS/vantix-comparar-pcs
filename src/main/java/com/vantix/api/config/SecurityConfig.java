package com.vantix.api.config;

import java.util.Arrays;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import com.vantix.api.security.JwtFilter;

/**
 * Quem acessa o que (docs/API_CONTRATO.md):
 *  - publico: login, catalogo, recomendacoes, criar pedido, "meus pedidos",
 *             e a leitura/calculo do "Monte seu PC" (especificacoes, tarifas, softwares, montagens, comparar, roda)
 *  - cliente com conta: salvar e apagar as proprias montagens
 *  - gerente: relatorios, funcionarios, escrita em produtos e nos cadastros do "Monte seu PC"
 *  - funcionarios (gerente, estoque, logistica): listar pedidos e mudar status
 */
@Configuration
public class SecurityConfig {

    private static final String[] FUNCIONARIOS = {"GERENTE", "ESTOQUE", "LOGISTICA"};

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filtros(HttpSecurity http, JwtFilter jwtFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(c -> { })
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/categorias", "/api/produtos", "/api/produtos/*",
                        "/api/recomendacoes").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/pedidos").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/pedidos/cliente").permitAll()
                // Monte seu PC: leitura e calculos sao publicos
                .requestMatchers(HttpMethod.GET, "/api/especificacoes", "/api/tarifas", "/api/softwares",
                        "/api/montagens", "/api/montagens/*", "/api/montagens/*/consumo",
                        "/api/comparar", "/api/roda").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/montagens/avaliar").permitAll()
                .requestMatchers(HttpMethod.POST, "/api/montagens").hasRole("CLIENTE")
                .requestMatchers(HttpMethod.DELETE, "/api/montagens/*").hasRole("CLIENTE")
                .requestMatchers("/api/especificacoes/**", "/api/tarifas/**", "/api/softwares/**").hasRole("GERENTE")
                .requestMatchers("/api/estoque", "/api/estoque/**").hasAnyRole("ESTOQUE", "GERENTE")
                .requestMatchers("/api/relatorios/**", "/api/funcionarios/**").hasRole("GERENTE")
                .requestMatchers("/api/produtos/**").hasRole("GERENTE")
                .requestMatchers("/api/pedidos/**").hasAnyRole(FUNCIONARIOS)
                .anyRequest().denyAll())
            .exceptionHandling(e -> e
                .authenticationEntryPoint((req, res, ex) -> escrever(res, 401,
                        "Sessão expirada ou inválida. Faça login novamente."))
                .accessDeniedHandler((req, res, ex) -> escrever(res, 403,
                        "Você não tem permissão para esta ação.")))
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private static void escrever(jakarta.servlet.http.HttpServletResponse res, int status, String msg)
            throws java.io.IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"mensagem\":\"" + msg + "\"}");
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(@Value("${vantix.cors.origem}") String origens) {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOrigins(Arrays.stream(origens.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList());
        c.setAllowedMethods(java.util.List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        c.setAllowedHeaders(java.util.List.of("Authorization", "Content-Type"));
        UrlBasedCorsConfigurationSource fonte = new UrlBasedCorsConfigurationSource();
        fonte.registerCorsConfiguration("/**", c);
        return fonte;
    }
}
