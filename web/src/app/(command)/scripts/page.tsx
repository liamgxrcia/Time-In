import type { Metadata } from "next"; import { ScriptsPage } from "@/features/scripts/scripts-page";
export const metadata: Metadata = { title: "Scripts" }; export default function Page() { return <ScriptsPage />; }
