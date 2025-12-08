const patterns = [
  /\b[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,            // email
  /\b\+?\d[\d\s().-]{7,}\b/g,                        // phone-ish
  /\b[A-Za-z0-9-_]{20,}\.([A-Za-z0-9-_]{20,})\.[A-Za-z0-9-_]{10,}\b/g // jwt-like
]
export function redact(text: string): string {
  let out = text
  for (const re of patterns) out = out.replace(re, '[REDACTED]')
  return out
}
