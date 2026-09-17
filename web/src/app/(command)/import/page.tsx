import type { Metadata } from "next"; import { ImportPage } from "@/features/import/import-page";
export const metadata: Metadata = { title: "Import" }; export default function Page() { return <ImportPage />; }
