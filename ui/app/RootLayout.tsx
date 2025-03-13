import { MinaWalletProvider } from "@/providers/MinaWalletProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <MinaWalletProvider>
        <body>{children}</body>
      </MinaWalletProvider>
    </html>
  );
}
