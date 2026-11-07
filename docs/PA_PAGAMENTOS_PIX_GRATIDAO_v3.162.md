# Gestão de PA — Confirmação de pagamento, Pix no boleto e compensação de parcelas

**Projeto:** ZAYRA / RomatecVoiceAgent — módulo Gestão de PA / Loteamentos
**Versões:** v3.161.0 · v3.162.0 · v3.162.1 (em produção desde 07/11/2026)
**Solicitante:** José Romário Pinto Bezerra — CEO, Romatec Consultoria Total (Açailândia/MA)
**Aplicação inicial:** Projeto de Assentamento Salete Moreno

---

## 1. Objetivo

1. **Agradecer e confirmar automaticamente cada pagamento recebido.** O associado recebe pelo WhatsApp uma mensagem de gratidão com um versículo bíblico, e o administrador recebe um aviso de recebimento sem precisar abrir o aplicativo.
2. **Facilitar o pagamento por Pix.** O boleto em PDF passa a ter um link clicável que abre uma página com o botão "Copiar código Pix". Assim o pagamento compensa na hora, em vez de levar até 1 dia útil pelo código de barras.
3. **Corrigir pagamentos lançados na parcela errada (compensação).** Isso acontece quando o associado paga, ou recebe por engano, o boleto de outro mês.

---

## 2. Confirmação automática de pagamento no WhatsApp (v3.161.0 / v3.162.1)

### 2.1 Quando dispara

Dispara para **todo pagamento novo**, qualquer que seja a origem:

| Origem | Como entra no sistema |
|---|---|
| Boleto/Pix do Asaas | webhook `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED`, ou o botão "Sincronizar com o Asaas" |
| Pix InfinitePay | recibo lançado na aba Financeiro |
| Lançamento manual | dinheiro, cartão etc., na aba Financeiro |

O envio sai em segundo plano cerca de 2 segundos depois da baixa, sem atrasar o lançamento.

**Não disparam:**
- os pagamentos que já existiam antes da v3.161.0;
- os pagamentos vindos da importação inicial (seed).

### 2.2 Mensagem para o associado (modelo aprovado)

> Bom dia, Silvana! 🙏
>
> Recebemos o seu pagamento. Muito obrigado pela confiança e pelo compromisso com o Projeto de Assentamento Salete Moreno!
>
> ✅ *Pagamento confirmado*
> 👤 Associado: SILVANA DA SILVA GOMES (PASM-014)
> 🏡 Lote: 14 — Projeto de Assentamento Salete Moreno
> 📄 Referente a: Parcela 1/2 (venc. 10/11/2026) — R$ 350,00 ✔️ quitada
> 💰 Valor recebido: *R$ 350,00*
> 📅 Pago em: 07/11/2026 · Pix
>
> 📌 Parcelas em aberto: 1 (R$ 350,00).
>
> 📖 _"Em tudo dai graças, porque esta é a vontade de Deus em Cristo Jesus para convosco."_ (1 Tessalonicenses 5:18)
>
> Deus abençoe você e sua família!
> Romatec Consultoria Total

**Variações automáticas:**
- **Saudação:** alterna entre "Olá", "Oi", "Bom dia", "Boa tarde" e "Boa noite", conforme o horário de Brasília. Mensagens idênticas em série favorecem bloqueio do número.
- **Quitação total:** a linha 📌 vira "🎉 Com este pagamento, *todas as suas parcelas estão quitadas*. Parabéns!".
- **Pagamento parcial:** mostra "falta R$ X" na parcela.
- **Pagamento que cobre várias parcelas:** lista uma parcela por linha.
- **Horário:** aparece só quando é conhecido. As baixas do Asaas mostram apenas a data.

### 2.3 Versículos (ARC, aprovados pelo CEO em 07/11/2026)

Um versículo por pagamento, em rodízio. O índice é o número do pagamento módulo 11.

