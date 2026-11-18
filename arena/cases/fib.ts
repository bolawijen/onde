// Recursion: stresses call/ret, argument marshalling and frame save/restore.
function fib(n) {
  if (n < 2) return n;
  const a = fib(n - 1);
  const b = fib(n - 2);
  return a + b;
}

const r = fib(30);
if (r == 832040) console.log("fib: ok (832040)");
