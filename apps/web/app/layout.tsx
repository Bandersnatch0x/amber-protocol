import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { TRPCProvider } from '@/lib/trpc-provider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Amber Protocol - Web Viewer',
  description: 'Session visualization and monitoring for Amber Protocol',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TRPCProvider>
          <div className="min-h-screen bg-gray-50">
            <nav className="bg-white border-b border-gray-200">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                  <div className="flex">
                    <div className="flex-shrink-0 flex items-center">
                      <h1 className="text-xl font-bold text-gray-900">
                        Amber Protocol
                      </h1>
                    </div>
                    <div className="ml-6 flex space-x-8">
                      <a
                        href="/sessions"
                        className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                      >
                        Sessions
                      </a>
                      <a
                        href="/routes"
                        className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent text-sm font-medium text-gray-500 hover:border-gray-300 hover:text-gray-700"
                      >
                        Routes
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </nav>
            <main>{children}</main>
          </div>
        </TRPCProvider>
      </body>
    </html>
  );
}
