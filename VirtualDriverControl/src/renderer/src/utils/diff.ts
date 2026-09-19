export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

/** Simple line-based LCS diff - plenty for config-file sized inputs. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  const n = a.length
  const m = b.length

  // LCS table (n+1 x m+1).
  const lcs: Uint32Array[] = []
  for (let i = 0; i <= n; i++) lcs.push(new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

/** Collapse long unchanged runs, keeping `context` lines around changes. */
export function compactDiff(lines: DiffLine[], context = 3): Array<DiffLine | { type: 'skip'; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, idx) => {
    if (line.type !== 'ctx') {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true
    }
  })
  const out: Array<DiffLine | { type: 'skip'; count: number }> = []
  let skipped = 0
  lines.forEach((line, idx) => {
    if (keep[idx]) {
      if (skipped > 0) {
        out.push({ type: 'skip', count: skipped })
        skipped = 0
      }
      out.push(line)
    } else {
      skipped++
    }
  })
  if (skipped > 0) out.push({ type: 'skip', count: skipped })
  return out
}
