import type { Metadata } from "next"; import { NewPersonPage } from "@/features/people/new-person-page";
export const metadata: Metadata = { title: "New person" }; export default function Page() { return <NewPersonPage />; }
