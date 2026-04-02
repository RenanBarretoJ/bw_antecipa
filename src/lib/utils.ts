import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export function formatCNPJ(cnpj: string): string {
  const cleaned = cnpj.replace(/\D/g, '')
  return cleaned.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  )
}

/**
 * Converte string de data do banco (YYYY-MM-DD ou ISO completo) para Date local.
 * Strings sem horário (YYYY-MM-DD) são tratadas como UTC pelo JS, causando D-1 no Brasil.
 * Forçar T00:00:00 faz o parse no timezone local e evita o problema.
 */
export function parseLocalDate(date: string): Date {
  const normalized = date.includes('T') ? date : `${date}T00:00:00`
  return new Date(normalized)
}

export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('pt-BR').format(parseLocalDate(date))
}
