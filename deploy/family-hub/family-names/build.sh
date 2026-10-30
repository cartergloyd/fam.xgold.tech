#!/usr/bin/env bash
# Builds FamilyNames.jar with Maven inside Docker, so no JDK is needed on the host.
# Usage: ./build.sh            -> target/FamilyNames.jar
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm \
  -v "$PWD:/work" -w /work \
  -v "${FAMILY_NAMES_M2:-$HOME/.m2-family-names}:/root/.m2" \
  maven:3.9-eclipse-temurin-21 mvn -q -B -DskipTests package
ls -l target/FamilyNames.jar
