import React from 'react';
import '../styles/global.css';

export const metadata = {
  title: "Wizard's Chess — Cathedral Evolution | Cathedral Ultra & Experimental Learning Lab",
  description:
    '3D Gothic Cathedral Chess Platform featuring Cathedral Ultra, X-Ray Tactical Awareness, and a Parallel Self-Play Experimental Learning Laboratory.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
