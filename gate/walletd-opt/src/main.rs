// Applies the exact optimisation tari_walletd v0.55.0 runs before publishing a template.
// Source: tari-ootle@b7c964c applications/tari_walletd/src/services/wasm_optimizer.rs
use wasm_opt::{Feature, OptimizationOptions, Pass};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: walletd-opt <in.wasm> <out.wasm>");
        std::process::exit(2);
    }
    OptimizationOptions::new_optimize_for_size()
        .enable_feature(Feature::BulkMemory)
        .enable_feature(Feature::ReferenceTypes)
        .disable_feature(Feature::Simd)
        .disable_feature(Feature::RelaxedSimd)
        .add_pass(Pass::StripDebug)
        .add_pass(Pass::StripProducers)
        .add_pass(Pass::StripTargetFeatuers)
        .run(&args[1], &args[2])
        .expect("optimization failed");
}
