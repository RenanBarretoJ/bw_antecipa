'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SensitiveConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  pending: boolean
  onConfirm: (mfaCode: string) => void
}) {
  const [mfaCode, setMfaCode] = useState('')

  function close(value: boolean) {
    if (!value) setMfaCode('')
    onOpenChange(value)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div>
          <Label htmlFor="admin-sensitive-mfa" className="mb-2">Codigo TOTP</Label>
          <Input id="admin-sensitive-mfa" value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="font-mono tracking-[0.35em]" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>Cancelar</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={() => onConfirm(mfaCode)} disabled={pending || mfaCode.length !== 6}>{pending && <Loader2 className="animate-spin" />}{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
