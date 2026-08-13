import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "QueryMind Admin",
  description: "QueryMind SaaS admin portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
