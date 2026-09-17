import type { Metadata } from "next"; import { PersonPage } from "@/features/people/person-page";
export const metadata: Metadata = { title: "Relationship workspace" }; export default function Page() { return <PersonPage />; }
