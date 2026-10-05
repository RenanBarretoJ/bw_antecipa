import { redirect } from 'next/navigation'

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value)) value.forEach(item => query.append(key, item))
  }
  redirect(`/gestor/sacados${query.size ? `?${query}` : ''}`)
}
