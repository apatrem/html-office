# Typed IronCalc build

Upstream: IronCalc v0.9.0, commit `297553dc3a37ec6b0f4821055220e3d26c4ac6a1` (MIT OR Apache-2.0). `typed-binding.rs` replaces the broad upstream UI binding with the narrow API needed by this prototype, including a WASM `getCellValue(sheet,row,column)` method returning `[kind,value]` through the existing public raw getter plus the error type. No formatted numeric strings are parsed and no calculation semantics are intentionally changed. Dates remain numeric serials at the engine boundary.

Developer prerequisites: Rust 1.95.0 with `wasm32-unknown-unknown`, wasm-bindgen-cli 0.2.126, Python 3, Git and the repository's locked npm dependencies (`npm ci`; `npm ci --prefix packages/data`). These are authoring/build tools, never installations triggered by a generated document.

`bash packages/data/engine/rebuild.sh <temporary-source-directory>` checks out the pinned upstream commit, applies the dependency patch and copies the narrow binding, builds with the committed Cargo lock, runs the pinned JS bundler and Binaryen optimiser, and regenerates the dependency audit/notices. Review binary hashes after rebuilding; an executable change requires a new manifest/version and regenerated workbooks. The custom binary is distributed with this repository, not represented as the upstream npm artifact.

The target-specific audit records the normal/build Cargo packages, including host proc macros conservatively. The `xlsx` feature and Python/Node bindings are excluded. All declared licences in this closure are permissive. Complete retained licence/notice texts are embedded in both HTML modes and live in `THIRD-PARTY-NOTICES.txt`. Rust 1.95.0 standard-library notices are retained conservatively for all targets, with identical full texts deduplicated. The compiler/optimiser themselves are development tools; runtime standard-library/compiler builtins notices are included.

`bitcode_derive` 0.6.9 omits its licence text from the published crate. Its `.cargo_vcs_info.json` identifies upstream commit `f41da053c08178189aaee8c62f4c6e738add6eda`; `license-sources/bitcode_derive-LICENSE-MIT` is retained from that exact revision at https://raw.githubusercontent.com/SoftbearStudios/bitcode/f41da053c08178189aaee8c62f4c6e738add6eda/LICENSE-MIT . The audit rejects missing texts or an unreviewed licence expression.

The surrounding Office code remains MIT. Third-party components retain their own terms. Audit scope is this exact build/feature/target closure; a dependency, toolchain or feature change requires a new audit.
