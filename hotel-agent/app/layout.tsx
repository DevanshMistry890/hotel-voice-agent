import type { Metadata } from "next";
import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "The Grand Hotel AI",
  description: "Concierge AI Agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* 1. LOAD TAILWIND VIA CDN */}
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        {/* 2. CONFIGURE ANIMATIONS DIRECTLY IN BROWSER */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              tailwind.config = {
                theme: {
                  extend: {
                    animation: {
                      blob: "blob 7s infinite",
                    },
                    keyframes: {
                      blob: {
                        "0%": { transform: "translate(0px, 0px) scale(1)" },
                        "33%": { transform: "translate(30px, -50px) scale(1.1)" },
                        "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
                        "100%": { transform: "translate(0px, 0px) scale(1)" },
                      },
                    },
                  },
                },
              }
            `,
          }}
        />
        
        {/* 3. ADD GLOBAL STYLES MANUALLY */}
        <style>{`
          body { background: #FDFDFD; }
          .scrollbar-hide::-webkit-scrollbar { display: none; }
          .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
          .animation-delay-2000 { animation-delay: 2s; }
          .animation-delay-4000 { animation-delay: 4s; }
        `}</style>
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}