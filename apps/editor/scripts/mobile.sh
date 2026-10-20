#!/bin/sh
# The tablet builds (phase 10): `npm run android -- dev`, `npm run ios -- build`, …
# Android's SDK and NDK are found where Android Studio puts them unless the
# environment already says otherwise — set here, for these commands only,
# never in the user's shell profile.
set -e
: "${ANDROID_HOME:=$HOME/Library/Android/sdk}"
if [ -z "$NDK_HOME" ] && [ -d "$ANDROID_HOME/ndk" ]; then
  NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
fi
# Gradle 8.14 (the generated wrapper) runs on Java 17–21; Android Studio's
# bundled runtime is Java 25, which it rejects ("class file major version
# 69"), so a JDK 21 (else 17) is picked unless JAVA_HOME is set.
if [ -z "$JAVA_HOME" ] && [ -x /usr/libexec/java_home ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || /usr/libexec/java_home -v 17 2>/dev/null || true)"
fi
[ -n "$JAVA_HOME" ] && export JAVA_HOME
export ANDROID_HOME NDK_HOME
exec npx tauri "$@"
