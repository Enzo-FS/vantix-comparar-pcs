// Configuração "mock": o Angular responde no lugar da API Java com um back-end falso em memória
// (src/app/core/mock), com os mesmos dados do database/seed.sql. Não precisa de Java nem de MySQL.
// Uso: npm run start:mock  (desenvolvimento)  |  npm run build:mock  (site estático, ex.: Netlify)
export const environment = {
  production: true,
  apiUrl: 'http://localhost:8080/api',
  useMock: true,
  pollingMs: 5000,
};
