# Native callback scripts

The native app evaluates editable callbacks as plain values. `acorn.js` is the
unmodified browser distribution of Acorn 8.17.0 from the npm package `acorn`.
Its MIT license is in `ACORN-LICENSE.txt`; the parser's API is documented at
https://github.com/acornjs/acorn/tree/master/acorn.

`engine.js` interprets the parsed syntax tree. User input is never executed by
JavaScriptCore's `Function` or `eval`. The bridge API is
`PlayerLabScriptEngine.validate(body)` and
`PlayerLabScriptEngine.create(sources).call(id, input)`. Each created engine owns
its own `storage`; successful evaluations share that storage. An interpreter
error discards its changes to storage. After evaluation, the native adapter
checks the SDK return type. A type mismatch uses the documented fallback while
retaining storage changes from the completed evaluation.

Supported scripts use named `let` and `const` variables, expressions, branches, functions, finite
loops, plain objects, arrays and the explicitly listed string, array, numeric
and JSON operations. Regular expressions, async code, classes, imports, host
objects, `var` declarations and prototype access are unavailable. Unsupported syntax is rejected
before application. An unavailable operation fails at execution.
JSON parsing and serialization accept one argument. Revivers, replacers and
pretty-printing options are rejected rather than silently ignored.

Each call has limits on interpreted instructions, call depth, elapsed time,
plain-value sizes and cumulative value allocations. Retained storage has a
separate size limit. Quota failures bypass user `catch` and `finally` blocks.
With the trusted native thread clock, calls are limited to 25 milliseconds of
CPU work and a secondary 2-second elapsed guard. Time spent waiting for the
thread to run is not CPU work. Without that clock, the elapsed guard is 250
milliseconds. The instruction limit is 50,000 in both cases. A clock that fails
after a call starts causes the call to fail rather than dropping CPU protection.
These are limits on the interpreter's value operations, not an isolated heap or
a separate operating-system process. Large request/response snapshots can
still allocate memory in the SDK and native bridge before reaching this engine.

Run the engine's regression and adversarial tests with:

```sh
node --test apps/ios/scripts/test-native-script-engine.cjs
```
