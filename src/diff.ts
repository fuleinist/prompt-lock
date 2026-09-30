export interface DiffOptions {
  context?: number;
  color?: boolean;
}

export interface DiffResult {
  text: string;
  changed: boolean;
}

interface Op {
  t: ' ' | '-' | '+';
  s: string;
}

/**
 * Unified line diff (LCS-based) between two strings.
 * Returns hunks with `context` unchanged lines around each change.
 */
export function diffLines(a: string, b: string, opts: DiffOptions = {}): DiffResult {
  const ctx = Math.max(0, opts.context ?? 3);
  const color = opts.color ?? false;
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;

  // LCS length table
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      ops.push({ t: ' ', s: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', s: A[i] });
      i++;
    } else {
      ops.push({ t: '+', s: B[j] });
      j++;
    }
  }
  while (i < n) ops.push({ t: '-', s: A[i++] });
  while (j < m) ops.push({ t: '+', s: B[j++] });

  const changed = ops.some((o) => o.t !== ' ');
  if (!changed) return { text: '', changed: false };

  const red = (s: string): string => (color ? `\x1b[31m${s}\x1b[0m` : s);
  const green = (s: string): string => (color ? `\x1b[32m${s}\x1b[0m` : s);
  const cyan = (s: string): string => (color ? `\x1b[36m${s}\x1b[0m` : s);

  const out: string[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === ' ') {
      k++;
      continue;
    }
    // Extend the hunk across small gaps between changes.
    let end = k;
    let p = k;
    for (;;) {
      if (p < ops.length && ops[p].t !== ' ') {
        end = p;
        p++;
        continue;
      }
      let q = p;
      while (q < ops.length && ops[q].t === ' ') q++;
      if (q < ops.length && q - p <= ctx * 2) {
        end = q - 1;
        p = q;
      } else {
        break;
      }
    }
    const hs = Math.max(0, k - ctx);
    const he = Math.min(ops.length - 1, end + ctx);

    // Line numbers at hunk start
    let la = 1;
    let lb = 1;
    for (let x = 0; x < hs; x++) {
      if (ops[x].t !== '+') la++;
      if (ops[x].t !== '-') lb++;
    }
    let ca = 0;
    let cb = 0;
    const body: string[] = [];
    for (let x = hs; x <= he; x++) {
      const o = ops[x];
      if (o.t === ' ') {
        body.push(' ' + o.s);
        ca++;
        cb++;
      } else if (o.t === '-') {
        body.push(red('-' + o.s));
        ca++;
      } else {
        body.push(green('+' + o.s));
        cb++;
      }
    }
    out.push(cyan(`@@ -${la},${ca} +${lb},${cb} @@`));
    out.push(...body);
    k = he + 1;
  }
  return { text: out.join('\n') + '\n', changed: true };
}
