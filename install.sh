#!/bin/bash
# Digital Media Vault — macOS/Linux Installer
set -e

cd "$(dirname "$0")"

echo ""
echo "  ============================================="
echo "    Digital Media Vault (DMV) — One-Click Installer"
echo "  ============================================="
echo ""
echo "  This installer handles everything for you."
echo "  Just sit back — it will install all dependencies"
echo "  automatically if they are not already present."
echo ""

# ─── [1/6] Homebrew (macOS only) ───
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  [1/6] Checking Homebrew..."
    if command -v brew &>/dev/null; then
        echo "         Homebrew found."
    else
        echo "         Homebrew not found. Installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for this session (Apple Silicon default location)
        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        fi
    fi
else
    echo "  [1/6] Linux detected — using apt package manager."
fi

# ─── [2/6] Node.js ───
echo "  [2/6] Checking Node.js..."
if command -v node &>/dev/null; then
    echo "         Found Node.js $(node --version)"
else
    echo "         Node.js not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install node
    else
        sudo apt update && sudo apt install -y nodejs npm
    fi
    echo "         Installed Node.js $(node --version)"
fi

# ─── [3/6] Git ───
echo "  [3/6] Checking Git..."
if command -v git &>/dev/null; then
    echo "         Found $(git --version)"
else
    echo "         Git not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install git
    else
        sudo apt install -y git
    fi
    echo "         Installed $(git --version)"
fi

# ─── [4/6] FFmpeg ───
echo "  [4/6] Checking FFmpeg..."
if command -v ffmpeg &>/dev/null; then
    echo "         FFmpeg already installed."
else
    echo "         FFmpeg not found. Installing..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install ffmpeg
    else
        sudo apt install -y ffmpeg
    fi
    echo "         FFmpeg installed."
fi

# ─── [5/6] npm packages ───
echo "  [5/6] Installing npm packages..."
npm install --no-audit --no-fund
echo "         Done."

# ─── [6/6] Check RV / OpenRV ───
echo "  [6/6] Checking RV / OpenRV..."
RV_FOUND=false
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Check bundled macOS RV.app
    if [ -f "tools/rv/RV.app/Contents/MacOS/RV" ]; then
        RV_FOUND=true
    elif ls /Applications/RV*.app &>/dev/null 2>&1; then
        RV_FOUND=true
    elif [ -f /usr/local/bin/rv ]; then
        RV_FOUND=true
    fi
else
    if [ -f "tools/rv/bin/rv" ] || command -v rv &>/dev/null; then
        RV_FOUND=true
    fi
fi

if [ "$RV_FOUND" = true ]; then
    echo "         RV / OpenRV found."
else
    echo ""
    echo "         RV / OpenRV not found (optional but recommended)."
    echo "         RV provides professional A/B wipe comparison and EXR/HDR playback."
    echo ""

    if [[ "$OSTYPE" == "darwin"* ]]; then
        MAC_ARCH=$(uname -m)
        if [ "$MAC_ARCH" = "arm64" ]; then
            read -p "         Download and install OpenRV for macOS? (~642 MB) (y/N): " INSTALL_RV
            if [[ "$INSTALL_RV" =~ ^[Yy]$ ]]; then
                mkdir -p tools
                RV_URL="https://github.com/gregtee2/Digital-Media-Vault/releases/download/rv-3.1.0/OpenRV-3.1.0-macos-arm64-mediavault.zip"
                echo "         Downloading OpenRV 3.1.0 for macOS (Apple Silicon)..."
                curl -L -o tools/rv.zip "$RV_URL" --progress-bar --connect-timeout 15 || true

                if [ -f tools/rv.zip ] && [ -s tools/rv.zip ]; then
                    echo "         Extracting..."
                    rm -rf tools/rv 2>/dev/null
                    mkdir -p tools/rv
                    ditto -x -k tools/rv.zip tools/rv/
                    rm -f tools/rv.zip
                    # Remove quarantine so macOS doesn't block it
                    xattr -cr tools/rv/RV.app 2>/dev/null
                    if [ -f "tools/rv/RV.app/Contents/MacOS/RV" ]; then
                        echo "         ✅ OpenRV installed to tools/rv/"
                    else
                        echo "         ⚠️  Extraction may have failed."
                        echo "         You can set a custom RV path in DMV Settings after launch."
                    fi
                else
                    echo "         ⚠️  Download failed."
                    echo "         You can set a custom RV path in DMV Settings after launch."
                    rm -f tools/rv.zip 2>/dev/null
                fi
            else
                echo "         Skipping. You can install RV later from DMV Settings."
            fi
        else
            echo "         NOTE: Pre-built OpenRV is available for Apple Silicon (arm64) only."
            echo "         For Intel Macs, build OpenRV from source:"
            echo "           https://github.com/AcademySoftwareFoundation/OpenRV"
            echo "         See also: docs/BUILD_OPENRV_MACOS.md"
            echo "         Then set the RV path in DMV Settings after launch."
        fi
    else
        echo "         For Linux, build OpenRV from source:"
        echo "           https://github.com/AcademySoftwareFoundation/OpenRV"
        echo "         Or download a pre-built release from:"
        echo "           https://github.com/AcademySoftwareFoundation/OpenRV/releases"
        echo "         Then set the RV path in DMV Settings after launch."
    fi
    echo ""
fi

# Create directories
mkdir -p data thumbnails

echo ""
echo "  ============================================="
echo "    ✅ Installation Complete!"
echo "  ============================================="
echo ""
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  To start DMV:"
    echo "    Double-click start.command"
    echo "    — or —"
    echo "    ./start.sh"
else
    echo "  To start DMV, run:  ./start.sh"
fi
echo ""
echo "  Then open:  http://localhost:7700"
echo ""
