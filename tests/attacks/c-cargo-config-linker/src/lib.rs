// ATTACK FIXTURE C: the real code is trivial; the attack is the cargo config linker.
#[no_mangle]
pub extern "C" fn answer() -> u32 {
    42
}
