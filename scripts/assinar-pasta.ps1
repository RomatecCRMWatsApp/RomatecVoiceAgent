<#
  ZAYRA - Assinatura em lote de uma pasta de PDFs (pecas do assistente tecnico)
  Uso:
    $env:ZAYRA_URL = "http://localhost:3000"        # ou https://seu-servidor
    $env:ASSINATURA_RT_TOKEN = "<token do .env>"
    .\assinar-pasta.ps1 -Pasta "D:\Romatec\Servidao Dom Eliseu\Joelson - Luana III"
#>
param(
  [Parameter(Mandatory = $true)][string]$Pasta,
  [string]$Obra = "Servidao LT 230 kV - Dom Eliseu/PA",
  [string]$Tipo = "parecer-assistente-tecnico",
  [ValidateSet("inferior-esquerda","inferior-direita","superior-esquerda","superior-direita","nenhum")]
  [string]$Posicao = "inferior-esquerda",
  [string]$Motivo = "Assistente Tecnico dos Reus - autoria e responsabilidade tecnica",
  [string]$Url = $env:ZAYRA_URL,
  [string]$Token = $env:ASSINATURA_RT_TOKEN
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if (-not $Url)   { $Url = "http://localhost:3000" }
if (-not $Token) { throw "Defina a variavel ASSINATURA_RT_TOKEN ou passe -Token" }
if ($Url -notmatch "^https://" -and $Url -notmatch "localhost|127\.0\.0\.1") {
  throw "Servidor remoto sem HTTPS: a senha do certificado trafegaria aberta. Use https://"
}

$api     = "$($Url.TrimEnd('/'))/api/assinatura"
$headers = @{ Authorization = "Bearer $Token" }

function Erro-Api($e) {
  if ($e.ErrorDetails -and $e.ErrorDetails.Message) {
    try { return ($e.ErrorDetails.Message | ConvertFrom-Json).erro } catch { return $e.ErrorDetails.Message }
  }
  return $e.Exception.Message
}

# 1) Certificado
try { $st = Invoke-RestMethod -Uri "$api/certificado" -Headers $headers }
catch { throw "Falha ao consultar certificado: $(Erro-Api $_)" }
Write-Host ""
Write-Host "Certificado: $($st.titular) | AC: $($st.emissor) | vence em $($st.diasRestantes) dia(s)" -ForegroundColor Green
if ($st.vencido) { throw "Certificado vencido" }
if ($st.alerta)  { Write-Host "ATENCAO: certificado proximo do vencimento" -ForegroundColor Yellow }

# 2) PDFs da pasta
$pdfs = Get-ChildItem -LiteralPath $Pasta -Filter *.pdf -File | Where-Object { $_.BaseName -notmatch "-ASSINADO$" }
if (-not $pdfs) { throw "Nenhum PDF encontrado em $Pasta" }

$ids = @()
foreach ($f in $pdfs) {
  try {
    if ($PSVersionTable.PSVersion.Major -ge 7) {
      $form = @{ pdf = Get-Item -LiteralPath $f.FullName; titulo = $f.BaseName; tipo = $Tipo; obra = $Obra;
                 motivo = $Motivo; posicao = $Posicao; origem = "powershell" }
      $j = Invoke-RestMethod -Method Post -Uri "$api/documentos" -Headers $headers -Form $form
    } else {
      $out = & curl.exe -sS --fail-with-body -X POST "$api/documentos" -H "Authorization: Bearer $Token" `
        -F "pdf=@$($f.FullName);type=application/pdf" -F "titulo=$($f.BaseName)" -F "tipo=$Tipo" `
        -F "obra=$Obra" -F "motivo=$Motivo" -F "posicao=$Posicao" -F "origem=powershell"
      if ($LASTEXITCODE -ne 0) { throw ($out | Out-String) }
      $j = $out | ConvertFrom-Json
    }
    $ids += [int]$j.id
    Write-Host ("Enfileirado  id {0,-5} cod {1}  {2}" -f $j.id, $j.codigo, $f.Name)
  } catch {
    Write-Host "ERRO ao enviar $($f.Name): $(Erro-Api $_)" -ForegroundColor Red
  }
}
if (-not $ids) { throw "Nenhum documento enfileirado" }

# 3) Conferencia e autorizacao do RT
Write-Host ""
$ok = Read-Host "Conferiu o conteudo dos $($ids.Count) documento(s) e autoriza a assinatura? (S/N)"
if ($ok -notmatch "^[sS]") {
  Write-Host "Assinatura nao autorizada. Documentos permanecem pendentes na fila." -ForegroundColor Yellow
  exit 0
}
$sec = Read-Host "Senha do certificado A1" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $senha = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $body = @{ ids = $ids; senha = $senha } | ConvertTo-Json -Compress
  $res = Invoke-RestMethod -Method Post -Uri "$api/aprovar" -Headers $headers `
           -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body))
} catch {
  throw "Assinatura recusada: $(Erro-Api $_)"
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  $senha = $null; $body = $null
}

# 4) Download dos assinados
$saida = Join-Path $Pasta "ASSINADOS"
New-Item -ItemType Directory -Force -Path $saida | Out-Null
Write-Host ""
foreach ($r in $res.resultados) {
  if ($r.ok) {
    $nome = ($r.titulo -replace '[\\/:*?"<>|]', '_') + "-ASSINADO.pdf"
    Invoke-WebRequest -Uri "$api/documentos/$($r.id)/assinado" -Headers $headers -OutFile (Join-Path $saida $nome) -UseBasicParsing
    Write-Host "ASSINADO  $nome" -ForegroundColor Green
  } else {
    Write-Host "FALHOU    $($r.titulo): $($r.erro)" -ForegroundColor Red
  }
}
Write-Host ""
Write-Host "$($res.assinados) assinado(s), $($res.falhas) falha(s). Saida: $saida"
Write-Host "Valide um deles em https://validar.iti.gov.br"
