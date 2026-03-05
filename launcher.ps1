# AesyClaw Launcher - Modern PowerShell Script
# Enhanced with error handling, colored output, and process management

$ErrorActionPreference = "Stop"

# Colors
$colors = @{
    Reset = [Console]::ResetColor
    Red = [Console]::ForegroundColor = "Red"
    Green = [Console]::ForegroundColor = "Green"
    Yellow = [Console]::ForegroundColor = "Yellow"
    Cyan = [Console]::ForegroundColor = "Cyan"
    White = [Console]::ForegroundColor = "White"
}

# Configuration
$PROJECT_ROOT = "G:\AesyClaw"
$PORTS = @(18791, 18792, 5173)
$SERVICE_NAMES = @("Gateway", "API Server", "WebUI")

function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    $colors[$Color] 2>$null
    Write-Host $Message
    [Console]::ResetColor() 2>$null
}

function Get-ProcessByPort {
    param([int]$Port)

    try {
        $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($connections -and $connections.OwningProcess) {
            return $connections.OwningProcess | Select-Object -Unique
        }
    } catch {
        # Port not in use
    }
    return $null
}

function Stop-ServiceOnPort {
    param([int]$Port)

    $pids = Get-ProcessByPort -Port $Port
    if ($pids) {
        foreach ($pid in $pids) {
            try {
                $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($process) {
                    Write-ColorOutput "[KILL] Stopping PID $pid on port $Port" "Yellow"
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                }
            } catch {
                Write-ColorOutput "[WARN] Could not stop process $pid" "Yellow"
            }
        }
        return $true
    }
    return $false
}

function Start-AesyClawService {
    param(
        [string]$Name,
        [string]$Command,
        [string]$WorkingDirectory
    )

    Write-ColorOutput "[START] Starting $Name..." "Cyan"

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = "-NoExit -Command `"cd '$WorkingDirectory'; $Command`""
    $psi.UseShellExecute = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal

    [System.Diagnostics.Process]::Start($psi) | Out-Null
}

function Get-ServiceStatus {
    Write-ColorOutput "`n========== AesyClaw Services Status ==========" "White"

    $services = @(
        @{ Name = "Gateway"; Port = 18791 },
        @{ Name = "API Server"; Port = 18792 },
        @{ Name = "WebUI"; Port = 5173 }
    )

    foreach ($service in $services) {
        $pids = Get-ProcessByPort -Port $service.Port
        if ($pids) {
            Write-ColorOutput "  $($service.Name).PadRight(12) : $($service.Port)  " -NoNewline
            Write-ColorOutput "Running (PID: $($pids -join ','))" "Green"
        } else {
            Write-ColorOutput "  $($service.Name).PadRight(12) : $($service.Port)  " -NoNewline
            Write-ColorOutput "Stopped" "Red"
        }
    }

    Write-ColorOutput "===============================================`n" "White"
}

function Stop-AllServices {
    Write-ColorOutput "`n[STOP] Stopping all AesyClaw services..." "Yellow"

    $stopped = $false
    foreach ($port in $PORTS) {
        if (Stop-ServiceOnPort -Port $port) {
            $stopped = $true
        }
    }

    if ($stopped) {
        Start-Sleep -Seconds 1
        Write-ColorOutput "[OK] All services stopped" "Green"
    } else {
        Write-ColorOutput "[INFO] No services were running" "Cyan"
    }
}

function Start-AllServices {
    Write-ColorOutput "`n[AESYCLAW] AesyClaw Launcher" "Cyan"
    Write-ColorOutput "================================`n" "Cyan"

    # Stop existing services first
    Stop-AllServices
    Start-Sleep -Seconds 1

    # Start Gateway
    Write-ColorOutput "[START] Starting Gateway on port 18791..." "Cyan"
    Start-AesyClawService -Name "Gateway" -Command "npm run gateway" -WorkingDirectory $PROJECT_ROOT
    Start-Sleep -Seconds 2

    # Start API Server (using dev mode)
    Write-ColorOutput "[START] Starting API Server on port 18792..." "Cyan"
    Start-AesyClawService -Name "API Server" -Command "npm run dev" -WorkingDirectory $PROJECT_ROOT
    Start-Sleep -Seconds 2

    # Start WebUI
    Write-ColorOutput "[START] Starting WebUI on port 5173..." "Cyan"
    Start-AesyClawService -Name "WebUI" -Command "npm run dev" -WorkingDirectory "$PROJECT_ROOT\webui"

    Start-Sleep -Seconds 2

    Write-ColorOutput "`n[OK] All services started successfully!" "Green"
    Get-ServiceStatus
}

# Parse command line arguments
$command = $args[0]

switch ($command) {
    "stop" {
        Stop-AllServices
    }
    "status" {
        Get-ServiceStatus
    }
    "restart" {
        Stop-AllServices
        Start-Sleep -Seconds 1
        Start-AllServices
    }
    default {
        # Default: start all services
        Start-AllServices
    }
}
