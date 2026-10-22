// Dumps IronCalc's engine-provided UI data so the toolbar panels need no WASM.
use ironcalc_base::{builtin_styles::builtin_named_styles, themes::builtin_themes};
fn main() {
    let styles: Vec<_> = builtin_named_styles()
        .into_iter()
        .map(|(name, style, includes)| {
            serde_json::json!({ "name": name, "style": style, "includes": includes })
        })
        .collect();
    let out = serde_json::json!({
        "themes": builtin_themes(),
        "builtinStyles": styles,
        "locales": ironcalc_base::get_supported_locales(),
    });
    println!("{}", serde_json::to_string(&out).unwrap());
}
