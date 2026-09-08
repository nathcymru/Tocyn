#!/usr/bin/env bash
set -euo pipefail

readonly actionlint_version='1.7.12'
case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    archive="actionlint_${actionlint_version}_linux_amd64.tar.gz"
    archive_sha256='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'
    ;;
  Darwin:arm64)
    archive="actionlint_${actionlint_version}_darwin_arm64.tar.gz"
    archive_sha256='aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f'
    ;;
  *)
    echo "Workflow validation has no checksum-pinned actionlint binary for $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac
readonly archive archive_sha256
readonly release_url="https://github.com/rhysd/actionlint/releases/download/v${actionlint_version}/${archive}"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
archive_path="${workdir}/${archive}"

curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error --output "$archive_path" "$release_url"
if [[ "$(uname -s)" == 'Linux' ]]; then
  printf '%s  %s\n' "$archive_sha256" "$archive_path" | sha256sum --check --status
else
  printf '%s  %s\n' "$archive_sha256" "$archive_path" | shasum --algorithm 256 --check --status
fi
tar --extract --gzip --file "$archive_path" --directory "$workdir" actionlint
# Keep semantic validation consistent across runners; optional host-installed
# ShellCheck/Pyflakes are separate linters, not prerequisites for this gate.
"${workdir}/actionlint" -shellcheck= -pyflakes= .github/workflows/*.yml
