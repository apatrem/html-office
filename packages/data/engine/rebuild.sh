#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
engine_dir="$repo_root/packages/data/engine"
source_dir="${1:?Pass an empty temporary source directory}"
[[ ! -e "$source_dir" ]] || { echo 'Source directory must not exist' >&2; exit 1; }
rust_compiler="${RUSTC:-rustc}"
[[ "$("$rust_compiler" --version)" == 'rustc 1.95.0 '* ]] || { echo 'Rust 1.95.0 required' >&2; exit 1; }
[[ "$(wasm-bindgen --version)" == 'wasm-bindgen 0.2.126' ]] || { echo 'wasm-bindgen 0.2.126 required' >&2; exit 1; }
git clone --no-checkout https://github.com/ironcalc/IronCalc.git "$source_dir"
git -C "$source_dir" checkout 297553dc3a37ec6b0f4821055220e3d26c4ac6a1
git -C "$source_dir" apply "$engine_dir/binding-dependencies.patch"
cp "$engine_dir/typed-binding.rs" "$source_dir/bindings/wasm/src/lib.rs"
cp "$engine_dir/Cargo.lock" "$source_dir/Cargo.lock"
cd "$source_dir"
export RUSTFLAGS="--remap-path-prefix=$source_dir=/ironcalc --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}/registry=/cargo/registry"
cargo build --locked --release --target wasm32-unknown-unknown -p wasm
wasm-bindgen target/wasm32-unknown-unknown/release/wasm.wasm --target web --out-dir office-bindgen
cd "$repo_root"
artifact_dir="$source_dir/office-artifacts"
node packages/data/tools/bundle-engine.mjs "$source_dir/office-bindgen" "$artifact_dir/vendor"
packages/data/node_modules/.bin/wasm-opt "$artifact_dir/vendor/ironcalc.wasm" -Oz --enable-mutable-globals --enable-nontrapping-float-to-int --enable-sign-ext --enable-bulk-memory --enable-reference-types --enable-multivalue --strip-debug --strip-producers -o "$artifact_dir/vendor/ironcalc.wasm"
python3 "$engine_dir/audit.py" "$source_dir" "$("$rust_compiler" --print sysroot)" "$artifact_dir"
if [[ "${2:-}" == "--check" ]]; then
  cmp "$artifact_dir/vendor/ironcalc.mjs" "$engine_dir/vendor/ironcalc.mjs"
  cmp "$artifact_dir/vendor/ironcalc.wasm" "$engine_dir/vendor/ironcalc.wasm"
  cmp "$artifact_dir/THIRD-PARTY-NOTICES.txt" "$engine_dir/THIRD-PARTY-NOTICES.txt"
  echo "Rebuild matches committed executable bytes and notices"
else
  echo "Candidate artifacts are in $artifact_dir; verify before copying into engine/vendor"
fi
