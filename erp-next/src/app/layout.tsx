import { AuthProvider } from '@/context/AuthContext'
// @ts-nocheck
import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './Providers'

export const metadata: Metadata = {
  title: 'Dejiandkola ERP',
  description: 'Production Management',
  openGraph: {
    title: 'Dejiandkola ERP',
    description: 'Production Management',
    images: [
      {
        url: '/logo.png',
        width: 1200,
        height: 630,
        alt: 'Dejiandkola ERP',
      },
    ],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        <AuthProvider>
          <Providers>
            {children}
          </Providers>
        </AuthProvider>
      </body>
    </html>
  )
}
