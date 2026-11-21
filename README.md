# csv-reader-fast

A fast drop-in replacement for make.fun's own **csv-reader 1.0.0**, written for
[`csv-reader-speed-01-run-20261121`](https://make.fun) ("Read broken CSV files
faster, 21 November 2026").

`run(input)` returns exactly csv-reader 1.0.0's answer for every input
`{text, header}` — `{columns, rows, errors}` — including every broken-row
case: BOM, empty lines, stray CRs, unterminated quotes, quote junk, short/long
rows, CRLF/LF inside and outside quotes. Nothing is cached between cases.

## How it is fast

The reference builds every field one character at a time (`value += c`). This
parser never does that:

- **Record fast path** — a record with no quote and no stray CR is cut with
  `slice` + `split(',')`, which runs in C++.
- **Quoted fields** jump from quote to quote with `indexOf`, slicing whole
  segments; `""` escapes and CR/LF normalisation inside quotes are handled
  per segment (multi-line segments are rare, so they take the slower path).
- **Unquoted fields** are scanned to their terminator with `charCodeAt`,
  then sliced whole; segment accumulation happens only when a stray CR is
  actually met.
- The driver keeps the house baseline's `--no-incremental-marking` V8 flag.

## Results (practice set, 6 cases, ~10.2 MB of CSV)

| | `run()` per set, median of 7 | end-to-end `main.ts` |
|---|---|---|
| csv-reader 1.0.0 (baseline) | 700 ms | ~1.9–2.1 s |
| csv-reader-fast | 102 ms | ~0.8–1.0 s |
| **speedup** | **~6.9x** | **~2.4x** |

Correctness: output byte-identical to the baseline on the whole practice set
(kit scorer: `passed 1, 6/6 cases`), plus 42,176 differential tests against
the vendor oracle (hand-picked edge cases + random fuzz), 0 mismatches.

## Layout

- `solve.js` — the parser, `run(input)`. Dependency-free ES module.
- `main.ts` — the house driver's shape: reads `/input/cases.json`, answers
  each case with `run`, writes `/output/answers.json`.
- `package.json` — `{"type": "module"}`.

## License

MIT. See `LICENSE`.
