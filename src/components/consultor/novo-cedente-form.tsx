'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { criarCedenteConsultor } from '@/lib/actions/consultor-cedentes'
import type { FundoCriacaoCedente } from '@/lib/consultor/cedentes'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications/notification-provider'

export function NovoCedenteConsultorForm({ fundos }: { fundos: FundoCriacaoCedente[] }) {
  const router = useRouter()
  const notifications = useNotifications()
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Record<string, string[]>>({})

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await criarCedenteConsultor({
        fundoId: String(formData.get('fundoId') || ''),
        cnpj: String(formData.get('cnpj') || ''),
        razaoSocial: String(formData.get('razaoSocial') || ''),
        nomeFantasia: String(formData.get('nomeFantasia') || ''),
      })
      setErrors(result.fieldErrors || {})
      notifications.notify({ type: result.success ? 'success' : 'error', message: result.message })
      if (result.success && result.cedenteId) {
        router.push(`/consultor/cedentes/${result.cedenteId}/cadastro`)
      }
    })
  }

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader><CardTitle>Cadastrar Cedente</CardTitle></CardHeader>
      <CardContent>
        <form action={submit} className="space-y-5">
          <div>
            <Label htmlFor="c3-fundo" className="mb-2">Fundo *</Label>
            <select id="c3-fundo" name="fundoId" required className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Selecione o fundo</option>
              {fundos.map((fundo) => <option key={fundo.id} value={fundo.id}>{fundo.nome}</option>)}
            </select>
            {errors.fundoId?.map((error) => <p key={error} className="mt-1 text-sm text-destructive">{error}</p>)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="c3-cnpj" className="mb-2">CNPJ *</Label>
              <Input id="c3-cnpj" name="cnpj" inputMode="numeric" required placeholder="00.000.000/0000-00" />
              {errors.cnpj?.map((error) => <p key={error} className="mt-1 text-sm text-destructive">{error}</p>)}
            </div>
            <div>
              <Label htmlFor="c3-fantasia" className="mb-2">Nome Fantasia</Label>
              <Input id="c3-fantasia" name="nomeFantasia" maxLength={200} />
            </div>
          </div>
          <div>
            <Label htmlFor="c3-razao" className="mb-2">Razão Social *</Label>
            <Input id="c3-razao" name="razaoSocial" required maxLength={200} />
            {errors.razaoSocial?.map((error) => <p key={error} className="mt-1 text-sm text-destructive">{error}</p>)}
          </div>
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => router.push('/consultor/cedentes')}>Cancelar</Button>
            <Button type="submit" disabled={pending || fundos.length === 0}>
              {pending && <Loader2 className="animate-spin" />}Criar e continuar
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
