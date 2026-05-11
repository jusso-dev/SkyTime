import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkyTime",
  description: "Simple time tracking, reminders, task boards, and polished timesheet exports.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
