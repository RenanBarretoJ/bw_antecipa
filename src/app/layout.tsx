import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/theme-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BW Antecipa - Portal de Antecipacao de Recebiveis",
  description: "Sistema financeiro de antecipacao de recebiveis por cessao de Notas Fiscais",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased light`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const theme = localStorage.getItem('bw-antecipa-theme') === 'dark' ? 'dark' : 'light'; const root = document.documentElement; root.classList.toggle('dark', theme === 'dark'); root.classList.toggle('light', theme === 'light'); root.style.colorScheme = theme; } catch (_) {} })()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
