import type { Metadata } from "next"; import { OperationsPage } from "@/features/reporting/operations-page";
export const metadata: Metadata = { title: "Operations" }; export default function Page() { return <OperationsPage />; }
