'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { buscarBancosCadastro } from '@/lib/actions/cadastro'
import type { BancoCatalogo } from '@/lib/cadastro/types'

export type BancoSelecionado = {
  codigo: string
  ispb: string | null
  nome: string
}

function formatarBanco(banco: BancoCatalogo | BancoSelecionado): string {
  return banco.ispb ? `${banco.codigo} – ${banco.nome} (ISPB: ${banco.ispb})` : `${banco.codigo} – ${banco.nome}`
}

/**
 * Combobox pesquisavel por codigo/nome/ISPB, compartilhado entre Matriz e
 * Filial (P0_Claude_Cadastro_Cedente_CNPJ_CEP_Bancos_Filiais). Sem
 * dependencia nova -- lista simples filtrada sob um input de texto.
 */
export function BancoCombobox({
  value,
  onSelect,
  legacyLabel,
  error,
  disabled,
}: {
  value: BancoSelecionado | null
  onSelect: (banco: BancoSelecionado) => void
  legacyLabel?: string | null
  error?: string
  disabled?: boolean
}) {
  const [termo, setTermo] = useState('')
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [opcoes, setOpcoes] = useState<BancoCatalogo[]>([])
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function aoClicarFora(evento: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(evento.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [])

  useEffect(() => {
    if (!aberto) return
    let cancelado = false
    const timer = setTimeout(async () => {
      setCarregando(true)
      setErroBusca(null)
      const resultado = await buscarBancosCadastro(termo)
      if (cancelado) return
      setCarregando(false)
      if (!resultado.success) {
        setErroBusca(resultado.message)
        setOpcoes([])
        return
      }
      setOpcoes(resultado.dados)
    }, 250)
    return () => { cancelado = true; clearTimeout(timer) }
  }, [termo, aberto])

  const rotuloAtual = value ? formatarBanco(value) : legacyLabel || ''

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={aberto ? termo : rotuloAtual}
        placeholder="Buscar por codigo, nome ou ISPB..."
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onFocus={() => { setAberto(true); setTermo('') }}
        onChange={(e) => setTermo(e.target.value)}
        className="h-11"
      />
      {error && <p className="text-destructive text-sm mt-1">{error}</p>}

      {aberto && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-popover shadow-md">
          {carregando && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Buscando bancos...
            </div>
          )}
          {!carregando && erroBusca && (
            <p className="px-3 py-2 text-sm text-destructive">{erroBusca}</p>
          )}
          {!carregando && !erroBusca && opcoes.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum banco encontrado.</p>
          )}
          {!carregando && opcoes.map((banco) => (
            <button
              key={banco.id}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                onSelect({ codigo: banco.codigo, ispb: banco.ispb, nome: banco.nome })
                setAberto(false)
                setTermo('')
              }}
            >
              {formatarBanco(banco)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
