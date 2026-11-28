---
name: videos-imobiliarios-narrados
description: Criar e revisar vídeos imobiliários narrados em português brasileiro para Reels e WhatsApp, adaptando referências, imagens reais, identidade de marca, mapas de vendas e comparações visuais de lotes e chácaras. Usar para anúncios de empreendimentos, lançamentos, obra do deck, contato com a natureza, cadastro de interessados e animações de contornos com medidas e áreas proporcionais. Inclui perfil opcional do Bom Jardims e scripts para auditar e renderizar geometrias.
---

# Vídeos imobiliários narrados

Produzir arquivos de vídeo reproduzíveis, persuasivos e fiéis aos materiais do proprietário. Priorizar imagens reais, desenhos que expliquem a diferença de espaço e uma chamada clara para cadastro. Não transformar o anúncio em uma apresentação excessivamente técnica.

## Recursos

- Ler [direção criativa e revisões](references/direcao-criativa.md) ao definir roteiro, comparação ou nova versão.
- Ler [montagem e verificação](references/montagem-e-verificacao.md) ao sincronizar cenas, legendas e áudio ou investigar um problema de exportação.
- Ler [perfil Bom Jardims](references/perfil-bom-jardims.md) somente quando o anúncio for desse empreendimento. Separar identidade da marca de informações comerciais históricas.
- Usar `templates/brief.json` para reunir dados e fontes; usar `templates/manifesto.json` para registrar cortes e versões.
- Usar `scripts/auditar_geometria.py` e `scripts/render_geometria.py` para contornos de terrenos em mesma escala.
- Usar `scripts/inspecionar_video.py` para parâmetros técnicos e quadros de conferência.

Consultar as habilidades de vídeo, narração e música disponíveis antes de gerar esses materiais. Descobrir os contratos atuais das ferramentas; não reutilizar esquemas de chamadas de uma sessão anterior. Consultar a habilidade de pesquisa antes de buscar dados externos e a de análise de dados antes de análises numéricas adicionais.

## 1. Identificar a tarefa e preservar o que foi aprovado

**Novo anúncio:** analisar a referência, montar o brief, criar a narração e definir a sequência visual.

**Revisão de um vídeo:** identificar o trecho e a mudança solicitados; preservar áudio, imagens, marca e condições já aprovadas fora desse escopo. Criar uma nova versão, sem sobrescrever os arquivos aprovados.

Prosseguir com o trabalho independente enquanto aguardar um dado bloqueante. Pedir apenas informações necessárias: arquivo de marca ausente, data incompleta, condição comercial contraditória ou identificação dos lotes a marcar.

## 2. Reunir dados confirmados e ativos

Registrar nome exato, público, benefício, data completa do lançamento, CTA, WhatsApp e contato profissional. Reunir vídeos reais, logo oficial, vinheta existente, mapa e fontes de valores/status. Registrar data e origem de cada alegação comercial.

- Não assumir que uma vinheta mencionada esteja acessível. Procurar nos materiais autorizados; se ausente, pedir o arquivo. Se o usuário mandar finalizar sem ela, informar a utilização de uma nova animação simples com o logo.
- Não redesenhar o logo oficial para corrigir texto ou grafia; corrigir apenas os títulos e legendas editoriais.
- Não reutilizar imagens ou trilhas de terceiros no anúncio sem autorização. Usar referências externas para entender a estratégia, não para copiar o arquivo final.
- Confirmar se uma expressão ambígua significa vias, visitas, vendas ou outra condição antes de anunciar uma liberação.
- Não atualizar CRM, site ou redes sociais apenas porque o usuário pediu um vídeo.

## 3. Analisar a estratégia e escrever o roteiro

Extrair da referência o gancho, a progressão, o ritmo, a prova visual e o CTA. Adaptar a estrutura ao empreendimento, sem copiar a identidade de terceiros.

Organizar a mensagem: gancho visual → comparação ou benefício → imagens reais/prova da obra → disponibilidade confirmada → cadastro e lançamento → logo e slogan.

Usar português brasileiro natural, frases curtas e benefício concreto. Explicar o que muda para o comprador: espaço, projeto de vida, natureza, localização ou condições claras. Não prometer valorização, retorno, infraestrutura entregue ou escassez não comprovada.

## 4. Auditar medidas, preços e disponibilidade

Calcular sempre por código antes de desenhar ou narrar números.

Para retângulos, conferir largura × comprimento, área anunciada, razão de áreas e preço por m². Não deduzir dimensões reais somente a partir da área. Confirmar medidas com o proprietário ou fonte técnica; usar exemplos claramente identificados quando não houver confirmação.

