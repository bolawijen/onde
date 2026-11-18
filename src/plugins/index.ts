// The bundled extension catalog. Importing a file runs its `plugin(...)`
// registration, which adds it to the registry by name. `onde.plugins` in
// package.json selects which of these are enabled; with no list, all are.
import "./console";
import "./process";
import "./fs";
import "./bun";
