package com.vantix.api.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.vantix.api.service.PedidoService;
import com.vantix.api.service.PedidoService.NovoPedido;

/** Pedidos e estoque (docs/API_CONTRATO.md, secao 4). A logica fica em PedidoService. */
@RestController
@RequestMapping("/api/pedidos")
public class PedidoController {

    public record StatusRequest(String status, Integer idEntregador, String motivoCancelamento) { }

    private final PedidoService service;

    public PedidoController(PedidoService service) {
        this.service = service;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> criar(@RequestBody NovoPedido pedido) {
        return service.criar(pedido);
    }

    @GetMapping
    public List<Map<String, Object>> listar(@RequestParam(required = false) String status) {
        return service.listar(status);
    }

    @GetMapping("/cliente")
    public List<Map<String, Object>> doCliente(@RequestParam(required = false) String telefone,
                                               @RequestParam(required = false) String email) {
        return service.doCliente(telefone, email);
    }

    @PatchMapping("/{id}/status")
    public Map<String, Object> mudarStatus(@PathVariable int id, @RequestBody StatusRequest r,
                                           Authentication auth) {
        boolean gerente = auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_GERENTE"));
        return service.mudarStatus(id, r.status(), r.idEntregador(), r.motivoCancelamento(), gerente,
                (Integer) auth.getPrincipal());
    }
}
