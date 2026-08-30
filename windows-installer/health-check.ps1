$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'install.ps1') -CheckOnly -NoScheduledTask