```bash
python3 scripts/auditar_geometria.py --config templates/geometria.exemplo.json
```

Se as medidas não produzirem a área anunciada, interromper a alegação contraditória e esclarecer. Exemplo: 12 × 25 = 300 m²; 50 × 55 = 2.750 m², não 3.025; 55 × 55 = 3.025 m².

Comparar preço total e preço por m² separadamente. Não dizer “mesmo preço” quando os totais diferirem. Não usar uma faixa estreita de preço por m² sem preços/áreas pareados e fontes adequadas.

Conferir entrada, saldo, prazo, juros e total antes de anunciar uma prestação. Se faltar confirmação, usar “consulte as condições de financiamento direto”, sem combinar números incompatíveis.

Marcar como vendidas somente as unidades identificadas e confirmadas. Se a lista contiver algumas vendas, não apresentá-la como o total completo. Usar escassez real: vendas iniciadas e disponibilidade sujeita a alteração, sem “últimas unidades” inventadas.

## 5. Gerar e medir a narração

Reutilizar uma voz brasileira aprovada quando estiver disponível. Separar o texto falado das orientações de interpretação. Gerar a passagem completa com pausas naturais; ouvir/verificar pronúncia, valores, marca e encerramento.

Medir a duração real com `ffprobe` e transcrever com tempos de palavras ou frases. Planejar as cenas com esses tempos, não com uma estimativa anterior. Se mudar o texto falado, atualizar a transcrição e a sincronização.

Não regenerar a narração ao alterar apenas o desenho de um quadro aprovado.

## 6. Construir a sequência visual

Mostrar as imagens reais quando a narração mencionar o empreendimento, a natureza ou a obra. Identificar projetos previstos e empreendimento em implantação sem sugerir conclusão.

Para comparações, desenhar os quatro lados dos terrenos com um ponto luminoso percorrendo o contorno e fechando a geometria. Revelar medidas junto aos lados, área e preço em etapas, com tempo para leitura. Usar a mesma quantidade de pixels por metro nos dois terrenos; não aumentar a figura menor para preencher seu cartão.

```bash
python3 scripts/render_geometria.py \
  --config templates/geometria.exemplo.json \
  --output /caminho/do/projeto/geometria.mp4 \
  --preview-dir /caminho/do/projeto/previas
```

Editar uma cópia do exemplo JSON com as dimensões confirmadas, rótulos, duração, preços atualizados e rodapé. O exemplo não contém oferta comercial vigente. Consultar `--help` para opções adicionais. Instalar dependências locais somente se faltarem; não chamar serviços pagos para uma geometria determinística.

Manter o quadro simples: nome, desenho, dimensões, área e benefício. Preferir “Olha a diferença de espaço!” a títulos de análise financeira; evitar equações detalhadas e texto técnico que não ajudem a decisão.

## 7. Montar, legendar e exportar

Usar arquivos locais e FFmpeg para cortes, enquadramento, composições, mixagem e exportação. Normalizar orientação por trecho; uma câmera que gira durante a filmagem pode exigir tratamentos diferentes dentro do mesmo arquivo.

Sincronizar legendas com a voz, corrigir nomes por contexto e usar frases curtas. Reservar uma faixa de legendas; reposicioná-las quando houver cartão de preço, medida, data ou contato. Não sobrepor os títulos à própria vinheta.

Manter a música abaixo da voz, sem reutilizar falas do vídeo-base por acidente. Preservar o fim da narração. Exportar, por padrão, MP4 vertical H.264/AAC em 1080 × 1920 e uma versão mais leve em 720 × 1280, com `+faststart`. Adaptar formato e duração quando o usuário pedir outro destino.

## 8. Verificar e entregar

Conferir codec, dimensões, duração e áudio; verificar o primeiro quadro, desenhos em andamento, geometria fechada, transições, cartões de preço, cenas reais e encerramento.

```bash
python3 scripts/inspecionar_video.py \
  --input /caminho/do/projeto/final.mp4 \
  --output-dir /caminho/do/projeto/checagem \
  --times 1,10,33,36,39,54,67 --require-audio
```

Adaptar os tempos ao vídeo real. Ouvir a mixagem; não considerar áudio aprovado apenas por existir um stream. Investigar divergências entre análise automática e quadros efetivos, especialmente orientação. Corrigir problemas materiais, sem refazer tudo por sugestões meramente estéticas.

Entregar os vídeos finais com links, indicar a versão leve e, numa revisão pontual, informar onde aparece o trecho alterado. Não anexar todos os intermediários quando já estiverem incorporados ao vídeo. Não afirmar que publicou o vídeo ou instalou algo sem executar essa ação autorizada.
