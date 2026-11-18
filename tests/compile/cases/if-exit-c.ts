// True branch logs, then exits before reaching the trailing log.
const x = 1;
if (x === 1) { console.log("yes"); process.exit(3); }
console.log("no");
