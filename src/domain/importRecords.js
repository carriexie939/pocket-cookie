// Parses an import file (CSV or JSON) into transaction items for POST /api/transactions.
// CSV header: date,type,category,amount,title,description
// A negative expense amount is a refund and offsets spending.

export const IMPORT_COLUMNS = ['date', 'type', 'category', 'amount', 'title', 'description']

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, '').toLowerCase())
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((h, idx) => [h, cells[idx] ?? ''])))
}

function parseDate(value) {
  const m = String(value).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const when = new Date(y, mo - 1, d, 12, 0, 0, 0)
  if (when.getMonth() !== mo - 1 || when.getDate() !== d) return null
  return when
}

export function parseImportFile(text, fileName, categoryOptions) {
  const isJson = /\.json$/i.test(fileName) || /^\s*[[{]/.test(text)
  let raw
  try {
    raw = isJson ? JSON.parse(text) : parseCsv(text)
  } catch {
    return { items: [], errors: ['Could not read the file. Use CSV or JSON.'] }
  }
  if (!Array.isArray(raw)) raw = raw?.transactions
  if (!Array.isArray(raw)) return { items: [], errors: ['No records found in the file.'] }

  const items = []
  const errors = []
  raw.forEach((rec, idx) => {
    const line = isJson ? `Record ${idx + 1}` : `Row ${idx + 2}`
    const type = String(rec.type || '').trim().toLowerCase()
    if (type !== 'expense' && type !== 'income') { errors.push(`${line}: type must be expense or income.`); return }
    const amount = Number(String(rec.amount).replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount === 0) { errors.push(`${line}: amount must be a non-zero number.`); return }
    const date = parseDate(rec.date)
    if (!date) { errors.push(`${line}: date must be YYYY-MM-DD.`); return }
    const allowed = categoryOptions[type] || []
    const rawCategory = String(rec.category || '').trim().toLowerCase()
    const category = allowed.includes(rawCategory) ? rawCategory : (type === 'income' ? 'other_income' : 'others')
    items.push({
      title: String(rec.title || '').trim() || category,
      description: String(rec.description || '').trim(),
      type,
      category,
      amount: Math.round(amount * 100) / 100,
      date: date.toISOString(),
      source: 'import',
    })
  })
  return { items, errors }
}
