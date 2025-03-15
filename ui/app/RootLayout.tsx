import { EthereumWalletProvider } from "@/providers/EthereumWalletProvider";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <EthereumWalletProvider>
        <body>{children}</body>
      </EthereumWalletProvider>
    </html>
  );
}
