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

/**
 * Formata um timestamptz (armazenado em UTC, ex.: "2026-08-26T12:20:24Z")
 * para data+hora local de Sao Paulo -- ex.: "26/08/2026, 09:20:24". O banco
 * continua em UTC/timestamptz; NUNCA converter/gravar horario local ali.
 * `toLocaleString()`/`Intl.DateTimeFormat` sem `timeZone` explicito usam o
 * fuso do processo (UTC em runtimes serverless), nao o do usuario --
 * helper canonico para nunca repetir esse bug (P0_Claude_Webhook_
 * Transportadora_Payloads_Auditoria_v2).
 */
export function formatDateTimeSaoPaulo(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date)
}

export function formatCPF(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, '')
  return cleaned.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 11) {
    return cleaned.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  }
  return cleaned.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
}
