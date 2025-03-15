import "../styles/globals.css";
import { EthereumWalletProvider } from "@/providers/EthereumWalletProvider";

export const metadata = {
  title: "Mina zkApp UI",
  description: "built with o1js",
  icons: {
    icon: "/assets/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <EthereumWalletProvider>
        {/* <MinaWalletProvider> */}
        <body>{children}</body>
        {/* </MinaWalletProvider> */}
      </EthereumWalletProvider>
    </html>
  );
}
