import Providers from "@/providers/Providers.tsx";
import "../styles/globals.css";
import { Toaster } from "sonner";

export const metadata = {
  title: "Nori zkApp UI",
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
