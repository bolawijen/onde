// mmap-backed typed array: byte writes and reads straight through memory operands.
const buf = new Uint8Array(256);
let sum = 0;

for (let i = 0; i < 256; i++) buf[i] = i;
for (let i = 0; i < 256; i++) {
  const v = buf[i];
  sum = sum + v;
}

if (sum == 32640) console.log("buffer: ok (32640)");
