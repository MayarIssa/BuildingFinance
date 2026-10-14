import type { OccupancyStatus, PaymentMethod, PayerRelation } from './types'

// Shown in the sidebar so anyone can tell at a glance which build a
// deployment is serving. Bump on every released change.
export const APP_VERSION = 'v3.13'

// Floors derived from the building setup: mezzanine M1..Mn, then 1..N
export function buildingFloors(mezzanineFloors: number, numFloors: number): string[] {
  const mezz = Math.max(0, Math.min(mezzanineFloors || 0, 5))
  const floors = Math.max(1, Math.min(numFloors || 1, 60))
  return [
    ...Array.from({ length: mezz }, (_, i) => `M${i + 1}`),
    ...Array.from({ length: floors }, (_, i) => String(i + 1)),
  ]
}

// Default building floors: mezzanine M1 and M2, then 1..13
export const FLOORS: string[] = buildingFloors(2, 13)

export const RECURRING_INTERVALS: { value: number; label: string }[] = [
  { value: 1, label: 'Every month' },
  { value: 2, label: 'Every 2 months' },
  { value: 3, label: 'Every 3 months' },
  { value: 6, label: 'Every 6 months' },
  { value: 12, label: 'Every year' },
]

// Sort order for floors (M1 first, then M2, then 1..13; unknown values last)
export function floorIndex(floor: string): number {
  const idx = FLOORS.indexOf(floor)
  return idx === -1 ? FLOORS.length : idx
}

export const PAYER_RELATIONS: { value: PayerRelation; label: string }[] = [
  { value: 'father', label: 'Father' },
  { value: 'mother', label: 'Mother' },
  { value: 'sister', label: 'Sister' },
  { value: 'brother', label: 'Brother' },
  { value: 'son', label: 'Son' },
  { value: 'daughter', label: 'Daughter' },
  { value: 'friend', label: 'Friend' },
]

// Title-case any relation for display — built-in or custom
export function relationLabel(value: PayerRelation): string {
  if (!value) return '—'
  const found = PAYER_RELATIONS.find((r) => r.value === value)
  if (found) return found.label
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// label is the English text, labelAr the Arabic — kept here rather than
// in the dictionary because "Resident" is also the resident-name column
export const OCCUPANCY_STATUSES: { value: OccupancyStatus; label: string; labelAr: string }[] = [
  { value: 'resident', label: 'Resident', labelAr: 'مقيم' },
  { value: 'non_resident', label: 'Non-Resident', labelAr: 'غير مقيم' },
  { value: 'unknown', label: 'Unknown', labelAr: 'مجهول' },
]

export function occupancyLabel(value: OccupancyStatus, lang: 'en' | 'ar'): string {
  const s = OCCUPANCY_STATUSES.find((o) => o.value === value)
  if (!s) return value
  return lang === 'ar' ? s.labelAr : s.label
}

// Maps current, legacy and typed-in values (English or Arabic) to a status:
// active → resident, traveling_but_paying → non_resident, mia / closed → unknown
export function normalizeOccupancy(value: unknown): OccupancyStatus {
  const v = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  switch (v) {
    case 'non_resident':
    case 'nonresident':
    case 'traveling_but_paying':
    case 'traveling':
    case 'غير_مقيم':
      return 'non_resident'
    case 'unknown':
    case 'closed':
    case 'mia':
    case 'مغلق':
    case 'مجهول':
      return 'unknown'
    default:
      return 'resident'
  }
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
]

export const DEFAULT_EXPENSE_CATEGORIES: string[] = [
  'maintenance',
  'water',
  'electricity',
  'internet',
  'security',
  'cleaning',
  'extras',
  'other',
]
