// csv-reader-fast: a fast drop-in replacement for make.fun's csv-reader 1.0.0.
//
// Returns exactly csv-reader 1.0.0's answer for every input {text, header}:
// {columns, rows, errors}, following the same broken-row policy (a U+FEFF at
// the very start dropped; empty lines are no records; a CR outside quotes not
// followed by LF dropped with stray_cr; a field opening with a quote runs to
// the next undoubled quote, "" inside it one quote, each CRLF or lone CR
// inside it read as LF; what follows its closing quote up to the next comma
// or line break appended as it stands, quote_junk when the field ends; a quote
// that never closes is literal and the text after it re-read as unquoted,
// unterminated_quote; a quote inside an unquoted field is literal; fields
// stay strings; columns is the first record when header is true, else null;
// rows padded with "" (short_row) or cut (long_row) to the first record's
// width; each error {code, line, row} in the order met, line the 1-based line
// its record starts on, row its index in rows, null for the header).
//
// Speed comes from avoiding the reference's one-character-at-a-time string
// building: a record with no quote and no stray CR is cut with slice + split
// (C++); quoted fields jump from quote to quote with indexOf and slice whole
// segments; unquoted fields are scanned to their terminator then sliced whole,
// with segment accumulation only when a stray CR is actually met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** Scratch result of readUnquoted: { v: field value, e: how it ended, a: chars kept }. */
const UQ = { v: '', e: 0, a: 0 };

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `init` up to the next comma or line break.
  // A CR not followed by LF is dropped (stray_cr). Sets UQ.
  function readUnquoted(init) {
    let start = pos;
    let prefix = init;
    let added = 0;
    let i = pos;
    for (;;) {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i++;
      }
      if (i >= n) {
        UQ.v = prefix === '' ? text.slice(start, i) : prefix + text.slice(start, i);
        UQ.a = added + (i - start);
        pos = n;
        UQ.e = END;
        return;
      }
      const c = text.charCodeAt(i);
      if (c === 44) {
        UQ.v = prefix === '' ? text.slice(start, i) : prefix + text.slice(start, i);
        UQ.a = added + (i - start);
        pos = i + 1;
        UQ.e = COMMA;
        return;
      }
      if (c === 10) {
        UQ.v = prefix === '' ? text.slice(start, i) : prefix + text.slice(start, i);
        UQ.a = added + (i - start);
        pos = i + 1;
        line += 1;
        UQ.e = LINE_BREAK;
        return;
      }
      // c === 13
      if (text.charCodeAt(i + 1) === 10) {
        UQ.v = prefix === '' ? text.slice(start, i) : prefix + text.slice(start, i);
        UQ.a = added + (i - start);
        pos = i + 2;
        line += 1;
        UQ.e = LINE_BREAK;
        return;
      }
      // Lone CR: dropped, error recorded for this record.
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      added += i - start;
      prefix += text.slice(start, i);
      i += 1;
      start = i;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: this physical line holds no quote and no stray CR.
    let fields = null;
    let lastQuoted = false;
    let le = text.indexOf('\n', pos);
    const hasLF = le !== -1;
    if (!hasLF) le = n;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= le) {
      const r = text.indexOf('\r', pos);
      if (r === -1 || r >= le) {
        fields = text.slice(pos, le).split(',');
        pos = hasLF ? le + 1 : n;
        if (hasLF) line += 1;
      } else if (hasLF && r === le - 1) {
        fields = text.slice(pos, le - 1).split(',');
        pos = le + 1;
        line += 1;
      }
    }

    if (fields === null) {
      // Slow path: field by field, exactly as the reference reads them.
      fields = [];
      let ended;
      do {
        const quoted = text.charCodeAt(pos) === 34;
        lastQuoted = quoted;
        if (!quoted) {
          readUnquoted('');
          fields.push(UQ.v);
          ended = UQ.e;
        } else {
          // A field that opens with a quote.
          const open = pos;
          const openLine = line;
          let i = pos + 1;
          let segStart = i;
          let parts = null;
          let addLines = 0;
          let value = '';
          let closed = false;
          for (;;) {
            const qq = text.indexOf('"', i);
            if (qq === -1) break;
            if (text.charCodeAt(qq + 1) === 34) {
              // Doubled quote: one literal quote.
              let seg = text.slice(segStart, qq);
              if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
                const m = seg.match(/\r\n|\r|\n/g);
                if (m) addLines += m.length;
                seg = seg.replace(/\r\n?/g, '\n');
              }
              if (parts === null) parts = [seg];
              else parts.push(seg);
              parts.push('"');
              i = qq + 2;
              segStart = i;
              continue;
            }
            // Closing quote.
            let seg = text.slice(segStart, qq);
            if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
              const m = seg.match(/\r\n|\r|\n/g);
              if (m) addLines += m.length;
              seg = seg.replace(/\r\n?/g, '\n');
            }
            if (parts === null) value = seg;
            else {
              parts.push(seg);
              value = parts.join('');
            }
            pos = qq + 1;
            closed = true;
            break;
          }
          if (!closed) {
            // The quote never closes: literal, text after it re-read unquoted.
            pos = open + 1;
            line = openLine;
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            readUnquoted('"');
            fields.push(UQ.v);
            ended = UQ.e;
          } else {
            line += addLines;
            if (pos >= n) {
              fields.push(value);
              ended = END;
            } else {
              const c = text.charCodeAt(pos);
              if (c === 44) {
                pos += 1;
                fields.push(value);
                ended = COMMA;
              } else if (c === 10) {
                pos += 1;
                line += 1;
                fields.push(value);
                ended = LINE_BREAK;
              } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
                pos += 2;
                line += 1;
                fields.push(value);
                ended = LINE_BREAK;
              } else {
                // What follows the closing quote, appended as it stands.
                readUnquoted(value);
                if (UQ.a > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
                fields.push(UQ.v);
                ended = UQ.e;
              }
            }
          }
        }
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
