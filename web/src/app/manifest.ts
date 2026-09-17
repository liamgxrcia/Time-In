import type { MetadataRoute } from "next";
import { brand } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${brand.name} · ${brand.descriptor}`,
    short_name: brand.name,
    description: brand.description,
    start_url: "/today",
    display: "standalone",
    background_color: "#f7f4ec",
    theme_color: "#111211",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
