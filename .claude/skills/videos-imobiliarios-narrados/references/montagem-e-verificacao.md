# Montagem e verificação

## Inspecionar primeiro

Executar `ffprobe` nos vídeos e no áudio antes da edição. Registrar duração, orientação/metadados de rotação, dimensões, FPS e existência de som. Extrair alguns quadros relevantes, não uma galeria indiscriminada.

O arquivo pode ter sido gravado com o telefone em pé e depois deitado. Aplicar correção apenas ao trecho afetado. Conferir se as pessoas estão em pé e se o enquadramento preserva a informação; não aplicar `transpose` a todos os trechos por inferência de um único quadro.

Para imagem horizontal em vídeo vertical, preferir uma janela central identificada, com fundo da marca, a esticar/desfigurar o material ou cortar a obra que se pretende mostrar. Conferir a orientação depois da composição final, com a mesma decodificação usada para extrair o quadro.

## Usar a narração como relógio

Medir o áudio gerado e usar a transcrição temporizada como referência. Registrar intervalos de saída e origem no manifesto. Um intervalo fonte não corresponde automaticamente ao mesmo segundo do vídeo final.

Se ajustar a velocidade de imagens, preservar a fala independente. Evitar aceleração excessiva das imagens reais da obra; usar retiming discreto para mapas e movimento gráfico. Não alongar o vídeo inteiro apenas para preencher um alvo arbitrário.

Ao reutilizar a mesma montagem, preservar caminhos de entrada parametrizados. Não portar scripts que dependam de nomes absolutos de uploads de uma sessão anterior sem substituir essas dependências.

## Renderizar geometrias eficientemente

O renderizador da habilidade deriva seus recursos do próprio diretório e recebe JSON externo. Usar Canvas JavaScript determinístico, renderizar cada instante por FPS e transportar o PNG do canvas para FFmpeg. Preferir `canvas.toDataURL` a screenshots repetidas de toda a página quando não forem necessárias; esse caminho reduziu o custo do render neste processo.

Usar fontes locais e formato H.264/yuv420p. Validar entradas antes do render para não produzir uma figura com medida e área contraditórias. Fazer um teste curto quando alterar o código ou as dependências, antes de renderizar a duração completa.

## Legendas e áreas seguras

Para 1080 × 1920, a faixa 1460–1620 é uma reserva útil de legendas, não uma regra universal. Ajustar para o destino e o conteúdo.

Separar as camadas: imagem → títulos/desenhos → condições/rodapé → legenda. Evitar que legendas cubram cartões de preço. No processo de referência, os cartões de lotes precisaram de legenda acima deles, enquanto os quadros de comparação usaram a faixa reservada.

Agrupar palavras por frases curtas, com quebra manual quando necessário. Evitar terminar a linha em uma preposição/conjunção isolada. Corrigir marca por contexto: “Bom Jardims” não autoriza trocar “Jardins” de um concorrente por “Jardims”.

Não presumir que um contato maior cabe em qualquer lugar do cartão. Conferir simultaneamente telefone, data e slogan. Um rótulo colocado sobre a data pode tornar o lançamento ilegível mesmo que ambos estejam corretos no texto.

## Mixagem

Verificar se o vídeo-base contém somente música ou também uma locução antes de reaproveitar seu som. Nunca deixar duas narrativas competindo por acidente.

Usar voz em primeiro plano; -16 LUFS para voz e aproximadamente -27 LUFS para a trilha são pontos de partida, não garantia de qualidade. Ouvir a mixagem, conferir picos e preservar a última frase. Usar fade musical no fim.

Se a trilha autorizada for ligeiramente mais curta, considerar retiming instrumental discreto ou nova trilha adequada à duração. Não cortar a voz nem fazer um loop com emenda perceptível. Não usar trilha de referência de terceiros sem autorização.

## Exportação padrão

Exportar o master em 1080 × 1920, H.264/yuv420p, AAC, 30 FPS e `+faststart`, quando compatível com as fontes e o destino. Gerar uma versão leve a partir do master, por exemplo:

```bash
ffmpeg -i master.mp4 -vf scale=720:1280 \
  -c:v libx264 -preset fast -crf 26 -pix_fmt yuv420p \
  -c:a aac -b:a 112k -movflags +faststart whatsapp.mp4
```

Não sobrescrever uma versão aprovada sem autorização; escolher um novo nome. Adaptar CRF e taxa de áudio se a legibilidade ou o tamanho exigirem.

## Conferência final

Verificar pelo menos um quadro de cada estado importante: abertura, títulos antigos substituídos, cartão urbano, apresentação real, geometria em andamento/fechada, condições, obra, vendas e encerramento.

Conferir se os títulos antigos com preço, prestação ou infraestrutura já pronta foram realmente removidos; trocar a narração não os apaga.

Usar análise automática para auxiliar na fala, coerência e cortes. Não aceitar como definitivo um alerta de rotação se o quadro final mostrar pessoas naturalmente em pé; investigar metadados e evidência visual. Neste processo, alertas automáticos de 90° contradisseram quadros corretos da obra. Também não ignorar um erro real apenas porque uma ferramenta deu aprovação geral.

Não repetir renderizações por gosto estético após cumprir o pedido. Corrigir sobreposição, número contraditório, imagem indevidamente girada, corte de fala ou outro problema material. Manter a revisão restrita ao que mudou e às suas transições.
