param(
  [switch]$Remove,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$Target = 'BW Antecipa:P4.9 Supabase Auth SMTP'

if (-not ('BwP49Credential' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BwP49Credential {
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

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CredWrite(ref Credential credential, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr credential);
}
'@
}

function Test-CredentialExists {
  $pointer = [IntPtr]::Zero
  if (-not [BwP49Credential]::CredRead($Target, 1, 0, [ref]$pointer)) { return $false }
  try { return $true } finally { [BwP49Credential]::CredFree($pointer) }
}

if ($Status) {
  [pscustomobject]@{ target = $Target; available = Test-CredentialExists } | ConvertTo-Json
  exit 0
}

if ($Remove) {
  if (Test-CredentialExists) {
    if (-not [BwP49Credential]::CredDelete($Target, 1, 0)) {
      throw 'Nao foi possivel remover a credencial SMTP temporaria.'
    }
  }
  [pscustomobject]@{ target = $Target; available = $false; removed = $true } | ConvertTo-Json
  exit 0
}

$username = Read-Host 'SMTP_USER da conta IONOS de producao'
if ($username -notmatch '^[^@\s]+@[^@\s]+$') { throw 'SMTP_USER possui formato invalido.' }
$password = Read-Host 'SMTP_PASSWORD da conta IONOS de producao' -AsSecureString
if ($password.Length -eq 0) { throw 'SMTP_PASSWORD nao pode ficar vazio.' }

$blob = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
  $credential = New-Object BwP49Credential+Credential
  $credential.Flags = 0
  $credential.Type = 1
  $credential.TargetName = $Target
  $credential.Comment = 'Credencial efemera para configurar Supabase Auth no P4.9'
  $credential.CredentialBlobSize = $password.Length * 2
  $credential.CredentialBlob = $blob
  $credential.Persist = 1
  $credential.AttributeCount = 0
  $credential.Attributes = [IntPtr]::Zero
  $credential.TargetAlias = $null
  $credential.UserName = $username

  if (-not [BwP49Credential]::CredWrite([ref]$credential, 0)) {
    throw 'Nao foi possivel armazenar a credencial SMTP no Windows Credential Manager.'
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($blob)
  $password.Dispose()
}

[pscustomobject]@{ target = $Target; available = $true; persistence = 'logon_session' } | ConvertTo-Json
