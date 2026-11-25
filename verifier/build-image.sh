#!/usr/bin/env bash
# Prepare the build container image BEFORE any untrusted code runs (this step has network).
# Base: ubuntu 24.04 (same distro and glibc as the GitHub ubuntu-24.04 runner) pinned by digest, plus the
# host tools build scripts and proc macros need (cc, libc headers, python3, git). The Rust toolchain is NOT
# in the image: the runner's rustup toolchain is mounted read-only at the same path, so rustc and every
# path it embeds are the same as for a build on the runner itself.
set -euo pipefail
BASE="ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852"  # ubuntu:noble-20261024.1
TAG="${ONESCAN_BUILD_IMAGE:-onescan-build:local}"
docker pull -q "$BASE"
docker rm -f onescan-prep >/dev/null 2>&1 || true
docker run --name onescan-prep "$BASE" bash -c \
  'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends gcc libc6-dev python3 git ca-certificates >/dev/null && rm -rf /var/lib/apt/lists/*'
docker commit onescan-prep "$TAG" >/dev/null
docker rm onescan-prep >/dev/null
echo "build image $TAG from $BASE:"
docker run --rm "$TAG" bash -c 'gcc --version | head -1; python3 --version; ldd --version | head -1; command -v sudo || echo "sudo: not installed"'
