# Fase 5C.7 test tooling only (never used by ORBIT's runtime): independent XSD validation with
# Microsoft .NET XmlSchemaSet. The official SAT schemas are added explicitly from the versioned
# copies; XmlResolver = null (no import is fetched) and DtdProcessing = Prohibit. Warnings
# (for example an undeclared root element) count as INVALID, like errors.
# Output: one line per file, "VALID <name>" or "INVALID <name>".
param([string]$SchemaDir, [string]$SampleDir)
$ErrorActionPreference = 'Stop'
$readerSettings = New-Object System.Xml.XmlReaderSettings
$readerSettings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$readerSettings.XmlResolver = $null
$set = New-Object System.Xml.Schema.XmlSchemaSet
$set.XmlResolver = $null
foreach ($name in @('tdCFDI.xsd', 'catCFDI.xsd', 'cfdv40.xsd')) {
  $reader = [System.Xml.XmlReader]::Create((Join-Path $SchemaDir $name), $readerSettings)
  [void]$set.Add([NullString]::Value, $reader)
  $reader.Close()
}
$set.Compile()
foreach ($file in Get-ChildItem $SampleDir -Filter *.xml | Sort-Object Name) {
  $script:problems = 0
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.ValidationType = [System.Xml.ValidationType]::Schema
  $settings.Schemas = $set
  $settings.ValidationFlags = [System.Xml.Schema.XmlSchemaValidationFlags]::ReportValidationWarnings
  $settings.add_ValidationEventHandler({ param($s, $e) $script:problems++ })
  try {
    $reader = [System.Xml.XmlReader]::Create($file.FullName, $settings)
    while ($reader.Read()) { }
    $reader.Close()
  } catch {
    $script:problems++
  }
  if ($script:problems -eq 0) { "VALID $($file.Name)" } else { "INVALID $($file.Name)" }
}
