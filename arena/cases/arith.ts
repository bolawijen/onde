// Hot integer loop mixing * % + - so every iteration runs a native idiv.
let acc = 0;
for (let i = 1; i < 10000; i++) {
  acc += i * 2 - i % 1000;
}

if (acc == 94995000) console.log("arith: ok (94995000)");
