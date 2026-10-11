# Independent type-only experiment. Does not validate a complete NFSe or patch official schemas.
$ErrorActionPreference = 'Stop'
$repoDirectory = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$schemaPaths = @(
    'tests/fixtures/nfse/nacional/schemas/1.01/tiposSimples_v1.01.xsd',
    'tests/fixtures/nfse/nacional/schemas/homolog-20260727/1.01/tiposSimples_v1.01.xsd'
)
$rows = @()
foreach ($relativePath in $schemaPaths) {
    $filePath = Join-Path $repoDirectory $relativePath
    $document = [System.Xml.XmlDocument]::new()
    $document.XmlResolver = $null
    $document.Load($filePath)
    $namespaces = [System.Xml.XmlNamespaceManager]::new($document.NameTable)
    $namespaces.AddNamespace('xs', 'http://www.w3.org/2001/XMLSchema')
    $pattern = $document.SelectSingleNode('//xs:simpleType[@name="TSSerieDPS"]//xs:pattern', $namespaces).GetAttribute('value')
    $maxLength = $document.SelectSingleNode('//xs:simpleType[@name="TSSerieDPS"]//xs:maxLength', $namespaces).GetAttribute('value')
    $schemaText = '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"><xs:element name="serie"><xs:simpleType><xs:restriction base="xs:string"><xs:maxLength value="' + $maxLength + '"/><xs:pattern value="' + [System.Security.SecurityElement]::Escape($pattern) + '"/></xs:restriction></xs:simpleType></xs:element></xs:schema>'
    $schemaReader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($schemaText))
    $schemaSet = [System.Xml.Schema.XmlSchemaSet]::new()
    $null = $schemaSet.Add('', $schemaReader)
    $schemaSet.Compile()
    foreach ($serie in @('00001', '1', '^1$')) {
        $errors = [System.Collections.Generic.List[string]]::new()
        $settings = [System.Xml.XmlReaderSettings]::new()
        $settings.ValidationType = [System.Xml.ValidationType]::Schema
        $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver = $null
        $settings.Schemas = $schemaSet
        $settings.add_ValidationEventHandler({ param($sender, $event) $errors.Add($event.Severity.ToString()) })
        $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new('<serie>' + $serie + '</serie>'), $settings)
        while ($reader.Read()) {}
        $reader.Dispose()
        $rows += [pscustomobject]@{ schema = $relativePath; sha256 = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant(); pattern = $pattern; serie = $serie; valid = ($errors.Count -eq 0) }
    }
    $schemaReader.Dispose()
}
[pscustomobject]@{ engine = [System.Xml.Schema.XmlSchemaSet].Assembly.FullName; scope = 'TYPE_ONLY_NOT_FULL_DOCUMENT'; resultados = $rows } | ConvertTo-Json -Depth 5
