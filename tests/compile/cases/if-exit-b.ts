// False branch skips process.exit and reaches the trailing log.
const x = 0;
if (x === 1) process.exit(7);
console.log("alive");
