#!/usr/bin/env bash
# run-certora.sh — Run Certora Solana Prover locally
#
# cargo-certora-sbf bundles a frozen rustc 1.75.0-dev that cannot parse
# Cargo.lock v4 or compile crates with MSRV > 1.75. This script works
# around the issue by regenerating the lockfile with Rust 1.81 (which
# produces v3 format with compatible dependency versions) before running
# the prover, then restoring the original lockfile.
#
# Prerequisites:
#   - CERTORAKEY environment variable set (get from certoracloud.com)
#   - certora-cli installed: pip install certora-cli
#   - cargo-certora-sbf installed: cargo install cargo-certora-sbf
#   - Rust 1.81.0 installed: rustup toolchain install 1.81.0
#
# Usage:
#   ./scripts/run-certora.sh

set -euo pipefail

# Navigate to repo root (script may be called from any directory)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── Check prerequisites ──────────────────────────────────────────────

if [[ -z "${CERTORAKEY:-}" ]]; then
  echo "ERROR: CERTORAKEY environment variable is not set."
  echo "  Get your key from https://prover.certora.com and export it:"
  echo "  export CERTORAKEY=your_key_here"
  exit 1
fi

if ! command -v certoraSolanaProver &>/dev/null; then
  echo "ERROR: certora-cli not found. Install it with:"
  echo "  pip install certora-cli"
  exit 1
fi

if ! command -v cargo-certora-sbf &>/dev/null; then
  echo "ERROR: cargo-certora-sbf not found. Install it with:"
  echo "  cargo install cargo-certora-sbf"
  exit 1
fi

if ! rustup run 1.81.0 rustc --version &>/dev/null; then
  echo "ERROR: Rust 1.81.0 toolchain not found. Install it with:"
  echo "  rustup toolchain install 1.81.0"
  exit 1
fi

# ── Backup and regenerate lockfile ───────────────────────────────────

echo "Backing up Cargo.lock..."
cp Cargo.lock Cargo.lock.bak

# Restore original lockfile on exit (success or failure)
restore_lockfile() {
  echo "Restoring original Cargo.lock..."
  mv Cargo.lock.bak Cargo.lock
}
trap restore_lockfile EXIT

echo "Regenerating lockfile with Rust 1.81 (v3 format, compatible deps)..."
cargo +1.81.0 generate-lockfile

# ── Run the prover ───────────────────────────────────────────────────

echo "Running Certora Solana Prover..."
certoraSolanaProver certora/conf/agent_shield.conf

echo "Done. Certora report available in .certora_internal/"
