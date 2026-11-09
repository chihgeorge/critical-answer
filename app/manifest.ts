import type { MetadataRoute } from "next";
import { webManifest } from "@/lib/web-manifest";

export default function manifest(): MetadataRoute.Manifest {
  return webManifest("/");
}
