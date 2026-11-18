// C baseline for loop.ts — same hot loop, same guard.
#include <stdio.h>

int main(void) {
  long acc = 0;
  for (long i = 0; i < 1000000; i++) {
    acc += i % 1000;
  }
  if (acc == 499500000) printf("loop: ok (499500000)\n");
  return 0;
}
