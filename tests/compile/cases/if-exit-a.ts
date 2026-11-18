// True branch exits with status 7 before reaching the trailing log.
const x = 1;
if (x === 1) process.exit(7);
console.log("alive");
