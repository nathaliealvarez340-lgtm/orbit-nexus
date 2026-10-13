import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "@/components/experience/experience.css";
import { serverExperience } from "@/lib/experience/server";
import { ExperienceProvider } from "@/components/experience/experience-provider";
import { WebPrivacy } from "@/components/privacy/web-privacy";
import { siteOrigin, webDescription } from "@/lib/web-metadata";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "ORBIT Nexus", template: "%s | ORBIT Nexus" },
  description: webDescription,
  metadataBase: new URL(siteOrigin() || "http://localhost:3101"),
  robots: { index: true, follow: true },
  referrer: "no-referrer",
  openGraph: {
    siteName: "ORBIT Nexus",
    title: "ORBIT Nexus",
    description: webDescription,
    locale: "es_MX",
    type: "website",
  },
  icons: {
    icon: "/logo/favicon-orbit.png",
    shortcut: "/logo/favicon-orbit.png",
    apple: "/logo/favicon-orbit.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const experience = await serverExperience();
  return (
    <html
      lang={experience.locale}
      data-theme={experience.theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ExperienceProvider
          initial={{
            theme: experience.theme,
            locale: experience.locale,
            timezone: experience.timezone,
            revision:
              "revision" in experience &&
              typeof experience.revision === "number"
                ? experience.revision
                : undefined,
          }}
        >
          <WebPrivacy>{children}</WebPrivacy>
        </ExperienceProvider>
      </body>
    </html>
  );
}
