#!/usr/bin/env bash
# Compiles and runs the C++ test suite natively (needs g++).
set -e
cd "$(dirname "$0")/src"
g++ -std=c++17 -O2 -Wall -Wextra tests.cpp -o ../pqc_tests
../pqc_tests
