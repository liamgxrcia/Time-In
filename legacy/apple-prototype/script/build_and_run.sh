#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")/.."
platform="${1:-macOS}"
if [[ "$platform" == "macOS" ]]; then
  xcodebuild -project TimeIn.xcodeproj -scheme TimeIn -configuration Debug -destination 'platform=macOS' -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
  open DerivedData/Build/Products/Debug/TimeIn.app --args "${@:2}"
else
  xcodebuild -project TimeIn.xcodeproj -scheme TimeIn -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath DerivedData-iOS CODE_SIGNING_ALLOWED=NO build
fi
