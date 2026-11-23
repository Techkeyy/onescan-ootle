// OneScan: instantiate the SourceRegistry component (no owner, anyone may attest).
// Manifest page variable: account = your component_... (pays the fee)
use template_5b0efecc709ce6885b69738ce8f774f086ef0c6cb7b2a58920f8bab3e38f8b13 as SourceRegistry;

fn fee_main() {
    let account = var!["account"];
    account.pay_fee(100000);
}

fn main() {
    SourceRegistry::new();
}
