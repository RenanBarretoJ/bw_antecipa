param(
  [ValidateSet('Inspect', 'SetSiteUrl', 'SetRedirects', 'EnableTotp', 'SetRecoveryTemplate', 'SetSmtpFromEnvironment')]
  [string]$Mode = 'Inspect'
)

$ErrorActionPreference = 'Stop'
$ProjectRef = 'wwsndnuvnjuabpbjwlck'
$ExpectedSiteUrl = 'https://bw-antecipa.better-with.tech'
$ExpectedRedirects = @(
  'https://bw-antecipa.better-with.tech/auth/confirm',
  'https://bw-antecipa.better-with.tech/convite/gestor',
  'https://bw-antecipa.better-with.tech/redefinir-senha'
)

if (-not ('BwP45Credential' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BwP45Credential {
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
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credential);
}
'@
}

function Get-SupabaseAccessToken {
  $pointer = [IntPtr]::Zero
  if (-not [BwP45Credential]::CredRead('Supabase CLI:supabase', 1, 0, [ref]$pointer)) {
    throw 'Sessao Supabase CLI nao encontrada no Windows Credential Manager.'
  }

  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
      $pointer,
      [type][BwP45Credential+Credential]
    )
    $bytes = New-Object byte[] $credential.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($credential.CredentialBlob, $bytes, 0, $bytes.Length)
    $utf8 = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
    $unicode = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0)
    $token = if ($utf8.StartsWith('sbp_')) { $utf8 } elseif ($unicode.StartsWith('sbp_')) { $unicode } else { '' }
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'Credencial Supabase CLI possui formato inesperado.' }
    return $token
  } finally {
    [BwP45Credential]::CredFree($pointer)
  }
}

function Invoke-AuthConfig {
  param(
    [ValidateSet('GET', 'PATCH')]
    [string]$Method,
    [hashtable]$Body
  )

  $headers = @{ Authorization = "Bearer $(Get-SupabaseAccessToken)" }
  $uri = "https://api.supabase.com/v1/projects/$ProjectRef/config/auth"
  if ($Method -eq 'GET') {
    return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers
  }

  return Invoke-RestMethod -Method Patch -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress)
}

function Split-Redirects([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
  return @($Value.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
}

function Test-Template {
  param(
    [object]$Config,
    [string]$Name,
    [string[]]$RequiredFragments
  )
  $value = [string]$Config.$Name
  $valid = -not [string]::IsNullOrWhiteSpace($value)
  foreach ($fragment in $RequiredFragments) { $valid = $valid -and $value.Contains($fragment) }
  return $valid
}

function Sanitize-Config([object]$Config) {
  $redirects = Split-Redirects ([string]$Config.uri_allow_list)
  $smtpHost = [string]$Config.smtp_host
  $smtpPort = [string]$Config.smtp_port
  $smtpUser = [string]$Config.smtp_user
  $smtpPass = [string]$Config.smtp_pass

  return [ordered]@{
    site_url = [string]$Config.site_url
    site_url_ready = ([string]$Config.site_url -eq $ExpectedSiteUrl)
    redirect_urls = $redirects
    redirects_exact = (@(Compare-Object $ExpectedRedirects $redirects).Count -eq 0)
    mfa = [ordered]@{
      totp_enroll_enabled = [bool]$Config.mfa_totp_enroll_enabled
      totp_verify_enabled = [bool]$Config.mfa_totp_verify_enabled
      max_enrolled_factors = [int]$Config.mfa_max_enrolled_factors
    }
    smtp = [ordered]@{
      host_present = -not [string]::IsNullOrWhiteSpace($smtpHost)
      host_nonlocal = (-not [string]::IsNullOrWhiteSpace($smtpHost)) -and ($smtpHost -notmatch 'localhost|127\.0\.0\.1')
      ionos = $smtpHost -match 'ionos'
      port_profile = if ($smtpPort -eq '465') { '465' } elseif ($smtpPort -eq '587') { '587' } else { 'other' }
      user_present = -not [string]::IsNullOrWhiteSpace($smtpUser)
      password_present = -not [string]::IsNullOrWhiteSpace($smtpPass)
      admin_email_present = -not [string]::IsNullOrWhiteSpace([string]$Config.smtp_admin_email)
      sender_name_present = -not [string]::IsNullOrWhiteSpace([string]$Config.smtp_sender_name)
    }
    templates = [ordered]@{
      invite_present = Test-Template $Config 'mailer_templates_invite_content' @()
      invite_uses_confirmation_url = Test-Template $Config 'mailer_templates_invite_content' @('{{ .ConfirmationURL }}')
      recovery_scanner_safe = Test-Template $Config 'mailer_templates_recovery_content' @('{{ .TokenHash }}', '/auth/confirm')
      recovery_uses_confirmation_url = Test-Template $Config 'mailer_templates_recovery_content' @('{{ .ConfirmationURL }}')
      confirmation_scanner_safe = Test-Template $Config 'mailer_templates_confirmation_content' @('{{ .TokenHash }}', '/auth/confirm')
      confirmation_uses_confirmation_url = Test-Template $Config 'mailer_templates_confirmation_content' @('{{ .ConfirmationURL }}')
      email_change_present = Test-Template $Config 'mailer_templates_email_change_content' @()
    }
  }
}

function Get-RequiredEnvironmentValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Variavel segura obrigatoria ausente: $Name."
  }
  return $value
}