| # | Tema | Versículo | Referência |
|---|---|---|---|
| 1 | Gratidão | "Em tudo dai graças, porque esta é a vontade de Deus em Cristo Jesus para convosco." | 1 Tessalonicenses 5:18 |
| 2 | Gratidão | "Louvai ao Senhor, porque ele é bom, porque a sua benignidade dura para sempre." | Salmos 107:1 |
| 3 | Gratidão | "Eu te louvarei, Senhor, de todo o meu coração; contarei todas as tuas maravilhas." | Salmos 9:1 |
| 4 | Gratidão | "E a paz de Deus, para a qual também fostes chamados em um corpo, domine em vossos corações; e sede agradecidos." | Colossenses 3:15 |
| 5 | Confiança | "Confia no Senhor de todo o teu coração e não te estribes no teu próprio entendimento." | Provérbios 3:5 |
| 6 | Confiança | "Entrega o teu caminho ao Senhor; confia nele, e ele tudo fará." | Salmos 37:5 |
| 7 | Confiança | "Confia no Senhor e faze o bem; habitarás na terra e, verdadeiramente, serás alimentado." | Salmos 37:3 |
| 8 | Confiança | "Tu conservarás em paz aquele cuja mente está firme em ti; porque ele confia em ti." | Isaías 26:3 |
| 9 | Confiança | "Confia ao Senhor as tuas obras, e teus pensamentos serão estabelecidos." | Provérbios 16:3 |
| 10 | Provisão | "O meu Deus, segundo as suas riquezas, suprirá todas as vossas necessidades em glória, por Cristo Jesus." | Filipenses 4:19 |
| 11 | Bênção | "O Senhor te abençoe e te guarde; o Senhor faça resplandecer o seu rosto sobre ti e tenha misericórdia de ti." | Números 6:24-25 |

Para trocar ou incluir versículos, edite a lista `VERSICULOS` em `src/services/pa/paNotificacoes.ts`.

### 2.4 Aviso para o administrador

> 💰 *Pagamento recebido — Projeto de Assentamento Salete Moreno*
>
> 👤 SILVANA DA SILVA GOMES (PASM-014) · Lote 14
>    📄 Parcela 1/2 (venc. 10/11/2026) — R$ 350,00 ✔️ quitada
>    📌 em aberto: 1 parcela(s) · R$ 350,00
>
> 💵 Total: *R$ 350,00* · Pix · 07/11/2026
> 🔎 Origem: Asaas — baixa automática do boleto
> 📊 Recebido hoje no PA: R$ 1.050,00 (3 pagamentos)
>
> ✅ Silvana avisado no WhatsApp

Quando o associado não pôde ser avisado, o aviso mostra o motivo. Exemplo: "⚠️ José não avisado: WhatsApp não validado no cadastro".

### 2.5 Regras de funcionamento

| Regra | Como funciona |
|---|---|
| Envio único | O pagamento é reservado (`notificado_em`) antes do envio. Webhook, sincronização e vigia nunca enviam em dobro. |
| Só para WhatsApp validado | O associado precisa estar como **VÁLIDO** em "Verificar WhatsApps". |
| WhatsApp do sistema fora do ar | A parte que falhou volta para a fila. O vigia tenta a cada 10 min, até 6 vezes, por 3 dias, sem repetir o que já foi entregue. |
| Ritmo anti-bloqueio | Usa a mesma fila serializada do envio de cobranças, com intervalo mínimo entre mensagens. |
| Acompanhamento | A aba Financeiro, na lista de pagamentos, tem a coluna **WhatsApp**: ✅ avisado / ⚠️ ver (o motivo aparece ao passar o mouse) / 📲 reenviar. |

### 2.6 Configuração (Railway)

| Variável | Uso | Padrão |
|---|---|---|
| `CEO_WHATSAPP_PHONE` | Número que recebe o aviso do administrador | já configurado |
| `PA_ADMIN_WHATSAPP` | (opcional) Outro número ou lista separada por vírgula; tem prioridade | — |
| `PA_NOTIFICAR_PAGAMENTOS` | `0` desliga toda a confirmação automática | ligado |

---

## 3. Pix copia e cola no boleto em PDF (v3.161.0)

### 3.1 Problema

O associado que abre o PDF no próprio celular não consegue ler o QR Code com a câmera. Sem isso, ele acabava pagando pelo código de barras, que compensa em até 1 dia útil.

### 3.2 Solução

Um PDF não consegue copiar texto sozinho no celular. Por isso:

