// Checks that run before the engine sees a formula or a defined name.
//
// The pinned IronCalc build stops reading a formula after its first complete
// expression and ignores the rest, so `=SUM(A1:A2))+5` or `=A1*1,2` would
// calculate a different number without any error. formulaProblem() finds the
// leftovers that way: stray or missing brackets, a comma or semicolon where
// no function argument can be, and two values next to each other. It reads
// tokens only and never judges function names or arguments, so everything the
// engine really understands passes.

// Returns a message naming the problem and its position (1 is the "=" sign),
// or null when the formula has no such problem.
export function formulaProblem(formula) {
  const text = formula;
  const stack = [];
  const where = (at) => `at position ${at + 1} of ${text}`;
  let at = 1,
    space = false,
    // "operand" after a value, ")" or "}", otherwise something that wants a value.
    prev = "start",
    // The previous value: its token and where it started.
    last = null,
    // A function name was read and its "(" comes next.
    call = false;
  const operand = (kind, start, token, end) => {
    if (prev === "operand") {
      const decimal = /^\d+$/.test(last.token) && /^\d+$/.test(token);
      if (decimal && space && /^\d{3}$/.test(token))
        return `Numbers cannot contain spaces: ${last.token} and ${token} ${where(last.start)} are two values. Write ${last.token}${token} without a thousands separator.`;
      return `Missing operator before ${token} ${where(start)}: put +, -, *, / or & between the two values.`;
    }
    prev = "operand";
    last = { token, start };
    call = false;
    at = end;
    return null;
  };
  while (at < text.length) {
    const ch = text[at];
    if (/\s/.test(ch)) {
      space = true;
      at++;
      continue;
    }
    const start = at;
    let problem = null;
    if (ch === '"') {
      let j = at + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"'))
        j += text[j] === '"' ? 2 : 1;
      if (j >= text.length)
        return `Text opened with " ${where(at)} is never closed: add a closing ".`;
      problem = operand("text", start, text.slice(at, j + 1), j + 1);
    } else if (ch === "'") {
      let j = at + 1;
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'"))
        j += text[j] === "'" ? 2 : 1;
      if (j >= text.length)
        return `Sheet name opened with ' ${where(at)} is never closed: add a closing '.`;
      if (text[j + 1] === "!") {
        problem = operand("sheet", start, text.slice(at, j + 2), j + 2);
        if (!problem) prev = "op";
      } else problem = operand("sheet", start, text.slice(at, j + 1), j + 1);
    } else if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[at + 1]))) {
      const m = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
      m.lastIndex = at;
      const token = m.exec(text)[0];
      problem = operand("number", start, token, at + token.length);
    } else if (/[\p{L}_\\$]/u.test(ch)) {
      const m = /[\p{L}\p{N}_.$\\]+/uy;
      m.lastIndex = at;
      const token = m.exec(text)[0],
        end = at + token.length,
        next = /^\s*(.)/.exec(text.slice(end))?.[1];
      if (text[end] === "!") {
        problem = operand("sheet", start, token + "!", end + 1);
        if (!problem) prev = "op";
      } else if (next === "(") {
        // A function name: its "(" starts the argument list.
        problem = operand("name", start, token, end);
        if (!problem) {
          prev = "op";
          call = true;
        }
      } else problem = operand("name", start, token, end);
    } else if (ch === "#") {
      const m =
        /#(?:REF!|N\/A|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!|SPILL!|CALC!|ERROR!|CIRC!|N\/IMPL!?)/iy;
      m.lastIndex = at;
      const token = m.exec(text)?.[0];
      if (token) problem = operand("error", start, token, at + token.length);
      else at++; // The spill suffix of a reference (A1#).
    } else if (ch === "[") {
      // Structured or external reference: skipped as one piece.
      let depth = 0,
        j = at;
      for (; j < text.length; j++) {
        if (text[j] === "[") depth++;
        if (text[j] === "]" && --depth === 0) break;
      }
      if (j >= text.length) return `Missing "]" for the "[" ${where(at)}.`;
      if (prev === "operand" && !space) at = j + 1;
      else problem = operand("reference", start, text.slice(at, j + 1), j + 1);
    } else if (ch === "(") {
      // After a function name or a ")" (a LAMBDA call) it opens arguments.
      if (prev === "operand" && last.token !== ")")
        return `Missing operator before "(" ${where(start)}: put +, -, *, / or & between the two values.`;
      stack.push({ ch, at });
      call = false;
      prev = "op";
      at++;
    } else if (ch === "{") {
      if (prev === "operand")
        return `Missing operator before "{" ${where(start)}: put +, -, *, / or & between the two values.`;
      stack.push({ ch, at });
      prev = "op";
      at++;
    } else if (ch === ")" || ch === "}") {
      const open = stack.pop(),
        want = ch === ")" ? "(" : "{";
      if (!open)
        return `Unexpected "${ch}" ${where(start)}: there is no "${want}" for it to close.`;
      if (open.ch !== want)
        return `"${ch}" ${where(start)} does not match the "${open.ch}" at position ${open.at + 1}: close it with "${open.ch === "(" ? ")" : "}"}".`;
      prev = "operand";
      last = { token: ch, start };
      call = false;
      at++;
    } else if (ch === "]") {
      return `Unexpected "]" ${where(start)}: there is no "[" for it to close.`;
    } else if (ch === ",") {
      const top = stack.at(-1);
      if (!top) {
        const before =
            prev === "operand" && /^\d+$/.test(last.token) ? last : null,
          after = /^\d/.exec(text.slice(at + 1));
        if (before && !space && after)
          return `"," ${where(start)} is not a decimal point: write the number with "." (for example ${before.token}.${/^\d+/.exec(text.slice(at + 1))[0]}). A comma only separates function arguments.`;
        return `"," ${where(start)} is outside a function: use "," only between function arguments, and "." for decimals.`;
      }
      prev = "op";
      at++;
    } else if (ch === ";") {
      if (stack.at(-1)?.ch !== "{")
        return `";" ${where(start)} is not valid here: separate function arguments with "," (this editor uses English formula syntax).`;
      prev = "op";
      at++;
    } else if (ch === "%") {
      at++;
    } else if (ch === "@") {
      prev = "op";
      at++;
    } else {
      // Operators: + - * / ^ & = < > <= >= <> :
      prev = "op";
      at +=
        (ch === "<" || ch === ">") && /[=>]/.test(text[at + 1] ?? "") ? 2 : 1;
    }
    if (problem) return problem;
    space = false;
  }
  const open = stack.at(-1);
  if (open)
    return `Missing "${open.ch === "(" ? ")" : "}"}" for the "${open.ch}" ${where(open.at)}: add it at the end or where the group should close.`;
  return null;
}

