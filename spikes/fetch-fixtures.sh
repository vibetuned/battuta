#!/bin/sh
# Fetch the sample-encodings corpus files the e2e scripts and spikes open
# into fixtures/ (gitignored). Skips files already present. From the repo
# root:  sh spikes/fetch-fixtures.sh
set -e
cd "$(dirname "$0")/.."
BASE="https://raw.githubusercontent.com/music-encoding/sample-encodings/master/MEI_5.0/Music/Complete_examples"
for f in Bach-JS_Ein_feste_Burg Beethoven_StringQuartet_Op18_No1 Beethoven_Hymn_to_joy Bach-JS_BrandenburgConcert_No2_I_BWV1047; do
  if [ -s "fixtures/$f.mei" ]; then echo "have   fixtures/$f.mei"; continue; fi
  echo "fetch  fixtures/$f.mei"
  curl -sSf --max-time 300 -o "fixtures/$f.mei" "$BASE/$f.mei"
done
echo "fixtures ready: $(ls fixtures/*.mei | wc -l | tr -d ' ') scores"
