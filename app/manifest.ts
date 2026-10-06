import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ORDA ERP",
    short_name: "ORDA",
    description: "Безопасная рабочая система ALTYN SAPA",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#0B1120",
    lang: "ru",
    icons: [],
  };
}
