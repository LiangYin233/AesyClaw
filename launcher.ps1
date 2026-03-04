$ErrorActionPreference = "SilentlyContinue"

Write-Host "Killing old processes on ports 18791, 18792, 5173..."

$ports = @(18791, 18792, 5173)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port 2>$null
    if ($connections) {
        foreach ($conn in $connections) {
            if ($conn.OwningProcess) {
                Write-Host "Killing PID $($conn.OwningProcess) on port $port"
                Stop-Process -Id $conn.OwningProcess -Force
            }
        }
    }
}

Start-Sleep -Seconds 1

Write-Host "Starting AesyClaw Gateway..."
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "cd 'G:\AesyClaw'; npm run gateway"

Start-Sleep -Seconds 2

Write-Host "Starting AesyClaw WebUI..."
Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", "cd 'G:\AesyClaw\webui'; npm run dev"

Write-Host "Done!"
