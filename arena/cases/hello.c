// C baseline for hello.ts — a single write of a fixed message.
#include <unistd.h>

int main(void) {
  const char msg[] = "Hello from Arena!\n";
  write(1, msg, sizeof(msg) - 1);
  return 0;
}
