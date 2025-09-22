import type React from "react";
import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/next";
import { Toaster } from "@/components/ui/sonner";
export const metadata: Metadata = {
  title: "LEED Target Finder",
  description: "Assess your project’s LEED feasibility with ease",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" style={{ fontFamily: "Arial, sans-serif" }}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Analytics />
        <Toaster />
      </body>
    </html>
  );
}
