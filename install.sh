#!/bin/bash
# Digital Media Vault — macOS/Linux Installer
set -e

cd "$(dirname "$0")"

echo ""
echo "  ============================================="
echo "    Digital Media Vault (DMV) — Installer"
echo "  ============================================="
echo ""

# ─── [1/5] Homebrew (macOS only) ───
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "  [1/5] Checking Homebrew..."
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
    echo "  [1/5] Linux detected — using apt package manager."
fi

# ─── [2/5] Node.js ───
echo "  [2/5] Checking Node.js..."
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

# ─── [3/5] FFmpeg ───
echo "  [3/5] Checking FFmpeg..."
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

# ─── [4/5] npm packages ───
echo "  [4/5] Installing npm packages..."
npm install --no-audit --no-fund
echo "         Done."

# ─── [5/5] mrViewer2 ───
echo "  [5/5] Checking mrViewer2..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    if ls /Applications/mrv2*.app &>/dev/null 2>&1; then
        echo "         mrViewer2 found in /Applications."
    else
        echo ""
        echo "         mrViewer2 is optional but recommended for pro video playback"
        echo "         (EXR, ProRes, HDR, DPX, etc.)"
        echo ""
        echo "         Download from: https://mrv2.sourceforge.io/"
        echo "         Install: drag mrv2.app to /Applications/"
        echo ""
    fi
else
    # Linux — check if mrv2 exists
    if command -v mrv2 &>/dev/null; then
        echo "         mrViewer2 found."
    else
        echo ""
        echo "         mrViewer2 is optional but recommended for pro video playback."
        echo "         Download from: https://mrv2.sourceforge.io/"
        echo ""
    fi
fi

# Create directories
mkdir -p data thumbnails

echo ""
echo "  ============================================="
echo "    Installation Complete!"
echo "  ============================================="
echo ""
echo "  To start DMV, run:  ./start.sh"
echo "  Then open:  http://localhost:7700"
echo ""
