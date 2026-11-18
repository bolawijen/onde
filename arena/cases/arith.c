// C baseline for arith.ts — same hot loop, same guard.
#include <stdio.h>

int main(void) {
  long acc = 0;
  for (long i = 1; i < 10000; i++) {
    acc += i * 2 - i % 1000;
  }
  if (acc == 94995000) printf("arith: ok (94995000)\n");
  return 0;
}
