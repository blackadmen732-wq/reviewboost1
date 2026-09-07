#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "Installing frontend dependencies..."
cd frontend
npm install

echo "Install complete."
