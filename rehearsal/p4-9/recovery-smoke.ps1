param(
  [Parameter(Mandatory = $true)]
  [string]$Recipient,
  [string]$Project = 'bw-antecipa',
  [string]$Scope = 'renanbarretoj'
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'wwsndnuvnjuabpbjwlck'
$expectedRedirect = 'https://bw-antecipa.better-with.tech/redefinir-senha'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempFile = [IO.Path]::GetFullPath((Join-Path $tempRoot ("bw-p4-9-recovery-{0}.env" -f [guid]::NewGuid().ToString('N'))))

if (-not $tempFile.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Diretorio temporario fora do escopo permitido.'
}

function ConvertFrom-DotEnvValue([string]$Value) {
  $trimmed = $Value.Trim()
  if ($trimmed.Length -ge 2 -and $trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) {
    $trimmed = $trimmed.Substring(1, $trimmed.Length - 2)
    return $trimmed.Replace('\n', "`n").Replace('\r', "`r").Replace('\"', '"').Replace('\\', '\')
  }
  if ($trimmed.Length -ge 2 -and $trimmed.StartsWith("'") -and $trimmed.EndsWith("'")) {
    return $trimmed.Substring(1, $trimmed.Length - 2)
  }
  return $trimmed
}

try {
  & vercel env pull $tempFile --environment production --project $Project --scope $Scope --yes --no-color | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempFile -PathType Leaf)) {
    throw 'Nao foi possivel obter a configuracao publica Production pela Vercel.'
  }

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $tempFile) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $values[$Matches[1]] = ConvertFrom-DotEnvValue $Matches[2]
    }
  }

  $supabaseUrl = [string]$values['NEXT_PUBLIC_SUPABASE_URL']
  $publishableKey = [string]$values['NEXT_PUBLIC_SUPABASE_ANON_KEY']
  if ([string]::IsNullOrWhiteSpace($supabaseUrl) -or [string]::IsNullOrWhiteSpace($publishableKey)) {
    throw 'URL ou chave publica do Supabase ausente no target Production.'
  }
  if ($supabaseUrl -ne "https://$expectedProjectRef.supabase.co") {
    throw 'Projeto Supabase Production divergente do esperado.'
  }
  if ($Recipient -notmatch '^[^@\s]+@[^@\s]+$') { throw 'Destinatario autorizado invalido.' }

  $uri = "$supabaseUrl/auth/v1/recover?redirect_to=$([uri]::EscapeDataString($expectedRedirect))"
  $body = @{ email = $Recipient } | ConvertTo-Json -Compress
  $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -Headers @{ apikey = $publishableKey } -ContentType 'application/json' -Body $body
  if ([int]$response.StatusCode -ne 200) { throw 'O endpoint Auth nao aceitou o recovery controlado.' }

  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $recipientHash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Recipient.ToLowerInvariant()))
  } finally {
    $sha.Dispose()
  }
  [pscustomobject]@{
    accepted = $true
    status_code = [int]$response.StatusCode
    project_ref = $expectedProjectRef
    flow = 'recovery_token_hash_scanner_safe'
    redirect_host = ([uri]$expectedRedirect).Host
    redirect_path = ([uri]$expectedRedirect).AbsolutePath
    recipient_fingerprint = (([BitConverter]::ToString($recipientHash) -replace '-', '').ToLowerInvariant().Substring(0, 16))
    requested_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json
} finally {
  if (Test-Path -LiteralPath $tempFile -PathType Leaf) {
    $resolved = [IO.Path]::GetFullPath($tempFile)
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Recusa ao remover arquivo fora do diretorio temporario permitido.'
    }
    Remove-Item -LiteralPath $resolved -Force
  }
}
