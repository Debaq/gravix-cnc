/**
 * Variable Text / Merge Codes
 *
 * Replace {{variable}} placeholders in text with values from CSV data.
 * Used for production runs: 100 nameplates with different names, serial numbers, etc.
 */

export interface MergeRecord {
  [key: string]: string
}

/**
 * Parse CSV string into array of records.
 * First row = headers (variable names).
 */
export function parseCSV(csv: string): MergeRecord[] {
  const lines = csv.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = parseCSVLine(lines[0])
  const records: MergeRecord[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const record: MergeRecord = {}
    for (let j = 0; j < headers.length; j++) {
      record[headers[j].trim()] = (values[j] || '').trim()
    }
    records.push(record)
  }

  return records
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current)
  return result
}

/**
 * Replace {{variable}} placeholders in text with values from a record.
 * Supports: {{name}}, {{serial}}, {{date}}, {{index}}
 */
export function mergeText(template: string, record: MergeRecord, index: number): string {
  let result = template

  // Replace {{key}} with record values
  for (const [key, value] of Object.entries(record)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'gi'), value)
  }

  // Built-in variables
  result = result.replace(/\{\{index\}\}/gi, String(index + 1))
  result = result.replace(/\{\{date\}\}/gi, new Date().toLocaleDateString())
  result = result.replace(/\{\{time\}\}/gi, new Date().toLocaleTimeString())

  return result
}

/**
 * Extract all {{variable}} names from a template string.
 */
export function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) || []
  return [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))]
}

/**
 * Generate preview of merge results.
 */
export function previewMerge(template: string, records: MergeRecord[]): string[] {
  return records.map((record, i) => mergeText(template, record, i))
}
