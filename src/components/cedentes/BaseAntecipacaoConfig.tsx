'use client'

import { useState, useTransition } from 'react'
import { configurarBaseAntecipacao } from '@/lib/actions/configuracao-financeira-fundo'
import type { BaseValorAntecipacao } from '@/lib/operacoes/base-antecipacao'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const baseLabels: Record<BaseValorAntecipacao, string> = {
  BRUTO: 'Valor bruto da nota',
  LIQUIDO: 'Valor líquido da nota',
}

export function BaseAntecipacaoConfig({ vinculoId, baseAtual }: { vinculoId: string; baseAtual: BaseValorAntecipacao }) {
  const [base, setBase] = useState(baseAtual)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  return <Card>
    <CardHeader><CardTitle>Base de valor para antecipação</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <Label htmlFor="base-antecipacao">Base para novas operações neste fundo</Label>
      <Select value={base} items={baseLabels} disabled={pending} onValueChange={(value) => {
        if (value === 'BRUTO' || value === 'LIQUIDO') setBase(value)
      }}>
        <SelectTrigger id="base-antecipacao"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="BRUTO">{baseLabels.BRUTO}</SelectItem>
          <SelectItem value="LIQUIDO">{baseLabels.LIQUIDO}</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">Bruto: usa o valor fiscal bruto. Líquido: usa o valor líquido explicitamente informado no documento e não permite notas parceladas.</p>
      <p className="text-sm text-muted-foreground">Operações existentes mantêm sua base original.</p>
      <Button disabled={pending} onClick={() => startTransition(async () => {
        setMessage('')
        try { setMessage((await configurarBaseAntecipacao(vinculoId, base)).message) }
        catch { setMessage('Não foi possível salvar. Verifique sua sessão e tente novamente.') }
      })}>{pending ? 'Salvando...' : 'Salvar base'}</Button>
      {message && <p role="status" className="text-sm">{message}</p>}
    </CardContent>
  </Card>
}
