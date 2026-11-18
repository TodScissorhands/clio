#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "Usage: bash scripts/provision-foliate-real-books.sh DESTINATION" >&2
  exit 1
fi

manifest="$(dirname -- "${BASH_SOURCE[0]}")/../tests/fixtures/foliate-real-books.manifest"
mkdir -p -- "$1"
destination=$(cd -- "$1" && pwd)
staging=$(mktemp -d "$destination/.download.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT

while read -r checksum filename url; do
  [[ -z "$checksum" || "$checksum" == \#* ]] && continue
  if [[ -e "$destination/$filename" ]]; then
    # Never overwrite a mismatched existing corpus or trust an unverified cache.
    (cd -- "$destination" && printf '%s  %s\n' "$checksum" "$filename" | sha256sum --check --strict)
    continue
  fi
  curl --fail --location --silent --show-error \
    --proto '=https' --proto-redir '=https' \
    --retry 2 --connect-timeout 30 --max-time 180 \
    "$url" --output "$staging/$filename"
  (cd -- "$staging" && printf '%s  %s\n' "$checksum" "$filename" | sha256sum --check --strict)
  mv -- "$staging/$filename" "$destination/$filename"
done < "$manifest"
