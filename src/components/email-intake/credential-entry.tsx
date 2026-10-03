'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { EmailCredentialDialog } from './credential-dialog'

export function EmailCredentialEntry({ fundoId }: { fundoId: string }) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState(''), router = useRouter()
  return <div className="space-y-2"><Button variant="outline" onClick={() => setOpen(true)}>Nova credencial de e-mail</Button>
    {message && <p className="text-sm" role="status">{message}</p>}
    {open && <EmailCredentialDialog open fundoId={fundoId} environment="homologacao" onClose={() => setOpen(false)} onCreated={() => { setMessage('Credencial salva. Crie uma integração e selecione a credencial cadastrada.'); router.refresh() }} />}
  </div>
}
