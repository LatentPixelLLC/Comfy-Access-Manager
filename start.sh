#!/bin/bash
# Digital Media Vault — macOS/Linux launcher
cd "$(dirname "$0")"
echo "Starting Digital Media Vault on http://localhost:7700"
node src/server.js
