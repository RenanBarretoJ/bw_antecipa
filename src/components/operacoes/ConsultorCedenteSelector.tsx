'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, Check, ChevronDown, Loader2, Search } from 'lucide-react'
import {
  buscarCedentesElegiveisConsultor,
  type CedenteElegivelConsultor,
} from '@/lib/actions/consultor-operacoes'
import { formatCNPJ } from '@/lib/utils'
import {
  deveExecutarBuscaCedentes,
  parametrosAoSelecionarCedente,
} from '@/lib/operacoes/consultor-seletor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ConsultorCedenteSelector({ selecionado }: {
  selecionado: CedenteElegivelConsultor | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const listboxId = useId()
  const triggerId = useId()
  const searchId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const requestId = useRef(0)
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [opcoes, setOpcoes] = useState<CedenteElegivelConsultor[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [indiceAtivo, setIndiceAtivo] = useState(-1)
  const [navegando, startTransition] = useTransition()

  useEffect(() => {
    function fecharAoClicarFora(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fecharAoClicarFora)
    return () => document.removeEventListener('mousedown', fecharAoClicarFora)
  }, [])

  useEffect(() => {
    if (!aberto) return
    const q = termo.trim()
    const current = ++requestId.current

    if (!deveExecutarBuscaCedentes(q)) return

    const timer = window.setTimeout(async () => {
      setCarregando(true)
      const result = await buscarCedentesElegiveisConsultor(q)
      if (current !== requestId.current) return
      setCarregando(false)
      if (!result.success) {
        setErro(result.message)
        setOpcoes([])
        return
      }
      setOpcoes(result.data)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [aberto, termo])

  function selecionar(opcao: CedenteElegivelConsultor) {
    const params = parametrosAoSelecionarCedente(new URLSearchParams(searchParams.toString()), opcao.id)
    setAberto(false)
    setTermo('')
    startTransition(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }))
  }

  function tratarTeclado(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setAberto(false)
      return
    }
    if (!opcoes.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndiceAtivo((atual) => Math.min(atual + 1, opcoes.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndiceAtivo((atual) => Math.max(atual - 1, 0))
    } else if (event.key === 'Enter' && indiceAtivo >= 0) {
      event.preventDefault()
      selecionar(opcoes[indiceAtivo])
    }
  }

  const q = termo.trim()
  const mensagemVazia = q.length > 0 && q.length < 4
    ? 'Digite ao menos 4 caracteres para pesquisar.'
    : 'Nenhum Cedente ativo encontrado.'

  return (
    <div ref={containerRef} className="relative">
      <label htmlFor={triggerId} className="mb-2 block text-sm font-medium">
        Cedente <span aria-hidden="true">*</span>
      </label>
      <Button
        id={triggerId}
        type="button"
        variant="outline"
        className="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2 text-left font-normal"
        aria-expanded={aberto}
        aria-controls={listboxId}
        disabled={navegando}
        onClick={() => {
          setAberto((atual) => !atual)
          setTermo('')
          setIndiceAtivo(-1)
          setErro(null)
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block truncate font-medium">
              {selecionado?.nomeFantasia || selecionado?.razaoSocial || 'Selecione um Cedente'}
            </span>
            {selecionado ? (
              <span className="block truncate text-xs text-muted-foreground">
                {selecionado.razaoSocial} · {formatCNPJ(selecionado.cnpj)}
              </span>
            ) : null}
          </span>
        </span>
        {navegando ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ChevronDown className="size-4 shrink-0" />}
      </Button>

      {aberto ? (
        <div className="absolute z-50 mt-1 w-full rounded-lg border bg-popover p-2 shadow-lg">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              aria-label="Pesquisar Cedente"
              autoFocus
              role="combobox"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={aberto}
              aria-activedescendant={indiceAtivo >= 0 ? `${listboxId}-${indiceAtivo}` : undefined}
              value={termo}
              onChange={(event) => {
                const proximo = event.target.value
                setTermo(proximo)
                setIndiceAtivo(-1)
                setErro(null)
                if (!deveExecutarBuscaCedentes(proximo)) setCarregando(false)
              }}
              onKeyDown={tratarTeclado}
              className="h-9 pl-8"
              placeholder="Razao social, nome fantasia ou CNPJ"
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto">
            {carregando ? (
              <div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Buscando Cedentes...
              </div>
            ) : erro ? (
              <p className="p-3 text-sm text-destructive" role="alert">{erro}</p>
            ) : (!deveExecutarBuscaCedentes(q) ? [] : opcoes).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{mensagemVazia}</p>
            ) : opcoes.map((opcao, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={opcao.id}
                type="button"
                role="option"
                aria-selected={selecionado?.id === opcao.id}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-muted ${indiceAtivo === index ? 'bg-muted' : ''}`}
                onMouseEnter={() => setIndiceAtivo(index)}
                onClick={() => selecionar(opcao)}
              >
                <Check className={`mt-0.5 size-4 shrink-0 ${selecionado?.id === opcao.id ? 'opacity-100' : 'opacity-0'}`} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{opcao.nomeFantasia || opcao.razaoSocial}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {opcao.razaoSocial} · {formatCNPJ(opcao.cnpj)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
