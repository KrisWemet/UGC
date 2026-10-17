import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UGC Studio",
  description: "Research a URL and turn it into UGC-style short video ads.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
