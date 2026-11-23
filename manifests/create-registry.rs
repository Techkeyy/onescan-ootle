// OneScan: instantiate the SourceRegistry component (no owner, anyone may attest).
// Manifest page variable: account = your component_... (pays the fee)
use template_REPLACE_WITH_PUBLISHED_TEMPLATE_HEX as SourceRegistry;

fn fee_main() {
    let account = var!["account"];
    account.pay_fee(100000);
}

fn main() {
    SourceRegistry::new();
}
