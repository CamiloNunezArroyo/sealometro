# Hecho con asistencia de IA (Claude) — Seal Hackathon Team, NASA Space Apps Sucre 2026
# Pide el token de NASA Earthdata SIN mostrarlo, descarga los minerales de EMIT para el top 5 y actualiza el ranking.
# El token solo vive en esta ventana mientras corre el script; no se guarda en ningún archivo.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$py = ".\.venv\Scripts\python.exe"

$s = Read-Host "Pega tu token de Earthdata y presiona Enter (no se va a ver)" -AsSecureString
$env:EARTHDATA_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
if (-not $env:EARTHDATA_TOKEN) { Write-Host "No se pegó ningún token."; exit 1 }

try {
    & $py -m seal emit
    if ($LASTEXITCODE -ne 0) { Write-Host "EMIT falló (ver el mensaje de arriba)."; exit $LASTEXITCODE }
} finally {
    Remove-Item Env:EARTHDATA_TOKEN -ErrorAction SilentlyContinue
}

Write-Host "`nActualizando el ranking con los minerales..."
& $py -m seal fetch --no-earth
& $py -m seal score | Select-Object -First 1
& $py -m seal validate | Select-Object -Last 1
& $py -m seal export | Select-Object -First 2
Write-Host "`nLISTO. Ya puedes cerrar esta ventana o avisarle a Claude."
