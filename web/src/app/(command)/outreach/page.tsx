import type { Metadata } from "next"; import { PeopleWorkspace } from "@/features/people/people-workspace";
export const metadata: Metadata = { title: "Outreach" }; export default function Page() { return <PeopleWorkspace mode="outreach" />; }
