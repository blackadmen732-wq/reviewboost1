#!/bin/bash
set -e

cd "$(dirname "$0")/.."

cd frontend
npm run dev