// A defined name must not be one the engine refuses: a cell address such as
// Q1, FY25 or TAX2 (any letter case), a row/column address in R1C1 style,
// R, C, TRUE or FALSE, or a name with characters other than letters, digits
// and "_". Returns a message naming the name, or null.
export function definedNameProblem(name) {
  const bad = (why) => `Defined name "${name}" ${why}`;
  if (typeof name !== "string" || !/^[A-Za-z][\w-]{0,79}$/.test(name))
    return bad(
      "must start with a letter and use only letters, digits and _ (80 characters at most).",
    );
  if (name.includes("-"))
    return bad(
      `contains "-", which the engine refuses: use letters, digits and _ (for example ${name.replaceAll("-", "_")}).`,
    );
  if (/^[rc]$/i.test(name))
    return bad(
      "is refused by the engine: R and C are reserved. Choose another name.",
    );
  if (/^(true|false)$/i.test(name))
    return bad(
      "is refused by the engine: it is a Boolean value. Choose another name.",
    );
  const cell = /^([A-Za-z]{1,3})(\d+)$/.exec(name);
  if (cell) {
    const column = [...cell[1].toUpperCase()].reduce(
        (n, c) => n * 26 + c.charCodeAt(0) - 64,
        0,
      ),
      row = Number(cell[2]);
    if (column <= 16384 && row >= 1 && row <= 1048576)
      return bad(
        `is refused by the engine: it is a cell address (column ${cell[1].toUpperCase()}, row ${row}). Add a letter or an underscore, for example ${name}_x or ${cell[1]}_${cell[2]}.`,
      );
  }
  if (name.length >= 4 && /^R\d*C\d*$/i.test(name))
    return bad(
      "is refused by the engine: it looks like a cell address in R1C1 style. Choose another name.",
    );
  return null;
}
