import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Egyptian Pound: "EGP" in English, "جنيه" in Arabic. The language is
// set by the LanguageProvider so every formatCurrency call follows the
// app language; digits stay Western so data entry stays consistent.
let currencyLang: 'en' | 'ar' = 'en'

export function setCurrencyLang(lang: 'en' | 'ar') {
  currencyLang = lang
}

export const CURRENCY_LABEL = { en: 'EGP', ar: 'جنيه' } as const

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatCurrency(amount: number): string {
  return `${formatAmount(amount)} ${CURRENCY_LABEL[currencyLang]}`
}

// Always "1,200 EGP" — for the PDF, whose font has no Arabic glyphs
export function formatCurrencyLatin(amount: number): string {
  return `${formatAmount(amount)} ${CURRENCY_LABEL.en}`
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Month + year only, e.g. "Jun 2026"
export function formatMonth(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
  })
}

// Re-export date filtering utilities
export {
  dateInRange,
  filterByDateRange,
  filterPaymentsByRange,
  filterExpensesByRange,
  filterTransfersByRange,
} from "@/lib/date-filters"
