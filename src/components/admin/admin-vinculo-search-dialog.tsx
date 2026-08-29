'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, ChevronLeft, ChevronRight, Loader2, Plus, Search, Users } from 'lucide-react'
import { buscarCandidatosVinculoAdmin } from '@/app/admin/usuarios/actions'
import { GestorFundAccessAction } from '@/components/admin/gestor-fund-access-action'
import { StatusBadge } from '@/components/data-display/primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { AdminVinculoBuscaDirecao, AdminVinculoBuscaResult } from '@/lib/admin/usuarios'
import { formatCNPJ } from '@/lib/utils'

const RESULTADO_VAZIO: AdminVinculoBuscaResult = {
  itens: [],
  total: 0,
  pagina: 1,
  por_pagina: 20,
  total_paginas: 0,
}

export function AdminVinculoSearchDialog({
  direcao,
  contextoId,
}: {
  direcao: AdminVinculoBuscaDirecao
  contextoId: string
}) {
  const gestoresParaFundo = direcao === 'gestores_para_fundo'
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const [resultado, setResultado] = useState(RESULTADO_VAZIO)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    const termo = busca.trim()
    if (!open || termo.length < 2) return
    const currentRequest = ++requestId.current
    const timer = window.setTimeout(() => {
      setCarregando(true)
      setErro(null)
      void buscarCandidatosVinculoAdmin({ direcao, contextoId, busca: termo, pagina }).then((response) => {
        if (currentRequest !== requestId.current) return
        if (!response.success || !response.data) {
          setResultado(RESULTADO_VAZIO)
          setErro(response.message || 'Nao foi possivel realizar a busca.')
          return
        }
        setResultado(response.data)
      }).finally(() => {
        if (currentRequest === requestId.current) setCarregando(false)
      })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [busca, contextoId, direcao, open, pagina])

  function handleOpenChange(value: boolean) {
    setOpen(value)
    if (value) return
    requestId.current += 1
    setBusca('')
    setPagina(1)
    setResultado(RESULTADO_VAZIO)
    setErro(null)
    setCarregando(false)
  }

  const title = gestoresParaFundo ? 'Vincular gestor ao fundo' : 'Vincular fundo ao gestor'
  const placeholder = gestoresParaFundo ? 'Buscar por nome ou e-mail' : 'Buscar por nome do fundo ou CNPJ'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}><Plus aria-hidden="true" />{gestoresParaFundo ? 'Vincular gestor' : 'Vincular fundo'}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Localize o cadastro desejado. A confirmação do vínculo exige o TOTP administrativo.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            autoFocus
            value={busca}
            onChange={(event) => {
              requestId.current += 1
              setBusca(event.target.value)
              setPagina(1)
              setResultado(RESULTADO_VAZIO)
              setErro(null)
              setCarregando(false)
            }}
            placeholder={placeholder}
            aria-label={placeholder}
            className="h-10 pl-9"
          />
        </div>

        <div className="min-h-64 overflow-hidden rounded-xl border border-border">
          {busca.trim().length < 2 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {gestoresParaFundo ? <Users className="mb-3 size-7" aria-hidden="true" /> : <Building2 className="mb-3 size-7" aria-hidden="true" />}
              Digite ao menos dois caracteres para iniciar a busca.
            </div>
          ) : carregando ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Buscando...</div>
          ) : erro ? (
            <div className="flex min-h-64 items-center justify-center px-6 text-center text-sm text-destructive">{erro}</div>
          ) : resultado.itens.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center px-6 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</div>
          ) : (
            <div className="divide-y divide-border">
              {resultado.itens.map((item) => {
                const usuarioId = gestoresParaFundo ? item.id : contextoId
                const fundoId = gestoresParaFundo ? contextoId : item.id
                const statusAtivo = item.entidade_status === 'ativo'
                return (
                  <div key={item.id} className={`flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center ${statusAtivo ? '' : 'bg-muted/35'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={item.nome}>{item.nome}</p>
                      <p className="truncate text-xs text-muted-foreground" title={item.descricao}>{gestoresParaFundo ? item.descricao : formatCNPJ(item.descricao)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={statusAtivo ? 'ativo' : 'desativada'} label={gestoresParaFundo ? `Usuario ${statusAtivo ? 'ativo' : 'inativo/bloqueado'}` : `Fundo ${statusAtivo ? 'ativo' : 'inativo'}`} />
                      {item.vinculo_status && <StatusBadge status="desativada" label={`Vinculo ${item.vinculo_status}`} />}
                      <GestorFundAccessAction usuarioId={usuarioId} fundoId={fundoId} status={item.vinculo_status} labelOverride="Vincular" onSuccess={() => handleOpenChange(false)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {resultado.total_paginas > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{resultado.total} resultado(s)</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="icon-sm" aria-label="Pagina anterior" disabled={carregando || pagina <= 1} onClick={() => setPagina((value) => Math.max(1, value - 1))}><ChevronLeft aria-hidden="true" /></Button>
              <span aria-live="polite">Pagina {resultado.pagina} de {resultado.total_paginas}</span>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Proxima pagina" disabled={carregando || pagina >= resultado.total_paginas} onClick={() => setPagina((value) => value + 1)}><ChevronRight aria-hidden="true" /></Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
