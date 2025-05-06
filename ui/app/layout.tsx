import Providers from "@/providers/Providers";
import "../styles/globals.css";
import { Toaster } from "sonner";

export const metadata = {
  title: "Mina zkApp UI",
  description: "built with o1js",
  icons: {
    icon: "/assets/favicon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
