'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { cadastrarCedente } from '@/lib/actions/cedente'
import {
  etapa1Schema, etapa2Schema, etapa3Schema,
  bancosBrasileiros,
  type Etapa1Data, type Etapa2Data, type Etapa3Data, type CedenteFormData,
} from '@/lib/validations/cedente'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const STORAGE_KEY = 'bw_antecipa_cadastro_cedente'

type FormErrors = Record<string, string[]>

function maskCNPJ(v: string) {
  return v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18)
}
function maskCPF(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2').slice(0, 14)
}
function maskPhone(v: string) {
  const n = v.replace(/\D/g, '')
  if (n.length <= 10) return n.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return n.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 15)
}
function maskCEP(v: string) {
  return v.replace(/\D/g, '').replace(/(\d{5})(\d)/, '$1-$2').slice(0, 9)
}

export default function CadastroCedentePage() {
  const router = useRouter()
  const [etapa, setEtapa] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [message, setMessage] = useState('')
  const [buscandoCep, setBuscandoCep] = useState(false)
  const [buscandoCnpj, setBuscandoCnpj] = useState(false)

  const [form, setForm] = useState<Partial<CedenteFormData>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    }
    return {}
  })

  // Auto-save no localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
  }, [form])

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const buscarCNPJ = async (cnpj: string) => {
    const clean = cnpj.replace(/\D/g, '')
    if (clean.length !== 14) return
    setBuscandoCnpj(true)
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`)
      if (!res.ok) return
      const data = await res.json()
      const telefone = (data.ddd_telefone_1 || '').replace(/\D/g, '')
      const cepLimpo = (data.cep || '').replace(/\D/g, '')
      setForm((prev) => ({
        ...prev,
        razao_social:       data.razao_social   || prev?.razao_social   || '',
        nome_fantasia:      data.nome_fantasia   || prev?.nome_fantasia  || '',
        cnae:               data.cnae_fiscal     ? String(data.cnae_fiscal) : prev?.cnae || '',
        logradouro:         data.logradouro      || prev?.logradouro     || '',
        numero:             data.numero          || prev?.numero         || '',
        complemento:        data.complemento     || prev?.complemento    || '',
        bairro:             data.bairro          || prev?.bairro         || '',
        cidade:             data.municipio       || prev?.cidade         || '',
        estado:             data.uf              || prev?.estado         || '',
        cep:                cepLimpo             || prev?.cep            || '',
        email_comercial:    data.email           || prev?.email_comercial || '',
        telefone_comercial: telefone             || prev?.telefone_comercial || '',
      }))
    } catch { /* ignore */ }
    setBuscandoCnpj(false)
  }

  const buscarCEP = async (cep: string) => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    setBuscandoCep(true)
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setForm((prev) => ({
          ...prev,
          logradouro: data.logradouro || prev?.logradouro || '',
          bairro: data.bairro || prev?.bairro || '',
          cidade: data.localidade || prev?.cidade || '',
          estado: data.uf || prev?.estado || '',
        }))
      }
    } catch { /* ignore */ }
    setBuscandoCep(false)
  }

  const validarEtapa = () => {
    const schemas = { 1: etapa1Schema, 2: etapa2Schema, 3: etapa3Schema }
    const schema = schemas[etapa as keyof typeof schemas]
    const result = schema.safeParse(form)
    if (!result.success) {
      setErrors(result.error.flatten().fieldErrors as FormErrors)
      return false
    }
    setErrors({})
    return true
  }

  const avancar = () => {
    if (validarEtapa()) setEtapa((e) => e + 1)
  }

  const voltar = () => setEtapa((e) => e - 1)

  const submeter = async () => {
    if (!validarEtapa()) return
    setLoading(true)
    setMessage('')

    const result = await cadastrarCedente(form as CedenteFormData)

    if (result?.success) {
      localStorage.removeItem(STORAGE_KEY)
      router.push('/cedente/documentos')
    } else {
      setMessage(result?.message || 'Erro ao cadastrar.')
      if (result?.errors) setErrors(result.errors)
    }
    setLoading(false)
  }

  const inputClass = (field: string) =>
    errors[field] ? 'border-destructive focus-visible:ring-destructive' : ''

  const ErrorMsg = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-destructive text-sm mt-1">{errors[field][0]}</p> : null

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground mb-2">Cadastro do Cedente</h1>
      <p className="text-muted-foreground mb-6">Preencha os dados para solicitar habilitacao na plataforma.</p>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {['Dados da Empresa', 'Representante Legal', 'Dados Bancarios'].map((label, i) => (
          <div key={label} className="flex items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              etapa > i + 1
                ? 'bg-emerald-500 text-white'
                : etapa === i + 1
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}>
              {etapa > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`ml-2 text-sm font-medium ${
              etapa === i + 1 ? 'text-primary' : 'text-muted-foreground'
            }`}>
              {label}
            </span>
            {i < 2 && (
              <div className={`flex-1 h-0.5 mx-3 ${
                etapa > i + 1 ? 'bg-emerald-500' : 'bg-border'
              }`} />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Etapa 1 */}
          {etapa === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">CNPJ *</Label>
                  <Input className={`h-11 ${inputClass('cnpj')}`} value={maskCNPJ(form.cnpj || '')}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '')
                      updateField('cnpj', v)
                      if (v.length === 14) buscarCNPJ(v)
                    }} placeholder="00.000.000/0000-00" />
                  {buscandoCnpj && <p className="text-primary text-xs mt-1">Buscando dados da empresa...</p>}
                  <ErrorMsg field="cnpj" />
                </div>
                <div>
                  <Label className="mb-1">Razao Social *</Label>
                  <Input className={`h-11 ${inputClass('razao_social')}`} value={form.razao_social || ''}
                    onChange={(e) => updateField('razao_social', e.target.value)} />
                  <ErrorMsg field="razao_social" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">Nome Fantasia</Label>
                  <Input className={`h-11 ${inputClass('nome_fantasia')}`} value={form.nome_fantasia || ''}
                    onChange={(e) => updateField('nome_fantasia', e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">CNAE</Label>
                  <Input className={`h-11 ${inputClass('cnae')}`} value={form.cnae || ''}
                    onChange={(e) => updateField('cnae', e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">CEP *</Label>
                  <Input className={`h-11 ${inputClass('cep')}`} value={maskCEP(form.cep || '')}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '')
                      updateField('cep', v)
                      if (v.length === 8) buscarCEP(v)
                    }} placeholder="00000-000" />
                  {buscandoCep && <p className="text-primary text-xs mt-1">Buscando endereco...</p>}
                  <ErrorMsg field="cep" />
                </div>
                <div className="md:col-span-2">
                  <Label className="mb-1">Logradouro *</Label>
                  <Input className={`h-11 ${inputClass('logradouro')}`} value={form.logradouro || ''}
                    onChange={(e) => updateField('logradouro', e.target.value)} />
                  <ErrorMsg field="logradouro" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="mb-1">Numero *</Label>
                  <Input className={`h-11 ${inputClass('numero')}`} value={form.numero || ''}
                    onChange={(e) => updateField('numero', e.target.value)} />
                  <ErrorMsg field="numero" />
                </div>
                <div>
                  <Label className="mb-1">Complemento</Label>
                  <Input className={`h-11 ${inputClass('complemento')}`} value={form.complemento || ''}
                    onChange={(e) => updateField('complemento', e.target.value)} />
                </div>
                <div>
                  <Label className="mb-1">Bairro *</Label>
                  <Input className={`h-11 ${inputClass('bairro')}`} value={form.bairro || ''}
                    onChange={(e) => updateField('bairro', e.target.value)} />
                  <ErrorMsg field="bairro" />
                </div>
                <div>
                  <Label className="mb-1">Cidade *</Label>
                  <Input className={`h-11 ${inputClass('cidade')}`} value={form.cidade || ''}
                    onChange={(e) => updateField('cidade', e.target.value)} />
                  <ErrorMsg field="cidade" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">Estado *</Label>
                  <Input className={`h-11 ${inputClass('estado')}`} value={form.estado || ''} maxLength={2}
                    onChange={(e) => updateField('estado', e.target.value.toUpperCase())} placeholder="UF" />
                  <ErrorMsg field="estado" />
                </div>
                <div>
                  <Label className="mb-1">Telefone Comercial *</Label>
                  <Input className={`h-11 ${inputClass('telefone_comercial')}`} value={maskPhone(form.telefone_comercial || '')}
                    onChange={(e) => updateField('telefone_comercial', e.target.value.replace(/\D/g, ''))} placeholder="(00) 00000-0000" />
                  <ErrorMsg field="telefone_comercial" />
                </div>
                <div>
                  <Label className="mb-1">E-mail Comercial *</Label>
                  <Input className={`h-11 ${inputClass('email_comercial')}`} type="email" value={form.email_comercial || ''}
                    onChange={(e) => updateField('email_comercial', e.target.value)} />
                  <ErrorMsg field="email_comercial" />
                </div>
              </div>
            </div>
          )}

          {/* Etapa 2 */}
          {etapa === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">Nome Completo *</Label>
                  <Input className={`h-11 ${inputClass('nome_representante')}`} value={form.nome_representante || ''}
                    onChange={(e) => updateField('nome_representante', e.target.value)} />
                  <ErrorMsg field="nome_representante" />
                </div>
                <div>
                  <Label className="mb-1">CPF *</Label>
                  <Input className={`h-11 ${inputClass('cpf_representante')}`} value={maskCPF(form.cpf_representante || '')}
                    onChange={(e) => updateField('cpf_representante', e.target.value.replace(/\D/g, ''))} placeholder="000.000.000-00" />
                  <ErrorMsg field="cpf_representante" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">RG *</Label>
                  <Input className={`h-11 ${inputClass('rg_representante')}`} value={form.rg_representante || ''}
                    onChange={(e) => updateField('rg_representante', e.target.value)} />
                  <ErrorMsg field="rg_representante" />
                </div>
                <div>
                  <Label className="mb-1">Cargo na Empresa *</Label>
                  <Input className={`h-11 ${inputClass('cargo_representante')}`} value={form.cargo_representante || ''}
                    onChange={(e) => updateField('cargo_representante', e.target.value)} />
                  <ErrorMsg field="cargo_representante" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1">E-mail *</Label>
                  <Input className={`h-11 ${inputClass('email_representante')}`} type="email" value={form.email_representante || ''}
                    onChange={(e) => updateField('email_representante', e.target.value)} />
                  <ErrorMsg field="email_representante" />
                </div>
                <div>
                  <Label className="mb-1">Telefone Celular *</Label>
                  <Input className={`h-11 ${inputClass('telefone_representante')}`} value={maskPhone(form.telefone_representante || '')}
                    onChange={(e) => updateField('telefone_representante', e.target.value.replace(/\D/g, ''))} placeholder="(00) 00000-0000" />
                  <ErrorMsg field="telefone_representante" />
                </div>
              </div>
            </div>
          )}

          {/* Etapa 3 */}
          {etapa === 3 && (
            <div className="space-y-4">
              <div>
                <Label className="mb-1">Banco *</Label>
                <select
                  className={`h-11 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    errors['banco'] ? 'border-destructive' : 'border-input'
                  }`}
                  value={form.banco || ''}
                  onChange={(e) => updateField('banco', e.target.value)}
                >
                  <option value="">Selecione o banco</option>
                  {bancosBrasileiros.map((b) => (
                    <option key={b.codigo} value={`${b.codigo} - ${b.nome}`}>{b.codigo} - {b.nome}</option>
                  ))}
                </select>
                <ErrorMsg field="banco" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1">Agencia *</Label>
                  <Input className={`h-11 ${inputClass('agencia')}`} value={form.agencia || ''}
                    onChange={(e) => updateField('agencia', e.target.value.replace(/\D/g, ''))} placeholder="0000" />
                  <ErrorMsg field="agencia" />
                </div>
                <div>
                  <Label className="mb-1">Conta *</Label>
                  <Input className={`h-11 ${inputClass('conta')}`} value={form.conta || ''}
                    onChange={(e) => updateField('conta', e.target.value)} placeholder="00000-0" />
                  <ErrorMsg field="conta" />
                </div>
                <div>
                  <Label className="mb-1">Tipo de Conta *</Label>
                  <select
                    className={`h-11 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      errors['tipo_conta'] ? 'border-destructive' : 'border-input'
                    }`}
                    value={form.tipo_conta || ''}
                    onChange={(e) => updateField('tipo_conta', e.target.value)}
                  >
                    <option value="">Selecione</option>
                    <option value="corrente">Corrente</option>
                    <option value="poupanca">Poupanca</option>
                  </select>
                  <ErrorMsg field="tipo_conta" />
                </div>
              </div>
            </div>
          )}

          {message && (
            <div className={`mt-4 p-3 rounded-lg text-sm border ${
              message.includes('sucesso')
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            }`}>{message}</div>
          )}

          {/* Botoes */}
          <div className="flex justify-between mt-6 pt-4 border-t border-border">
            {etapa > 1 ? (
              <Button variant="outline" onClick={voltar}>
                Voltar
              </Button>
            ) : <div />}

            {etapa < 3 ? (
              <Button variant="default" onClick={avancar}>
                Proximo
              </Button>
            ) : (
              <Button
                onClick={submeter}
                disabled={loading}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Finalizar Cadastro'
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
