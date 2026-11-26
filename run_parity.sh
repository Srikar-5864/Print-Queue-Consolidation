#!/usr/bin/env bash
# Compiles tests.cpp, runs 50 seeded parity scenarios in C++ and Node JS, and reports any mismatch.
set -e
cd "$(dirname "$0")"
g++ -std=c++17 -O2 -Wall -Wextra src/tests.cpp -o pqc_tests
./pqc_tests --parity > /tmp/pqc_parity_cpp.txt
node tests/parity.js > /tmp/pqc_parity_js.txt
diff -u /tmp/pqc_parity_cpp.txt /tmp/pqc_parity_js.txt
echo "PARITY OK: all 50 scenarios match identically between C++ and JS."
