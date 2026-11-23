import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "superRestaurant POS",
    short_name: "superRestaurant",
    description: "Sistema POS para restaurantes multi-sucursal.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "es",
    dir: "ltr",
    background_color: "#f7f8fa",
    theme_color: "#0076a8",
    categories: ["business", "food", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
