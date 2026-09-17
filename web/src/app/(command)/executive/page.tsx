import type { Metadata } from "next"; import { ExecutivePage } from "@/features/reporting/executive-page";
export const metadata: Metadata = { title: "Executive" }; export default function Page() { return <ExecutivePage />; }
