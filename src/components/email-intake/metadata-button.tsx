'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { atualizarDetalhesMensagensEmail } from '@/app/actions/email-operations'
import { Button } from '@/components/ui/button'

export function EmailMetadataButton({ fundoId, ids }: { fundoId: string; ids: string[] }) {
  const [pending, start] = useTransition(), [message, setMessage] = useState(''), router = useRouter()
  if (!ids.length) return null
  return <div className="space-y-2"><Button variant="outline" disabled={pending} onClick={() => start(async () => {
    const result = await atualizarDetalhesMensagensEmail({ fundoId, ids })
    setMessage(result.ok ? result.data.failed ? 'Alguns detalhes não puderam ser consultados. Confira o acesso à caixa e aguarde cinco minutos antes de tentar novamente.' : result.data.updated ? 'Assuntos e remetentes atualizados com proteção de dados.' : 'Nenhuma atualização disponível. Se houve uma consulta recente, aguarde cinco minutos.' : result.message)
    router.refresh()
  })}>{pending ? 'Consultando detalhes…' : 'Consultar assuntos e remetentes'}</Button><p className="text-xs text-muted-foreground">Consulta somente as mensagens desta página. O conteúdo dos e-mails não será carregado.</p>{message && <p role="status" className="text-sm">{message}</p>}</div>
}
