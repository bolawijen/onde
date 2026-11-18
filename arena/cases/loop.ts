// Hot integer loop: 1,000,000 iterations of add + modulo.
// The modulo keeps the accumulator inside a signed 32-bit immediate, so the
// final guard can use `cmp r64, imm32`.
let acc = 0;
for (let i = 0; i < 1000000; i++) {
  acc += i % 1000;
}

if (acc == 499500000) console.log("loop: ok (499500000)");
