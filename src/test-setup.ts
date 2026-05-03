// Setup global pros testes vitest. Define env vars dummy pra que imports
// transitivos de tools.ts (que puxa database/connection.ts e validators
// de provider keys) nao explodam ao subir o test runner.
//
// IMPORTANTE: nenhum teste aqui deve realmente conectar no MySQL ou
// chamar APIs externas. Esses valores sao stubs.

process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test_db';
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'test-secret-please-change';
