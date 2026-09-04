param(
  [Parameter(Mandatory = $true)]
  [string]$PluginRoot
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $PluginRoot -PathType Container)) {
  throw "未找到 dsh-codex 插件目录：$PluginRoot"
}

function Read-Text([string]$Path) {
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
}

function Write-Text([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Replace-Once([string]$Text, [string]$Old, [string]$New, [string]$Label) {
  if ($Text.Contains($New)) { return $Text }
  if (-not $Text.Contains($Old)) { throw "无法定位 $Label 的补丁锚点" }
  return $Text.Replace($Old, $New)
}

# The generic pi-ai adapter validates image policies as positive integers. The
# Codex adapter created its own profile map and omitted these fields, so image
# messages from GPT vision models reached checkedInteger(undefined) and failed
# with "Image request maxPixels must be a positive integer".
$sourceAdapter = Join-Path $PluginRoot 'src\adapter.ts'
if (Test-Path -LiteralPath $sourceAdapter) {
  $source = Read-Text $sourceAdapter
  $sourceConstants = @(
    'export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000',
    '',
    '// Keep Codex image requests within the same safe defaults as dsh-llm-pi-ai.',
    '// These values are deliberately positive because the attachment converter',
    '// rejects undefined/zero image budgets before the provider is called.',
    'export const OPENAI_CODEX_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024',
    'export const OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048',
    'export const OPENAI_CODEX_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024'
  ) -join "`n"
  $sourceFields = @(
    '    configuredMaxTokens: new Map(),',
    '    maxRequestImageBytes: OPENAI_CODEX_MAX_REQUEST_IMAGE_BYTES,',
    '    requestImagePixelBudget: OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET,',
    '    requestImageMaxBytes: OPENAI_CODEX_REQUEST_IMAGE_MAX_BYTES,',
    '    piProvider:'
  ) -join "`n"
  $source = Replace-Once $source `
    'export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000' `
    $sourceConstants `
    'Codex image policy constants'
  $source = Replace-Once $source `
    '    configuredMaxTokens: new Map(),
    piProvider:' `
    $sourceFields `
    'Codex image policy fields'
  Write-Text $sourceAdapter $source
}

# The distributed plugin includes the bundled JavaScript used by Desktop.
# Patch every hashed adapter bundle so a future dsh-codex filename change does
# not silently reintroduce the undefined policy.
Get-ChildItem -LiteralPath (Join-Path $PluginRoot 'lib') -Filter 'src-*.js' -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    $path = $_.FullName
    $bundle = Read-Text $path
    if (-not $bundle.Contains('function createOpenAICodexAdapter')) { return }
    $bundleConstants = @(
      'const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 3e5;',
      '// Positive image request limits shared with dsh-llm-pi-ai.',
      'const OPENAI_CODEX_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;',
      'const OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;',
      'const OPENAI_CODEX_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;'
    ) -join "`n"
    $bundleFields = @(
      'configuredMaxTokens: /* @__PURE__ */ new Map(),',
      "`t`tmaxRequestImageBytes: OPENAI_CODEX_MAX_REQUEST_IMAGE_BYTES,",
      "`t`trequestImagePixelBudget: OPENAI_CODEX_REQUEST_IMAGE_PIXEL_BUDGET,",
      "`t`trequestImageMaxBytes: OPENAI_CODEX_REQUEST_IMAGE_MAX_BYTES,"
    ) -join "`n"
    $bundle = Replace-Once $bundle `
      'const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 3e5;' `
      $bundleConstants `
      'bundled Codex image policy constants'
    $bundle = Replace-Once $bundle `
      'configuredMaxTokens: /* @__PURE__ */ new Map(),' `
      $bundleFields `
      'bundled Codex image policy fields'
    Write-Text $path $bundle
  }

# Only an actual imagegen result carries the stable <image> marker emitted by
# contentOf(). Reference/input attachments or error payloads must not be shown
# as generated images in every conversation.
$sourceView = Join-Path $PluginRoot 'src\client\ImagegenToolView.tsx'
if (Test-Path -LiteralPath $sourceView) {
  $view = Read-Text $sourceView
  if (-not $view.Contains("text.includes('<image>image/')")) {
  $view = Replace-Once $view `
    '  resultText: string
} {' `
    '  resultText: string
  generated: boolean
} {' `
    'Imagegen result generated flag type'
  $view = Replace-Once $view `
    '    return { running: true, failed: false, writeFailed: false, resultText: '''' }' `
    '    return { running: true, failed: false, writeFailed: false, generated: false, resultText: '''' }' `
    'Imagegen running result generated flag'
  $view = Replace-Once $view `
    '  const path = text.match(/<output_path\s+operation="(?:create|update)">([^<]+)<\/output_path>/u)?.[1]
  return {
    running: false,
    failed: block.isError,
    ...image === undefined ? {} : { image },' `
    '  const path = text.match(/<output_path\s+operation="(?:create|update)">([^<]+)<\/output_path>/u)?.[1]
  const generated = !block.isError && /<image>\\s*image\\//u.test(text)
  if (!generated) image = undefined
  return {
    running: false,
    failed: block.isError,
    generated,
    ...image === undefined ? {} : { image },' `
    'Imagegen generated-result filter'
  $view = Replace-Once $view `
    '  if (result.image === undefined) return result.resultText' `
    '  if (!result.generated || result.image === undefined) return result.resultText' `
    'Imagegen output filter'
  $view = Replace-Once $view `
    '      {result.image === undefined ? null : (' `
    '      {!result.generated || result.image === undefined ? null : (' `
    'Imagegen preview filter'
    Write-Text $sourceView $view
  }
}

$compiledClient = Join-Path $PluginRoot 'lib\client.js'
if (Test-Path -LiteralPath $compiledClient) {
  $client = Read-Text $compiledClient
  if (-not $client.Contains('const generated = !block.isError')) {
    $tabs4 = [string]([char]9) * 4
    $runningOld = 'writeFailed: false,' + "`n" + $tabs4 + 'resultText: ""'
    $runningNew = 'generated: false,' + "`n" + $tabs4 + 'writeFailed: false,' + "`n" + $tabs4 + 'resultText: ""'
    $client = Replace-Once $client $runningOld $runningNew 'Bundled imagegen running result generated flag'
    $pathLine = 'const path = text.match(/<output_path\s+operation="(?:create|update)">([^<]+)<\/output_path>/u)?.[1];'
    $pathReplacement = $pathLine + "`n" + "`t`t`tconst generated = !block.isError && /<image>\\s*image\\//u.test(text);" + "`n" + "`t`t`tif (!generated) image = void 0;"
    $client = Replace-Once $client $pathLine $pathReplacement 'Bundled imagegen generated-result marker'
    $generatedField = 'failed: block.isError,' + "`n" + "`t`t`t`tgenerated,"
    $client = Replace-Once $client `
      'failed: block.isError,' `
      $generatedField `
      'Bundled imagegen generated-result field'
    $client = Replace-Once $client `
      'if (result.image === void 0) return result.resultText;' `
      'if (!result.generated || result.image === void 0) return result.resultText;' `
      'Bundled imagegen output filter'
    $client = Replace-Once $client `
      'result.image === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {' `
      '!result.generated || result.image === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {' `
      'Bundled imagegen preview filter'
    Write-Text $compiledClient $client
  }
}

# Normalize an earlier development build that escaped the marker twice. The
# replacement is assembled from character codes so this script remains safe
# under both PowerShell 5.1 and PowerShell 7 parsing rules.
$doubleSlash = [string]([char]92) * 2
$wrongSourceMarker = '/<image>' + $doubleSlash + 's*image' + $doubleSlash + '//u.test(text)'
$rightSourceMarker = "text.includes('<image>image/')"
if (Test-Path -LiteralPath $sourceView) {
  $view = Read-Text $sourceView
  if ($view.Contains($wrongSourceMarker)) {
    $view = $view.Replace($wrongSourceMarker, $rightSourceMarker)
    Write-Text $sourceView $view
  }
}
if (Test-Path -LiteralPath $compiledClient) {
  $client = Read-Text $compiledClient
  $wrongCompiledMarker = '/<image>' + $doubleSlash + 's*image' + $doubleSlash + '//u.test(text)'
  if ($client.Contains($wrongCompiledMarker)) {
    $client = $client.Replace($wrongCompiledMarker, "text.includes('<image>image/')")
    Write-Text $compiledClient $client
  }
}

Write-Output "已修复 dsh-codex 图片请求策略和生成图片显示：$PluginRoot"
