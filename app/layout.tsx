export const metadata = {
  title: "Advbox",
  description: "Chatbot e Webhook do WhatsApp",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-br">
      <body>{children}</body>
    </html>
  );
}
