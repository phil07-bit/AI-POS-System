import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "AI-POS", template: "%s · AI-POS" }, description: "AI Property Operating System — property, tenancy and rent operations for Ghana." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
