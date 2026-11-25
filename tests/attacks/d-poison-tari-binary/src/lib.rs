// ATTACK FIXTURE D: the real code is trivial; the attack is in build.rs.
#[no_mangle]
pub extern "C" fn answer() -> u32 {
    42
}
