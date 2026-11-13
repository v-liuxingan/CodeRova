// Run with: cargo run --example recursion
// Each call reduces remaining; zero returns without another recursive call.
fn main() {
    direct(2);
    first(3);
}

fn direct(remaining: u32) {
    if remaining == 0 {
        return;
    }
    direct(remaining - 1);
    direct(remaining - 1);
}

fn first(remaining: u32) {
    if remaining == 0 {
        return;
    }
    second(remaining - 1);
}

fn second(remaining: u32) {
    if remaining == 0 {
        return;
    }
    first(remaining - 1);
}
