# Complete offline XSD validation. Includes are wired from pinned local files, without a resolver.
param([string]$PrivateDirectory)
$ErrorActionPreference = 'Stop'
$repoDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$schemasDirectory = Join-Path $repoDirectory 'tests/fixtures/nfse/nacional/schemas'
$corpusDirectory = Join-Path $repoDirectory 'tests/fixtures/nfse/nacional'
foreach ($provenance in @('provenance.json', 'homolog-20260727/provenance.json')) {
    $source = Get-Content -LiteralPath (Join-Path $schemasDirectory $provenance) -Raw | ConvertFrom-Json
    foreach ($file in $source.arquivos) {
        if ((Get-FileHash -LiteralPath (Join-Path $schemasDirectory $file.arquivo) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
            throw 'OFFICIAL_SCHEMA_HASH_CHANGED'
        }
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $corpusDirectory 'manifest.json') -Raw | ConvertFrom-Json
$cases = @($manifest.casos | ForEach-Object {
    [pscustomobject]@{ id = $_.id; versao = $_.versao; raiz_xsd = $_.raiz_xsd;
        sha256 = $_.sha256; path = (Join-Path $corpusDirectory $_.arquivo); classification = $_.origem }
})
if ($PrivateDirectory) {
    $publicSamples = Get-Content -LiteralPath (Join-Path $PrivateDirectory 'public-samples.json') -Raw | ConvertFrom-Json
    $cases += @($publicSamples | ForEach-Object {
        [pscustomobject]@{ id = $_.id; versao = $_.version; raiz_xsd = $_.root;
            sha256 = $_.sha256; path = $_.local_private_path; classification = $_.classification }
    })
}
$rows = @()
foreach ($case in $cases) {
    $xmlPath = $case.path
    if ((Get-FileHash -LiteralPath $xmlPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $case.sha256) { throw 'CORPUS_HASH_CHANGED' }
    if ($case.versao -notin @('1.00', '1.01')) {
        $rows += [pscustomobject]@{ id = $case.id; version = $case.versao; profile = $null;
            classification = $case.classification; xml_sha256 = $case.sha256; valid = $null;
            status = 'NOT_EXECUTED_MISSING_SUPPORTED_VERSION'; errors = @() }
        continue
    }
    $profiles = @([pscustomobject]@{ name = 'producao-20260209'; directory = (Join-Path $schemasDirectory $case.versao) })
    if ($case.versao -eq '1.01') {
        $profiles += [pscustomobject]@{ name = 'homolog-20260727'; directory = (Join-Path $schemasDirectory 'homolog-20260727/1.01') }
    }
    foreach ($profile in $profiles) {
        $loaded = @{}
        foreach ($file in Get-ChildItem -LiteralPath $profile.directory -Filter '*.xsd') {
            $readerSettings = [System.Xml.XmlReaderSettings]::new()
            # Trusted, hash-checked signature schema has an unused DTD; ignore it without resolution.
            $readerSettings.DtdProcessing = [System.Xml.DtdProcessing]::Ignore
            $readerSettings.XmlResolver = $null
            $reader = [System.Xml.XmlReader]::Create($file.FullName, $readerSettings)
            $loaded[$file.Name] = [System.Xml.Schema.XmlSchema]::Read($reader, $null)
            $reader.Dispose()
        }
        foreach ($schema in $loaded.Values) {
            foreach ($edge in $schema.Includes) {
                if (-not $loaded.ContainsKey($edge.SchemaLocation)) { throw 'NONLOCAL_SCHEMA_INCLUDE' }
                $edge.Schema = $loaded[$edge.SchemaLocation]
            }
        }
        $schemaSet = [System.Xml.Schema.XmlSchemaSet]::new()
        $schemaSet.XmlResolver = $null
        $schemaName = $case.raiz_xsd + '_v' + $case.versao + '.xsd'
        $null = $schemaSet.Add($loaded[$schemaName])
        $schemaSet.Compile()
        $errors = [System.Collections.Generic.List[object]]::new()
        $settings = [System.Xml.XmlReaderSettings]::new()
        $settings.ValidationType = [System.Xml.ValidationType]::Schema
        $settings.Schemas = $schemaSet
        $settings.XmlResolver = $null
        $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
        $settings.add_ValidationEventHandler({ param($sender, $event)
            $errors.Add([pscustomobject]@{ line = $event.Exception.LineNumber;
                field = $sender.LocalName; severity = $event.Severity.ToString() })
        })
        $reader = [System.Xml.XmlReader]::Create($xmlPath, $settings)
        while ($reader.Read()) {}
        $reader.Dispose()
        $rows += [pscustomobject]@{ id = $case.id; version = $case.versao; profile = $profile.name;
            classification = $case.classification; xml_sha256 = $case.sha256;
            valid = ($errors.Count -eq 0); errors = @($errors.ToArray()) }
    }
}
[pscustomobject]@{ engine = [System.Xml.Schema.XmlSchemaSet].Assembly.FullName;
    scope = 'COMPLETE_DOCUMENT_OFFLINE'; signature_verified = $false; resultados = $rows } | ConvertTo-Json -Depth 6
