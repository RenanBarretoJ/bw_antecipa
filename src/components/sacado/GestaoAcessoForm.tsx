'use client'

import { useActionState, useId, useRef, useState } from 'react'
import { Building2, Loader2, ShieldCheck } from 'lucide-react'
import { consultarEmpresaSacado, gerenciarAcessoSacado } from '@/lib/actions/sacado-acessos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AcessoGestaoSacado } from '@/lib/sacado/gestao.server'
import { cn, formatCNPJ } from '@/lib/utils'

export function GestaoAcessoForm({ usuario, fundo, acesso }: { usuario: string; fundo: string; acesso?: AcessoGestaoSacado }) {
  const id = useId()
  const [razao, setRazao] = useState(acesso?.razao_social ?? '')
  const [consulta, setConsulta] = useState('')
  const consultaAtual = useRef(0)
  const [consultando, setConsultando] = useState(false)
  const [acao, setAcao] = useState(acesso ? acesso.status === 'ativo' ? 'desativar' : 'ativar' : 'adicionar')
  const [state, action, pending] = useActionState(gerenciarAcessoSacado, { success: false, message: '' })
  const restringeAcesso = acao === 'desativar' || acao === 'revogar'
  return <form action={action} aria-label={acesso ? `Alterar acesso ${formatCNPJ(acesso.cnpj)}` : 'Adicionar empresa / CNPJ'} className={cn('space-y-5 rounded-xl bg-card', !acesso && 'border border-border p-5')}>
    <input type="hidden" name="usuario" value={usuario} />
    <input type="hidden" name="fundo" value={fundo} />
    <div className="flex items-start gap-3"><Building2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /><div><h3 className="font-semibold">{acesso ? 'Alterar acesso' : 'Adicionar empresa / CNPJ'}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{acesso ? 'Escolha a alteração e confirme com seu autenticador.' : 'Vincule um CNPJ completo ao usuário e fundo selecionados.'}</p></div></div>
    {acesso ? <div className="space-y-2"><label htmlFor={`${id}-acao`} className="block text-sm font-medium">O que deseja fazer?</label><select id={`${id}-acao`} name="acao" value={acao} onChange={event => setAcao(event.target.value)} className="block h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {acesso.status !== 'ativo' && <option value="ativar">Ativar acesso</option>}
      {acesso.status === 'ativo' && <option value="desativar">Desativar acesso</option>}
      {acesso.status !== 'revogado' && <option value="revogar">Revogar acesso</option>}
      <option value="atualizar_empresa">Atualizar razão social</option>
    </select></div> : <input type="hidden" name="acao" value="adicionar" />}
    <div className="grid gap-4">
      <div className="space-y-2"><label htmlFor={`${id}-cnpj`} className="block text-sm font-medium">CNPJ completo</label><Input id={`${id}-cnpj`} name="cnpj" required maxLength={18} className="h-10 w-full font-mono read-only:bg-muted/50" defaultValue={acesso ? formatCNPJ(acesso.cnpj) : undefined} readOnly={!!acesso} placeholder="00.000.000/0000-00" onBlur={async event => {
        if (acesso) return
        const sequencia = ++consultaAtual.current
        const cnpj = event.currentTarget.value
        setConsultando(true)
        setConsulta('Consultando empresa...')
        try {
          const result = await consultarEmpresaSacado(fundo, cnpj)
          if (sequencia !== consultaAtual.current) return
          if (!result.success) { setConsulta(result.message); return }
          if (result.empresa) setRazao(result.empresa.razao_social)
          setConsulta(result.empresa ? 'Empresa encontrada. O cadastro existente sera preservado.' : 'Empresa ainda nao cadastrada. Informe a razao social para criar e vincular.')
        } catch { if (sequencia === consultaAtual.current) setConsulta('Consulta indisponivel. Tente novamente antes de confirmar.') }
        finally { if (sequencia === consultaAtual.current) setConsultando(false) }
      }} onChange={() => { consultaAtual.current++; setConsultando(false); setConsulta(''); setRazao('') }} /></div>
      <div className="space-y-2"><label htmlFor={`${id}-razao`} className="block text-sm font-medium">Razão social</label><Input id={`${id}-razao`} name="razao" required minLength={2} maxLength={200} className="h-10 w-full read-only:bg-muted/50" readOnly={!!acesso && acao !== 'atualizar_empresa'} placeholder="Nome empresarial completo" value={razao} onChange={event => setRazao(event.target.value)} /></div>
    </div>
    {consulta && <p role="status" className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">{consulta}</p>}
    {!acesso && <p className="text-xs leading-relaxed text-muted-foreground">Ao sair do campo CNPJ, consultamos o cadastro. Se a empresa já existir, seus dados serão preservados.</p>}
    <fieldset className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
      <legend className="px-1 text-xs font-semibold"><span className="inline-flex items-center gap-1.5"><ShieldCheck aria-hidden="true" className="size-4" />Confirmação de segurança</span></legend>
      <p className={cn('text-xs leading-relaxed', restringeAcesso ? 'text-destructive' : 'text-muted-foreground')}>{restringeAcesso ? 'Este usuário perderá o acesso a este CNPJ neste fundo. O histórico e os vínculos de outros usuários serão preservados.' : acao === 'atualizar_empresa' ? 'A razão social pertence ao cadastro da empresa. Confira o nome antes de confirmar a atualização.' : 'A autorização será concedida somente ao usuário, CNPJ e fundo selecionados.'}</p>
      <label className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" name="confirmacao" required className="mt-0.5 size-4 shrink-0 accent-primary" />Revisei os dados e confirmo esta alteração.</label>
      <div className="space-y-2"><label htmlFor={`${id}-mfa`} className="block text-sm font-medium">Código do autenticador</label><Input id={`${id}-mfa`} name="mfa" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" aria-describedby={`${id}-mfa-hint`} className="block h-10 w-full max-w-48 font-mono tracking-[0.3em]" /><p id={`${id}-mfa-hint`} className="text-xs text-muted-foreground">Informe os 6 dígitos do seu aplicativo.</p></div>
    </fieldset>
    <Button type="submit" variant={restringeAcesso ? 'destructive' : 'default'} className="h-10 w-full" disabled={pending || consultando}>{pending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}{pending ? 'Confirmando...' : acao === 'adicionar' ? 'Adicionar empresa' : 'Confirmar alteração'}</Button>
    {state.message && <p role={state.success ? 'status' : 'alert'} className={cn('rounded-lg border p-3 text-sm', state.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-destructive/20 bg-destructive/5 text-destructive')}>{state.message}</p>}
  </form>
}
