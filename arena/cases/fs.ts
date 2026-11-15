import { openSync, writeSync, closeSync } from "fs";

const fd = openSync("/tmp/onde-bench.txt", "w");
writeSync(fd, "hello from onde\n");
closeSync(fd);
