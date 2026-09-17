import type { Metadata } from "next"; import { ReferralsPage } from "@/features/referrals/referrals-page";
export const metadata: Metadata = { title: "Referrals" }; export default function Page() { return <ReferralsPage />; }
