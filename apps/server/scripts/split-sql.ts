/** Split migrations while preserving quoted semicolons and SQLite trigger bodies. */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let buffer = '', word = '', quote = '', depth = 0;
  const finishWord = () => {
    const token = word.toUpperCase();
    if (token === 'BEGIN' || token === 'CASE') depth++;
    else if (token === 'END') depth--;
    word = '';
  };
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (quote) {
      buffer += c;
      if (c === quote) {
        if (next === quote) { buffer += next; i++; }
        else quote = '';
      }
      continue;
    }
    if (c === '-' && next === '-') {
      finishWord();
      while (i < sql.length && sql[i] !== '\n') i++;
      buffer += '\n'; continue;
    }
    if (c === '/' && next === '*') {
      finishWord(); i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i++; buffer += ' '; continue;
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      finishWord(); quote = c === '[' ? ']' : c; buffer += c; continue;
    }
    if (/[a-zA-Z_]/.test(c)) word += c;
    else finishWord();
    if (c === ';' && depth === 0) {
      if (buffer.trim()) statements.push(buffer.trim());
      buffer = '';
    } else buffer += c;
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}
