import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AMAFH CORE",
    short_name: "AMAFH CORE",
    description: "AMAFH CORE business operations workspace",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f8",
    theme_color: "#6f0d83",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icon1.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/amafh-core-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/amafh-core-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