1. O **bloco Pix do boleto**, nos 3 modelos (Carta Técnica, Folha Topográfica e Carnê), ganhou:
   - o botão clicável **"TOQUE AQUI PARA COPIAR O PIX"** (no Carnê: "TOQUE AQUI E COPIE O PIX");
   - o texto "ou escaneie o QR Code com o app do banco";
   - o aviso "Pelo código de barras a compensação leva até 1 dia útil".
2. No Carnê, o passo 2 das instruções passou a ser "**Pix (recomendado)**".
3. O link abre a página pública **`/pa/pix/<token>`**, que tem:
   - um botão grande **"📋 Copiar código Pix"**: um toque copia, e aparece "Código Pix copiado! Agora abra o app do seu banco e cole em Pix › Pix Copia e Cola";
   - o código visível, para quem prefere copiar à mão;
   - um passo a passo em 3 itens;
   - o QR Code, para quem paga por outro aparelho;
   - o link para o boleto em PDF.
4. O Pix é atualizado no Asaas a cada abertura, pois pode mudar após o vencimento.
5. Boleto já pago mostra "✅ Este boleto já foi pago". Boleto cancelado mostra o aviso correspondente.

### 3.3 Segurança

- **Acesso:** o mesmo token aleatório do link do boleto, que só o associado recebe.
- **Dados expostos:** apenas o primeiro nome, o lote, a parcela, o valor e o vencimento. CPF e endereço não aparecem.
- **Busca:** página marcada como `noindex` e servida sem cache.

### 3.4 Abrangência

O PDF é gerado no momento da abertura. Por isso:
- todo boleto aberto pelo link já sai com o botão do Pix;
- PDFs salvos antes da v3.161.0 continuam sem o botão.

---

## 4. Compensação de pagamento em outra parcela (v3.162.0)

### 4.1 Caso de uso

O associado pagou, ou recebeu por engano, o boleto de um mês diferente do devido. O valor recebido precisa passar para a parcela correta, e a outra parcela volta a ficar em aberto.

### 4.2 Como usar

Na **ficha do associado → Financeiro → Pagamentos**, cada pagamento mostra em qual parcela caiu e tem o botão **"🔁 Compensar em outra parcela"**.

| Campo | Padrão |
|---|---|
| Tirar de | Parcela que recebeu o pagamento |
| Passar para | Parcela em aberto de vencimento mais antigo |
| ☑ Cancelar no Asaas o boleto em aberto da parcela que ficar paga | marcado (evita pagamento em dobro) |
| ☑ Emitir boleto novo para a parcela que reabrir, com o vencimento dela | marcado |
| ☐ Reenviar a confirmação de pagamento no WhatsApp, com a parcela correta | desmarcado |

### 4.3 O que o sistema faz

1. Move o valor do rateio da parcela de origem para a de destino.
2. Recalcula as duas parcelas:
   - a de destino fica PAGA (ou PARCIAL);
   - a de origem volta para "A vencer" (boleto) ou "A pagar" (sinal/à vista).
3. Faz o boleto do Asaas que foi pago passar a constar na parcela correta.
4. Cancela no Asaas o boleto em aberto da parcela que ficou paga, se a opção estiver marcada.
5. Emite um boleto novo para a parcela que reabriu, se a opção estiver marcada.
6. Registra o evento `PAGAMENTO_COMPENSADO` no histórico do associado.

Se o Asaas ou o WhatsApp falharem nos passos 4 e 5 (ou no reenvio da confirmação), a compensação **não é desfeita**: o sistema mostra um aviso e o passo pode ser repetido pelos botões da ficha.

**Recusas:** a compensação é recusada nos seguintes casos:
- origem igual ao destino;
- pagamento que não está na parcela de origem;
- parcela de outro associado ou de outro projeto;
- destino cancelado ou já quitado.

### 4.4 Correção aplicada — Silvana da Silva Gomes (PASM-014, lote 14)

**Situação:** em 07/11/2026 foi pago o boleto do Boleto 2 (venc. 10/12/2026) no lugar do Boleto 1 (venc. 10/11/2026).

