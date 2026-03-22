import Link from 'next/link'
import {
  ShieldCheck,
  TrendingUp,
  Zap,
  BarChart3,
  Users,
  Wallet,
  ArrowRight,
  CheckCircle,
} from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
              BW
            </div>
            <span className="text-lg font-bold tracking-tight text-foreground">Antecipa</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Entrar
            </Link>
            <Link
              href="/cadastro"
              className="px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Criar conta
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-32 relative">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Zap size={14} />
              Plataforma 100% digital
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight tracking-tight">
              Antecipe seus recebiveis com{' '}
              <span className="text-primary">seguranca</span> e{' '}
              <span className="text-primary">agilidade</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl">
              Transforme suas notas fiscais em capital de giro. Processo rapido, taxas competitivas
              e conta escrow para protecao total dos seus recursos.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/cadastro"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-base font-semibold bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
              >
                Comecar agora
                <ArrowRight size={18} />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-base font-semibold border border-border text-foreground rounded-xl hover:bg-muted transition-colors"
              >
                Ja tenho conta
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 sm:py-28 bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Tudo que voce precisa em uma plataforma
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Do envio da nota fiscal ao desembolso, acompanhe cada etapa com transparencia total.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: Zap,
                title: 'Processo agil',
                desc: 'Envie XMLs de NF-e com leitura automatica. Analise e aprovacao em ate 24h.',
                color: 'bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400',
              },
              {
                icon: ShieldCheck,
                title: 'Conta escrow',
                desc: 'Recursos protegidos em conta vinculada com rastreabilidade completa de movimentacoes.',
                color: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
              },
              {
                icon: TrendingUp,
                title: 'Taxas competitivas',
                desc: 'Condicoes personalizadas por prazo e volume. Simulacao instantanea do valor liquido.',
                color: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
              },
              {
                icon: BarChart3,
                title: 'Dashboard completo',
                desc: 'Visao em tempo real de operacoes, saldos, vencimentos e performance da carteira.',
                color: 'bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400',
              },
              {
                icon: Users,
                title: 'Multi-portal',
                desc: 'Portais dedicados para cedentes, sacados, consultores e gestores com permissoes granulares.',
                color: 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
              },
              {
                icon: Wallet,
                title: 'Extrato detalhado',
                desc: 'Acompanhe creditos, debitos e saldos com filtros por periodo e exportacao de dados.',
                color: 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group p-6 rounded-2xl border border-border/50 hover:border-primary/20 hover:shadow-lg transition-all bg-background"
              >
                <div className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center mb-4`}>
                  <feature.icon size={24} />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground">
              Como funciona
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              4 passos simples para antecipar seus recebiveis
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Cadastre-se', desc: 'Crie sua conta e envie os documentos da empresa para habilitacao.' },
              { step: '02', title: 'Envie NFs', desc: 'Faca upload dos XMLs de NF-e. O sistema preenche tudo automaticamente.' },
              { step: '03', title: 'Solicite', desc: 'Selecione as NFs aprovadas e veja a simulacao do valor liquido em tempo real.' },
              { step: '04', title: 'Receba', desc: 'Apos aprovacao, o valor e depositado na sua conta. Rapido e seguro.' },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary font-bold text-xl flex items-center justify-center mx-auto mb-4">
                  {item.step}
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-28 bg-primary relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-10 -left-20 w-72 h-72 rounded-full bg-white/30 blur-3xl" />
          <div className="absolute bottom-10 right-10 w-96 h-96 rounded-full bg-white/20 blur-3xl" />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-bold text-primary-foreground mb-4">
            Pronto para comecar?
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-10 max-w-xl mx-auto">
            Crie sua conta gratuitamente e comece a antecipar seus recebiveis hoje mesmo.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/cadastro"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold bg-white text-primary rounded-xl hover:bg-white/90 transition-colors"
            >
              Criar conta gratuita
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-primary-foreground/70">
            <span className="flex items-center gap-1.5"><CheckCircle size={16} /> Sem taxa de adesao</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={16} /> Processo 100% digital</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={16} /> Suporte dedicado</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold text-xs">
                BW
              </div>
              <span className="text-sm font-semibold text-foreground">Antecipa</span>
              <span className="text-xs text-muted-foreground">by Blue Wave Asset Management</span>
            </div>
            <p className="text-xs text-muted-foreground">
              2024-2026 Blue Wave Asset Management. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
