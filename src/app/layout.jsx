import "./globals.css";

export const metadata = {
  title: "Puffbuddy | Product Discovery",
  description: "Explore products, compare features, and request items in store."
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f9f6"
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
