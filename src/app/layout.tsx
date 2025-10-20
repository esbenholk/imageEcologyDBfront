export const metadata = {
  title: "Image Ecology Database",
  description: "aggregating images since 2024",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* <link
          rel="icon"
          href={`https://res.cloudinary.com/dmwpm8iiw/image/upload/v1755240875/favicon_muszun.ico`}
          sizes="any"
        /> */}
      </head>

      <body>{children}</body>
    </html>
  );
}
