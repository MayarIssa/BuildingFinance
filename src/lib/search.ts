// Forgiving search used by the Apartments and Payments pages.
//
// - case-insensitive, extra spaces ignored
// - Arabic letter variants match each other (أ إ آ → ا, ة → ه, ى → ي) and
//   diacritics are ignored, so "احمد" finds "أحمد"
// - Arabic-Indic digits (٠١٢…) match Western digits
// - phone numbers match on digits only, so "0101 234" finds "01012345678"
// - several words must all match (in any field): "101 ahmed"

const ARABIC_INDIC = /[٠-٩۰-۹]/g

export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/[ً-ْـ]/g, "") // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
}

export function digitsOnly(value: string | null | undefined): string {
  return normalizeSearch(value).replace(/\D/g, "")
}

/**
 * True when every word of the query is found in one of the text fields,
 * or (for numeric words of 3+ digits) in one of the phone fields.
 */
export function matchesSearch(
  query: string,
  textFields: (string | null | undefined)[],
  phoneFields: (string | null | undefined)[] = []
): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  const texts = textFields.map(normalizeSearch)
  const phones = phoneFields.map(digitsOnly).filter(Boolean)
  // a phone typed with separators ("0101-234 5678") is one word
  const queryDigits = q.replace(/[\s\-()+.]/g, "")
  if (/^\d{3,}$/.test(queryDigits) && phones.some((p) => p.includes(queryDigits))) return true

  return q.split(" ").every((word) => {
    if (texts.some((t) => t.includes(word))) return true
    const d = word.replace(/\D/g, "")
    return d.length >= 3 && d === word.replace(/[\-()+.]/g, "") && phones.some((p) => p.includes(d))
  })
}
