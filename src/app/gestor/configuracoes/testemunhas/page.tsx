'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, UserCheck, UserX } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { adicionarTestemunha, listarTestemunhas, toggleTestemunhaAtivo } from '@/lib/actions/testemunhas'

interface Testemunha {
  id: string
  nome: string
  cpf: string
  email: string | null
  ativo: boolean
  created_at: string
}

export default function TestemunhasPage() {
  const [testemunhas, setTestemunhas] = useState<Testemunha[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Form nova testemunha
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [email, setEmail] = useState('')
  const [adicionando, setAdicionando] = useState(false)

  const carregar = async () => {
    const data = await listarTestemunhas()
    setTestemunhas(data as Testemunha[])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [])

  const handleAdicionar = async () => {
    if (!nome.trim() || !cpf.trim()) {
      setMessage('Nome e CPF sao obrigatorios.')
      setMessageType('error')
      return
    }
    setAdicionando(true)
    const result = await adicionarTestemunha(nome, cpf, email || null)
    setMessage(result.message)
    setMessageType(result.success ? 'success' : 'error')
    if (result.success) {
      setNome('')
      setCpf('')
      setEmail('')
      await carregar()
    }
    setAdicionando(false)
  }

  const handleToggle = async (id: string, ativo: boolean) => {
    const result = await toggleTestemunhaAtivo(id, !ativo)
    setMessage(result.message)
    setMessageType(result.success ? 'success' : 'error')
    if (result.success) await carregar()
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/gestor/configuracoes">
          <Button variant="ghost" size="icon">
            <ArrowLeft size={20} />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Testemunhas</h1>
          <p className="text-sm text-muted-foreground">Lista global de testemunhas usadas nos termos de cessao.</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          messageType === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
            : 'bg-destructive/10 text-destructive border border-destructive/20'
        }`}>
          {message}
        </div>
      )}

      <div className="space-y-6">
        {/* Lista */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Testemunhas Cadastradas</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : testemunhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma testemunha cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {testemunhas.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      t.ativo ? 'bg-background' : 'bg-muted/30 opacity-60'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{t.nome}</p>
                      <p className="text-xs text-muted-foreground">CPF: {t.cpf}</p>
                      {t.email && <p className="text-xs text-muted-foreground">{t.email}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.ativo ? 'default' : 'secondary'} className="text-xs">
                        {t.ativo ? 'Ativa' : 'Inativa'}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(t.id, t.ativo)}
                        className="text-xs gap-1"
                      >
                        {t.ativo ? <><UserX size={13} /> Desativar</> : <><UserCheck size={13} /> Ativar</>}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Adicionar */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus size={16} />
              Adicionar Testemunha
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="nome">Nome completo *</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="NOME COMPLETO"
                  className="uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cpf">CPF *</Label>
                <Input
                  id="cpf"
                  value={cpf}
                  onChange={(e) => setCpf(e.target.value)}
                  placeholder="000.000.000-00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail (opcional)</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>
            <Button onClick={handleAdicionar} disabled={adicionando} className="w-full sm:w-auto">
              {adicionando ? 'Adicionando...' : 'Adicionar'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
