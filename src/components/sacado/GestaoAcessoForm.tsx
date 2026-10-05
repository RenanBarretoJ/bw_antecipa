'use client'

import { useActionState, useId, useRef, useState } from 'react'
import { consultarEmpresaSacado, gerenciarAcessoSacado } from '@/lib/actions/sacado-acessos'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { AcessoGestaoSacado } from '@/lib/sacado/gestao.server'

export function GestaoAcessoForm({ usuario, fundo, acesso }: { usuario: string; fundo: string; acesso?: AcessoGestaoSacado }) {
  const id = useId()
  const [razao, setRazao] = useState(acesso?.razao_social ?? '')
  const [consulta, setConsulta] = useState('')
  const consultaAtual = useRef(0)
  const [consultando, setConsultando] = useState(false)
  const [state, action, pending] = useActionState(gerenciarAcessoSacado, { success: false, message: '' })
  return <form action={action} className="space-y-3 rounded-xl border border-border p-4">
    <input type="hidden" name="usuario" value={usuario} />
    <input type="hidden" name="fundo" value={fundo} />
    <h3 className="font-medium">{acesso ? 'Alterar acesso desta empresa' : 'Adicionar empresa / CNPJ'}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label htmlFor={`${id}-cnpj`} className="text-sm">CNPJ completo</label><Input id={`${id}-cnpj`} name="cnpj" required maxLength={18} defaultValue={acesso?.cnpj} readOnly={!!acesso} placeholder="00.000.000/0000-00" onBlur={async event => {
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
      <div><label htmlFor={`${id}-razao`} className="text-sm">Razao social</label><Input id={`${id}-razao`} name="razao" required minLength={2} maxLength={200} value={razao} onChange={event => setRazao(event.target.value)} /></div>
    </div>
    {consulta && <p role="status" className="text-sm text-muted-foreground">{consulta}</p>}
    <p className="text-xs text-muted-foreground">Se a empresa ja existir, seu cadastro sera preservado e vinculado pelo CNPJ completo. Alterar a razao social exige a acao especifica abaixo.</p>
    {acesso ? <div><label htmlFor={`${id}-acao`} className="text-sm">Acao</label><select id={`${id}-acao`} name="acao" className="block min-h-10 w-full rounded-lg border border-input bg-background px-3">
      {acesso.status !== 'ativo' && <option value="ativar">Ativar acesso</option>}
      {acesso.status === 'ativo' && <option value="desativar">Desativar acesso</option>}
      {acesso.status !== 'revogado' && <option value="revogar">Revogar acesso</option>}
      <option value="atualizar_empresa">Atualizar razao social</option>
    </select></div> : <input type="hidden" name="acao" value="adicionar" />}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmacao" required className="mt-1" />Confirmo a alteracao somente para este usuario, empresa e Fundo. Revogar ou desativar impede novos acessos; o historico e os outros usuarios permanecem.</label>
    <div><label htmlFor={`${id}-mfa`} className="text-sm">Codigo do autenticador</label><Input id={`${id}-mfa`} name="mfa" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="max-w-60" /></div>
    <Button type="submit" disabled={pending || consultando}>{pending ? 'Confirmando...' : 'Confirmar e salvar'}</Button>
    {state.message && <p role={state.success ? 'status' : 'alert'} className={state.success ? 'text-sm text-success' : 'text-sm text-destructive'}>{state.message}</p>}
  </form>
}