**Correção automática, executada uma única vez no boot da v3.162.x:**
- R$ 350,00 passaram do Boleto 2 para o Boleto 1, que ficou PAGO;
- o Boleto 2 voltou a "A vencer";
- o boleto de novembro, que estava em aberto, foi cancelado no Asaas;
- foi emitido um boleto novo do Boleto 2 com vencimento em 10/12/2026.

**Ação manual pendente:** enviar à associada o boleto novo do Boleto 2, pelo PDF/WhatsApp da ficha.

---

## 5. Correção de falha da v3.161.0 (v3.162.0)

**Falha:** a coluna `pa_pagamentos.notificado_em` foi criada com padrão `CURRENT_TIMESTAMP`, para marcar os pagamentos antigos como "já avisados". Em seguida, o padrão seria trocado para `NULL` com `ALTER COLUMN … SET DEFAULT NULL`. Esse comando responde OK, mas não altera o padrão. Resultado: todo pagamento novo nascia "já avisado", e a confirmação não era enviada.

**Correção:**
- `MODIFY notificado_em DATETIME NULL DEFAULT NULL`;
- recuperação automática dos pagamentos afetados: marcados no mesmo instante da criação, sem registro de envio, dos últimos 3 dias. O vigia envia as confirmações desses pagamentos.

**Validação:** feita em banco MariaDB 10.11 real:
- os pagamentos afetados foram recuperados;
- os pagamentos antigos não foram tocados;
- pagamento novo nasce com `notificado_em` NULL.

---

## 6. Referência técnica

### 6.1 Arquivos

| Arquivo | Conteúdo |
|---|---|
| `src/services/pa/paNotificacoes.ts` | Mensagens, versículos, envio, reserva, vigia de pendentes |
| `src/services/pa/paWhatsapp.ts` | `enviarWhatsAppNumero` (aviso ao administrador na fila anti-bloqueio) |
| `src/services/pa/paFinanceiro.ts` | Disparo após `lancarPagamento`; `compensarPagamento`; correção pontual |
| `src/services/pa/boletoRomatec.ts` | Bloco Pix com link clicável nos 3 modelos |
| `src/services/pa/paBoletoPdf.ts` | `urlPixBoleto`; Pix atualizado do Asaas |
| `src/routes/paPixPublico.ts` | Página pública `/pa/pix/<token>` |
| `src/routes/pa.ts` | Endpoints de reenvio e compensação |
| `src/database/migrations-pa.ts` | Colunas `notificado_em` e `notificacao_json` |
| `src/public/pa.html` | Coluna WhatsApp na lista de pagamentos; formulário de compensação |

### 6.2 Endpoints

| Método | Rota | Uso |
|---|---|---|
| GET | `/pa/pix/:token` | Página pública do Pix do boleto |
| POST | `/api/pa/projetos/:id/pagamentos/:pid/notificar` | Reenviar a confirmação (associado + administrador) |
| POST | `/api/pa/projetos/:id/pagamentos/:pid/compensar` | Compensar. Corpo: `de_lancamento_id`, `para_lancamento_id`, `cancelar_boleto`, `emitir_boleto`, `avisar` |

### 6.3 Banco de dados

| Tabela.coluna | Tipo | Uso |
|---|---|---|
| `pa_pagamentos.notificado_em` | DATETIME NULL | Reserva/conclusão do envio (NULL = a avisar) |
| `pa_pagamentos.notificacao_json` | JSON NULL | Tentativas, quem foi avisado, motivo das falhas |

### 6.4 Testes

| Arquivo | O que cobre |
|---|---|
| `paNotificacoes.test.ts` | Mensagens, versículos aprovados, número do administrador |
| `paPixPublico.test.ts` | Botão copiar, boleto pago, Pix indisponível, escape do código |
| `boletoRomatec.test.ts` | Link clicável e texto explicativo nos 3 modelos |
| `compensacao.test.ts` | Status após estorno/compensação |

Validações adicionais, fora da bateria automatizada:
- **Ponta a ponta em MariaDB real, com Asaas simulado:** caso da Silvana, idempotência, recusas e compensação ida e volta.
- **PDF real:** link clicável presente e 1 página por boleto.
- **Celular simulado (iPhone):** o botão copiou o código Pix exato.
