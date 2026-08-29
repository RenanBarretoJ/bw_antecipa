param(
  [string]$Project = 'bw-antecipa',
  [string]$Scope = 'renanbarretoj'
)

$ErrorActionPreference = 'Stop'
$requiredKeys = @('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM')
$secretKeys = @('SMTP_USER', 'SMTP_PASSWORD')
$credentialTarget = 'BW Antecipa:P4.9 Supabase Auth SMTP'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempFile = [IO.Path]::GetFullPath((Join-Path $tempRoot ("bw-p4-8-{0}.env" -f [guid]::NewGuid().ToString('N'))))

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

function Get-LocalSmtpCredential {
  if (-not ('BwP49CredentialRead' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BwP49CredentialRead {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credential);
}
'@
  }

  $pointer = [IntPtr]::Zero
  if (-not [BwP49CredentialRead]::CredRead($credentialTarget, 1, 0, [ref]$pointer)) {
    throw 'Credencial SMTP de producao nao encontrada no Windows Credential Manager.'
  }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $pointer,
      [type][BwP49CredentialRead+Credential]
    )
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
    return [ordered]@{
      username = [string]$credential.UserName
      password = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
    }
  } finally {
    [BwP49CredentialRead]::CredFree($pointer)
  }
}

$previousValues = @{}
try {
  & vercel env pull $tempFile --environment production --project $Project --scope $Scope --yes --no-color | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempFile -PathType Leaf)) {
    throw 'Nao foi possivel obter as variaveis Production pelo canal seguro da Vercel.'
  }

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $tempFile) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $values[$Matches[1]] = ConvertFrom-DotEnvValue $Matches[2]
    }
  }

  $localCredential = Get-LocalSmtpCredential
  $values['SMTP_USER'] = $localCredential.username
  $values['SMTP_PASSWORD'] = $localCredential.password

  foreach ($key in $requiredKeys) {
    if (-not $values.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$values[$key])) {
      throw "A variavel segura $key nao esta disponivel no target Production."
    }
    if ($secretKeys -notcontains $key -and [string]$values[$key] -eq '[SENSITIVE]') {
      throw "A Vercel protege $key contra exportacao. Forneca o segredo por um canal seguro nao versionado."
    }
    $previousValues[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$values[$key], 'Process')
  }

  & (Join-Path $PSScriptRoot '..\p4-5\supabase-auth-config.ps1') -Mode SetSmtpFromEnvironment
  if ($LASTEXITCODE -ne 0) { throw 'A configuracao segura do Supabase Auth SMTP falhou.' }
  & (Join-Path $PSScriptRoot '..\p4-9\smtp-auth-credential.ps1') -Remove | Out-Null
} finally {
  foreach ($key in $requiredKeys) {
    [Environment]::SetEnvironmentVariable($key, $previousValues[$key], 'Process')
  }
  if (Test-Path -LiteralPath $tempFile -PathType Leaf) {
    $resolved = [IO.Path]::GetFullPath($tempFile)
    if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Recusa ao remover arquivo fora do diretorio temporario permitido.'
    }
    Remove-Item -LiteralPath $resolved -Force
  }
}
