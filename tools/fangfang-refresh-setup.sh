#!/bin/bash
# 方方: automatic weekly reinstall on iPhone/iPad (free Apple ID, over Wi-Fi)
# Run once on the Mac:   bash tools/fangfang-refresh-setup.sh
set -e

LABEL="com.unoki99.fangfang-refresh"
BIN="$HOME/bin/fangfang-refresh.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/bin" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# ---- find the Xcode project ----
PROJECT=$(find "$HOME/Fangfang-Xcode" "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" -maxdepth 4 -name "*.xcodeproj" \( -iname "*fangfang*" -o -name "*方方*" \) -not -path "*/.Trash/*" 2>/dev/null | head -1)
if [ -z "$PROJECT" ]; then
  read -r -p "Drag the 方方 .xcodeproj file here and press Enter: " PROJECT
  PROJECT=$(eval echo "$PROJECT")
fi
echo "Project: $PROJECT"

# ---- the refresh script ----
cat > "$BIN" <<EOF
#!/bin/bash
# Rebuilds 方方 for iOS and installs it on every paired iPhone/iPad it can reach.
PROJECT="$PROJECT"
SCHEME="$(basename "$PROJECT" .xcodeproj) (iOS)"
LABEL="$LABEL"
EOF
cat >> "$BIN" <<'EOF'
DD="$HOME/Library/Developer/fangfang-build"
LOG="$HOME/Library/Logs/fangfang-refresh.log"
STAMP="$HOME/.fangfang-last-refresh"
FORCE_FLAG="$HOME/.fangfang-force"
STATUS="$HOME/.fangfang-status"
MAX_AGE_DAYS=5
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin"

# From SSH (e.g. an iPhone Shortcut): hand the job to the logged-in session, which
# can use the signing keychain, then wait for the result and print it.
if [ "$1" = "--remote" ]; then
  touch "$FORCE_FLAG"; rm -f "$STATUS"
  launchctl kickstart "gui/$(id -u)/$LABEL" || { echo "Could not start the job — is the Mac logged in?"; exit 1; }
  for i in $(seq 1 180); do [ -f "$STATUS" ] && { cat "$STATUS"; exit 0; }; sleep 2; done
  echo "Still running — check $LOG"; exit 0
fi

note() { osascript -e "display notification \"$1\" with title \"方方\"" >/dev/null 2>&1; }
finish() { echo "$1" | tee -a "$LOG" > "$STATUS"; note "$1"; exit 0; }
exec >>"$LOG" 2>&1
echo "=== $(date) ==="

FORCE=0; [ "$1" = "--force" ] && FORCE=1; [ -f "$FORCE_FLAG" ] && { FORCE=1; rm -f "$FORCE_FLAG"; }
if [ $FORCE = 0 ] && [ -f "$STAMP" ] && [ -n "$(find "$STAMP" -mtime -$MAX_AGE_DAYS)" ]; then
  echo "Installed less than $MAX_AGE_DAYS days ago, nothing to do."; exit 0
fi

# 1. build (fresh 7-day signature)
if ! xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug \
     -destination "generic/platform=iOS" -derivedDataPath "$DD" \
     -allowProvisioningUpdates clean build -quiet; then
  finish "方方：建置失敗，請看 $LOG"
fi
APP=$(ls -d "$DD"/Build/Products/Debug-iphoneos/*.app | head -1)

# 2. install on every paired iPhone/iPad that is reachable
JSON=$(mktemp)
xcrun devicectl list devices --json-output "$JSON" >/dev/null 2>&1
IDS=$(python3 - "$JSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for dev in d.get("result", {}).get("devices", []):
    hw = dev.get("hardwareProperties", {}); cp = dev.get("connectionProperties", {})
    if hw.get("platform") == "iOS" and cp.get("pairingState") == "paired" and cp.get("tunnelState") != "unavailable":
        print(dev["identifier"] + "\t" + dev.get("deviceProperties", {}).get("name", "?"))
PY
)
rm -f "$JSON"
[ -z "$IDS" ] && finish "方方：找不到 iPhone／iPad（同一個 Wi-Fi？已解鎖？）"

OK=""; BAD=""
while IFS=$'\t' read -r ID NAME; do
  if xcrun devicectl device install app --device "$ID" "$APP"; then OK="$OK $NAME"; else BAD="$BAD $NAME"; fi
done <<< "$IDS"

[ -n "$OK" ] && touch "$STAMP"
if [ -n "$BAD" ]; then finish "方方：已安裝到$OK；失敗：$BAD"; fi
finish "方方：已重新安裝到$OK（7 天有效）"
EOF
chmod +x "$BIN"

# ---- run every day at 12:00 (and after waking if the Mac was asleep); it only
#      reinstalls when the last install is 5+ days old ----
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$BIN</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo
echo "Done. Test it now with:   ~/bin/fangfang-refresh.sh --remote"
