import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './phase35b.css';
import './phase35c5.css';

export const metadata: Metadata = {
  title: 'InfraTwin',
  description: 'Browser-native network decision digital twin',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
