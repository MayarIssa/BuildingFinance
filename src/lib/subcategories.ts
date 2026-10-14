import type { CategoryPerson, ExpenseCategory } from './types'

// A category's subcategories are the people (staff) listed under it in
// Building Setup — one shared list, so adding, renaming or removing
// someone there shows up in the expense form, filters and exports.
// Names typed into the older per-category subcategory list are kept too.
export function subcategoryNames(
  categoryId: string,
  people: CategoryPerson[],
  categories: ExpenseCategory[]
): string[] {
  if (!categoryId) return []
  const names: string[] = []
  const seen = new Set<string>()
  const add = (n: string) => {
    const clean = n.trim()
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase())
      names.push(clean)
    }
  }
  for (const p of people) if (p.category_id === categoryId) add(p.name)
  for (const n of categories.find((c) => c.id === categoryId)?.subcategories ?? []) add(n)
  return names
}