function Resolve-SmtpSender([string]$EmailFrom, [string]$SmtpUser) {
  $match = [regex]::Match($EmailFrom, '^\s*(?:"?([^"<]+)"?\s*)?<([^>]+)>\s*$')
  $email = if ($match.Success) { $match.Groups[2].Value.Trim() } else { $EmailFrom.Trim() }
  $name = if ($match.Success -and -not [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) {
    $match.Groups[1].Value.Trim()
  } else {
    'BW Antecipa'
  }

  if ($email -notmatch '^[^@\s]+@[^@\s]+$' -or $SmtpUser -notmatch '^[^@\s]+@[^@\s]+$') {
    throw 'Remetente ou usuario SMTP possui formato invalido.'
  }
  if (($email.Split('@')[-1]).ToLowerInvariant() -ne ($SmtpUser.Split('@')[-1]).ToLowerInvariant()) {
    throw 'O remetente deve usar o mesmo dominio da conta SMTP corporativa.'
  }

  return [ordered]@{ email = $email; name = $name }
}

$before = Invoke-AuthConfig -Method GET

switch ($Mode) {
  'Inspect' {
    Sanitize-Config $before | ConvertTo-Json -Depth 8
  }
  'SetSiteUrl' {
    if ([string]$before.site_url -ne $ExpectedSiteUrl) {
      $null = Invoke-AuthConfig -Method PATCH -Body @{ site_url = $ExpectedSiteUrl }
    }
    Sanitize-Config (Invoke-AuthConfig -Method GET) | ConvertTo-Json -Depth 8
  }
  'SetRedirects' {
    $desired = $ExpectedRedirects -join ','
    if ([string]$before.uri_allow_list -ne $desired) {
      $null = Invoke-AuthConfig -Method PATCH -Body @{ uri_allow_list = $desired }
    }
    Sanitize-Config (Invoke-AuthConfig -Method GET) | ConvertTo-Json -Depth 8
  }
  'EnableTotp' {
    if (-not [bool]$before.mfa_totp_enroll_enabled -or -not [bool]$before.mfa_totp_verify_enabled) {
      $null = Invoke-AuthConfig -Method PATCH -Body @{
        mfa_totp_enroll_enabled = $true
        mfa_totp_verify_enabled = $true
      }
    }
    Sanitize-Config (Invoke-AuthConfig -Method GET) | ConvertTo-Json -Depth 8
  }
  'SetRecoveryTemplate' {
    $desiredTemplate = @'
<h2>Redefinir sua senha</h2>
<p>Recebemos uma solicitação para redefinir a senha de acesso ao BW Antecipa.</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/redefinir-senha">Redefinir minha senha</a></p>
<p>Se você não solicitou esta alteração, ignore esta mensagem.</p>
'@
    $previousTemplate = [string]$before.mailer_templates_recovery_content
    if ($previousTemplate -ne $desiredTemplate) {
      $null = Invoke-AuthConfig -Method PATCH -Body @{ mailer_templates_recovery_content = $desiredTemplate }
    }
    $after = Invoke-AuthConfig -Method GET
    $sanitized = Sanitize-Config $after
    if (-not $sanitized.templates.recovery_scanner_safe) {
      $null = Invoke-AuthConfig -Method PATCH -Body @{ mailer_templates_recovery_content = $previousTemplate }
      throw 'Template recovery nao passou na verificacao; estado anterior restaurado.'
    }
    $sanitized | ConvertTo-Json -Depth 8
  }
  'SetSmtpFromEnvironment' {
    $smtpHost = Get-RequiredEnvironmentValue 'SMTP_HOST'
    $smtpPort = Get-RequiredEnvironmentValue 'SMTP_PORT'
    $smtpSecure = (Get-RequiredEnvironmentValue 'SMTP_SECURE').ToLowerInvariant()
    $smtpUser = Get-RequiredEnvironmentValue 'SMTP_USER'
    $smtpPassword = Get-RequiredEnvironmentValue 'SMTP_PASSWORD'
    $emailFrom = Get-RequiredEnvironmentValue 'EMAIL_FROM'

    if ($smtpHost -notmatch 'ionos') { throw 'O host SMTP autorizado deve pertencer ao provedor IONOS.' }
    if ($smtpPort -notin @('465', '587')) { throw 'A porta SMTP deve ser 465 ou 587.' }
    if (($smtpPort -eq '465' -and $smtpSecure -notin @('true', '1')) -or
        ($smtpPort -eq '587' -and $smtpSecure -notin @('false', '0'))) {
      throw 'A configuracao TLS nao corresponde a porta SMTP informada.'
    }

    $sender = Resolve-SmtpSender $emailFrom $smtpUser
    $null = Invoke-AuthConfig -Method PATCH -Body @{
      smtp_admin_email = $sender.email
      smtp_host = $smtpHost
      smtp_port = $smtpPort
      smtp_user = $smtpUser
      smtp_pass = $smtpPassword
      smtp_sender_name = $sender.name
    }

    $after = Invoke-AuthConfig -Method GET
    $sanitized = Sanitize-Config $after
    if (-not $sanitized.smtp.host_nonlocal -or
        -not $sanitized.smtp.ionos -or
        $sanitized.smtp.port_profile -ne $smtpPort -or
        -not $sanitized.smtp.user_present -or
        -not $sanitized.smtp.password_present -or
        -not $sanitized.smtp.admin_email_present -or
        -not $sanitized.smtp.sender_name_present) {
      throw 'O Supabase Auth nao confirmou a configuracao SMTP esperada.'
    }

    $sanitized | ConvertTo-Json -Depth 8
  }
}
