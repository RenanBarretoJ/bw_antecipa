import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O log de desenvolvimento do Next inclui argumentos de Server Actions;
  // intents assinados de upload nunca devem aparecer no terminal.
  logging: false,
  // pdf-parse usa require() interno e acessa o filesystem — não pode ser bundlado pelo Webpack.
  // Com esta flag Next.js usa o require nativo do Node.js, eliminando o workaround do lazy require.
  serverExternalPackages: [
    'pdf-parse',
    'sharp',
    'jszip',
    'handlebars',
  ],
  reactCompiler: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    // Limite do corpo da requisição no proxy interno (middleware incluído).
    // Deve ser >= serverActions.bodySizeLimit para não cortar uploads de PDFs em lote.
    proxyClientMaxBodySize: '50mb',
  },
  async headers() {
    const isDev = process.env.NODE_ENV === 'development'
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : 'https://*.supabase.co'
    const supabaseWebSocketOrigin = supabaseUrl
      ? (() => {
          const url = new URL(supabaseUrl)
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
          return url.origin
        })()
      : 'wss://*.supabase.co'
    const imageSources = ["'self'", 'data:', 'blob:']
    if (supabaseUrl) imageSources.push(supabaseOrigin)
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `connect-src 'self' ${supabaseOrigin} ${supabaseWebSocketOrigin} https://*.supabase.co wss://*.supabase.co`,
              `img-src ${imageSources.join(' ')}`,
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
              "frame-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
};

export default nextConfig;
