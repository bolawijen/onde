// Compile-time template folding plus a single-character string index.
const who = "onde";
const msg = `hello ${who} from arena\n`;
const c = msg[0];

if (c == 104) console.log(msg);
