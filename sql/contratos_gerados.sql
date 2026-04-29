-- v1.34.0: Tabela pra histórico de contratos GERADOS pela ZAYRA (Fase 2)
-- Rodar uma vez no SQL Editor do Supabase (https://supabase.com/dashboard → SQL Editor)
--
-- Diferente de contratos_indexados (modelos da Fase 1), esta tabela guarda
-- contratos PREENCHIDOS com dados reais de cliente/imóvel/condições.

CREATE TABLE IF NOT EXISTS contratos_gerados (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                 TEXT NOT NULL,          -- compra_venda/locacao/permuta/comodato/corretagem/outro
  titulo               TEXT NOT NULL,
  contrato_modelo_id   UUID REFERENCES contratos_indexados(id) ON DELETE SET NULL,
  cliente_nome         TEXT,
  valor_total          NUMERIC(15, 2) DEFAULT 0,
  texto                TEXT NOT NULL,          -- texto completo do contrato gerado
  metadata             JSONB,                  -- input completo (vendedor/comprador/imovel/condicoes)
  d4sign_documento_id  TEXT,                   -- ID no D4Sign quando enviar pra assinatura
  d4sign_status        TEXT,                   -- pendente/assinado/cancelado
  criado_em            TIMESTAMP DEFAULT NOW(),
  atualizado_em        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contratos_gerados_tipo
  ON contratos_gerados(tipo);
CREATE INDEX IF NOT EXISTS idx_contratos_gerados_cliente
  ON contratos_gerados(cliente_nome);
CREATE INDEX IF NOT EXISTS idx_contratos_gerados_criado_em
  ON contratos_gerados(criado_em DESC);

-- Trigger pra atualizar atualizado_em automaticamente
CREATE OR REPLACE FUNCTION trg_contratos_gerados_atualizado()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_contratos_gerados_atualizado ON contratos_gerados;
CREATE TRIGGER trigger_contratos_gerados_atualizado
  BEFORE UPDATE ON contratos_gerados
  FOR EACH ROW EXECUTE FUNCTION trg_contratos_gerados_atualizado();
