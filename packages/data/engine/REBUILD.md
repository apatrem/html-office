# Typed IronCalc build

Upstream: IronCalc v0.9.0, commit `297553dc3a37ec6b0f4821055220e3d26c4ac6a1` (MIT OR Apache-2.0). `typed-binding.rs` replaces the broad upstream UI binding with the narrow API needed by this prototype, including a WASM `getCellValue(sheet,row,column)` method returning `[kind,value]` through the existing public raw getter plus the error type. No formatted numeric strings are parsed. The original typed.1 artifact intentionally retained upstream calculation semantics. The html-office.2 candidate also applies the explicit formula compatibility patch described below. Dates remain numeric serials at the engine boundary.

Developer prerequisites: Rust 1.95.0 with `wasm32-unknown-unknown`, wasm-bindgen-cli 0.2.126, Python 3, Git and the repository's locked npm dependencies (`npm ci`; `npm ci --prefix packages/data`). These are authoring/build tools, never installations triggered by a generated document.

`bash packages/data/engine/rebuild.sh <temporary-source-directory>` checks out the pinned upstream commit, applies the dependency/formula-compatibility patches and copies the narrow binding, builds with the committed Cargo lock, runs the pinned JS bundler and Binaryen optimiser, and regenerates the dependency audit/notices. Review binary hashes after rebuilding; an executable change requires a new manifest/version and regenerated workbooks. The custom binary is distributed with this repository, not represented as the upstream npm artifact.

The target-specific audit records the normal/build Cargo packages, including host proc macros conservatively. The `xlsx` feature and Python/Node bindings are excluded. All declared licences in this closure are permissive. Complete retained licence/notice texts are embedded in both HTML modes and live in `THIRD-PARTY-NOTICES.txt`. Rust 1.95.0 standard-library notices are retained conservatively for all targets, with identical full texts deduplicated. The compiler/optimiser themselves are development tools; runtime standard-library/compiler builtins notices are included.

`bitcode_derive` 0.6.9 omits its licence text from the published crate. Its `.cargo_vcs_info.json` identifies upstream commit `f41da053c08178189aaee8c62f4c6e738add6eda`; `license-sources/bitcode_derive-LICENSE-MIT` is retained from that exact revision at https://raw.githubusercontent.com/SoftbearStudios/bitcode/f41da053c08178189aaee8c62f4c6e738add6eda/LICENSE-MIT . The audit rejects missing texts or an unreviewed licence expression.

The surrounding Office code remains MIT. Third-party components retain their own terms. Audit scope is this exact build/feature/target closure; a dependency, toolchain or feature change requires a new audit.

## Rebuild verification and transport

Rebuild output goes into the temporary checkout's `office-artifacts/`, leaving approved artifacts untouched. Pass `--check` as the second argument to compare JavaScript, raw WASM and notices against the repository. Source/cache paths are remapped before compilation. On 19 October 2026, two independent checkout paths produced identical JavaScript, optimised WASM and notices. The raw WASM SHA-256 is recorded in `manifest.json` and verified in tests.

`tools/pack-engine.mjs` creates a deterministic gzip transport with Node's level-9 zlib. The manifest pins compressed and decoded hashes separately. Transport compression bytes can depend on the Node/zlib version; a new compressed representation requires its own recorded digest even when the decoded engine is identical. `record-engine.mjs` must run after committing the artifact files so URLs refer to an immutable revision that actually contains them.

The current custom build is 2,172,743 decoded WASM bytes and 707,874 gzip bytes, plus a 7,381-byte JavaScript wrapper. A fresh real HTTPS/file:// smoke confirmed the compressed asset was requested only on the first edit and passed both checks. These are measurements of this prototype, separate from the earlier upstream npm/Brotli measurement. See `bench/cdn-results.json` for the response sizes and environment.

## Formula compatibility build (T12)

`formula-compatibility.patch` remains on the same pinned upstream source and fixes range-shape checking in plural criteria functions, typed criteria-error propagation, single-criterion sum/average alignment (including a single-cell reference), and AND/OR evaluation of later errors. This is a distinct custom IronCalc version, `ironcalc/0.9.0+html-office.2`, with no secondary evaluator or new dependency. The committed 87-case aggregation/logic fixture stores independent hand-derived expected values with reference provenance; it is not an exhaustive Excel conformance claim. See [ADR-006](../../../docs/decisions/006-formula-compatibility-patches.md).

On 20 October 2026 two fresh checkouts at different paths produced identical JavaScript, raw/gzip WASM and notices. The candidate has 2,175,716 raw WASM bytes, 709,847 gzip bytes and the unchanged 7,381-byte JS wrapper. The audit still contains 38 target packages, 47 notice texts and 197,451 notice bytes, with byte-identical notices. The patched native upstream suite passed 2,765 tests with eight existing upstream ignores; the added regression covers the changed semantics. Browser distribution, full-suite, performance and independent review evidence must pass before merging its pin.
