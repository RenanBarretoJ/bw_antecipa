import Link from 'next/link'
import { MailCheck, ShieldCheck } from 'lucide-react'

export default function CadastroPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#125dcc] px-6 py-12 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-white/20 bg-white/10 p-7 shadow-xl backdrop-blur sm:p-9">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-white text-[#125dcc]">
            <MailCheck size={24} aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">Acesso seguro</p>
            <h1 className="text-2xl font-bold tracking-tight">Cadastro por convite</h1>
          </div>
        </div>

        <p className="mt-6 text-sm leading-6 text-white/80">
          Novos Cedentes sao cadastrados a partir de um convite enviado pelo gestor do fundo. Assim, a empresa ja nasce vinculada ao contexto operacional correto.
        </p>

        <div className="mt-5 rounded-xl border border-white/15 bg-white/10 p-4 text-sm text-white/75">
          <p className="flex items-center gap-2 font-semibold text-white"><ShieldCheck size={16} /> Ja recebeu um convite?</p>
          <p className="mt-1">Abra o link individual enviado ao seu e-mail para definir a senha e iniciar o onboarding.</p>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          <Link href="/login" className="inline-flex h-10 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-black hover:bg-white/90">Ja tenho acesso</Link>
          <Link href="/" className="inline-flex h-10 items-center justify-center rounded-lg border border-white/30 px-4 text-sm font-semibold text-white hover:bg-white/10">Voltar ao inicio</Link>
        </div>
      </section>
    </main>
  )
}
