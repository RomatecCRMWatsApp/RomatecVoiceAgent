// v3.61.0: Captive Portal / Captacao de Leads Wi-Fi.
//
// Tabela wifi_leads — leads capturados na pagina do captive portal (Mikrotik,
// TP-Link Omada, Starlink + hAP). Persistencia local, sem dependencia de
// servico externo. O disparo de boas-vindas via Z-API e' assincrono e nao
// bloqueia a insercao (flag boas_vindas marcada depois, em background).
//
// Convencao do projeto: cada modulo tem seu migrations-<nome>.ts exportando
// runMigrations<Nome>(), invocado por uma IIFE isolada no server.ts. Falha
// aqui nao derruba o boot (try/catch no chamador).

import pool from './connection';

export async function runMigrationsWifiLeads(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS wifi_leads (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      nome          VARCHAR(120)  NOT NULL,
      whatsapp      VARCHAR(20)   NOT NULL,
      email         VARCHAR(120)  NULL,
      origem        ENUM('escritorio','carro','starlink','outro') NOT NULL DEFAULT 'outro',
      ip_cliente    VARCHAR(45)   NOT NULL,
      mac_address   VARCHAR(17)   NULL,
      user_agent    TEXT          NULL,
      boas_vindas   TINYINT(1)    NOT NULL DEFAULT 0,
      criado_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_whatsapp (whatsapp),
      INDEX idx_criado_em (criado_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
