export type CnpjDadosConsultados = {
  cnpj: string
  razao_social: string
  nome_fantasia: string
  cnae_principal: string
  situacao_cadastral: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  telefone: string
  email: string
}

export type CepDadosConsultados = {
  cep: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
}

export type BancoCatalogo = {
  id: string
  codigo: string
  ispb: string | null
  nome: string
  nome_completo: string | null
}
