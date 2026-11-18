// C baseline for fib.ts — same recursion, same guard.
#include <stdio.h>

long fib(long n) {
  if (n < 2) return n;
  long a = fib(n - 1);
  long b = fib(n - 2);
  return a + b;
}

int main(void) {
  long r = fib(30);
  if (r == 832040) printf("fib: ok (832040)\n");
  return 0;
}
