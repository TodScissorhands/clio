#!/usr/bin/env bash
set -euo pipefail

# The real-WebKit Bun tests skip when these prerequisites are absent. Treat an
# absent native runner as a failed verification rather than a green test run.
if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Real WebKitGTK verification requires Linux." >&2
  exit 1
fi
if [[ -z "${DISPLAY:-}" ]]; then
  echo "Real WebKitGTK verification requires an X11 DISPLAY (use xvfb-run in CI)." >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Real WebKitGTK verification requires python3." >&2
  exit 1
fi
if ! python3 -c 'import gi; gi.require_version("WebKit2", "4.1"); from gi.repository import WebKit2'; then
  echo "Install Python GObject and WebKitGTK 4.1 introspection bindings." >&2
  exit 1
fi
if ! command -v bun >/dev/null 2>&1; then
  echo "Real WebKitGTK verification requires Bun." >&2
  exit 1
fi

GDK_SCALE=1 GDK_DPI_SCALE=1 bun test
