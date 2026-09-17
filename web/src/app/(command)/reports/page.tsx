import type { Metadata } from "next"; import { ReportsPage } from "@/features/reporting/reports-page";
export const metadata: Metadata = { title: "Reports" }; export default function Page() { return <ReportsPage />; }
