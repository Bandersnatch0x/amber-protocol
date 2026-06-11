import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider } from '@/lib/theme-provider';
import { ThemeToggle } from '@/components/ThemeToggle';

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
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <TRPCProvider>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
              <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="flex justify-between h-16">
                    <div className="flex">
                      <div className="flex-shrink-0 flex items-center">
                        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                          Amber Protocol
                        </h1>
                      </div>
                      <div className="ml-6 flex space-x-8">
                        <a
                          href="/sessions"
                          className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent text-sm font-medium text-gray-500 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100"
                        >
                          Sessions
                        </a>
                        <a
                          href="/routes"
                          className="inline-flex items-center px-1 pt-1 border-b-2 border-transparent text-sm font-medium text-gray-500 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-100"
                        >
                          Routes
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <ThemeToggle />
                    </div>
                  </div>
                </div>
              </nav>
              <main>{children}</main>
            </div>
          </TRPCProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
